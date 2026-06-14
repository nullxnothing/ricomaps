// X (Twitter) recycled-account tracker. Once a day, resolve every tracked handle to
// its IMMUTABLE numeric user id + current username via X's read API, and ship the
// snapshot back to the app. Over time, two different handles resolving to the same id
// reveal an operator recycling accounts — Phanes' signature signal, but we start the
// clock now and lean on on-chain CA↔account linkage the app already has.
//
// Reads only: uses the app-only Bearer token (no OAuth2 user token, no writes). The
// app owns detection + storage; this worker is just the resolver loop.

const X_API = 'https://api.x.com/2';
// Daily cadence: account churn is slow, and X's user-lookup window is small, so once
// every 24h keeps us well under any rate limit while still catching renames.
const CYCLE_MS = Number(process.env.X_TRACKER_INTERVAL_MS ?? 24 * 60 * 60_000);
// Per-cycle handle cap so one cycle never blows the user-lookup rate-limit window.
const BATCH = Number(process.env.X_TRACKER_BATCH ?? 80);
// Spacing between single-user lookups (X allows bursts but we stay gentle).
const LOOKUP_SPACING_MS = 1_500;

export interface XTrackerConfig {
  appUrl: string;          // RicoMaps app base URL (ATLAS_APP_URL)
  internalSecret: string;  // x-internal-secret for the internal routes
  bearerToken: string;     // app-only bearer (reads)
}

interface ResolvedUser {
  id: string;
  username: string;
  name?: string;
  created_at?: string;
  public_metrics?: { followers_count?: number };
}

interface Snapshot {
  userId: string;
  username: string;
  name?: string;
  createdAt?: number;
  followers?: number;
  seenAt: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class XTracker {
  private cycles = 0;
  private resolved = 0;

  constructor(private readonly cfg: XTrackerConfig) {
    void this.boot();
  }

  stats(): { cycles: number; resolved: number } {
    return { cycles: this.cycles, resolved: this.resolved };
  }

  private async boot(): Promise<void> {
    // Run one cycle shortly after boot, then on the daily interval.
    setTimeout(() => void this.runCycle(), 10_000);
    setInterval(() => void this.runCycle(), CYCLE_MS);
  }

  private async runCycle(): Promise<void> {
    this.cycles++;
    try {
      const handles = await this.fetchTrackedHandles();
      if (handles.length === 0) {
        console.log('[x-tracker] no tracked handles this cycle');
        return;
      }
      const snapshots: Snapshot[] = [];
      const attempted: string[] = [];
      for (const handle of handles.slice(0, BATCH)) {
        attempted.push(handle);
        const user = await this.resolveHandle(handle);
        if (user) {
          snapshots.push({
            userId: user.id,
            username: user.username,
            name: user.name,
            createdAt: user.created_at ? Math.floor(new Date(user.created_at).getTime() / 1000) : undefined,
            followers: user.public_metrics?.followers_count,
            seenAt: Math.floor(Date.now() / 1000),
          });
          this.resolved++;
        }
        await sleep(LOOKUP_SPACING_MS);
      }
      await this.postSnapshots(snapshots, attempted);
      console.log(`[x-tracker] cycle ${this.cycles}: resolved ${snapshots.length}/${attempted.length} handles`);
    } catch (err) {
      console.error('[x-tracker] cycle error:', err);
    }
  }

  private async fetchTrackedHandles(): Promise<string[]> {
    try {
      const res = await fetch(`${this.cfg.appUrl}/api/internal/x-track?limit=${BATCH}`, {
        headers: { 'x-internal-secret': this.cfg.internalSecret },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.error(`[x-tracker] fetch handles failed: HTTP ${res.status}`);
        return [];
      }
      const body = (await res.json()) as { handles?: string[] };
      return body.handles ?? [];
    } catch (err) {
      console.error('[x-tracker] fetch handles error:', err);
      return [];
    }
  }

  private async resolveHandle(handle: string): Promise<ResolvedUser | null> {
    try {
      const url = new URL(`${X_API}/users/by/username/${encodeURIComponent(handle)}`);
      url.searchParams.set('user.fields', 'created_at,public_metrics,username,name');
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.cfg.bearerToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429) {
        // Hit the window: stop this cycle early by signalling null on the rest.
        console.error('[x-tracker] 429 on user lookup, ending cycle early');
        return null;
      }
      if (!res.ok) return null; // suspended / nonexistent handle resolves to nothing
      const body = (await res.json()) as { data?: ResolvedUser };
      return body.data ?? null;
    } catch {
      return null;
    }
  }

  private async postSnapshots(snapshots: Snapshot[], resolved: string[]): Promise<void> {
    try {
      await fetch(`${this.cfg.appUrl}/api/internal/x-track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': this.cfg.internalSecret },
        body: JSON.stringify({ snapshots, resolved }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      console.error('[x-tracker] post snapshots error:', err);
    }
  }
}
