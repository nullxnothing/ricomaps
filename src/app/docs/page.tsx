'use client';

import Link from 'next/link';
import { useState, useCallback, useEffect } from 'react';
import { PageShell } from '@/components/layout/PageShell';
import { PageHeader } from '@/components/layout/PageHeader';
import { Container } from '@/components/layout/Container';
import { BorderBeam } from '@/components/ui/border-beam';

/* ─── Embed Code Generator ─── */

function EmbedCodeGenerator() {
  const [address, setAddress] = useState('');
  const [hideWatermark, setHideWatermark] = useState(false);
  const [width, setWidth] = useState('100%');
  const [height, setHeight] = useState('500px');
  const [copied, setCopied] = useState(false);

  // Start with the canonical origin so SSR and the first client render match,
  // then swap to the live origin after mount to avoid a hydration mismatch.
  const [baseUrl, setBaseUrl] = useState('https://ricomaps.fun');
  useEffect(() => {
    setBaseUrl(window.location.origin);
  }, []);
  const embedUrl = `${baseUrl}/embed?address=${address}${hideWatermark ? '&hideWatermark=true' : ''}`;
  const embedCode = `<iframe
  src="${embedUrl}"
  width="${width}"
  height="${height}"
  frameborder="0"
  allow="accelerometer; gyroscope"
  style="border-radius: 8px;"
></iframe>`;

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [embedCode]);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[11px] font-mono uppercase tracking-wide mb-2" style={{ color: 'var(--text-tertiary)' }}>Wallet or Token Address</label>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Enter Solana address..."
          className="input w-full"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-[11px] font-mono uppercase tracking-wide mb-2" style={{ color: 'var(--text-tertiary)' }}>Watermark</label>
          <select
            value={hideWatermark ? 'hide' : 'show'}
            onChange={(e) => setHideWatermark(e.target.value === 'hide')}
            className="input w-full"
          >
            <option value="show">Show badge</option>
            <option value="hide">Hide badge</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-mono uppercase tracking-wide mb-2" style={{ color: 'var(--text-tertiary)' }}>Width</label>
          <input
            type="text"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            className="input w-full"
          />
        </div>
        <div>
          <label className="block text-[11px] font-mono uppercase tracking-wide mb-2" style={{ color: 'var(--text-tertiary)' }}>Height</label>
          <input
            type="text"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            className="input w-full"
          />
        </div>
      </div>

      {address && (
        <div>
          <label className="block text-[11px] font-mono uppercase tracking-wide mb-2" style={{ color: 'var(--text-tertiary)' }}>Preview URL</label>
          <a
            href={embedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm break-all hover:underline font-mono"
            style={{ color: 'var(--green-primary)' }}
          >
            {embedUrl}
          </a>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-[11px] font-mono uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>Embed Code</label>
          <button
            onClick={copyToClipboard}
            className="btn-ghost text-[10px] px-2.5 py-1"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <pre className="p-4 text-sm text-[#c3e88d] overflow-x-auto font-mono rounded-md" style={{ background: 'var(--bg-void)' }}>
          {embedCode}
        </pre>
      </div>
    </div>
  );
}

/* ─── Section Badge ─── */

function SectionBadge({ number, color }: { number: number; color: string }) {
  return (
    <span
      className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-sm font-bold shrink-0"
      style={{ backgroundColor: `${color}20`, color }}
    >
      {number}
    </span>
  );
}

/* ─── Step Card ─── */

function StepCard({
  number,
  title,
  description,
  color,
  icon,
}: {
  number: number;
  title: string;
  description: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="relative">
      <div
        className="rounded-lg p-6 border transition-colors"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)', borderLeftColor: color, borderLeftWidth: '3px' }}
      >
        <div className="flex items-center gap-3 mb-3">
          <span
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold"
            style={{ backgroundColor: `${color}15`, color }}
          >
            {number}
          </span>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
        </div>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>{description}</p>
        <div className="mt-4 flex justify-end opacity-20" style={{ color }}>
          {icon}
        </div>
      </div>
    </div>
  );
}

/* ─── Node Color Dot ─── */

function NodeCard({
  color,
  label,
  description,
}: {
  color: string;
  label: string;
  description: string;
}) {
  return (
    <div className="rounded-lg p-4 border transition-colors group" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-base)'; }}
    >
      <div className="flex items-center gap-3 mb-2">
        <span
          className="w-3.5 h-3.5 rounded-full shrink-0"
          style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}60, 0 0 0 2px #12121a, 0 0 0 4px ${color}40` }}
        />
        <span className="font-semibold text-white text-sm">{label}</span>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>{description}</p>
    </div>
  );
}

/* ─── Feature Card ─── */

function FeatureCard({
  title,
  description,
  color,
  icon,
}: {
  title: string;
  description: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg p-6 border transition-all"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)', borderLeftColor: color, borderLeftWidth: '3px' }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${color}15`, color }}
        >
          {icon}
        </div>
        <div>
          <h3 className="text-white font-semibold mb-1">{title}</h3>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>{description}</p>
        </div>
      </div>
    </div>
  );
}

