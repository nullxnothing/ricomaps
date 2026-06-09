import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { GateProvider } from "@/components/GateProvider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RicoMaps",
  description: "Solana forensic intelligence. Trace wallet funding chains and expose hidden cabal connections.",
  icons: {
    icon: [
      { url: '/favicon.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/favicon.png',
  },
  openGraph: {
    title: "RicoMaps",
    description: "Solana forensic intelligence. Trace wallet funding chains and expose hidden cabal connections.",
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 675,
        alt: 'RicoMaps - Solana Forensic Intelligence',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: "RicoMaps",
    description: "Solana forensic intelligence. Trace wallet funding chains and expose hidden cabal connections.",
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased font-sans">
        <GateProvider>
          {children}
        </GateProvider>
      </body>
    </html>
  );
}
