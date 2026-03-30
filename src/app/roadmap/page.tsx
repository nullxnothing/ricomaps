'use client';

import Link from 'next/link';

interface RoadmapItem {
  title: string;
  description: string;
  status: 'completed' | 'in-progress' | 'planned' | 'future';
}

interface RoadmapPhase {
  phase: string;
  title: string;
  timeline: string;
  items: RoadmapItem[];
}

const roadmap: RoadmapPhase[] = [
  {
    phase: 'Phase 1',
    title: 'Foundation',
    timeline: 'Completed',
    items: [
      {
        title: 'Token Holder Mapping',
        description: 'Visualize top holders of any Solana token with interactive 3D bubble maps',
        status: 'completed',
      },
      {
        title: 'Cabal Detection',
        description: 'Identify wallets funded by the same source - expose coordinated holder groups',
        status: 'completed',
      },
      {
        title: 'Wallet Funding Traces',
        description: 'Trace funding chains backwards to find who funded any wallet',
        status: 'completed',
      },
      {
        title: 'Token Security Analysis',
        description: 'Check freeze authority, mint authority, and metadata mutability',
        status: 'completed',
      },
      {
        title: 'Sniper Detection',
        description: 'Flag wallets that bought within the first 10 blocks of token launch',
        status: 'completed',
      },
    ],
  },
  {
    phase: 'Phase 2',
    title: 'Intelligence',
    timeline: 'Q1 2026',
    items: [
      {
        title: 'Bundle Detection',
        description: 'Detect Jito bundles - prove multiple wallets bought in the same atomic transaction',
        status: 'in-progress',
      },
      {
        title: 'Wallet Labels',
        description: 'Tag known wallets: exchanges, VCs, influencers, known scammers',
        status: 'planned',
      },
      {
        title: 'Rug Risk Score',
        description: 'Aggregate risk score (0-100) based on holder concentration, cabal connections, and deployer history',
        status: 'planned',
      },
      {
        title: 'Deployer Analysis',
        description: 'Track deployer wallet history - see their previous token launches and outcomes',
        status: 'planned',
      },
    ],
  },
  {
    phase: 'Phase 3',
    title: 'Tracking',
    timeline: 'Q2 2026',
    items: [
      {
        title: 'Smart Money Tracker',
        description: 'Identify and follow wallets with consistent profitable trades',
        status: 'planned',
      },
      {
        title: 'Copy Trade Detection',
        description: 'Find wallets that consistently mirror another wallet\'s trades',
        status: 'planned',
      },
      {
        title: 'Whale Alerts',
        description: 'Real-time notifications for large movements on watched tokens',
        status: 'planned',
      },
      {
        title: 'Token Comparison',
        description: 'Side-by-side holder overlap analysis between two tokens',
        status: 'planned',
      },
    ],
  },
  {
    phase: 'Phase 4',
    title: 'Social & Sharing',
    timeline: 'Q3 2026',
    items: [
      {
        title: 'Shareable Reports',
        description: 'One-click PNG/PDF reports with RicoMaps branding for sharing on socials',
        status: 'future',
      },
      {
        title: 'Embed Widgets',
        description: 'Embeddable bubble maps for websites and Discord bots',
        status: 'future',
      },
      {
        title: 'Alert Webhooks',
        description: 'Telegram and Discord webhook integrations for real-time alerts',
        status: 'future',
      },
      {
        title: 'Wallet Reputation',
        description: 'Community-driven reputation system for wallet addresses',
        status: 'future',
      },
    ],
  },
  {
    phase: 'Phase 5',
    title: 'Advanced Analytics',
    timeline: 'Q4 2026',
    items: [
      {
        title: 'Time-lapse Replay',
        description: 'Animate funding flows over time - watch how cabals form block by block',
        status: 'future',
      },
      {
        title: 'Historical Snapshots',
        description: 'View holder distribution at any past date',
        status: 'future',
      },
      {
        title: 'Cross-Chain Tracking',
        description: 'Track wallet activity across Solana, Ethereum, and bridges',
        status: 'future',
      },
      {
        title: 'AI Pattern Detection',
        description: 'Machine learning to identify suspicious patterns automatically',
        status: 'future',
      },
    ],
  },
];

const statusColors = {
  completed: 'bg-[#00ff88] text-black',
  'in-progress': 'bg-[#ffd54f] text-black',
  planned: 'bg-[#4a9eff] text-white',
  future: 'bg-[#6b7280] text-white',
};

const statusLabels = {
  completed: 'Completed',
  'in-progress': 'In Progress',
  planned: 'Planned',
  future: 'Future',
};

