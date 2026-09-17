'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/lib/constants';
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

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setMoreOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const anyMoreActive = moreItems.some((item) => isActive(item.href, false));

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-surface-border bg-white shadow-nav md:hidden">
      <div className="flex items-center justify-around pb-safe" style={{ height: '56px' }}>
        {visibleTabs.map((tab) => {
          const active = isActive(tab.href, tab.exact);
          return (
            <Link
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
            </Link>
          );
        })}

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            aria-label="More navigation options"
            aria-expanded={moreOpen}
            aria-haspopup="true"
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
            <div className="absolute bottom-full right-0 mb-2 max-w-[calc(100vw-16px)] w-40 motion-safe:animate-fade-in rounded-card border border-surface-border bg-surface-card p-2 shadow-elevated">
              {moreItems.map((item) => {
                const active = isActive(item.href, false);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-text-secondary hover:bg-surface-muted hover:text-text-primary',
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
