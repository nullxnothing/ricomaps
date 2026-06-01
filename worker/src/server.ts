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
  });
});

app.get('/stream/holders', async (req: Request, res: Response) => {
  const mint = String(req.query.mint ?? '');
  if (!BASE58_RE.test(mint)) {
    res.status(400).json({ error: 'Valid mint address required' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
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

app.listen(PORT, () => {
  console.log(`[worker] LaserStream SSE worker listening on :${PORT} (origins: ${APP_ORIGIN.join(', ')})`);
});
