import {
  subscribe,
  CommitmentLevel,
  type StreamHandle,
  type SubscribeRequest,
  type SubscribeUpdate,
} from 'helius-laserstream';
import { parseHolderDeltas, parseSolMovements, type HolderDelta, type SolMovementDelta } from './parse.js';
import { PUMP_PROGRAM, PUMPSWAP_PROGRAM, PUMP_MINT_AUTHORITY } from './pumpfun.js';
import type { AtlasEngine } from './atlas.js';

/** A connected browser; the worker writes SSE frames to it. */
export interface SseClient {
  send: (event: string, data: unknown) => void;
}

const TX_FILTER_LABEL = 'holders';
const CABAL_FILTER_LABEL = 'cabal';
const ATLAS_CREATES_LABEL = 'atlas-creates';
const ATLAS_MIGRATIONS_LABEL = 'atlas-migrations';
const ATLAS_WALLETS_LABEL = 'atlas-wallets';
const UNSUBSCRIBE_DEBOUNCE_MS = 30_000;

/**
 * Single LaserStream gRPC connection multiplexed across every watched mint.
 *
 * - `accountInclude` is the union of all currently-watched mints.
 * - When the watched set changes we re-`write()` the subscription request on the
 *   live handle (LaserStream supports dynamic updates without reconnecting).
 * - Each transaction update is parsed into per-owner deltas and fanned out only
 *   to the SSE clients watching that delta's mint.
 * - Removals are debounced so quick re-subscribes (page nav, reconnect) don't churn.
 */
export class LaserStreamManager {
  private handle: StreamHandle | null = null;
  private connecting: Promise<void> | null = null;
  private readonly clientsByMint = new Map<string, Set<SseClient>>();
  private readonly walletClients = new Map<string, Set<SseClient>>();
  private readonly removalTimers = new Map<string, NodeJS.Timeout>();
  private connected = false;
  private atlas: AtlasEngine | null = null;
  private atlasWallets: string[] = []; // roster wallets watched for live cabal buys

  constructor(
    private readonly apiKey: string,
    private readonly endpoint: string,
  ) {}

  /** Atlas ingestion rides the same gRPC connection; call before start(). */
  attachAtlas(engine: AtlasEngine): void {
    this.atlas = engine;
  }

  /** Replace the cabal-roster wallets watched for live buys; re-applies the live subscription. */
  setAtlasWallets(wallets: string[]): void {
    const next = [...new Set(wallets)];
    const changed = next.length !== this.atlasWallets.length || next.some((w, i) => w !== this.atlasWallets[i]);
    if (!changed) return;
    this.atlasWallets = next;
    void this.applySubscription();
  }

  /** Connect at boot (atlas ingestion must run with zero SSE clients attached). */
  async start(): Promise<void> {
    await this.ensureConnected();
  }

  isConnected(): boolean {
    return this.connected;
  }

  watchedMints(): string[] {
    return [...this.clientsByMint.keys()];
  }

  watchedWallets(): string[] {
    return [...this.walletClients.keys()];
  }

  async addClient(mint: string, client: SseClient): Promise<void> {
    const pendingRemoval = this.removalTimers.get(mint);
    if (pendingRemoval) {
      clearTimeout(pendingRemoval);
      this.removalTimers.delete(mint);
    }

    let set = this.clientsByMint.get(mint);
    const isNewMint = !set;
    if (!set) {
      set = new Set<SseClient>();
      this.clientsByMint.set(mint, set);
    }
    set.add(client);

    await this.ensureConnected();
    if (isNewMint) await this.applySubscription();
  }

  removeClient(mint: string, client: SseClient): void {
    const set = this.clientsByMint.get(mint);
    if (!set) return;
    set.delete(client);
    if (set.size > 0) return;

    // No clients left for this mint — debounce the unsubscribe.
    const timerKey = `mint:${mint}`;
    const timer = setTimeout(() => {
      this.removalTimers.delete(timerKey);
      const current = this.clientsByMint.get(mint);
      if (current && current.size === 0) {
        this.clientsByMint.delete(mint);
        void this.applySubscription();
      }
    }, UNSUBSCRIBE_DEBOUNCE_MS);
    this.removalTimers.set(timerKey, timer);
  }

  async addWalletClient(wallet: string, client: SseClient): Promise<void> {
    const timerKey = `wallet:${wallet}`;
    const pendingRemoval = this.removalTimers.get(timerKey);
    if (pendingRemoval) {
      clearTimeout(pendingRemoval);
      this.removalTimers.delete(timerKey);
    }

    let set = this.walletClients.get(wallet);
    const isNew = !set;
    if (!set) {
      set = new Set<SseClient>();
      this.walletClients.set(wallet, set);
    }
    set.add(client);

    await this.ensureConnected();
    if (isNew) await this.applySubscription();
  }

