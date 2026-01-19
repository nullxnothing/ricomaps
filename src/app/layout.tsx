import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RicoMaps",
  description: "Bubble Maps. Real-time. Click to Scan Any CA.",
  icons: {
    icon: [
      { url: '/favicon.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/favicon.png',
  },
  openGraph: {
    title: "RicoMaps",
    description: "Bubble Maps. Real-time. Click to Scan Any CA.",
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 675,
        alt: 'RicoMaps - Bubble Maps Real-time',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: "RicoMaps",
    description: "Bubble Maps. Real-time. Click to Scan Any CA.",
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-[#0a0a0a] text-[#e8e8ed]" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace" }}>
        {children}
      </body>
    </html>
  );
}
