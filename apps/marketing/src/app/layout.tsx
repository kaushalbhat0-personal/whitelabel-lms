import type { Metadata } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import { siteConfig } from '@/site.config';
import { MarketingNav } from '@/components/marketing-nav';
import { MarketingFooter } from '@/components/marketing-footer';
import { SiteSchema } from '@/components/site-schema';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

// Single editorial display face for headlines (MKT-02B). Self-hosted via
// next/font — no runtime external request. Body copy stays Inter.
const display = Fraunces({ subsets: ['latin'], variable: '--font-display', display: 'swap' });

const description =
  'A branded LMS deployed for your institute. We configure and launch your own learning platform on infrastructure you own — for coaching institutes and academies.';

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.siteUrl),
  title: {
    default: `${siteConfig.tagline} | ${siteConfig.brandName}`,
    template: `%s | ${siteConfig.brandName}`,
  },
  description,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: siteConfig.brandName,
    title: `${siteConfig.tagline} | ${siteConfig.brandName}`,
    description,
    url: '/',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'MicroNest LMS — your own branded LMS, deployed for you.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${siteConfig.tagline} | ${siteConfig.brandName}`,
    description,
    images: ['/og-image.png'],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`}>
      <body className="font-sans">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-cta focus:bg-paper focus:px-4 focus:py-2 focus:font-semibold"
        >
          Skip to content
        </a>
        <MarketingNav />
        <main id="main-content">{children}</main>
        <MarketingFooter />
        <SiteSchema />
      </body>
    </html>
  );
}