  removeWalletClient(wallet: string, client: SseClient): void {
    const set = this.walletClients.get(wallet);
    if (!set) return;
    set.delete(client);
    if (set.size > 0) return;

    const timerKey = `wallet:${wallet}`;
    const timer = setTimeout(() => {
      this.removalTimers.delete(timerKey);
      const current = this.walletClients.get(wallet);
      if (current && current.size === 0) {
        this.walletClients.delete(wallet);
        void this.applySubscription();
      }
    }, UNSUBSCRIBE_DEBOUNCE_MS);
    this.removalTimers.set(timerKey, timer);
  }

  private buildRequest(): SubscribeRequest {
    const mints = [...this.clientsByMint.keys()];
    const wallets = [...this.walletClients.keys()];
    const transactions: Record<string, unknown> = {};
    // Only include a filter when it has accounts — LaserStream rejects an empty
    // accountInclude with no other constraints (would match the whole firehose).
    if (mints.length > 0) {
      transactions[TX_FILTER_LABEL] = { vote: false, failed: false, accountInclude: mints, accountExclude: [], accountRequired: [] };
    }
    if (wallets.length > 0) {
      transactions[CABAL_FILTER_LABEL] = { vote: false, failed: false, accountInclude: wallets, accountExclude: [], accountRequired: [] };
    }
    if (this.atlas) {
      // Creates: the pump.fun mint authority signs every create and appears nowhere else.
      transactions[ATLAS_CREATES_LABEL] = { vote: false, failed: false, accountInclude: [PUMP_MINT_AUTHORITY], accountExclude: [], accountRequired: [] };
      // Graduations: only migration txs touch both the bonding curve and PumpSwap.
      transactions[ATLAS_MIGRATIONS_LABEL] = { vote: false, failed: false, accountInclude: [PUMP_PROGRAM], accountExclude: [], accountRequired: [PUMP_PROGRAM, PUMPSWAP_PROGRAM] };
      // Roster wallets: watched for live token buys → cabal-buy beams.
      if (this.atlasWallets.length > 0) {
        transactions[ATLAS_WALLETS_LABEL] = { vote: false, failed: false, accountInclude: this.atlasWallets, accountExclude: [], accountRequired: [] };
      }
    }
    return {
      transactions,
      commitment: CommitmentLevel.CONFIRMED,
    } as SubscribeRequest;
  }

  private async ensureConnected(): Promise<void> {
    if (this.handle) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      this.handle = await subscribe(
        { apiKey: this.apiKey, endpoint: this.endpoint, replay: true },
        this.buildRequest(),
        (update) => this.onUpdate(update),
        (error) => this.onError(error),
      );
      this.connected = true;
      console.log(`[laserstream] connected (${this.clientsByMint.size} mints)`);
    })();

    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  /** Push the current watched-mint set onto the live subscription (no reconnect). */
  private async applySubscription(): Promise<void> {
    if (!this.handle) return;
    try {
      await this.handle.write(this.buildRequest());
    } catch (err) {
      console.error('[laserstream] failed to update subscription:', err);
    }
  }

  private onUpdate(update: SubscribeUpdate): void {
    if (!update.transaction) return; // ignore ping/pong/slot/account updates

    const watchedMints = new Set(this.clientsByMint.keys());
    if (watchedMints.size > 0) this.dispatchHolderDeltas(update, watchedMints);

    const watchedWallets = new Set(this.walletClients.keys());
    if (watchedWallets.size > 0) this.dispatchSolMovements(update, watchedWallets);

    this.atlas?.handleUpdate(update);
  }

  private dispatchHolderDeltas(update: SubscribeUpdate, watched: Set<string>): void {
    let deltas: HolderDelta[];
    try {
      deltas = parseHolderDeltas(update, watched);
    } catch (err) {
      console.error('[laserstream] holder parse error:', err);
      return;
    }

    for (const delta of deltas) {
      const clients = this.clientsByMint.get(delta.mint);
      if (!clients || clients.size === 0) continue;
      const payload = {
        owner: delta.owner,
        newBalance: delta.newBalance,
        delta: delta.delta,
        slot: delta.slot,
        signature: delta.signature,
      };
      for (const client of clients) client.send('holder', payload);
    }
  }

  private dispatchSolMovements(update: SubscribeUpdate, watched: Set<string>): void {
    let movements: SolMovementDelta[];
    try {
      movements = parseSolMovements(update, watched);
    } catch (err) {
      console.error('[laserstream] sol parse error:', err);
      return;
    }

    for (const m of movements) {
      const clients = this.walletClients.get(m.watchedFunder);
      if (!clients || clients.size === 0) continue;
      const payload = {
        watchedFunder: m.watchedFunder,
        recipient: m.recipient,
        amount: m.amount,
        slot: m.slot,
        signature: m.signature,
        ts: Math.floor(Date.now() / 1000),
      };
      for (const client of clients) client.send('cabal-alert', payload);
    }
  }

  private onError(error: Error): void {
    // The SDK auto-reconnects (with slot replay since replay:true). Surface staleness to clients.
    this.connected = false;
    console.error('[laserstream] stream error (auto-reconnecting):', error.message);
    for (const clients of this.clientsByMint.values()) {
      for (const client of clients) client.send('error', { message: 'stream reconnecting' });
    }
    // Mark reconnected on the next successful update; a heartbeat from the SDK flips it back.
    this.connected = true;
  }
}
