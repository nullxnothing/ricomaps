'use client';

import Link from 'next/link';
import { PageShell } from '@/components/layout/PageShell';
import { PageHeader } from '@/components/layout/PageHeader';
import { Container } from '@/components/layout/Container';

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

const statusConfig = {
  completed:    { label: 'Completed',   cls: 'text-black font-semibold', bg: 'var(--green-primary)' },
  'in-progress':{ label: 'In Progress', cls: 'text-black font-semibold', bg: '#ffd54f' },
  planned:      { label: 'Planned',     cls: 'text-white',               bg: '#4a9eff' },
  future:       { label: 'Future',      cls: 'text-white',               bg: '#555568' },
};

const phaseAccents: Record<string, string> = {
  'Phase 1': 'var(--green-primary)',
  'Phase 2': '#ffd54f',
  'Phase 3': '#4a9eff',
  'Phase 4': '#ff9f43',
  'Phase 5': '#a78bfa',
};

export default function RoadmapPage() {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Roadmap"
        title={(
          <>
            <span style={{ color: 'var(--green-primary)' }}>RicoMaps</span> Roadmap
          </>
        )}
        subtitle="Our vision for building the most powerful on-chain forensics tool on Solana. Follow our progress as we expose the unseen."
      />

      {/* Legend */}
      <section className="py-6 border-b" style={{ borderColor: 'var(--border-base)' }}>
        <Container className="flex flex-wrap justify-center gap-3">
          {Object.entries(statusConfig).map(([status, cfg]) => (
            <span
              key={status}
              className={`px-2 py-1 rounded text-xs font-medium ${cfg.cls}`}
              style={{ background: cfg.bg }}
            >
              {cfg.label}
            </span>
          ))}
        </Container>
      </section>

      {/* Roadmap Timeline */}
      <section className="py-12">
        <Container>
          {roadmap.map((phase, phaseIndex) => (
            <div key={phase.phase} className="relative mb-12 last:mb-0">
              {/* Timeline line */}
              {phaseIndex < roadmap.length - 1 && (
                <div className="absolute left-6 top-16 bottom-0 w-0.5" style={{ background: 'var(--border-base)' }} />
              )}

              {/* Phase header */}
              <div
                className="flex items-center gap-4 mb-6 pl-4"
                style={{ borderLeft: `4px solid ${phaseAccents[phase.phase] ?? 'var(--border-hover)'}` }}
              >
                <div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                      {phase.phase}
                    </span>
                    <span className="text-xs" style={{ color: '#4a9eff' }}>{phase.timeline}</span>
                  </div>
                  <h2 className="text-2xl font-bold text-white">{phase.title}</h2>
                </div>
              </div>

              {/* Phase items */}
              <div className="ml-4 space-y-4">
                {phase.items.map((item, itemIndex) => (
                  <div
                    key={itemIndex}
                    className="relative rounded-lg p-4 border transition-colors"
                    style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-base)'; }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-white">{item.title}</h3>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-medium ${statusConfig[item.status].cls}`}
                            style={{ background: statusConfig[item.status].bg }}
                          >
                            {statusConfig[item.status].label}
                          </span>
                        </div>
                        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{item.description}</p>
                      </div>
                      {item.status === 'completed' && (
                        <div style={{ color: 'var(--green-primary)' }}>
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
        </Container>
      </section>

      {/* CTA */}
      <section className="py-16 border-t" style={{ borderColor: 'var(--border-base)' }}>
        <Container>
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Have a Feature Request?</h2>
            <p className="mb-7" style={{ color: 'var(--text-secondary)' }}>
              Join our community and let us know what features you want to see next.
            </p>
            <div className="flex justify-center gap-3 flex-wrap">
              <a
                href="https://x.com/RicoxMaps"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-cta-secondary"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
                Follow @RicoMaps
              </a>
              <Link href="/" className="btn-cta">Try RicoMaps Now</Link>
            </div>
          </div>
        </Container>
      </section>
    </PageShell>
  );
}
