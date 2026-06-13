import type { SubscribeUpdate } from 'helius-laserstream';
import type { LaserStreamManager, SseClient } from './laserstream.js';
import { parsePumpCreates, parsePumpMigrations, type PumpCreateEvent } from './pumpfun.js';
import { parseWalletBuys } from './parse.js';

const CREATE_MEMORY_MAX = 20_000;      // recent launches kept for createdAt lookup at graduation
const SCAN_DRAIN_INTERVAL_MS = 5_000;  // one scan trigger per tick — app enforces its own concurrency
const SCAN_MAX_ATTEMPTS = 3;
const OUTCOME_INTERVAL_MS = Number(process.env.ATLAS_OUTCOME_INTERVAL_MS ?? 120_000);
const ROSTER_INTERVAL_MS = Number(process.env.ATLAS_ROSTER_INTERVAL_MS ?? 150_000);
const BUY_DEDUPE_MS = 4_000;           // collapse a wallet's repeat buys of one token within this window

interface QueuedScan {
  mint: string;
  attempts: number;
  createdAt?: number;
  graduatedAt: number;
  name?: string;
  symbol?: string;
}

/** Mirror of the app's AlertEvent (src/lib/telegram/alert-format.ts) — kept in sync by hand. */
interface AlertEvent {
  kind: 'bundle-cluster' | 'dev-sell' | 'blacklist-buy' | 'rug';
  mint: string;
  symbol?: string;
  count?: number;
  wallet?: string;
  estExtractedUsd?: number;
  supplyPct?: number;
}

/**
 * Always-on atlas ingestion: watches pump.fun creates/graduations from the shared
 * LaserStream connection, fans live events to /stream/atlas SSE clients, and drives
 * the app's auto-scan + outcome endpoints. Creates are ephemeral (SSE + in-memory
 * only); graduations are what get persisted and scanned — that's the triage knob.
 */
export class AtlasEngine {
  private readonly clients = new Set<SseClient>();
  private readonly recentCreates = new Map<string, PumpCreateEvent>();
  private readonly scanQueue: QueuedScan[] = [];
  private manager: LaserStreamManager | null = null;
  private walletToCabal = new Map<string, string>();
  private watchedWallets = new Set<string>();
  private readonly buyDedupe = new Map<string, number>(); // `${cabalId}:${mint}` -> last broadcast ms

  constructor(
    private readonly appUrl: string,
    private readonly secret: string,
  ) {
    setInterval(() => void this.drainScanQueue(), SCAN_DRAIN_INTERVAL_MS);
    setInterval(() => void this.runOutcomePass(), OUTCOME_INTERVAL_MS);
    setInterval(() => void this.refreshRosters(), ROSTER_INTERVAL_MS);
  }

  /** Wired by the manager so the engine can push its watched-wallet set onto the live subscription. */
  attachManager(manager: LaserStreamManager): void {
    this.manager = manager;
    void this.refreshRosters(); // pull immediately on boot
  }

  addClient(client: SseClient): void {
    this.clients.add(client);
  }

  removeClient(client: SseClient): void {
    this.clients.delete(client);
  }

  clientCount(): number {
    return this.clients.size;
  }

  handleUpdate(update: SubscribeUpdate): void {
    try {
      for (const create of parsePumpCreates(update)) {
        this.rememberCreate(create);
        this.broadcast('token-spawn', create);
      }
      for (const migration of parsePumpMigrations(update)) {
        const create = this.recentCreates.get(migration.mint);
        this.broadcast('graduation', { ...migration, name: create?.name, symbol: create?.symbol });
        this.scanQueue.push({
          mint: migration.mint,
          attempts: 0,
          createdAt: create?.ts,
          graduatedAt: migration.ts,
          name: create?.name,
          symbol: create?.symbol,
        });
      }
      if (this.watchedWallets.size > 0) this.detectBuys(update);
    } catch (err) {
      console.error('[atlas] update handling error:', err);
    }
  }

  /** Roster-wallet token buys → cabal-buy beams, deduped per (cabal, mint). */
  private detectBuys(update: SubscribeUpdate): void {
    const buys = parseWalletBuys(update, this.watchedWallets);
    if (buys.length === 0) return;
    const now = Date.now();
    for (const buy of buys) {
      const cabalId = this.walletToCabal.get(buy.wallet);
      if (!cabalId) continue;
      const key = `${cabalId}:${buy.mint}`;
      if (now - (this.buyDedupe.get(key) ?? 0) < BUY_DEDUPE_MS) continue;
      this.buyDedupe.set(key, now);
      this.broadcast('cabal-buy', {
        cabalId, mint: buy.mint, wallet: buy.wallet,
        ts: Math.floor(now / 1000),
      });
      // A roster wallet is a known bundler from prior launches — a live buy on any
      // watched mint is exactly the "blacklisted-bundler buy" alert. Dedup above keeps it to one per (cabal, mint).
      void this.notify({ kind: 'blacklist-buy', mint: buy.mint, wallet: buy.wallet, count: 1 });
    }
    if (this.buyDedupe.size > 5_000) this.buyDedupe.clear(); // cheap bound; dedupe is best-effort
  }

