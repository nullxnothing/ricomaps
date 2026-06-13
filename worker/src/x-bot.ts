// X (Twitter) reply bot. Polls @mentions, extracts a Solana CA, asks the app to
// scan it, and replies with the forensic summary. Mirrors the AtlasEngine pattern:
// a setInterval poll loop + fire-and-forget fetches to the app's internal routes.
//
// Reads use the app-only Bearer token. Writes (posting replies) use an OAuth2
// USER token, which expires (~2h) and is refreshed via the refresh token.

const X_API = 'https://api.x.com/2';
const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
// Base cadence between mention polls. Lower = faster replies but more reads;
// the adaptive backoff below stretches this automatically when X says we're
// running low on the rate-limit window, so 15s is safe to default.
const POLL_INTERVAL_MS = Number(process.env.X_POLL_INTERVAL_MS ?? 15_000);
// Never poll faster than this even if the window looks healthy.
const MIN_POLL_INTERVAL_MS = 5_000;
// When the mentions window has few requests left, slow down. If remaining drops
// to/below this, the next poll waits until the window resets instead of racing
// into a 429.
const RATE_LIMIT_FLOOR = 2;
const SEEN_MAX = 5_000;                 // bound the dedupe set
const BASE58_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
// Refresh the user token a minute before it actually expires.
const TOKEN_REFRESH_SKEW_MS = 60_000;
// After a hard refresh failure (e.g. a dead/revoked refresh token), back off
// before retrying so we don't hammer X's token endpoint on every poll/mention
// and risk a rate-limit. Clears as soon as one refresh succeeds.
const REFRESH_BACKOFF_MS = 10 * 60_000;

export interface XBotConfig {
  appUrl: string;            // RicoMaps app base URL (ATLAS_APP_URL)
  internalSecret: string;    // x-internal-secret for the app routes
  userId: string;            // @RicoMaps numeric user id
  bearerToken: string;       // app-only bearer (reads)
  clientId: string;          // OAuth2 client id (for token refresh)
  clientSecret?: string;     // OAuth2 client secret (confidential clients)
  accessToken: string;       // initial OAuth2 user access token (writes)
  refreshToken: string;      // OAuth2 refresh token
}

interface MentionTweet {
  id: string;
  text: string;
  author_id?: string;
}

export class XBot {
  private sinceId: string | null = null;
  private readonly seen = new Set<string>();   // replied tweet ids (dedupe)
  private accessToken: string;
  private refreshToken: string;
  private refreshTokenLoaded = false;           // loaded the rotated token from the app yet?
  private tokenExpiresAt = 0;                   // ms epoch; 0 => refresh before first write
  private refreshBlockedUntil = 0;              // ms epoch; backoff after a hard refresh failure
  private mentionsHandled = 0;
  private repliesPosted = 0;

  constructor(private readonly cfg: XBotConfig) {
    this.accessToken = cfg.accessToken;
    this.refreshToken = cfg.refreshToken;
    this.scheduleNextPoll(POLL_INTERVAL_MS);
  }

  /**
   * Self-scheduling poll loop. Each poll computes the next delay from X's
   * rate-limit headers, so we run fast when the window is healthy and stretch
   * out automatically as it depletes — no fixed interval that races into 429s.
   */
  private scheduleNextPoll(delayMs: number): void {
    setTimeout(async () => {
      const nextDelay = await this.pollMentions();
      this.scheduleNextPoll(nextDelay);
    }, Math.max(MIN_POLL_INTERVAL_MS, delayMs));
  }

