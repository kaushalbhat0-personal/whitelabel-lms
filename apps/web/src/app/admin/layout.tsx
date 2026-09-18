import { ReactNode } from 'react';
import { SessionExpiredOverlay } from '@/components/shared/SessionExpiredOverlay';
import { GuardRoute } from '@/lib/guards/client-guard';
import { AdminSidebarWrapper } from './admin-sidebar-wrapper';
import { GlobalSearch } from '@/components/admin/GlobalSearch';
import { NavigationProvider } from '@/components/providers/NavigationProvider';
import { NavigationProgress } from '@/components/providers/NavigationProgress';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SessionExpiredOverlay />
      <GuardRoute>
        <NavigationProvider>
          <NavigationProgress />
          <div className="flex flex-col md:flex-row min-h-screen bg-surface-page">
            {/* Sidebar: fixed desktop aside + mobile drawer bar */}
            <AdminSidebarWrapper />

            {/* Main content */}
            <main className="flex flex-1 flex-col min-w-0">
              {/* Header */}
              <header className="flex h-16 items-center justify-between border-b border-surface-border bg-white px-4 md:px-8 shadow-nav shrink-0">
                <div className="flex items-center gap-3 md:gap-4">
                  <div className="h-2 w-2 rounded-full bg-brand-500" />
                  <h2 className="text-sm md:text-base font-semibold text-text-primary">Admin Command Center</h2>
                </div>
                <GlobalSearch />
              </header>

              {/* Page content */}
              <div className="flex-1 p-4 md:p-6 lg:p-8 overflow-x-hidden">{children}</div>
            </main>
          </div>
        </NavigationProvider>
      </GuardRoute>
    </>
  );
}
