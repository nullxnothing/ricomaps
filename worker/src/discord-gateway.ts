import WebSocket from 'ws';

// Minimal Discord gateway listener: auto-detects a Solana CA pasted in any channel
// the bot can see and replies with the forensic card — no /scan needed, mirroring the
// Telegram group behavior. HTTP slash commands can't read messages; only a gateway
// connection with the MESSAGE CONTENT privileged intent can, so this runs in the
// always-on worker (not Vercel). Dependency-light: raw ws, no discord.js.
//
// Requires DISCORD_BOT_TOKEN + the MESSAGE CONTENT INTENT enabled in the Developer
// Portal (Bot → Privileged Gateway Intents).

const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
const REST = 'https://discord.com/api/v10';
const BASE58_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

// Gateway intents bitfield: GUILD_MESSAGES (1<<9) | MESSAGE_CONTENT (1<<15).
const INTENTS = (1 << 9) | (1 << 15);

// Opcodes we handle.
const OP = { DISPATCH: 0, HEARTBEAT: 1, RECONNECT: 7, INVALID_SESSION: 9, HELLO: 10, HEARTBEAT_ACK: 11 } as const;

export interface DiscordGatewayConfig {
  appUrl: string;          // RicoMaps app base URL
  internalSecret: string;  // x-internal-secret for /api/internal routes
  botToken: string;        // DISCORD_BOT_TOKEN
}

export class DiscordGateway {
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private seq: number | null = null;
  private acked = true;
  private botUserId: string | null = null;
  private readonly seen = new Set<string>(); // replied message ids (dedupe)
  private scansHandled = 0;
  private reconnectDelay = 1_000;

  constructor(private readonly cfg: DiscordGatewayConfig) {
    this.connect();
  }

  stats(): { connected: boolean; scansHandled: number } {
    return { connected: this.ws?.readyState === WebSocket.OPEN, scansHandled: this.scansHandled };
  }

  private connect(): void {
    this.ws = new WebSocket(GATEWAY_URL);
    this.ws.on('message', (raw) => this.onMessage(raw.toString()));
    this.ws.on('close', (code) => {
      console.error(`[discord-gw] closed (${code}); reconnecting in ${this.reconnectDelay}ms`);
      this.cleanup();
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000); // backoff cap
    });
    this.ws.on('error', (err) => console.error('[discord-gw] socket error:', err.message));
  }

  private cleanup(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.ws = null;
  }

  private send(op: number, d: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op, d }));
  }

  private onMessage(raw: string): void {
    let payload: { op: number; d: unknown; s: number | null; t: string | null };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (payload.s != null) this.seq = payload.s;

    switch (payload.op) {
      case OP.HELLO: {
        const interval = (payload.d as { heartbeat_interval: number }).heartbeat_interval;
        this.startHeartbeat(interval);
        this.identify();
        this.reconnectDelay = 1_000; // healthy connection resets backoff
        break;
      }
      case OP.HEARTBEAT:
        this.send(OP.HEARTBEAT, this.seq); // server asked for an immediate beat
        break;
      case OP.HEARTBEAT_ACK:
        this.acked = true;
        break;
      case OP.RECONNECT:
      case OP.INVALID_SESSION:
        this.ws?.close(4000); // trigger the reconnect path
        break;
      case OP.DISPATCH:
        this.onDispatch(payload.t, payload.d);
        break;
    }
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.acked = true;
    this.heartbeatTimer = setInterval(() => {
      if (!this.acked) {
        // Missed an ack — the connection is a zombie. Drop it and reconnect.
        console.error('[discord-gw] heartbeat not acked; reconnecting');
        this.ws?.close(4000);
        return;
      }
      this.acked = false;
      this.send(OP.HEARTBEAT, this.seq);
    }, intervalMs);
  }

  private identify(): void {
    this.send(2, {
      token: this.cfg.botToken,
      intents: INTENTS,
      properties: { os: 'linux', browser: 'ricomaps', device: 'ricomaps' },
    });
  }

  private onDispatch(type: string | null, d: unknown): void {
    if (type === 'READY') {
      this.botUserId = (d as { user?: { id?: string } }).user?.id ?? null;
      console.log(`[discord-gw] connected as bot ${this.botUserId}`);
      return;
    }
    if (type === 'MESSAGE_CREATE') {
      void this.onChannelMessage(d as DiscordMessage);
    }
  }

  /** Auto-detect a CA pasted in a channel and reply with the scan card. */
  private async onChannelMessage(msg: DiscordMessage): Promise<void> {
    if (!msg?.id || !msg.channel_id) return;
    if (msg.author?.bot) return;                    // never react to bots (incl. ourselves)
    if (this.seen.has(msg.id)) return;
    const mint = this.extractMint(msg.content ?? '');
    if (!mint) return;
    this.seen.add(msg.id);
    this.boundSeen();

    const card = await this.scan(mint);
    if (!card) return; // not a token / scan failed → stay quiet (group-noise discipline)
    this.scansHandled++;
    await this.reply(msg.channel_id, msg.id, card);
  }

  private extractMint(text: string): string | null {
    for (const m of text.match(BASE58_RE) ?? []) {
      if (m.length >= 32 && m.length <= 44) return m;
    }
    return null;
  }

  /** Ask the app to scan; returns the plain-text card or null if not a token. */
  private async scan(mint: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.cfg.appUrl}/api/internal/discord-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': this.cfg.internalSecret },
        body: JSON.stringify({ mint }),
        signal: AbortSignal.timeout(55_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { success?: boolean; text?: string };
      return body.success && body.text ? body.text : null;
    } catch (err) {
      console.error('[discord-gw] scan error:', err);
      return null;
    }
  }

  private async reply(channelId: string, messageId: string, content: string): Promise<void> {
    try {
      await fetch(`${REST}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${this.cfg.botToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          message_reference: { message_id: messageId, fail_if_not_exists: false },
          allowed_mentions: { parse: [] },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      console.error('[discord-gw] reply error:', err);
    }
  }

  private boundSeen(): void {
    if (this.seen.size <= 5_000) return;
    let i = 0;
    for (const id of this.seen) {
      this.seen.delete(id);
      if (++i >= 500) break;
    }
  }
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  content?: string;
  author?: { id: string; bot?: boolean };
}
