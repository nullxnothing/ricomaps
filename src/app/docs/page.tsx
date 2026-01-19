'use client';

import Link from 'next/link';

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-[#e0e0e0]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0a0a0a]/95 backdrop-blur border-b border-[#1a1a2e]">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#e34946" strokeWidth="2">
              <path d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-[#e34946] font-bold">Rico Maps</span>
          </Link>
          <a
            href="https://x.com/RicoMaps"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#6b7280] hover:text-white transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
          </a>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Title */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-white mb-4">Documentation</h1>
          <p className="text-[#9898a6] text-lg">
            Understanding how Rico Maps detects coordinated wallet activity and cabal networks.
          </p>
        </div>

        {/* What We Detect */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-[#e34946] mb-6 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-[#e34946]/20 flex items-center justify-center text-sm">1</span>
            What We Detect
          </h2>

          <div className="space-y-6">
            <div className="bg-[#12121a] rounded-xl p-6 border border-[#1a1a2e]">
              <h3 className="text-lg font-semibold text-[#ff3366] mb-3">Cabal Networks</h3>
              <p className="text-[#9898a6] mb-4">
                A &quot;cabal&quot; is a group of wallets that appear independent but are actually coordinated.
                We detect this by finding <strong className="text-white">shared funders</strong> - wallets that
                funded multiple token holders.
              </p>
              <div className="bg-[#0a0a0a] rounded-lg p-4 font-mono text-sm">
                <div className="text-[#6b7280]"># Example: Cabal Detection</div>
                <div className="text-[#ff6b6b]">Funder A</div>
                <div className="text-[#9898a6] ml-4">├─ funded → Holder 1</div>
                <div className="text-[#9898a6] ml-4">├─ funded → Holder 2</div>
                <div className="text-[#9898a6] ml-4">└─ funded → Holder 3</div>
                <div className="text-[#ff3366] mt-2">⚠ Cabal detected: 1 wallet funded 3 holders</div>
              </div>
            </div>

            <div className="bg-[#12121a] rounded-xl p-6 border border-[#1a1a2e]">
              <h3 className="text-lg font-semibold text-[#f59e0b] mb-3">DEX Obfuscation</h3>
              <p className="text-[#9898a6]">
                Some actors route funds through DEXs (Jupiter, Raydium, etc.) to hide the funding source.
                We flag holders whose initial funding came through a DEX transaction as potentially obfuscated.
              </p>
            </div>

            <div className="bg-[#12121a] rounded-xl p-6 border border-[#1a1a2e]">
              <h3 className="text-lg font-semibold text-[#f59e0b] mb-3">Fresh Wallet Funders</h3>
              <p className="text-[#9898a6]">
                Wallets less than 7 days old that fund multiple holders are flagged as suspicious.
                Legitimate actors rarely create new wallets just to distribute tokens.
              </p>
            </div>
          </div>
        </section>

        {/* What We Display */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-[#4a9eff] mb-6 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-[#4a9eff]/20 flex items-center justify-center text-sm">2</span>
            What We Display
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="bg-[#12121a] rounded-xl p-5 border border-[#1a1a2e]">
              <div className="flex items-center gap-3 mb-3">
                <span className="w-4 h-4 rounded-full bg-[#ffd54f]"></span>
                <span className="font-semibold text-white">Token</span>
              </div>
              <p className="text-[#9898a6] text-sm">The token being analyzed (center node)</p>
            </div>

            <div className="bg-[#12121a] rounded-xl p-5 border border-[#1a1a2e]">
              <div className="flex items-center gap-3 mb-3">
                <span className="w-4 h-4 rounded-full bg-[#5a7a9a]"></span>
                <span className="font-semibold text-white">Holders</span>
              </div>
              <p className="text-[#9898a6] text-sm">Clean token holders with no detected cabal connections</p>
            </div>

            <div className="bg-[#12121a] rounded-xl p-5 border border-[#1a1a2e]">
              <div className="flex items-center gap-3 mb-3">
                <span className="w-4 h-4 rounded-full bg-[#ff9f43]"></span>
                <span className="font-semibold text-white">Connected</span>
              </div>
              <p className="text-[#9898a6] text-sm">Holders linked to a cabal funder (suspicious)</p>
            </div>

            <div className="bg-[#12121a] rounded-xl p-5 border border-[#1a1a2e]">
              <div className="flex items-center gap-3 mb-3">
                <span className="w-4 h-4 rounded-full bg-[#ff3366]"></span>
                <span className="font-semibold text-white">Cabal Funder</span>
              </div>
              <p className="text-[#9898a6] text-sm">Wallet that funded multiple token holders</p>
            </div>
          </div>

          <div className="bg-[#12121a] rounded-xl p-6 border border-[#1a1a2e]">
            <h3 className="text-lg font-semibold text-white mb-4">Statistics Panel</h3>
            <ul className="space-y-2 text-[#9898a6]">
              <li className="flex items-start gap-2">
                <span className="text-[#4a9eff] mt-1">•</span>
                <span><strong className="text-white">Node Breakdown</strong> - Count of each node type</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#4a9eff] mt-1">•</span>
                <span><strong className="text-white">Cabal Links</strong> - Total connections between funders and holders</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#4a9eff] mt-1">•</span>
                <span><strong className="text-white">Top Cabal Funders</strong> - Ranked by how many holders they funded</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#4a9eff] mt-1">•</span>
                <span><strong className="text-white">DEX Funded</strong> - Holders with obfuscated funding sources</span>
              </li>
            </ul>
          </div>
        </section>

        {/* Technical Implementation */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-[#22c55e] mb-6 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-[#22c55e]/20 flex items-center justify-center text-sm">3</span>
            Technical Implementation
          </h2>

          <div className="space-y-6">
            <div className="bg-[#12121a] rounded-xl p-6 border border-[#1a1a2e]">
              <h3 className="text-lg font-semibold text-white mb-4">Step 1: Fetch Token Holders</h3>
              <p className="text-[#9898a6] mb-4">
                We use Helius&apos;s <code className="bg-[#1a1a2e] px-2 py-1 rounded text-[#4a9eff]">getTokenAccounts</code> API
                to fetch all token holders, sorted by balance. We analyze the top 30 holders by default.
              </p>
              <div className="bg-[#0a0a0a] rounded-lg p-4 font-mono text-sm overflow-x-auto">
                <span className="text-[#6b7280]">// RPC call to Helius</span><br/>
                <span className="text-[#c792ea]">method:</span> <span className="text-[#c3e88d]">&quot;getTokenAccounts&quot;</span><br/>
                <span className="text-[#c792ea]">params:</span> {'{'} <span className="text-[#c792ea]">mint</span>, <span className="text-[#c792ea]">limit:</span> <span className="text-[#f78c6c]">1000</span> {'}'}
              </div>
            </div>

            <div className="bg-[#12121a] rounded-xl p-6 border border-[#1a1a2e]">
              <h3 className="text-lg font-semibold text-white mb-4">Step 2: Trace Funding Sources</h3>
              <p className="text-[#9898a6] mb-4">
                For each holder, we fetch their earliest transactions using
                <code className="bg-[#1a1a2e] px-2 py-1 rounded text-[#4a9eff]">getTransactionsForAddress</code> with
                the <code className="bg-[#1a1a2e] px-2 py-1 rounded text-[#4a9eff]">tokenAccounts: &quot;balanceChanged&quot;</code> filter
                to capture Associated Token Account (ATA) transactions.
              </p>
              <div className="bg-[#0a0a0a] rounded-lg p-4 font-mono text-sm overflow-x-auto">
                <span className="text-[#6b7280]">// For each holder wallet</span><br/>
                <span className="text-[#c792ea]">method:</span> <span className="text-[#c3e88d]">&quot;getTransactionsForAddress&quot;</span><br/>
                <span className="text-[#c792ea]">params:</span> [address, {'{'}<br/>
                <span className="ml-4 text-[#c792ea]">sortOrder:</span> <span className="text-[#c3e88d]">&quot;asc&quot;</span>, <span className="text-[#6b7280]">// oldest first</span><br/>
                <span className="ml-4 text-[#c792ea]">filters:</span> {'{'} <span className="text-[#c792ea]">tokenAccounts:</span> <span className="text-[#c3e88d]">&quot;balanceChanged&quot;</span> {'}'}<br/>
                {'}'}]
              </div>
            </div>

            <div className="bg-[#12121a] rounded-xl p-6 border border-[#1a1a2e]">
              <h3 className="text-lg font-semibold text-white mb-4">Step 3: Build Funder Map</h3>
              <p className="text-[#9898a6] mb-4">
                We extract <code className="bg-[#1a1a2e] px-2 py-1 rounded text-[#4a9eff]">nativeTransfers</code> from
                each transaction to identify who sent SOL to each holder. We build a map of
                <strong className="text-white"> funder → [list of holders they funded]</strong>.
              </p>
              <div className="bg-[#0a0a0a] rounded-lg p-4 font-mono text-sm">
                <span className="text-[#6b7280]">// Funder map structure</span><br/>
                <span className="text-[#ff6b6b]">funderMap</span> = {'{'}<br/>
                <span className="ml-4 text-[#c3e88d]">&quot;FunderWallet1&quot;</span>: [<span className="text-[#f78c6c]">&quot;Holder1&quot;</span>, <span className="text-[#f78c6c]">&quot;Holder2&quot;</span>, <span className="text-[#f78c6c]">&quot;Holder3&quot;</span>],<br/>
                <span className="ml-4 text-[#c3e88d]">&quot;FunderWallet2&quot;</span>: [<span className="text-[#f78c6c]">&quot;Holder4&quot;</span>],<br/>
                {'}'}
              </div>
            </div>

            <div className="bg-[#12121a] rounded-xl p-6 border border-[#1a1a2e]">
              <h3 className="text-lg font-semibold text-white mb-4">Step 4: Detect Cabals</h3>
              <p className="text-[#9898a6] mb-4">
                Any funder that appears in <strong className="text-white">2 or more holders&apos;</strong> funding history is flagged as a
                <strong className="text-[#ff3366]"> cabal funder</strong>. The holders they funded are marked as
                <strong className="text-[#ff9f43]"> connected</strong>.
              </p>
              <div className="bg-[#0a0a0a] rounded-lg p-4 font-mono text-sm">
                <span className="text-[#c792ea]">for</span> (funder, holders) <span className="text-[#c792ea]">in</span> funderMap:<br/>
                <span className="ml-4 text-[#c792ea]">if</span> holders.length {'>'} <span className="text-[#f78c6c]">1</span>:<br/>
                <span className="ml-8 text-[#ff3366]">// CABAL DETECTED</span><br/>
                <span className="ml-8">mark funder as <span className="text-[#ff3366]">&quot;cabal-funder&quot;</span></span><br/>
                <span className="ml-8">mark holders as <span className="text-[#ff9f43]">&quot;connected&quot;</span></span>
              </div>
            </div>

            <div className="bg-[#12121a] rounded-xl p-6 border border-[#1a1a2e]">
              <h3 className="text-lg font-semibold text-white mb-4">Step 5: Render Graph</h3>
              <p className="text-[#9898a6]">
                The resulting nodes and links are rendered using <strong className="text-white">Three.js</strong> with
                a force-directed layout (<code className="bg-[#1a1a2e] px-2 py-1 rounded text-[#4a9eff]">d3-force-3d</code>).
                Cabal connections naturally cluster together due to the link forces, making coordinated networks visually obvious.
              </p>
            </div>
          </div>
        </section>

        {/* API & Data Sources */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-[#ce93d8] mb-6 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-[#ce93d8]/20 flex items-center justify-center text-sm">4</span>
            Data Sources
          </h2>

          <div className="bg-[#12121a] rounded-xl p-6 border border-[#1a1a2e]">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold text-white mb-2">Helius API</h3>
                <p className="text-[#9898a6] text-sm">
                  Transaction history, token holders, and parsed transaction data via Helius RPC and Enhanced APIs.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-white mb-2">DexScreener API</h3>
                <p className="text-[#9898a6] text-sm">
                  Token metadata, icons, and trending token data for the discovery section.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Limitations */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-[#6b7280] mb-6 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-[#6b7280]/20 flex items-center justify-center text-sm">5</span>
            Limitations
          </h2>

          <div className="bg-[#12121a] rounded-xl p-6 border border-[#1a1a2e]">
            <ul className="space-y-3 text-[#9898a6]">
              <li className="flex items-start gap-2">
                <span className="text-[#6b7280] mt-1">•</span>
                <span>We analyze the <strong className="text-white">top 30 holders</strong> by default. Smaller holders are not analyzed.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#6b7280] mt-1">•</span>
                <span>We trace the <strong className="text-white">first 3 funders</strong> per holder. Deep funding chains may be missed.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#6b7280] mt-1">•</span>
                <span>CEX withdrawals and legitimate shared services may cause false positives.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#6b7280] mt-1">•</span>
                <span>Multi-hop obfuscation (A → B → C → Holder) is not fully traced.</span>
              </li>
            </ul>
          </div>
        </section>

        {/* Footer */}
        <footer className="pt-8 border-t border-[#1a1a2e] text-center text-[#6b7280] text-sm">
          <p>Rico Maps - Follow the money, expose the cabal.</p>
        </footer>
      </div>
    </main>
  );
}