/* ─── Threat Meter ─── */

function ThreatMeter() {
  const levels = [
    { label: 'Safe', range: '0-14', color: '#00cc66', width: '15%' },
    { label: 'Low', range: '15-29', color: '#ffcc00', width: '15%' },
    { label: 'Medium', range: '30-49', color: '#ff8800', width: '20%' },
    { label: 'High', range: '50-69', color: '#ff4444', width: '20%' },
    { label: 'Critical', range: '70-100', color: '#ff0000', width: '30%' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex rounded-lg overflow-hidden h-3">
        {levels.map((l) => (
          <div
            key={l.label}
            style={{ width: l.width, backgroundColor: l.color }}
            className="relative group"
          />
        ))}
      </div>
      <div className="flex justify-between text-xs">
        {levels.map((l) => (
          <div key={l.label} className="text-center" style={{ color: l.color }}>
            <div className="font-semibold">{l.label}</div>
            <div style={{ color: 'var(--text-tertiary)' }}>{l.range}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Icons (inline SVGs) ─── */

const icons = {
  search: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
    </svg>
  ),
  network: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="3" /><circle cx="5" cy="19" r="3" /><circle cx="19" cy="19" r="3" />
      <path d="m12 8-4 8M12 8l4 8" />
    </svg>
  ),
  scan: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M7 12h10" />
    </svg>
  ),
  eye: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  heatmap: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  wallet: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  ),
  crosshair: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M22 12h-4M6 12H2M12 6V2M12 22v-4" />
    </svg>
  ),
  refresh: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  ),
  trending: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
    </svg>
  ),
  code: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  shield: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  ),
  bolt: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  ),
  database: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14a9 3 0 0 0 18 0V5" /><path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  ),
  alert: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  ),
};

/* ─── Main Page ─── */

