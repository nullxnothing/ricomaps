import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { LaserStreamManager, type SseClient } from './laserstream.js';

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
const app = express();

app.use(cors({ origin: APP_ORIGIN }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    connected: manager.isConnected(),
    watchedMints: manager.watchedMints().length,
    watchedWallets: manager.watchedWallets().length,
  });
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
