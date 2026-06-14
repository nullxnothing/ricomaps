import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { LaserStreamManager, type SseClient } from './laserstream.js';
import { AtlasEngine } from './atlas.js';
import { XBot } from './x-bot.js';
import { XTracker } from './x-tracker.js';

const PORT = Number(process.env.PORT ?? 8080);
const API_KEY = process.env.HELIUS_LASERSTREAM_API_KEY ?? '';
const ENDPOINT = process.env.HELIUS_LASERSTREAM_ENDPOINT ?? '';
// Comma-separated allowed origins (the deployed app + localhost dev).
const APP_ORIGIN = (process.env.APP_ORIGIN ?? 'http://localhost:3600')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const HEARTBEAT_MS = 15_000;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

if (!API_KEY || !ENDPOINT) {
  console.error('[worker] Missing HELIUS_LASERSTREAM_API_KEY or HELIUS_LASERSTREAM_ENDPOINT. Exiting.');
  process.exit(1);
}

const manager = new LaserStreamManager(API_KEY, ENDPOINT);

// Atlas ingestion needs the app's internal endpoints; without both env vars it stays off
// and the worker behaves exactly as before.
const ATLAS_APP_URL = (process.env.ATLAS_APP_URL ?? '').replace(/\/$/, '');
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? '';
const atlas = ATLAS_APP_URL && INTERNAL_API_SECRET ? new AtlasEngine(ATLAS_APP_URL, INTERNAL_API_SECRET) : null;
if (atlas) {
  manager.attachAtlas(atlas);
  atlas.attachManager(manager);
  manager.start().catch((err) => console.error('[worker] atlas boot connect failed:', err));
  console.log(`[worker] atlas ingestion enabled → ${ATLAS_APP_URL}`);
} else {
  console.log('[worker] atlas ingestion disabled (set ATLAS_APP_URL + INTERNAL_API_SECRET)');
}

// X reply bot: polls @mentions, scans the CA via the app, replies. Off unless all
// of its env vars are present (mirrors atlas), so the worker is unchanged otherwise.
const X_USER_ID = process.env.X_USER_ID ?? '';
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN ?? '';
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN ?? '';
const X_REFRESH_TOKEN = process.env.X_REFRESH_TOKEN ?? '';
const X_CLIENT_ID = process.env.X_CLIENT_ID ?? '';
const xBotReady = ATLAS_APP_URL && INTERNAL_API_SECRET && X_USER_ID && X_BEARER_TOKEN && X_ACCESS_TOKEN && X_REFRESH_TOKEN && X_CLIENT_ID;
const xBot = xBotReady
  ? new XBot({
      appUrl: ATLAS_APP_URL,
      internalSecret: INTERNAL_API_SECRET,
      userId: X_USER_ID,
      bearerToken: X_BEARER_TOKEN,
      clientId: X_CLIENT_ID,
      clientSecret: process.env.X_CLIENT_SECRET || undefined,
      accessToken: X_ACCESS_TOKEN,
      refreshToken: X_REFRESH_TOKEN,
    })
  : null;
console.log(xBot
  ? '[worker] X reply bot enabled'
  : '[worker] X reply bot disabled (set X_USER_ID, X_BEARER_TOKEN, X_ACCESS_TOKEN, X_REFRESH_TOKEN, X_CLIENT_ID)');

// X recycled-account tracker: daily handle→user-id resolver. Read-only, so it only
// needs the app bearer + the internal bridge — no OAuth2 user token. Gated like atlas.
const xTrackerReady = ATLAS_APP_URL && INTERNAL_API_SECRET && X_BEARER_TOKEN && process.env.X_TRACKER_ENABLED !== '0';
const xTracker = xTrackerReady
  ? new XTracker({ appUrl: ATLAS_APP_URL, internalSecret: INTERNAL_API_SECRET, bearerToken: X_BEARER_TOKEN })
  : null;
console.log(xTracker
  ? '[worker] X account tracker enabled'
  : '[worker] X account tracker disabled (needs ATLAS_APP_URL + INTERNAL_API_SECRET + X_BEARER_TOKEN)');

const app = express();

