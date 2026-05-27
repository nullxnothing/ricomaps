'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';

const RICO_CA = '6tf2X4GbYdM59hAMNa5kgyja2C9CjwUVqr9YLvJ1pump';

interface NavbarProps {
  /** Visually hide the bar when scrollY === 0 (useful for full-bleed heroes) */
  fadeIn?: boolean;
}

const NAV_LINKS = [
  { href: '/docs', label: 'Docs' },
  { href: '/roadmap', label: 'Roadmap' },
  { href: '/blacklist', label: 'Blacklist' },
];

export function Navbar({ fadeIn = false }: NavbarProps) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(!fadeIn);
  const [copied, setCopied] = useState(false);

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
          <button
            onClick={copyCA}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold transition-all duration-150 mr-1"
            style={{
              background: copied ? 'rgba(0,255,65,0.1)' : 'rgba(255,255,255,0.04)',
              color: copied ? 'var(--green-primary)' : 'var(--text-tertiary)',
              border: copied ? '1px solid rgba(0,255,65,0.2)' : '1px solid var(--border-base)',
            }}
            title={copied ? 'Copied!' : `Copy $RICO CA: ${RICO_CA}`}
          >
            <span>$RICO</span>
            {copied ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
            )}
          </button>
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
        </nav>
      </div>
    </header>
  );
}
