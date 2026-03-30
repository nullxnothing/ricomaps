<p align="center">
  <img src="public/banner.png" alt="RicoMaps — Bubble Maps. Real-time." width="100%" />
</p>

# RicoMaps

Solana forensic intelligence tool. Trace wallet funding chains, detect cabal funders, snipers, and coordinated bundle clusters across token launches.

## Features

- **Token Scan** — Paste any Solana token mint. Analyzes top holders, traces who funded each one, and detects coordinated actors.
- **Wallet Scan** — Trace funding chain backwards from any wallet to find who funded it.
- **Cabal Detection** — Identifies wallets that funded multiple token holders (shared funders).
- **Sniper Detection** — Flags wallets that bought within the first 10 blocks / 60 seconds after launch.
- **Bundle Detection** — Detects wallets that bought in the same Jito bundle (same-slot transactions). Serial bundlers are tracked across multiple token scans.
- **Blacklist** — Accumulated bundle clusters across scans. Exportable as CSV.
- **Live Streaming** — WebSocket feed of real-time transactions for watched wallets.
- **2D Force Graph** — Interactive canvas visualization with cluster detection, node types, and suspicious link highlighting.

## Tech Stack

- Next.js 16 (App Router)
- React 19
- TypeScript 5
- Tailwind CSS v4
- D3 Force Simulation (canvas rendering)
- Helius API (Solana RPC, Wallet API, DAS, Enhanced Transactions)
- PostgreSQL (optional, for persistent caching)

## Setup

```bash
git clone https://github.com/Nullxnothing/cabal-visualizer.git
cd cabal-visualizer
npm install
```

Create `.env.local`:

```
HELIUS_API_KEY=your_helius_api_key
```

Optional (additional API keys for higher throughput):

```
HELIUS_API_KEY_2=
HELIUS_API_KEY_3=
HELIUS_API_KEY_4=
HELIUS_DEDICATED_RPC=
DATABASE_URL=postgresql://...
```

Get a Helius API key at [dashboard.helius.dev](https://dashboard.helius.dev).

## Development

```bash
npm run dev       # Dev server on port 3600
npm run build     # Production build
npm run lint      # ESLint
```

## Architecture

```
src/
├── app/
│   ├── page.tsx                 # Landing + graph view
│   ├── blacklist/page.tsx       # Blacklist page
│   └── api/
│       ├── scan/route.ts        # Auto-detect wallet vs token
│       ├── trace/route.ts       # Wallet funding chain
│       ├── token/route.ts       # Token holder analysis
│       ├── expand/route.ts      # On-demand node expansion
│       ├── stream/route.ts      # WebSocket transaction stream
│       ├── blacklist/route.ts   # Bundle cluster queries
│       └── trending/route.ts    # Trending tokens feed
├── components/
│   ├── BubbleMap.tsx            # 2D force graph (canvas)
│   ├── StatsPanel.tsx           # Risk + stats sidebar
│   ├── BlacklistView.tsx        # Blacklist page UI
│   ├── ClusterCard.tsx          # Bundle cluster card
│   └── ...
├── hooks/
│   ├── useGraphData.ts          # Central graph state
│   ├── useBlacklist.ts          # Blacklist data fetching
│   └── useTransactionStream.ts  # WebSocket stream
└── lib/
    ├── helius.ts                # Helius API wrapper (rate limiting, caching, retries)
    ├── holder-mapper.ts         # Token holder analysis + cabal/sniper/bundle detection
    ├── graph-builder.ts         # Wallet funding chain tracer (BFS)
    ├── bundle-detector.ts       # Same-slot bundle cluster detection
    ├── graph-analysis.ts        # Cluster detection (union-find) + centrality
    ├── db-cache.ts              # PostgreSQL scan cache
    ├── db-blacklist.ts          # Bundle cluster persistence (PG + in-memory fallback)
    └── types.ts                 # All TypeScript interfaces
```

## How Bundle Detection Works

1. During a token scan, early transactions are fetched for all analyzed holders
2. Transactions are grouped by Solana slot number
3. If 2+ holder wallets transacted in the same slot, they were likely in a Jito bundle
4. Overlapping clusters are merged (union-find)
5. Clusters persist in PostgreSQL (or in-memory) and accumulate across scans
6. Wallets appearing in bundles across multiple tokens are flagged as serial bundlers

## License

MIT