app.use(cors({ origin: APP_ORIGIN }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    connected: manager.isConnected(),
    watchedMints: manager.watchedMints().length,
    watchedWallets: manager.watchedWallets().length,
    atlas: atlas ? { enabled: true, clients: atlas.clientCount() } : { enabled: false },
    xBot: xBot ? { enabled: true, ...xBot.stats() } : { enabled: false },
    xTracker: xTracker ? { enabled: true, ...xTracker.stats() } : { enabled: false },
  });
});

// One-shot duplicate-reply cleanup. GET = dry-run (lists groups, deletes
// nothing); POST = execute. Secret-gated. Use to remove the duplicate replies
// posted before the sinceId-persistence fix.
app.all('/x-cleanup', async (req: Request, res: Response) => {
  if (!INTERNAL_API_SECRET || req.header('x-internal-secret') !== INTERNAL_API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!xBot) {
    res.status(503).json({ error: 'X bot not enabled' });
    return;
  }
  const execute = req.method === 'POST';
  try {
    const result = await xBot.cleanupDuplicates({ execute });
    const toDelete = result.groups.reduce((n, g) => n + g.deletable.length, 0);
    res.json({ dryRun: !execute, dupGroups: result.groups.length, toDelete, ...result });
  } catch (err) {
    console.error('[x-cleanup] failed:', err);
    res.status(500).json({ error: 'Cleanup failed' });
  }
});

// Global atlas feed — pump.fun creates, graduations, cabal hits, rug events.
app.get('/stream/atlas', (req: Request, res: Response) => {
  if (!atlas) {
    res.status(503).json({ error: 'Atlas ingestion not enabled on this worker' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.writeHead(200);
  res.flushHeaders?.();

  const client: SseClient = {
    send: (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };

  const heartbeat = setInterval(() => client.send('heartbeat', {}), HEARTBEAT_MS);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    atlas.removeClient(client);
  };
  req.on('close', cleanup);
  res.on('error', cleanup);

  atlas.addClient(client);
  client.send('ready', {});
});

app.get('/stream/holders', async (req: Request, res: Response) => {
  const mint = String(req.query.mint ?? '');
  if (!BASE58_RE.test(mint)) {
    res.status(400).json({ error: 'Valid mint address required' });
    return;
  }

  // Use setHeader (not writeHead with an object) so the CORS middleware's
  // Access-Control-Allow-Origin header set earlier on this response is preserved.
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.writeHead(200);
  res.flushHeaders?.();

  const client: SseClient = {
    send: (event, data) => {
      // res.write returns false under backpressure; SSE frames are tiny, so we ignore it.
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };

  const heartbeat = setInterval(() => client.send('heartbeat', {}), HEARTBEAT_MS);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    manager.removeClient(mint, client);
  };
  req.on('close', cleanup);
  res.on('error', cleanup);

  try {
    await manager.addClient(mint, client);
    client.send('ready', { mint });
  } catch (err) {
    console.error('[worker] failed to subscribe client:', err);
    client.send('error', { message: 'failed to subscribe to LaserStream' });
    cleanup();
    res.end();
  }
});

// Watch a cabal's funding wallets for native-SOL fan-out (the pre-launch tell).
const MAX_WATCHED_WALLETS = 25;

app.get('/stream/cabal', async (req: Request, res: Response) => {
  const wallets = String(req.query.wallets ?? '')
    .split(',')
    .map((w) => w.trim())
    .filter((w) => BASE58_RE.test(w))
    .slice(0, MAX_WATCHED_WALLETS);

  if (wallets.length === 0) {
    res.status(400).json({ error: 'At least one valid wallet address required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.writeHead(200);
  res.flushHeaders?.();

  const client: SseClient = {
    send: (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };

  const heartbeat = setInterval(() => client.send('heartbeat', {}), HEARTBEAT_MS);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    for (const wallet of wallets) manager.removeWalletClient(wallet, client);
  };
  req.on('close', cleanup);
  res.on('error', cleanup);

  try {
    await Promise.all(wallets.map((wallet) => manager.addWalletClient(wallet, client)));
    client.send('ready', { wallets });
  } catch (err) {
    console.error('[worker] failed to subscribe cabal client:', err);
    client.send('error', { message: 'failed to subscribe to LaserStream' });
    cleanup();
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`[worker] LaserStream SSE worker listening on :${PORT} (origins: ${APP_ORIGIN.join(', ')})`);
});
