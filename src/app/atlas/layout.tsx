import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Atlas — Live Cabal Map | RicoMaps',
  description:
    'A live map of every active cabal operating across pump.fun: launches, graduations, coordinated crews, and rugs as they happen.',
};

export default function AtlasLayout({ children }: { children: React.ReactNode }) {
  return children;
}
