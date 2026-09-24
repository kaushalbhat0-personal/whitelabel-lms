'use client';

import { useState, useEffect, useCallback, useRef, useId } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/lib/constants';
import { useSession } from '@/hooks/useSession';
import { NavigationLink } from '@/components/shared/NavigationLink';
import { Button } from '@/components/ui/Button';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useBusinessConfig } from '@/components/providers/BusinessConfigProvider';
import {
  LayoutDashboard,
  Users,
  IndianRupee,
  Video,
  GraduationCap,
  Pencil,
  Monitor,
  Megaphone,
  Trophy,
  LogOut,
  ChevronDown,
  Menu,
  X,
} from 'lucide-react';

interface NavGroup {
  label: string;
  icon: typeof LayoutDashboard;
  items: { label: string; href: string }[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Dashboard',
    icon: LayoutDashboard,
    items: [{ label: 'Home', href: ROUTES.ADMIN.HOME }],
  },
  {
    label: 'Academics',
    icon: GraduationCap,
    items: [{ label: 'Courses & Batches', href: ROUTES.ADMIN.COURSES }],
  },
  {
    label: 'Assessments',
    icon: Pencil,
    items: [
      { label: 'Tests', href: ROUTES.ADMIN.TESTS },
      { label: 'Question Bank', href: ROUTES.ADMIN.QUESTIONS },
      { label: 'Review Queue', href: ROUTES.ADMIN.REVIEW_QUEUE },
    ],
  },
  {
    label: 'Content',
    icon: Video,
    items: [
      { label: 'Recordings', href: ROUTES.ADMIN.RECORDINGS },
      { label: 'Live Sessions', href: ROUTES.ADMIN.SESSIONS },
    ],
  },
  {
    label: 'Students',
    icon: Users,
    items: [
      { label: 'All Students', href: ROUTES.ADMIN.STUDENTS },
      { label: 'Bulk Upload', href: ROUTES.ADMIN.BULK_UPLOAD },
    ],
  },
  {
    label: 'Finance',
    icon: IndianRupee,
    items: [
      { label: 'Finance Center', href: ROUTES.ADMIN.FINANCE },
      { label: 'Payments & Plans', href: ROUTES.ADMIN.PAYMENTS },
      { label: 'Business Config', href: ROUTES.ADMIN.BUSINESS_CONFIG },
    ],
  },
  {
    label: 'Communication',
    icon: Megaphone,
    items: [
      { label: 'Announcements', href: ROUTES.ADMIN.ANNOUNCEMENTS },
      { label: 'Email Center', href: ROUTES.ADMIN.EMAIL_LOGS },
    ],
  },
  {
    label: 'System',
    icon: Monitor,
    items: [
      { label: 'Monitoring', href: ROUTES.ADMIN.MONITORING },
      { label: 'Performance', href: ROUTES.ADMIN.PERFORMANCE },
      { label: 'Analytics', href: ROUTES.ADMIN.ANALYTICS },
      { label: 'Playback Analytics', href: ROUTES.ADMIN.PLAYBACK_ANALYTICS },
      { label: 'Audit Logs', href: ROUTES.ADMIN.AUDIT_LOGS },
      { label: 'Violations', href: ROUTES.ADMIN.VIOLATIONS },
    ],
  },
];

const STORAGE_KEY = 'admin-sidebar-state-v2';

