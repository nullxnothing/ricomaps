import {
  subscribe,
  CommitmentLevel,
  type StreamHandle,
  type SubscribeRequest,
  type SubscribeUpdate,
} from 'helius-laserstream';
import { parseHolderDeltas, type HolderDelta } from './parse.js';

/** A connected browser; the worker writes SSE frames to it. */
export interface SseClient {
  send: (event: string, data: unknown) => void;
}

const TX_FILTER_LABEL = 'holders';
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
  private readonly removalTimers = new Map<string, NodeJS.Timeout>();
  private connected = false;

  constructor(
    private readonly apiKey: string,
    private readonly endpoint: string,
  ) {}

  isConnected(): boolean {
    return this.connected;
  }

  watchedMints(): string[] {
    return [...this.clientsByMint.keys()];
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
    const timer = setTimeout(() => {
      this.removalTimers.delete(mint);
      const current = this.clientsByMint.get(mint);
      if (current && current.size === 0) {
        this.clientsByMint.delete(mint);
        void this.applySubscription();
      }
    }, UNSUBSCRIBE_DEBOUNCE_MS);
    this.removalTimers.set(mint, timer);
  }

  private buildRequest(): SubscribeRequest {
    const mints = [...this.clientsByMint.keys()];
    return {
      transactions: {
        [TX_FILTER_LABEL]: {
          vote: false,
          failed: false,
          accountInclude: mints,
          accountExclude: [],
          accountRequired: [],
        },
      },
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
    const watched = new Set(this.clientsByMint.keys());
    if (watched.size === 0) return;

    let deltas: HolderDelta[];
    try {
      deltas = parseHolderDeltas(update, watched);
    } catch (err) {
      console.error('[laserstream] parse error:', err);
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
