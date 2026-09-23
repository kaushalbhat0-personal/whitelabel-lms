'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/lib/constants';
import { useSession } from '@/hooks/useSession';
import { useAuthStore } from '@/stores/auth.store';
import Image from 'next/image';
import { NavigationLink } from '@/components/shared/NavigationLink';
import { Button } from '@/components/ui/Button';
import {
  LayoutDashboard,
  BookOpen,
  Video,
  Radio,
  ClipboardList,
  BarChart3,
  User,
  LogOut,
} from 'lucide-react';

const navItems = [
  { label: 'Dashboard', href: ROUTES.STUDENT.HOME, icon: LayoutDashboard, exact: true },
  { label: 'Courses', href: ROUTES.STUDENT.COURSES, icon: BookOpen },
  { label: 'Live Sessions', href: ROUTES.STUDENT.LIVE_SESSIONS, icon: Radio },
  { label: 'Videos', href: ROUTES.STUDENT.VIDEOS, icon: Video },
  { label: 'Tests', href: ROUTES.STUDENT.TESTS, icon: ClipboardList },
  { label: 'Results', href: ROUTES.STUDENT.RESULTS, icon: BarChart3 },
  { label: 'Profile', href: '/student/profile', icon: User },
];

function isActive(href: string, exact: boolean | undefined, pathname: string) {
  if (exact) return pathname === href;
  return pathname.startsWith(href);
}

export function StudentSidebar() {
  const pathname = usePathname();
  const { logout, isLoggingOut } = useSession();
  const user = useAuthStore((s) => s.user);
  const displayName =
    user?.name?.trim() ||
    user?.email?.split('@')[0] ||
    'Student';
  const initial = displayName.trim()[0]?.toUpperCase() || 'U';

  return (
    <>
      <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-divider px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white p-1">
          <Image
            src="/mct-logo.png"
            alt=""
            width={32}
            height={32}
            className="h-full w-full object-contain"
            aria-hidden="true"
          />
        </div>
        <div>
          <span className="text-base font-bold tracking-tight text-white">MCT Learn</span>
          <p className="text-2xs font-medium text-brand-200">Student Portal</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const active = isActive(item.href, item.exact, pathname);
          return (
            <NavigationLink
              key={item.href}
              href={item.href}
              className={cn(
                'sidebar-link',
                active && 'active',
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              <span>{item.label}</span>
            </NavigationLink>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-divider px-4 py-4">
        <div className="flex items-center gap-3 rounded-xl px-3 py-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white" aria-hidden="true">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white" title={displayName}>{displayName}</p>
            <p className="truncate text-2xs text-brand-200">Student</p>
          </div>
        </div>
        <Button
          onClick={logout}
          loading={isLoggingOut}
          variant="ghost"
          className="mt-2 min-h-[44px] w-full justify-start gap-2 rounded-xl px-3 py-2 text-sm font-medium text-brand-200 hover:bg-sidebar-hover hover:text-white"
        >
          {!isLoggingOut && <LogOut className="h-4 w-4" />}
          {isLoggingOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </>
  );
}