const phaseColors = {
  'Phase 1': 'border-[#00ff88]',
  'Phase 2': 'border-[#ffd54f]',
  'Phase 3': 'border-[#4a9eff]',
  'Phase 4': 'border-[#ff9f43]',
  'Phase 5': 'border-[#ff3366]',
};

export default function RoadmapPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="border-b border-[#1f2937] bg-[#0a0a0a]/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <img src="/favicon.png" alt="RicoMaps" className="w-8 h-8 rounded-lg" />
            <span className="text-xl font-bold text-[#e34946]">RicoMaps</span>
          </Link>
          <nav className="flex items-center gap-6">
            <Link href="/docs" className="text-sm text-[#9ca3af] hover:text-white transition-colors">
              Docs
            </Link>
            <Link href="/roadmap" className="text-sm text-white font-medium">
              Roadmap
            </Link>
            <a
              href="https://x.com/Nullxnothing"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[#9ca3af] hover:text-white transition-colors"
            >
              Twitter
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="py-16 px-6 text-center border-b border-[#1f2937]">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          <span className="text-[#e34946]">RicoMaps</span> Roadmap
        </h1>
        <p className="text-lg text-[#9ca3af] max-w-2xl mx-auto">
          Our vision for building the most powerful on-chain forensics tool on Solana.
          Follow our progress as we expose the unseen.
        </p>
      </section>

      {/* Legend */}
      <section className="py-6 px-6 border-b border-[#1f2937]">
        <div className="max-w-6xl mx-auto flex flex-wrap justify-center gap-4">
          {Object.entries(statusLabels).map(([status, label]) => (
            <div key={status} className="flex items-center gap-2">
              <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[status as keyof typeof statusColors]}`}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Roadmap Timeline */}
      <section className="py-12 px-6">
        <div className="max-w-4xl mx-auto">
          {roadmap.map((phase, phaseIndex) => (
            <div key={phase.phase} className="relative mb-12 last:mb-0">
              {/* Timeline line */}
              {phaseIndex < roadmap.length - 1 && (
                <div className="absolute left-6 top-16 bottom-0 w-0.5 bg-[#1f2937]" />
              )}

              {/* Phase header */}
              <div className={`flex items-center gap-4 mb-6 border-l-4 pl-4 ${phaseColors[phase.phase as keyof typeof phaseColors] || 'border-[#6b7280]'}`}>
                <div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-[#6b7280] uppercase tracking-wider">
                      {phase.phase}
                    </span>
                    <span className="text-xs text-[#4a9eff]">{phase.timeline}</span>
                  </div>
                  <h2 className="text-2xl font-bold text-white">{phase.title}</h2>
                </div>
              </div>

              {/* Phase items */}
              <div className="ml-4 space-y-4">
                {phase.items.map((item, itemIndex) => (
                  <div
                    key={itemIndex}
                    className="relative bg-[#111318] border border-[#1f2937] rounded-lg p-4 hover:border-[#2d3748] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-white">{item.title}</h3>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${statusColors[item.status]}`}>
                            {statusLabels[item.status]}
                          </span>
                        </div>
                        <p className="text-sm text-[#9ca3af]">{item.description}</p>
                      </div>
                      {item.status === 'completed' && (
                        <div className="text-[#00ff88]">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        </div>
                      )}
                      {item.status === 'in-progress' && (
                        <div className="text-[#ffd54f] animate-pulse">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 6v6l4 2" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-6 border-t border-[#1f2937]">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-4">Have a Feature Request?</h2>
          <p className="text-[#9ca3af] mb-6">
            Join our community and let us know what features you want to see next.
          </p>
          <div className="flex justify-center gap-4">
            <a
              href="https://x.com/Nullxnothing"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 bg-[#1a1a2e] border border-[#2a2a4a] rounded-lg hover:bg-[#252540] transition-colors flex items-center gap-2"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
              Follow @RicoMaps
            </a>
            <Link
              href="/"
              className="px-6 py-3 bg-[#e34946] text-white rounded-lg hover:bg-[#c73e3b] transition-colors"
            >
              Try RicoMaps Now
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#1f2937] py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-[#6b7280]">
            <img src="/favicon.png" alt="RicoMaps" className="w-5 h-5 rounded" />
            <span>RicoMaps - See the unseen on Solana</span>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <Link href="/docs" className="text-[#9ca3af] hover:text-white transition-colors">
              Documentation
            </Link>
            <a
              href="https://pump.fun/coin/GmfCguoum2Mbw6ohrFtjuPo5hjsjoWv36YYzwxdwpump"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#ffd54f] hover:text-[#ffe066] transition-colors"
            >
              $RicoMaps Token
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