export default function DocsPage() {
  return (
    <PageShell navFadeIn>
      <PageHeader
        eyebrow="Documentation"
        title={(
          <>
            <span style={{ color: 'var(--text-primary)' }}>{"Solana's On-Chain"}</span>
            <br />
            <span style={{ color: 'var(--green-primary)' }}>Intelligence Platform</span>
          </>
        )}
        subtitle="Trace wallet funding chains, expose coordinated cabal networks, and score on-chain threats across the Solana ecosystem."
        actions={(
          <>
            <Link href="/" className="btn-cta">Launch App</Link>
            <a href="#extension" className="btn-cta-secondary">Get the Extension</a>
          </>
        )}
      />

      <Container className="py-16 sm:py-20 space-y-20">
        {/* ─── Section 1: What is Rico Maps? ─── */}
        <section>
          <div className="flex items-center gap-3 mb-8">
            <SectionBadge number={1} color="#e34946" />
            <h2 className="text-2xl font-bold text-white">What is Rico Maps?</h2>
          </div>
          <p className="text-lg leading-relaxed max-w-3xl mb-10" style={{ color: 'var(--text-secondary)' }}>
            Rico Maps is a forensic intelligence tool that analyzes Solana wallets and tokens to uncover hidden
            coordination between addresses. Paste any token contract or wallet and get a full network visualization
            of who funded whom, who sniped, and who&apos;s running together.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-lg p-6 border transition-colors" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(255,51,102,0.3)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-base)'; }}
            >
              <div className="w-10 h-10 rounded-lg bg-[#ff3366]/10 flex items-center justify-center text-[#ff3366] mb-4">
                {icons.network}
              </div>
              <h3 className="text-white font-semibold mb-2">Cabal Detection</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                Finds wallets secretly coordinating by tracing shared funding sources across token holders.
              </p>
            </div>
            <div className="rounded-lg p-6 border transition-colors" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(0,255,204,0.3)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-base)'; }}
            >
              <div className="w-10 h-10 rounded-lg bg-[#00ffcc]/10 flex items-center justify-center text-[#00ffcc] mb-4">
                {icons.bolt}
              </div>
              <h3 className="text-white font-semibold mb-2">Sniper & Bundle Detection</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                Identifies wallets that bought within the first block or used Jito bundles to front-run others.
              </p>
            </div>
            <div className="rounded-lg p-6 border transition-colors" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(245,158,11,0.3)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-base)'; }}
            >
              <div className="w-10 h-10 rounded-lg bg-[#f59e0b]/10 flex items-center justify-center text-[#f59e0b] mb-4">
                {icons.shield}
              </div>
              <h3 className="text-white font-semibold mb-2">Threat Scoring</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                Assigns 0-100 risk scores based on identity tags, behavior patterns, and wallet age.
              </p>
            </div>
          </div>
        </section>

        {/* ─── Section 2: How It Works ─── */}
        <section>
          <div className="flex items-center gap-3 mb-8">
            <SectionBadge number={2} color="#4a9eff" />
            <h2 className="text-2xl font-bold text-white">How It Works</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <StepCard
              number={1}
              title="Enter Address"
              description="Paste any Solana token contract address or wallet address. Rico Maps automatically detects the type and routes to the appropriate analysis pipeline."
              color="#4a9eff"
              icon={icons.search}
            />
            <StepCard
              number={2}
              title="Analyze Holders"
              description="We fetch the top token holders and trace their funding sources using the Helius Wallet API. Each holder's earliest transactions are inspected for SOL transfers."
              color="#00FF41"
              icon={icons.scan}
            />
            <StepCard
              number={3}
              title="Detect Patterns"
              description="Our engine cross-references all funding sources to find shared funders, flags first-block snipers, identifies Jito bundle clusters, and computes threat scores."
              color="#ff3366"
              icon={icons.crosshair}
            />
            <StepCard
              number={4}
              title="Visualize"
              description="An interactive bubble map renders the full network with color-coded nodes and links. Click any node to inspect its wallet profile, portfolio, and risk breakdown."
              color="#a78bfa"
              icon={icons.eye}
            />
          </div>
          {/* Flow connector */}
          <div className="hidden md:flex items-center justify-center mt-6 gap-2">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[#4a9eff]/30 to-[#00FF41]/30" />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#737373" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
            <div className="h-px flex-1 bg-gradient-to-r from-[#ff3366]/30 via-[#a78bfa]/30 to-transparent" />
          </div>
        </section>

        {/* ─── Section 3: Node Types & Colors ─── */}
        <section>
          <div className="flex items-center gap-3 mb-8">
            <SectionBadge number={3} color="#22d3ee" />
            <h2 className="text-2xl font-bold text-white">Node Types & Colors</h2>
          </div>
          <p className="text-[#9898a6] mb-6">
            Each node in the visualization represents a wallet or token, color-coded by its role in the network.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <NodeCard color="#f59e0b" label="Token" description="The token being analyzed. Center of the graph." />
            <NodeCard color="#1a7a3a" label="Holder" description="Clean token holders with no detected cabal connections." />
            <NodeCard color="#ff9f43" label="Connected" description="Holders linked to one or more cabal funders." />
            <NodeCard color="#ff3366" label="Cabal Funder" description="Wallet that funded multiple token holders." />
            <NodeCard color="#00ffcc" label="Sniper" description="Bought within the first 10 blocks of trading." />
            <NodeCard color="#a78bfa" label="Bundled" description="Detected in a Jito bundle cluster transaction." />
            <NodeCard color="#64b5f6" label="Funder" description="Funding source wallet traced via SOL transfers." />
            <NodeCard color="#00FF41" label="Target" description="Original wallet being traced in wallet mode." />
            <NodeCard color="#9ca3af" label="Pool" description="Liquidity pool / AMM. Infrastructure, not a real holder." />
          </div>
        </section>

        {/* ─── Section 4: Features ─── */}
        <section>
          <div className="flex items-center gap-3 mb-8">
            <SectionBadge number={4} color="#00FF41" />
            <h2 className="text-2xl font-bold text-white">Features</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FeatureCard
              title="Risk Heatmap"
              description="Toggle heatmap mode to recolor all nodes by threat level. Critical wallets glow red, safe wallets stay green. Instantly spot the highest-risk areas in any network."
              color="#ff4444"
              icon={icons.heatmap}
            />
            <FeatureCard
              title="Wallet Profiles"
              description="Click any node for a full breakdown: portfolio holdings, funding source, recent activity, identity tags, and a threat score with contributing factors."
              color="#4a9eff"
              icon={icons.wallet}
            />
            <FeatureCard
              title="Cross-Token Deep Scan"
              description="Discover what other tokens cabal wallets hold in common. Surface coordinated activity that spans multiple token launches."
              color="#ff3366"
              icon={icons.crosshair}
            />
            <FeatureCard
              title="Real-Time Polling"
              description="Live holder balance tracking with incremental updates. Watch positions change in real time as the chart auto-refreshes."
              color="#00FF41"
              icon={icons.refresh}
            />
            <FeatureCard
              title="Trending Discovery"
              description="Browse trending and featured Solana tokens with market cap, price, and volume data. One click to scan any token."
              color="#f59e0b"
              icon={icons.trending}
            />
            <FeatureCard
              title="Embed Integration"
              description="Embed Rico Maps visualizations on your own site via a simple iframe. Customize view style, dimensions, and target address."
              color="#a78bfa"
              icon={icons.code}
            />
            <FeatureCard
              title="Axiom Extension"
              description="A Chrome extension that shows the bubble map inline on axiom.trade chart pages; auto-detects the token, draggable and resizable. Download it below."
              color="#5b7fff"
              icon={icons.crosshair}
            />
          </div>
        </section>

        {/* ─── Bots & Surfaces (Telegram / Discord / X) ─── */}
        <section id="bots">
          <div className="flex items-center gap-3 mb-8">
            <SectionBadge number={5} color="#26a5e4" />
            <h2 className="text-2xl font-bold text-white">Bots &amp; Surfaces</h2>
          </div>
          <p className="text-lg leading-relaxed max-w-3xl mb-10" style={{ color: 'var(--text-secondary)' }}>
            The same forensic engine that powers the web app runs everywhere your group already lives.
            Paste a contract address and get the full rug / cabal / sniper / bundle read in-channel.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <FeatureCard
              title="Telegram"
              description="Add the bot to any group. Auto-detects pasted CAs, ranks your callers on a performance leaderboard (/top), and auto-warns on drainer links. Commands: /scan, /price, /pnl, /top, /x, /watch."
              color="#26a5e4"
              icon={icons.bolt}
            />
            <FeatureCard
              title="Discord"
              description="Slash commands backed by the same engine: /scan, /price, /pnl, /x. Ephemeral forensic cards with the bubble-map link. Verified Ed25519 interactions endpoint — no third-party middleman."
              color="#5865f2"
              icon={icons.shield}
            />
            <FeatureCard
              title="X Reply Bot + Tracker"
              description="Tweet a CA at the bot for a forensic reply. A daily tracker also fingerprints X accounts by immutable user id, so a renamed / recycled account is flagged on every token that links it."
              color="#1d9bf0"
              icon={icons.crosshair}
            />
          </div>
          <div className="mt-6 rounded-lg p-6 border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)', borderLeftColor: '#26a5e4', borderLeftWidth: '3px' }}>
            <h3 className="text-white font-semibold mb-2">Group Caller Leaderboard</h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              Every CA pasted in a Telegram group is credited to its first caller and re-priced live (market
              cap at call vs now). <code className="font-mono text-[#c3e88d]">/top [24h|7d|30d]</code> ranks
              callers by their best multiple and hit rate — the call-tracking Phanes charges for, with the
              forensic depth it doesn&apos;t have.
            </p>
          </div>
        </section>

        {/* ─── Persistent Forensics (reputation / PnL / recycled X) ─── */}
        <section id="persistent-forensics">
          <div className="flex items-center gap-3 mb-8">
            <SectionBadge number={6} color="#a78bfa" />
            <h2 className="text-2xl font-bold text-white">Persistent Forensics</h2>
          </div>
          <p className="text-lg leading-relaxed max-w-3xl mb-10" style={{ color: 'var(--text-secondary)' }}>
            Single-token scanners forget. Rico Maps remembers across tokens — so a wallet&apos;s sniping,
            bundling, and rug history follows it, and a crew is recognized even after it rotates wallets.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FeatureCard
              title="Wallet Reputation"
              description="Sniper / bundler / cabal-funder / rug-dev tags accumulate per wallet across every scan. A serial sniper that's hit 8 launches is tagged on the 9th, not treated as a stranger."
              color="#ff3366"
              icon={icons.database}
            />
            <FeatureCard
              title="Holder PnL & Win-Rate"
              description="Top holders are scored by realized SOL flow: winners (took profit) vs exit liquidity (underwater / dumping on you). Whale tiers 🦐🐟🐬🦈🐋 size each holder at a glance."
              color="#00FF41"
              icon={icons.wallet}
            />
            <FeatureCard
              title="Rug-Dev Flag"
              description="A deployer that has rugged a prior tracked token carries a ⛔ flag into every future launch — cross-token dev accountability, not a one-shot guess."
              color="#ff4444"
              icon={icons.alert}
            />
            <FeatureCard
              title="Recycled X Accounts"
              description="Accounts are keyed on their immutable X user id. Two different @handles on one id = the same operator recycling an account. Surfaced as ♻️ with the prior handles on any token that links it."
              color="#1d9bf0"
              icon={icons.refresh}
            />
          </div>
        </section>

        {/* ─── Section 5: Threat Scoring ─── */}
        <section>
          <div className="flex items-center gap-3 mb-8">
            <SectionBadge number={7} color="#ff4444" />
            <h2 className="text-2xl font-bold text-white">Threat Scoring</h2>
          </div>
          <div className="rounded-lg p-8 border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)' }}>
              <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
                Every wallet is assigned a threat score from 0 to 100 based on multiple behavioral and identity signals.
              The score determines the wallet&apos;s risk level and visualization color in heatmap mode.
            </p>
            <ThreatMeter />
            <div className="mt-8">
              <h3 className="text-white font-semibold mb-4">Contributing Factors</h3>
              <div className="space-y-3">
                {[
                  { label: 'Identity tags (scammer / rugger / hacker via Helius)', score: '+40', color: '#ff0000' },
                  { label: 'Cabal funder status (funded 2+ holders)', score: '+25', color: '#ff3366' },
                  { label: 'Sniper detection (first 10 blocks)', score: '+20', color: '#00ffcc' },
                  { label: 'Bundle membership (Jito bundle cluster)', score: '+15', color: '#a78bfa' },
                  { label: 'Fresh wallet (created < 7 days ago)', score: '+10', color: '#f59e0b' },
                ].map((factor) => (
                  <div
                    key={factor.label}
                    className="flex items-center justify-between py-2 px-4 rounded-md border"
                    style={{ background: 'var(--bg-void)', borderColor: 'var(--border-base)' }}
                  >
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{factor.label}</span>
                    <span className="font-mono font-bold text-sm" style={{ color: factor.color }}>
                      {factor.score}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ─── Section 6: API Access ─── */}
        <section id="api-access">
          <div className="flex items-center gap-3 mb-8">
            <SectionBadge number={8} color="#a78bfa" />
            <h2 className="text-2xl font-bold text-white">API Access</h2>
          </div>
          <div className="space-y-6">
            <div className="rounded-lg p-6 border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)' }}>
              <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
                Programmatic access to Rico Maps analysis via REST API. Requires an API key set via
                the <code className="px-2 py-0.5 rounded text-sm font-mono" style={{ background: 'var(--bg-void)', color: 'var(--purple-primary)' }}>RICO_API_KEYS</code> environment variable.
              </p>

              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="px-2 py-1 text-[#00FF41] text-xs font-mono rounded font-bold" style={{ background: 'rgba(0,255,65,0.08)' }}>POST</span>
                  <code className="text-white font-mono text-sm">/api/v1/analyze</code>
                  <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Full cabal analysis (top 30 holders, API key required)</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="px-2 py-1 text-[#00FF41] text-xs font-mono rounded font-bold" style={{ background: 'rgba(0,255,65,0.08)' }}>POST</span>
                  <code className="text-white font-mono text-sm">/api/v1/quick-scan</code>
                  <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Fast scan (top 15 holders, IP rate-limited, no key)</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="px-2 py-1 text-[#4a9eff] text-xs font-mono rounded font-bold" style={{ background: 'rgba(74,158,255,0.08)' }}>GET</span>
                  <code className="text-white font-mono text-sm">/api/v1/x-account?handle=</code>
                  <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Recycled-X-account check: current + prior handles, linked CAs</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="px-2 py-1 text-[#4a9eff] text-xs font-mono rounded font-bold" style={{ background: 'rgba(74,158,255,0.08)' }}>GET</span>
                  <code className="text-white font-mono text-sm">/api/v1/status</code>
                  <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Health check (version + timestamp)</span>
                </div>
              </div>
              <p className="mt-5 text-sm" style={{ color: 'var(--text-tertiary)' }}>
                Authenticate <code className="px-1.5 py-0.5 rounded text-xs font-mono" style={{ background: 'var(--bg-void)', color: 'var(--purple-primary)' }}>/api/v1/analyze</code> by passing
                {' '}<code className="px-1.5 py-0.5 rounded text-xs font-mono" style={{ background: 'var(--bg-void)', color: 'var(--purple-primary)' }}>apiKey</code> in the JSON body.
                Rate limit: 10 requests/minute per key.
              </p>
            </div>

            <div className="rounded-lg border overflow-hidden" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)' }}>
              <div className="px-6 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-base)' }}>
                <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>Example Request</span>
              </div>
              <pre className="p-6 text-sm font-mono overflow-x-auto leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
{`curl -X POST https://ricomaps.fun/api/v1/analyze \\
  -H "Content-Type: application/json" \\
  -d '{
    "apiKey": "YOUR_API_KEY",
    "mint": "So11111111111111111111111111111111111111112"
  }'`}
              </pre>
            </div>

            <div className="rounded-lg border overflow-hidden" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)' }}>
              <div className="px-6 py-3" style={{ borderBottom: '1px solid var(--border-base)' }}>
                <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>Example Response</span>
              </div>
              <pre className="p-6 text-sm font-mono overflow-x-auto leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
{`{
  "success": true,
  "nodes": [
    {
      "id": "7xK...mN2",
      "type": "cabal-funder",
      "label": "7xK...mN2",
      "tokenAmount": 0,
      "solBalance": 1.42,
      "identity": { "tags": [] },
      "metadata": { "threatScore": 85 }
    }
  ],
  "links": [
    { "source": "7xK...mN2", "target": "9aB...pQ4", "value": 0.5, "suspicious": true }
  ],
  "summary": {
    "totalHolders": 30,
    "cabalCount": 3,
    "riskScore": 34,
    "snipersDetected": 5,
    "bundleClustersDetected": 2
  },
  "tokenSecurity": { /* mint/freeze authority, rug score */ },
  "tokenMetadata": { /* name, symbol, supply */ },
  "creditsUsed": 3050,
  "processingMs": 8421,
  "timestamp": "2026-06-13T19:00:00.000Z"
}`}
              </pre>
            </div>
          </div>
        </section>

        {/* ─── RicoMaps for Agents (trading-agent skill) ─── */}
        <section id="agents">
          <div className="flex items-center gap-3 mb-8">
            <SectionBadge number={9} color="#00FF41" />
            <h2 className="text-2xl font-bold text-white">RicoMaps for Agents</h2>
          </div>
          {/* Animated hero download card */}
          <div
            className="agent-card relative rounded-2xl border p-8 sm:p-10 text-center mb-6"
            style={{ background: 'radial-gradient(120% 120% at 50% 0%, rgba(0,255,65,0.05), var(--bg-void) 60%)', borderColor: 'rgba(0,255,65,0.18)' }}
          >
            {/* Orbiting border beam */}
            <BorderBeam size={120} duration={7} colorFrom="#00FF41" colorTo="#00cc33" borderWidth={1.5} />
            <BorderBeam size={120} duration={7} delay={3.5} colorFrom="#00FF41" colorTo="#34d399" borderWidth={1.5} />

            {/* Breathing glow + sweeping scan line (decorative) */}
            <div className="agent-glow" style={{ top: '-90px', left: '50%', marginLeft: '-160px' }} />
            <div className="agent-scanline" />

            {/* Pulsing download icon */}
            <div className="relative inline-flex items-center justify-center mb-5">
              <span className="absolute inset-0 rounded-2xl" style={{ background: 'rgba(0,255,65,0.12)', filter: 'blur(14px)' }} />
              <span
                className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl border"
                style={{ background: 'rgba(0,255,65,0.06)', borderColor: 'rgba(0,255,65,0.25)' }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00FF41" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'agent-arrow 2.2s ease-in-out infinite' }}>
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </span>
            </div>

            <h3 className="text-2xl font-bold text-white mb-2">RicoMaps Rug Check Skill</h3>
            <p className="mx-auto max-w-xl text-sm leading-relaxed mb-6" style={{ color: 'var(--text-tertiary)' }}>
              A Claude Code skill that gates your trading agent. Every buy runs through the RicoMaps
              detector first: mint/freeze authority, snipers, Jito bundles, and cabal funders. No API
              key. If a scan fails, it blocks by default, so your agent never trades on a bad check.
            </p>

            {/* Live verdict chips */}
            <div className="flex items-center justify-center gap-2.5 mb-7">
              {[
                { label: 'BLOCK', color: '#ef4444', delay: '0s' },
                { label: 'CAUTION', color: '#f59e0b', delay: '0.5s' },
                { label: 'PASS', color: '#00FF41', delay: '1s' },
              ].map((v) => (
                <span
                  key={v.label}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-mono font-bold tracking-wide border"
                  style={{ color: v.color, borderColor: `${v.color}33`, background: `${v.color}0d` }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: v.color, animation: `agent-verdict 1.5s ease-in-out infinite`, animationDelay: v.delay }} />
                  {v.label}
                </span>
              ))}
            </div>

            <a
              href="/ricomaps-rugcheck.zip"
              download
              className="btn-cta inline-flex items-center gap-2 text-base px-6 py-3"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download Skill (.zip)
            </a>
            <p className="mt-3 text-[11px] font-mono" style={{ color: 'var(--text-faint)' }}>~7 KB · no dependencies · works with any Claude Code agent</p>
          </div>

          <div className="rounded-lg p-6 border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)' }}>
            <div>
              <h3 className="text-lg font-semibold text-white mb-3">Install</h3>
              <ol className="space-y-2 text-sm list-decimal pl-5" style={{ color: 'var(--text-secondary)' }}>
                <li>Download the .zip above and unzip it.</li>
                <li>Move the <code className="font-mono text-[#c3e88d]">ricomaps-rugcheck</code> folder into your skills directory: <code className="font-mono text-[#c3e88d]">~/.claude/skills/</code> (project-level <code className="font-mono text-[#c3e88d]">.claude/skills/</code> also works).</li>
                <li>Your agent can now invoke it before any buy. It auto-triggers on prompts like &quot;is this token safe&quot; or &quot;rug check &lt;mint&gt;&quot;.</li>
              </ol>
            </div>

            <div className="mt-6">
              <h3 className="text-lg font-semibold text-white mb-3">Run it directly</h3>
              <pre className="p-4 text-sm font-mono overflow-x-auto leading-relaxed rounded-md" style={{ background: 'var(--bg-void)', color: 'var(--text-secondary)' }}>
{`# from the skill folder
node scripts/rugcheck.mjs <MINT_ADDRESS>

# machine-readable for a bot
node scripts/rugcheck.mjs <MINT_ADDRESS> --json`}
              </pre>
              <p className="mt-3 text-sm" style={{ color: 'var(--text-tertiary)' }}>
                Exit codes let a bot branch without parsing output:
                {' '}<code className="font-mono text-[#c3e88d]">0</code> PASS,
                {' '}<code className="font-mono" style={{ color: '#f59e0b' }}>10</code> CAUTION,
                {' '}<code className="font-mono text-red-primary">20</code> BLOCK,
                {' '}<code className="font-mono text-red-primary">1</code> error (fail closed).
                Set <code className="font-mono text-[#c3e88d]">RICO_API_KEY</code> to upgrade to the deeper top-30 scan.
              </p>
            </div>
          </div>
        </section>

        {/* ─── Section 8: Embed on Your Site ─── */}
        <section>
          <div className="flex items-center gap-3 mb-8">
            <SectionBadge number={10} color="#f59e0b" />
            <h2 className="text-2xl font-bold text-white">Embed on Your Site</h2>
          </div>
          <div className="space-y-6">
            <div className="rounded-lg p-6 border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)' }}>
              <h3 className="text-lg font-semibold text-white mb-4">Code Generator</h3>
              <p className="mb-6" style={{ color: 'var(--text-tertiary)' }}>
                Generate an iframe embed code for any Solana address. Drop it into your site, dashboard, or app.
              </p>
              <EmbedCodeGenerator />
            </div>

            <div className="rounded-lg p-6 border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)' }}>
              <h3 className="text-lg font-semibold text-white mb-4">URL Parameters</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b" style={{ borderColor: 'var(--border-hover)' }}>
                      <th className="text-left py-3 font-medium" style={{ color: 'var(--text-tertiary)' }}>Parameter</th>
                      <th className="text-left py-3 font-medium" style={{ color: 'var(--text-tertiary)' }}>Description</th>
                      <th className="text-left py-3 font-medium" style={{ color: 'var(--text-tertiary)' }}>Default</th>
                    </tr>
                  </thead>
                  <tbody style={{ color: 'var(--text-secondary)' }}>
                    <tr className="border-b" style={{ borderColor: 'var(--border-base)' }}>
                      <td className="py-3"><code className="font-mono" style={{ color: 'var(--blue-primary)' }}>address</code></td>
                      <td className="py-3">Solana wallet or token mint address</td>
                      <td className="py-3 italic" style={{ color: 'var(--text-tertiary)' }}>required</td>
                    </tr>
                    <tr className="border-b" style={{ borderColor: 'var(--border-base)' }}>
                      <td className="py-3"><code className="font-mono" style={{ color: 'var(--blue-primary)' }}>hideWatermark</code></td>
                      <td className="py-3">Hide the &quot;Powered by RicoMaps&quot; badge (<code className="text-[#c3e88d] font-mono">true</code>)</td>
                      <td className="py-3" style={{ color: 'var(--text-tertiary)' }}>false</td>
                    </tr>
                    <tr>
                      <td className="py-3"><code className="font-mono" style={{ color: 'var(--blue-primary)' }}>compact</code></td>
                      <td className="py-3">Compact panel for inline embeds; also hides the watermark (<code className="text-[#c3e88d] font-mono">1</code>)</td>
                      <td className="py-3" style={{ color: 'var(--text-tertiary)' }}>false</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg p-6 border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)' }}>
              <h3 className="text-lg font-semibold text-white mb-4">Example Embeds</h3>
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>Token or wallet analysis:</p>
                  <pre className="p-3 text-xs text-[#c3e88d] overflow-x-auto font-mono rounded-md" style={{ background: 'var(--bg-void)' }}>
                    {`<iframe src="https://ricomaps.fun/embed?address=TOKEN_OR_WALLET" width="100%" height="500"></iframe>`}
                  </pre>
                </div>
                <div>
                  <p className="mb-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>White-label (no watermark):</p>
                  <pre className="p-3 text-xs text-[#c3e88d] overflow-x-auto font-mono rounded-md" style={{ background: 'var(--bg-void)' }}>
                    {`<iframe src="https://ricomaps.fun/embed?address=TOKEN_OR_WALLET&hideWatermark=true" width="100%" height="600"></iframe>`}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Browser Extension ─── */}
        <section id="extension">
          <div className="flex items-center gap-3 mb-8">
            <SectionBadge number={11} color="#a78bfa" />
            <h2 className="text-2xl font-bold text-white">Browser Extension</h2>
          </div>
          <div className="rounded-lg p-6 border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)' }}>
            <p className="mb-5" style={{ color: 'var(--text-tertiary)' }}>
              Run Rico Maps right on your trading pages. The Chrome extension detects the token on{' '}
              <span className="text-white">axiom.trade</span> chart pages and shows the holder/cabal
              bubble map in a draggable, resizable panel: no copy-pasting addresses.
            </p>

            <a
              href="/ricomaps-extension.zip"
              download
              className="btn-cta inline-flex items-center gap-2"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download Extension (.zip)
            </a>

            <div className="mt-6">
              <h3 className="text-lg font-semibold text-white mb-3">Install (Chrome / Brave / Edge)</h3>
              <ol className="space-y-2 text-sm list-decimal pl-5" style={{ color: 'var(--text-secondary)' }}>
                <li>Download the .zip above and unzip it.</li>
                <li>Open <code className="font-mono text-[#c3e88d]">chrome://extensions</code> and enable <span className="text-white">Developer mode</span> (top-right).</li>
                <li>Click <span className="text-white">Load unpacked</span> and select the unzipped <code className="font-mono text-[#c3e88d]">ricomaps-extension</code> folder.</li>
                <li>Open any <code className="font-mono text-[#c3e88d]">axiom.trade/meme/&lt;token&gt;</code> page: the panel appears top-right. Drag it by the header, resize from the corner, or toggle it from the extension popup.</li>
              </ol>
              <p className="mt-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Coming soon to the Chrome Web Store for one-click install.
              </p>
            </div>
          </div>
        </section>

        {/* ─── Section 10: Data Sources & Methodology ─── */}
        <section>
          <div className="flex items-center gap-3 mb-8">
            <SectionBadge number={12} color="#22d3ee" />
            <h2 className="text-2xl font-bold text-white">Data Sources & Methodology</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div
              className="rounded-lg p-6 border"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)', borderTopColor: '#4a9eff', borderTopWidth: '2px' }}
            >
              <div className="w-10 h-10 rounded-lg bg-[#4a9eff]/10 flex items-center justify-center text-[#4a9eff] mb-4">
                {icons.database}
              </div>
              <h3 className="text-white font-semibold mb-2">Helius Wallet API</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                Funded-by tracing, batch identity lookups (5,100+ tagged accounts including known scammers,
                exchanges, and market makers), and portfolio data.
              </p>
            </div>
            <div
              className="rounded-lg p-6 border"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)', borderTopColor: '#00FF41', borderTopWidth: '2px' }}
            >
              <div className="w-10 h-10 rounded-lg bg-[#00FF41]/10 flex items-center justify-center text-[#00FF41] mb-4">
                {icons.scan}
              </div>
              <h3 className="text-white font-semibold mb-2">Helius RPC (Gatekeeper)</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                Token account queries, transaction history, on-chain data fetching, and enhanced transaction parsing.
              </p>
            </div>
            <div
              className="rounded-lg p-6 border"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)', borderTopColor: '#f59e0b', borderTopWidth: '2px' }}
            >
              <div className="w-10 h-10 rounded-lg bg-[#f59e0b]/10 flex items-center justify-center text-[#f59e0b] mb-4">
                {icons.trending}
              </div>
              <h3 className="text-white font-semibold mb-2">DexScreener</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                Token metadata, trending tokens, price feeds, market cap data, and chart information for discovery.
              </p>
            </div>
          </div>
          <div className="rounded-lg p-6 border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)', borderLeftColor: '#4a9eff', borderLeftWidth: '3px' }}>
            <h3 className="text-white font-semibold mb-2">Methodology</h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              We use the Helius Wallet API to trace funding sources for each token holder, then cross-reference
              all holders to find shared funders. First-block buyers are flagged as snipers via transaction
              timestamp analysis. Jito bundle detection identifies wallets that transacted in the same bundle
              slot. Identity enrichment from 5,100+ tagged accounts flags known scammers, exchanges, and market
              makers. All signals are combined into a weighted threat score.
            </p>
          </div>
        </section>

        {/* ─── Section 11: Limitations ─── */}
        <section>
          <div className="flex items-center gap-3 mb-8">
            <SectionBadge number={13} color="#737373" />
            <h2 className="text-2xl font-bold text-white">Limitations</h2>
          </div>
          <div className="rounded-lg p-6 border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-base)' }}>
            <p className="mb-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Rico Maps is a forensic intelligence tool, not a crystal ball. Here&apos;s what to keep in mind.
            </p>
            <div className="space-y-3">
              {[
                'We analyze the top 30 holders by default. Smaller holders are not traced.',
                'We trace the first 3 funders per holder. Deep multi-hop funding chains may be missed.',
                'CEX withdrawals (Binance, Coinbase, etc.) and legitimate shared services can cause false positives.',
                'Multi-hop obfuscation (A -> B -> C -> Holder) is partially traced but not guaranteed at depth.',
                'DEX-routed funding (through Jupiter, Raydium) is flagged but the original source may be hidden.',
                'Threat scores are heuristic-based. A high score means elevated risk, not confirmed malice.',
                'Bundle detection relies on transaction slot proximity. Some edge cases may be missed.',
              ].map((limitation, i) => (
                <div key={i} className="flex items-start gap-3 py-2 px-4 rounded-md" style={{ background: 'var(--bg-void)' }}>
                  <span className="mt-0.5 shrink-0" style={{ color: 'var(--text-tertiary)' }}>{icons.alert}</span>
                  <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{limitation}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </Container>
    </PageShell>
  );
}
