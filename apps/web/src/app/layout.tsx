import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { AuthDebugPanel } from '@/components/debug/AuthDebugPanel';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

async function getBusinessMetadata(): Promise<{ businessName: string; faviconUrl?: string }> {
  const fallback = { businessName: 'LMS Platform' as string, faviconUrl: undefined as string | undefined };
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!apiUrl) return fallback;
    const url = `${apiUrl.replace(/\/$/, '')}/business-config/public`;
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return fallback;
    const json = await res.json().catch(() => null);
    if (!json) return fallback;
    // Unwrap ResponseTransformInterceptor { success, data } or direct
    const data = (json.data ?? json) as Record<string, unknown>;
    const businessName = (data.business_name as string) ?? fallback.businessName;
    const faviconUrl = (data.favicon_url as string | undefined) ?? undefined;
    return { businessName, faviconUrl };
  } catch {
    return fallback;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const { businessName, faviconUrl } = await getBusinessMetadata();
  return {
    title: businessName,
    description: 'Learning Management System',
    ...(faviconUrl ? { icons: { icon: faviconUrl } } : {}),
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#10b981',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans">
        <AuthProvider>
          {children}
          <AuthDebugPanel />
        </AuthProvider>
      </body>
    </html>
  );
}
