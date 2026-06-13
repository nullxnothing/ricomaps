// X (Twitter) reply bot. Polls @mentions, extracts a Solana CA, asks the app to
// scan it, and replies with the forensic summary. Mirrors the AtlasEngine pattern:
// a setInterval poll loop + fire-and-forget fetches to the app's internal routes.
//
// Reads use the app-only Bearer token. Writes (posting replies) use an OAuth2
// USER token, which expires (~2h) and is refreshed via the refresh token.

const X_API = 'https://api.x.com/2';
const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const POLL_INTERVAL_MS = Number(process.env.X_POLL_INTERVAL_MS ?? 45_000);
const SEEN_MAX = 5_000;                 // bound the dedupe set
const BASE58_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
// Refresh the user token a minute before it actually expires.
const TOKEN_REFRESH_SKEW_MS = 60_000;

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
  private mentionsHandled = 0;
  private repliesPosted = 0;

  constructor(private readonly cfg: XBotConfig) {
    this.accessToken = cfg.accessToken;
    this.refreshToken = cfg.refreshToken;
    setInterval(() => void this.pollMentions(), POLL_INTERVAL_MS);
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

  private async pollMentions(): Promise<void> {
    try {
      const url = new URL(`${X_API}/users/${this.cfg.userId}/mentions`);
      url.searchParams.set('max_results', '20');
      url.searchParams.set('tweet.fields', 'text,author_id');
      if (this.sinceId) url.searchParams.set('since_id', this.sinceId);

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.cfg.bearerToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.error(`[x-bot] mentions poll failed: HTTP ${res.status}`);
        return;
      }
      const body = await res.json() as { data?: MentionTweet[]; meta?: { newest_id?: string } };
      const tweets = body.data ?? [];
      // newest_id advances the high-water mark even when no tweet had a CA.
      if (body.meta?.newest_id) this.sinceId = body.meta.newest_id;

      // Oldest first so replies land in chronological order.
      for (const tweet of [...tweets].reverse()) {
        if (this.seen.has(tweet.id)) continue;
        this.seen.add(tweet.id);
        this.boundSeen();
        const mint = this.extractMint(tweet.text);
        if (!mint) continue;
        this.mentionsHandled++;
        await this.handleMention(tweet.id, mint);
      }
    } catch (err) {
      console.error('[x-bot] poll error:', err);
    }
  }

  /** First base58 run that looks like a mint (length 32-44). Catches CAs inside URLs/sentences. */
  private extractMint(text: string): string | null {
    for (const m of text.match(BASE58_RE) ?? []) {
      if (m.length >= 32 && m.length <= 44) return m;
    }
    return null;
  }

  private async handleMention(tweetId: string, mint: string): Promise<void> {
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
        return;
      }
      const body = await res.json() as { success?: boolean; text?: string; notToken?: boolean };
      // No text => not a token CA (e.g. a wallet address) or scan unavailable. Skip the reply.
      if (!body.success || !body.text) return;
      text = body.text;
    } catch (err) {
      console.error(`[x-bot] x-scan error for ${mint}:`, err);
      return;
    }
    await this.postReply(tweetId, text);
  }

  private async postReply(inReplyToTweetId: string, text: string): Promise<void> {
    try {
      const token = await this.validAccessToken();
      if (!token) return;
      const res = await fetch(`${X_API}/tweets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: inReplyToTweetId } }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        this.repliesPosted++;
        return;
      }
      console.error(`[x-bot] reply failed for ${inReplyToTweetId}: HTTP ${res.status} ${await res.text()}`);
    } catch (err) {
      console.error(`[x-bot] reply error for ${inReplyToTweetId}:`, err);
    }
  }

  /** Return a non-expired user access token, refreshing if needed. */
  private async validAccessToken(): Promise<string | null> {
    if (Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_SKEW_MS) return this.accessToken;
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
        console.error(`[x-bot] token refresh failed: HTTP ${res.status} ${await res.text()}`);
        return null;
      }
      const body = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!body.access_token) return null;
      this.accessToken = body.access_token;
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