  private async refreshRosters(): Promise<void> {
    if (!this.manager) return;
    try {
      const res = await fetch(`${this.appUrl}/api/internal/cabal-rosters`, {
        headers: { 'x-internal-secret': this.secret },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.error(`[atlas] roster pull failed: HTTP ${res.status}`);
        return;
      }
      const body = await res.json() as { rosters?: { cabalId: string; wallets: string[] }[] };
      const walletToCabal = new Map<string, string>();
      for (const r of body.rosters ?? []) {
        for (const w of r.wallets) if (!walletToCabal.has(w)) walletToCabal.set(w, r.cabalId);
      }
      this.walletToCabal = walletToCabal;
      this.watchedWallets = new Set(walletToCabal.keys());
      this.manager.setAtlasWallets([...this.watchedWallets]);
      console.log(`[atlas] rosters refreshed: ${body.rosters?.length ?? 0} cabals, ${this.watchedWallets.size} wallets`);
    } catch (err) {
      console.error('[atlas] roster refresh error:', err);
    }
  }

  private rememberCreate(create: PumpCreateEvent): void {
    this.recentCreates.set(create.mint, create);
    if (this.recentCreates.size > CREATE_MEMORY_MAX) {
      // Map iterates in insertion order — evict the oldest entry.
      const oldest = this.recentCreates.keys().next().value;
      if (oldest) this.recentCreates.delete(oldest);
    }
  }

  private broadcast(event: string, data: unknown): void {
    for (const client of this.clients) client.send(event, data);
  }

  private async drainScanQueue(): Promise<void> {
    const job = this.scanQueue.shift();
    if (!job) return;

    try {
      const res = await this.post('/api/internal/auto-scan', {
        mint: job.mint, name: job.name, symbol: job.symbol,
        createdAt: job.createdAt, graduatedAt: job.graduatedAt,
      });
      if (res.ok) {
        const body = await res.json() as {
          rugLevel?: string; fingerprintMatches?: number; cabalSupplyPct?: number;
          bundleClusters?: number; bundledSupplyPct?: number;
        };
        this.broadcast('cabal-activity', {
          mint: job.mint, symbol: job.symbol, ts: Math.floor(Date.now() / 1000),
          rugLevel: body.rugLevel, fingerprintMatches: body.fingerprintMatches ?? 0,
          cabalSupplyPct: body.cabalSupplyPct,
        });
        // Telegram alert funnel — fire on the forensic signals a watcher cares about.
        // The notify route filters to chats actually subscribed to this mint.
        if ((body.bundleClusters ?? 0) > 0) {
          void this.notify({
            kind: 'bundle-cluster', mint: job.mint, symbol: job.symbol,
            count: body.bundleClusters, supplyPct: body.bundledSupplyPct,
          });
        }
        if ((body.fingerprintMatches ?? 0) > 0) {
          void this.notify({
            kind: 'blacklist-buy', mint: job.mint, symbol: job.symbol, count: body.fingerprintMatches,
          });
        }
        return;
      }
      // Queue-full / transient errors: retry with bounded attempts.
      if ((res.status === 429 || res.status >= 500) && job.attempts + 1 < SCAN_MAX_ATTEMPTS) {
        this.scanQueue.push({ ...job, attempts: job.attempts + 1 });
      } else {
        console.error(`[atlas] auto-scan dropped for ${job.mint}: HTTP ${res.status}`);
      }
    } catch (err) {
      if (job.attempts + 1 < SCAN_MAX_ATTEMPTS) {
        this.scanQueue.push({ ...job, attempts: job.attempts + 1 });
      } else {
        console.error(`[atlas] auto-scan failed for ${job.mint}:`, err);
      }
    }
  }

  private async runOutcomePass(): Promise<void> {
    try {
      const res = await this.post('/api/internal/outcomes', {});
      if (!res.ok) {
        console.error(`[atlas] outcome pass failed: HTTP ${res.status}`);
        return;
      }
      const body = await res.json() as { rugEvents?: { mint: string; symbol?: string; estExtractedUsd: number }[] };
      for (const rug of body.rugEvents ?? []) {
        this.broadcast('rug-event', { ...rug, ts: Math.floor(Date.now() / 1000) });
        void this.notify({ kind: 'rug', mint: rug.mint, symbol: rug.symbol, estExtractedUsd: rug.estExtractedUsd });
      }
    } catch (err) {
      console.error('[atlas] outcome pass error:', err);
    }
  }

  /** Fire-and-forget Telegram alert funnel. The app route filters to subscribed chats. */
  private async notify(event: AlertEvent): Promise<void> {
    try {
      const res = await this.post('/api/internal/telegram-notify', event);
      if (!res.ok && res.status !== 404) {
        console.error(`[atlas] telegram-notify ${event.kind} ${event.mint}: HTTP ${res.status}`);
      }
    } catch (err) {
      console.error(`[atlas] telegram-notify failed for ${event.mint}:`, err);
    }
  }

  private post(path: string, body: unknown): Promise<globalThis.Response> {
    return fetch(`${this.appUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': this.secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(55_000), // auto-scan holds the connection for the scan duration
    });
  }
}
