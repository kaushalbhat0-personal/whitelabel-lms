'use client';

import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/lib/constants';
import { NavigationLink } from '@/components/shared/NavigationLink';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import {
  LayoutDashboard,
  BookOpen,
  Radio,
  Video,
  MoreHorizontal,
  ClipboardList,
  BarChart3,
  User,
  Bell,
} from 'lucide-react';

const visibleTabs = [
  { href: ROUTES.STUDENT.HOME, icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { href: ROUTES.STUDENT.COURSES, icon: BookOpen, label: 'Courses' },
  { href: ROUTES.STUDENT.LIVE_SESSIONS, icon: Radio, label: 'Live' },
  { href: ROUTES.STUDENT.VIDEOS, icon: Video, label: 'Videos' },
];

const moreItems = [
  { href: ROUTES.STUDENT.TESTS, icon: ClipboardList, label: 'Tests' },
  { href: ROUTES.STUDENT.RESULTS, icon: BarChart3, label: 'Results' },
  { href: ROUTES.STUDENT.NOTIFICATIONS, icon: Bell, label: 'Notifications' },
  { href: '/student/profile', icon: User, label: 'Profile' },
];

export function StudentBottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const sheetTitleId = useId();

  const closeMore = useCallback(() => setMoreOpen(false), []);

  useFocusTrap(sheetRef as React.RefObject<HTMLElement>, moreOpen, closeMore);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Restore focus + body scroll lock (UX-2)
  useEffect(() => {
    if (moreOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      const prev = previousFocusRef.current;
      if (prev && typeof prev.focus === 'function') {
        setTimeout(() => prev.focus(), 0);
      }
      previousFocusRef.current = null;
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [moreOpen]);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const anyMoreActive = moreItems.some((item) => isActive(item.href, false));

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-surface-border bg-white shadow-nav md:hidden">
      <div className="flex items-center justify-around pb-safe" style={{ height: '56px' }}>
        {visibleTabs.map((tab) => {
          const active = isActive(tab.href, tab.exact);
          return (
            <NavigationLink
              key={tab.href}
              href={tab.href}
              aria-label={tab.label}
              aria-current={active ? 'page' : undefined}
              className="bottom-nav-link"
              style={{ minHeight: '44px', minWidth: '44px' }}
            >
              <tab.icon
                className={cn('h-5 w-5', active ? 'text-brand-600' : 'text-text-muted')}
              />
              <span
                className={cn(
                  'text-[10px] leading-tight',
                  active ? 'font-semibold text-brand-600' : 'font-medium text-text-muted',
                )}
              >
                {tab.label}
              </span>
            </NavigationLink>
          );
        })}

        <div className="relative" ref={menuRef}>
          <button
            ref={moreButtonRef}
            onClick={() => setMoreOpen(!moreOpen)}
            aria-label="More navigation options"
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            aria-controls={moreOpen ? 'student-more-sheet' : undefined}
            className={cn(
              'bottom-nav-link',
              (anyMoreActive || moreOpen) && 'active',
            )}
            style={{ minHeight: '44px', minWidth: '44px' }}
          >
            <MoreHorizontal
              className={cn('h-5 w-5', (anyMoreActive || moreOpen) ? 'text-brand-600' : 'text-text-muted')}
            />
            <span
              className={cn(
                'text-[10px] leading-tight',
                (anyMoreActive || moreOpen) ? 'font-semibold text-brand-600' : 'font-medium text-text-muted',
              )}
            >
              More
            </span>
          </button>

          {moreOpen && (
            <>
              {/* UX-2: inert backdrop — prevents background interaction/keyboard */}
              <div className="fixed inset-0 z-40 bg-transparent" aria-hidden="true" onClick={closeMore} />
              <div
                ref={sheetRef}
                id="student-more-sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby={sheetTitleId}
                tabIndex={-1}
                className="absolute bottom-full right-0 z-50 mb-2 max-w-[calc(100vw-16px)] w-40 motion-safe:animate-fade-in rounded-card border border-surface-border bg-surface-card p-2 shadow-elevated outline-none"
              >
                <span id={sheetTitleId} className="sr-only">More navigation</span>
                {moreItems.map((item) => {
                  const active = isActive(item.href, false);
                  return (
                    <NavigationLink
                      key={item.href}
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors min-h-[44px]',
                        active
                          ? 'bg-brand-50 text-brand-700'
                          : 'text-text-secondary hover:bg-surface-muted hover:text-text-primary',
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </NavigationLink>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
