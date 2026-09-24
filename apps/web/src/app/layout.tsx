import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { AuthDebugPanel } from '@/components/debug/AuthDebugPanel';
import './globals.css';
import { DEFAULT_THEME_PRIMARY, DEFAULT_THEME_SIDEBAR_BG, DEFAULT_THEME_ACCENT, resolveTheme, themeCssVarsStyle } from '@/lib/theme';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

const HEX_6 = /^#[0-9A-Fa-f]{6}$/;
function isValidHex6(v: unknown): v is string {
  return typeof v === 'string' && HEX_6.test(v);
}

async function getBusinessConfigPublic(): Promise<{
  businessName: string;
  faviconUrl?: string;
  theme: { primary: string; sidebarBg: string; accent: string };
}> {
  const fallback = {
    businessName: 'LMS Platform' as string,
    faviconUrl: undefined as string | undefined,
    theme: { primary: DEFAULT_THEME_PRIMARY, sidebarBg: DEFAULT_THEME_SIDEBAR_BG, accent: DEFAULT_THEME_ACCENT },
  };
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
    const theme = resolveTheme((data as any).theme_json);
    return { businessName, faviconUrl, theme };
  } catch {
    return fallback;
  }
}

async function getBusinessMetadata(): Promise<{ businessName: string; faviconUrl?: string }> {
  const { businessName, faviconUrl } = await getBusinessConfigPublic();
  return { businessName, faviconUrl };
}

export async function generateMetadata(): Promise<Metadata> {
  const { businessName, faviconUrl } = await getBusinessMetadata();
  return {
    title: businessName,
    description: 'Learning Management System',
    ...(faviconUrl ? { icons: { icon: faviconUrl } } : {}),
  };
}

export async function generateViewport(): Promise<Viewport> {
  const { theme } = await getBusinessConfigPublic();
  const themeColor = isValidHex6(theme.primary) ? theme.primary : DEFAULT_THEME_PRIMARY;
  return {
    width: 'device-width',
    initialScale: 1,
    themeColor,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { theme } = await getBusinessConfigPublic();
  // Only validated hex values reach inline style — no raw DB JSON injection.
  const themeStyle = themeCssVarsStyle(theme);
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <style dangerouslySetInnerHTML={{ __html: themeStyle }} />
      </head>
      <body className="font-sans">
        <AuthProvider>
          {children}
          <AuthDebugPanel />
        </AuthProvider>
      </body>
    </html>
  );
}
