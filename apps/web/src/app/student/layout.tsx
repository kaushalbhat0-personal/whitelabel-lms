import { ReactNode } from 'react';
import { StudentSidebar } from '@/components/layout/StudentSidebar';
import { StudentBottomNav } from '@/components/layout/StudentBottomNav';
import { SessionExpiredOverlay } from '@/components/shared/SessionExpiredOverlay';
import { GuardRoute } from '@/lib/guards/client-guard';
import { NotificationBell } from '@/components/student/NotificationBell';
import { NavigationProvider } from '@/components/providers/NavigationProvider';
import { NavigationProgress } from '@/components/providers/NavigationProgress';

export default function StudentLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SessionExpiredOverlay />
      <GuardRoute>
        <NavigationProvider>
          <NavigationProgress />
          <div className="min-h-screen bg-surface-page">
            {/* Desktop sidebar — hidden on mobile */}
            <aside className="fixed left-0 top-0 z-40 hidden h-screen w-60 flex-col bg-sidebar-bg md:flex">
              <StudentSidebar />
            </aside>

            {/* Single content column — offset by sidebar on desktop */}
            <main className="ml-0 min-h-screen flex-1 md:ml-60">
              {/* Desktop top bar — hidden on mobile */}
              <header className="hidden h-14 items-center border-b border-surface-border bg-white px-8 md:flex">
                <div className="flex flex-1 items-center gap-2">
                  <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
                  <span className="text-sm font-medium text-text-secondary">Student Dashboard</span>
                </div>
                <div className="flex items-center gap-3">
                  <NotificationBell />
                  <span className="text-xs text-text-muted">MCT Learn v2.0</span>
                </div>
              </header>

              {/* Single content container */}
              <div className="mx-auto max-w-5xl px-0 pb-20 pt-0 md:px-6 md:pb-8 md:pt-8">
                {children}
              </div>
            </main>

            {/* Mobile bottom nav — hidden on desktop */}
            <StudentBottomNav />
          </div>
        </NavigationProvider>
      </GuardRoute>
    </>
  );
}