  /**
   * Load the latest rotated refresh token persisted by a previous run. X rotates
   * the refresh token on every refresh; without this the worker would reuse the
   * stale env-seeded token after a restart and fail with invalid_request.
   */
  private async loadPersistedRefreshToken(): Promise<void> {
    if (this.refreshTokenLoaded) return;
    this.refreshTokenLoaded = true; // mark first so a transient failure doesn't loop forever
    try {
      const res = await fetch(`${this.cfg.appUrl}/api/internal/x-token`, {
        headers: { 'x-internal-secret': this.cfg.internalSecret },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return;
      const body = await res.json() as { refreshToken?: string | null };
      if (body.refreshToken) this.refreshToken = body.refreshToken;
    } catch (err) {
      console.error('[x-bot] failed to load persisted refresh token:', err);
    }
  }

  /** Persist the rotated refresh token so the next restart picks it up. */
  private async persistRefreshToken(token: string): Promise<void> {
    try {
      await fetch(`${this.cfg.appUrl}/api/internal/x-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': this.cfg.internalSecret },
        body: JSON.stringify({ refreshToken: token }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      console.error('[x-bot] failed to persist refresh token:', err);
    }
  }

  stats(): { mentionsHandled: number; repliesPosted: number; sinceId: string | null } {
    return { mentionsHandled: this.mentionsHandled, repliesPosted: this.repliesPosted, sinceId: this.sinceId };
  }

  /** Poll once; returns the delay (ms) before the next poll should run. */
  private async pollMentions(): Promise<number> {
    try {
      const url = new URL(`${X_API}/users/${this.cfg.userId}/mentions`);
      url.searchParams.set('max_results', '20');
      url.searchParams.set('tweet.fields', 'text,author_id');
      if (this.sinceId) url.searchParams.set('since_id', this.sinceId);

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.cfg.bearerToken}` },
        signal: AbortSignal.timeout(15_000),
      });

      // A 429 means we're already over: wait the full window the header gives us.
      if (res.status === 429) {
        const wait = this.rateLimitResetDelay(res) ?? 15 * 60_000;
        console.error(`[x-bot] mentions poll 429, backing off ${Math.round(wait / 1000)}s`);
        return wait;
      }
      if (!res.ok) {
        // Surface the body — a bad bearer / wrong user id / missing scope returns
        // a JSON error here that the bare status code hid, which is the usual
        // reason polls "succeed" yet never see a mention.
        const detail = await res.text().catch(() => '');
        console.error(`[x-bot] mentions poll failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
        return POLL_INTERVAL_MS;
      }

      const body = await res.json() as { data?: MentionTweet[]; meta?: { newest_id?: string; result_count?: number }; errors?: unknown };
      const tweets = body.data ?? [];
      // A 200 can still carry partial errors (e.g. permission on a field). Log them.
      if (body.errors) console.error('[x-bot] mentions partial errors:', JSON.stringify(body.errors).slice(0, 200));
      // First poll and any non-empty poll: log what X actually returned so a
      // silently-empty mentions feed is visible instead of looking idle.
      if (this.sinceId === null || (body.meta?.result_count ?? 0) > 0) {
        console.log(`[x-bot] poll: ${body.meta?.result_count ?? 0} mentions, newest=${body.meta?.newest_id ?? 'none'}`);
      }
      // newest_id advances the high-water mark even when no tweet had a CA.
      if (body.meta?.newest_id) this.sinceId = body.meta.newest_id;

      // Oldest first so replies land in chronological order.
      for (const tweet of [...tweets].reverse()) {
        if (this.seen.has(tweet.id)) continue;
        const mint = this.extractMint(tweet.text);
        // No CA in the tweet — mark seen so we never look at it again.
        if (!mint) { this.seen.add(tweet.id); this.boundSeen(); continue; }
        this.mentionsHandled++;
        // Mark seen optimistically to avoid double-replying while in flight, but
        // roll back on a transient failure (scan/post error) so the next poll
        // retries. A duplicate-content 403 or notToken is a permanent skip.
        this.seen.add(tweet.id);
        this.boundSeen();
        const outcome = await this.handleMention(tweet.id, mint);
        if (outcome === 'retry') this.seen.delete(tweet.id);
      }

      return this.nextPollDelay(res);
    } catch (err) {
      console.error('[x-bot] poll error:', err);
      return POLL_INTERVAL_MS;
    }
  }

  /**
   * Decide the next poll delay from the response's rate-limit headers. While the
   * window has headroom we run at the base cadence; once `remaining` hits the
   * floor we wait for the window to reset so we never trip a 429.
   */
  private nextPollDelay(res: Response): number {
    const remaining = Number(res.headers.get('x-rate-limit-remaining'));
    if (Number.isFinite(remaining) && remaining <= RATE_LIMIT_FLOOR) {
      return this.rateLimitResetDelay(res) ?? POLL_INTERVAL_MS;
    }
    return POLL_INTERVAL_MS;
  }

  /** Ms until the rate-limit window resets (from x-rate-limit-reset), or null. */
  private rateLimitResetDelay(res: Response): number | null {
    const resetSec = Number(res.headers.get('x-rate-limit-reset'));
    if (!Number.isFinite(resetSec) || resetSec <= 0) return null;
    return Math.max(MIN_POLL_INTERVAL_MS, resetSec * 1000 - Date.now() + 1_000);
  }

  /** First base58 run that looks like a mint (length 32-44). Catches CAs inside URLs/sentences. */
  private extractMint(text: string): string | null {
    for (const m of text.match(BASE58_RE) ?? []) {
      if (m.length >= 32 && m.length <= 44) return m;
    }
    return null;
  }

  /**
   * Scan a mint and reply. Returns 'retry' for transient failures (scan down,
   * post error) so the caller un-marks the tweet and the next poll tries again;
   * 'done' when there's nothing more to do (replied, not a token, or a permanent
   * reject like duplicate content).
   */
  private async handleMention(tweetId: string, mint: string): Promise<'done' | 'retry'> {
    let text: string;
    try {
      const res = await fetch(`${this.cfg.appUrl}/api/internal/x-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': this.cfg.internalSecret },
        body: JSON.stringify({ mint }),
        signal: AbortSignal.timeout(55_000),
      });
      if (!res.ok) {
        console.error(`[x-bot] x-scan failed for ${mint}: HTTP ${res.status}`);
        return 'retry'; // app hiccup — try again next poll
      }
      const body = await res.json() as { success?: boolean; text?: string; notToken?: boolean };
      // No text => not a token CA (e.g. a wallet) or scan unavailable. Don't retry.
      if (!body.success || !body.text) return 'done';
      text = body.text;
    } catch (err) {
      console.error(`[x-bot] x-scan error for ${mint}:`, err);
      return 'retry';
    }
    return this.postReply(tweetId, text);
  }

