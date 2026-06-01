# Rico Maps — LaserStream Worker

Always-on Node service holding a single Helius **LaserStream** gRPC connection and pushing
per-owner token balance deltas to Rico Maps browsers over **SSE**. It exists because LaserStream
is a long-lived gRPC stream that cannot run inside a 30s Vercel function.

## Why a separate service

The main app deploys to Vercel serverless (30s function cap, no worker). This worker deploys to an
always-on host (Railway / Fly / Render). The browser connects directly to this worker's SSE
endpoint; the LaserStream key never leaves the worker.

## Run locally (Linux/macOS or WSL — the `helius-laserstream` native binary is not built for Windows)

```bash
cd worker
cp .env.example .env   # fill in HELIUS_LASERSTREAM_API_KEY (rotate it first)
npm install
npm run dev
# health check
curl localhost:8080/health
# stream a mint (replace with an active mint)
curl -N "localhost:8080/stream/holders?mint=<MINT>"
```

You should see `event: ready`, periodic `event: heartbeat`, and `event: holder` frames as buys/sells
land.

## Deploy

- Start command: `npm run build && npm start`
- Env: `HELIUS_LASERSTREAM_API_KEY`, `HELIUS_LASERSTREAM_ENDPOINT`, `APP_ORIGIN`, `PORT`
- Point the app at it: set `NEXT_PUBLIC_HOLDER_STREAM_URL=https://<worker-host>` in the Vercel app.

## SSE event contract

| event       | data                                                                 |
|-------------|----------------------------------------------------------------------|
| `ready`     | `{ "mint": "<MINT>" }`                                                |
| `holder`    | `{ "owner", "newBalance", "delta", "slot", "signature" }`            |
| `heartbeat` | `{}`                                                                 |
| `error`     | `{ "message": "..." }`                                               |

`newBalance === 0` means the owner closed their position (client removes the node). `delta < 0` is a
sell.
