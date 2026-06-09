'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { GateButton } from './GateButton';

const RICO_CA = '6tf2X4GbYdM59hAMNa5kgyja2C9CjwUVqr9YLvJ1pump';

interface NavbarProps {
  /** Visually hide the bar when scrollY === 0 (useful for full-bleed heroes) */
  fadeIn?: boolean;
}

const NAV_LINKS = [
  { href: '/atlas', label: 'Atlas' },
  { href: '/docs', label: 'Docs' },
  { href: '/roadmap', label: 'Roadmap' },
  { href: '/blacklist', label: 'Blacklist' },
  { href: '/watchlist', label: 'Radar' },
];

export function Navbar({ fadeIn = false }: NavbarProps) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(!fadeIn);
  const [copied, setCopied] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const copyCA = () => {
    navigator.clipboard.writeText(RICO_CA);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  useEffect(() => {
    if (!fadeIn) return;
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [fadeIn]);

  useEffect(() => {
    if (!popoverOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current && !popoverRef.current.contains(target) &&
        triggerRef.current && !triggerRef.current.contains(target)
      ) {
        setPopoverOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopoverOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [popoverOpen]);

  return (
    <header
      className="sticky top-0 z-50 transition-all duration-200"
      style={{
        background: scrolled ? 'rgba(9,9,14,0.95)' : 'transparent',
        backdropFilter: scrolled ? 'blur(24px)' : 'none',
        WebkitBackdropFilter: scrolled ? 'blur(24px)' : 'none',
        borderBottom: scrolled ? '1px solid var(--border-base)' : '1px solid transparent',
      }}
    >
      <div className="w-full px-5 sm:px-8 h-[52px] flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
          aria-label="RicoMaps Home"
        >
          <img
            src="/favicon.png"
            alt=""
            className="w-6 h-6 rounded-md"
            style={{ border: '1px solid rgba(255,255,255,0.08)' }}
          />
          <span className="text-sm font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            RicoMaps
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          <div className="relative mr-1">
            <button
              ref={triggerRef}
              onClick={() => setPopoverOpen(o => !o)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold transition-all duration-150 border ${
                popoverOpen
                  ? 'bg-green-primary/10 text-green-primary border-green-primary/20'
                  : 'bg-white/[0.04] text-text-tertiary border-border-base hover:text-text-primary hover:border-border-hover'
              }`}
              aria-haspopup="dialog"
              aria-expanded={popoverOpen}
              aria-label="About $RICO token"
            >
              <span>$RICO</span>
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className={`transition-transform duration-150 ${popoverOpen ? 'rotate-180' : ''}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {popoverOpen && (
              <div
                ref={popoverRef}
                role="dialog"
                aria-label="About $RICO"
                className="absolute right-0 top-full mt-2 w-[300px] glass-panel p-3.5 z-50"
                style={{ animation: 'fadeIn 0.15s ease-out' }}
              >
                <p className="text-[12px] leading-relaxed text-text-secondary mb-3">
                  The fees generated from this token are auto sent to a wallet for API funding to keep the site running. Thanks for stopping by.
                </p>
                <div className="text-[10px] font-mono uppercase tracking-[0.08em] text-text-tertiary mb-1">
                  Contract
                </div>
                <button
                  onClick={copyCA}
                  className="flex items-center justify-between w-full gap-2 px-2.5 py-2 rounded-md bg-bg-elevated hover:bg-bg-hover border border-border-base hover:border-border-hover transition-colors group"
                  title="Click to copy"
                >
                  <span className="text-[10.5px] font-mono text-text-secondary truncate">
                    {RICO_CA}
                  </span>
                  {copied ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-shrink-0 text-green-primary">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 text-text-tertiary group-hover:text-text-primary">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </svg>
                  )}
                </button>
              </div>
            )}
          </div>
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-link ${pathname === link.href ? 'active' : ''}`}
            >
              {link.label}
            </Link>
          ))}
          <a
            href="https://github.com/nullxnothing/ricomaps"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-icon-btn ml-1"
            aria-label="GitHub repository"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836a9.59 9.59 0 012.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
            </svg>
          </a>
          <a
            href="https://x.com/RicoxMaps"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-icon-btn"
            aria-label="Follow on X"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
          <div className="ml-2">
            <GateButton />
          </div>
        </nav>
      </div>
    </header>
  );
}
