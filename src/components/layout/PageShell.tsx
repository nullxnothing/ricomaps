import { ReactNode } from 'react';
import { Navbar } from '../Navbar';
import { Footer } from './Footer';

interface PageShellProps {
  children: ReactNode;
  /** Make navbar fade in on scroll instead of always solid (useful for full-bleed heroes) */
  navFadeIn?: boolean;
}

export function PageShell({ children, navFadeIn = false }: PageShellProps) {
  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--bg-void)', color: 'var(--text-primary)' }}>
      <Navbar fadeIn={navFadeIn} />
      <main className="flex-1 flex flex-col">{children}</main>
      <Footer />
    </div>
  );
}