function loadCollapsedState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveCollapsedState(state: Record<string, boolean>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function SidebarContent({
  pathname,
  onNavigate,
  onLogout,
  collapsed,
  toggleGroup,
  isLoggingOut,
}: {
  pathname: string;
  onNavigate?: () => void;
  onLogout: () => void;
  collapsed: Record<string, boolean>;
  toggleGroup: (label: string) => void;
  isLoggingOut?: boolean;
}) {
  const { businessName, logoUrl } = useBusinessConfig();
  const isGroupActive = (group: NavGroup) =>
    group.items.some((item) => pathname === item.href || (item.href !== ROUTES.ADMIN.HOME && pathname.startsWith(item.href)));
  const isItemActive = (href: string) =>
    pathname === href || (href !== ROUTES.ADMIN.HOME && pathname.startsWith(href));

  return (
    <>
      <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-divider px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/20 overflow-hidden">
          {logoUrl ? (
            <img src={logoUrl} alt={businessName} className="h-full w-full object-contain p-0.5" />
          ) : (
            <Trophy className="h-4 w-4 text-brand-300" />
          )}
        </div>
        <div className="min-w-0">
          <span className="block truncate text-base font-bold tracking-tight text-white" title={businessName}>
            {businessName}
          </span>
          <p className="text-2xs font-medium text-brand-200">Admin Panel</p>
        </div>
      </div>
      <nav className="flex-1 min-h-0 space-y-0.5 overflow-y-auto overscroll-contain px-3 py-3 scrollbar-thin" role="navigation">
        {navGroups.map((group) => {
          const active = isGroupActive(group);
          const isOpen = !collapsed[group.label];
          return (
            <div key={group.label} className="mb-0.5">
              <button
                onClick={() => toggleGroup(group.label)}
                className={cn(
                  'w-full flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200',
                  active ? 'text-sidebar-text' : 'text-sidebar-text/70 hover:text-sidebar-text hover:bg-sidebar-hover',
                )}
                aria-expanded={isOpen}
              >
                <group.icon className="h-5 w-5 shrink-0" />
                <span className="flex-1 text-left">{group.label}</span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform duration-200', isOpen && 'rotate-180')} />
              </button>
              <div className={cn('overflow-hidden transition-all duration-200', isOpen ? 'max-h-96' : 'max-h-0')}>
                <div className="ml-2 space-y-0.5 border-l border-sidebar-divider/30 pl-4 py-0.5">
                  {group.items.map((item) => (
                    <NavigationLink
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      className={cn('sidebar-link', isItemActive(item.href) && 'active')}
                    >
                      <span className="truncate">{item.label}</span>
                    </NavigationLink>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-divider px-3 py-4">
        <Button
          onClick={onLogout}
          loading={!!isLoggingOut}
          variant="ghost"
          className="sidebar-link w-full justify-start min-h-[44px] border border-transparent text-sidebar-text hover:bg-sidebar-hover hover:text-white"
        >
          {!isLoggingOut && <LogOut className="h-5 w-5 shrink-0" />}
          <span>{isLoggingOut ? 'Signing out…' : 'Logout'}</span>
        </Button>
      </div>
    </>
  );
}

export function AdminSidebarWrapper() {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, isLoggingOut } = useSession();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const drawerTitleId = useId();
  const closeDrawer = useCallback(() => setMobileOpen(false), []);
  useFocusTrap(drawerRef as React.RefObject<HTMLElement>, mobileOpen, closeDrawer);

  useEffect(() => { setCollapsed(loadCollapsedState()); }, []);

  useEffect(() => {
    setCollapsed((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const group of navGroups) {
        if (group.items.some((item) => pathname === item.href || (item.href !== ROUTES.ADMIN.HOME && pathname.startsWith(item.href)))) {
          if (next[group.label] === true) { next[group.label] = false; changed = true; }
        }
      }
      if (changed) saveCollapsedState(next);
      return changed ? next : prev;
    });
  }, [pathname]);

  // Close mobile drawer on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Focus return + body scroll lock (UX-2)
  useEffect(() => {
    if (mobileOpen) {
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
  }, [mobileOpen]);

  const toggleGroup = useCallback((label: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      saveCollapsedState(next);
      return next;
    });
  }, []);

  const { businessName: mobileBusinessName, logoUrl: mobileLogoUrl } = useBusinessConfig();

  const handleLogout = () => {
    setMobileOpen(false);
    logout();
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-sidebar-bg md:h-screen md:h-[100dvh] md:overflow-hidden md:min-h-0">
        <SidebarContent
          pathname={pathname}
          onLogout={handleLogout}
          collapsed={collapsed}
          toggleGroup={toggleGroup}
          isLoggingOut={isLoggingOut}
        />
      </aside>

      {/* Mobile Top Bar */}
      <div className="md:hidden flex items-center justify-between bg-sidebar-bg px-4 py-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {mobileLogoUrl ? (
            <img src={mobileLogoUrl} alt={mobileBusinessName} className="h-5 w-5 object-contain rounded" />
          ) : (
            <Trophy className="h-5 w-5 text-brand-300 shrink-0" />
          )}
          <span className="truncate text-sm font-bold text-white" title={mobileBusinessName}>
            {mobileBusinessName}
          </span>
        </div>
        <button
          ref={triggerRef}
          onClick={() => setMobileOpen(true)}
          className="rounded-lg p-2 text-sidebar-text hover:bg-sidebar-hover min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Open navigation menu"
          aria-expanded={mobileOpen}
          aria-controls="admin-mobile-drawer"
          aria-haspopup="dialog"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={drawerRef}
            id="admin-mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby={drawerTitleId}
            tabIndex={-1}
            className="absolute left-0 top-0 bottom-0 w-72 bg-sidebar-bg shadow-xl flex flex-col motion-safe:animate-slide-in-right outline-none"
          >
            <div className="flex items-center justify-between p-4 border-b border-sidebar-divider">
              <span id={drawerTitleId} className="text-sm font-bold text-white">Navigation</span>
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded-lg p-2 text-sidebar-text hover:bg-sidebar-hover min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarContent
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
              onLogout={handleLogout}
              collapsed={collapsed}
              toggleGroup={toggleGroup}
              isLoggingOut={isLoggingOut}
            />
          </div>
        </div>
      )}
    </>
  );
}