  private async postReply(inReplyToTweetId: string, text: string): Promise<'done' | 'retry'> {
    try {
      const token = await this.validAccessToken();
      if (!token) return 'retry'; // no usable token now (refresh backoff) — retry later
      const res = await fetch(`${X_API}/tweets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: inReplyToTweetId } }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        this.repliesPosted++;
        return 'done';
      }
      const detail = await res.text().catch(() => '');
      console.error(`[x-bot] reply failed for ${inReplyToTweetId}: HTTP ${res.status} ${detail}`);
      // 429/5xx are transient → retry. 4xx (dup content, bad request, auth) are
      // permanent for this exact text → done, so we don't loop on it forever.
      return (res.status === 429 || res.status >= 500) ? 'retry' : 'done';
    } catch (err) {
      console.error(`[x-bot] reply error for ${inReplyToTweetId}:`, err);
      return 'retry';
    }
  }

  /** Return a non-expired user access token, refreshing if needed. */
  private async validAccessToken(): Promise<string | null> {
    if (Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_SKEW_MS) return this.accessToken;
    // A recent hard failure (dead token) is in its cooldown: don't retry yet.
    if (Date.now() < this.refreshBlockedUntil) return null;
    return this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<string | null> {
    try {
      // On the first refresh after a restart, prefer the rotated token the app
      // persisted over the (possibly already-invalidated) env-seeded one.
      await this.loadPersistedRefreshToken();
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: this.cfg.clientId,
      });
      const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
      // Confidential clients authenticate with HTTP Basic; public clients send client_id in the body.
      if (this.cfg.clientSecret) {
        headers.Authorization = `Basic ${Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64')}`;
      }
      const res = await fetch(X_TOKEN_URL, { method: 'POST', headers, body: params, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        // 400 = dead/revoked token or bad client creds — re-auth needed, won't
        // self-heal. Back off so we stop hammering X until the token is replaced.
        if (res.status === 400) this.refreshBlockedUntil = Date.now() + REFRESH_BACKOFF_MS;
        console.error(`[x-bot] token refresh failed: HTTP ${res.status} ${await res.text()}`);
        return null;
      }
      const body = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!body.access_token) return null;
      this.accessToken = body.access_token;
      this.refreshBlockedUntil = 0; // success clears any prior backoff
      if (body.refresh_token && body.refresh_token !== this.refreshToken) {
        this.refreshToken = body.refresh_token; // X rotates refresh tokens
        void this.persistRefreshToken(body.refresh_token); // survive restarts
      }
      this.tokenExpiresAt = Date.now() + (body.expires_in ?? 7200) * 1000;
      return this.accessToken;
    } catch (err) {
      console.error('[x-bot] token refresh error:', err);
      return null;
    }
  }

  private boundSeen(): void {
    if (this.seen.size <= SEEN_MAX) return;
    // Drop the oldest ~10% (insertion order) to keep the set bounded.
    const drop = Math.floor(SEEN_MAX * 0.1);
    let i = 0;
    for (const id of this.seen) {
      this.seen.delete(id);
      if (++i >= drop) break;
    }
  }
}
