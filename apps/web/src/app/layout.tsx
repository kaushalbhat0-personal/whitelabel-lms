import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/components/providers/AuthProvider';
import { AuthDebugPanel } from '@/components/debug/AuthDebugPanel';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'MCT Learn — Money Craft Trader',
  description: 'Learning Management System — Money Craft Trader',
};

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
