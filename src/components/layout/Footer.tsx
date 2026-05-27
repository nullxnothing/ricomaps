import Link from 'next/link';
import { Container } from './Container';

const FOOTER_LINKS = [
  { href: '/docs', label: 'Docs' },
  { href: '/roadmap', label: 'Roadmap' },
  { href: '/blacklist', label: 'Blacklist' },
];

export function Footer() {
  return (
    <footer className="border-t mt-auto" style={{ borderColor: 'var(--border-base)', background: 'var(--bg-void)' }}>
      <Container className="py-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <img
              src="/favicon.png"
              alt=""
              className="w-5 h-5 rounded-md"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            />
            <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>RicoMaps</span> &middot; See the unseen on Solana
            </span>
          </div>
          <nav className="flex items-center gap-5 text-sm">
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="footer-link"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {link.label}
              </Link>
            ))}
            <a
              href="https://x.com/RicoxMaps"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link"
              style={{ color: 'var(--text-tertiary)' }}
            >
              X / Twitter
            </a>
            <a
              href="https://github.com/nullxnothing/ricomaps"
              target="_blank"
              rel="noopener noreferrer"
              className="footer-link"
              style={{ color: 'var(--text-tertiary)' }}
            >
              GitHub
            </a>
          </nav>
        </div>
      </Container>
    </footer>
  );
}
