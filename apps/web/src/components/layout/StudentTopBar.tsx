'use client';

import { usePathname } from 'next/navigation';
import { ROUTES } from '@/lib/constants';

function getTopBarLabel(pathname: string): string {
  if (pathname === ROUTES.STUDENT.HOME) return 'Student Dashboard';
  if (pathname.startsWith(ROUTES.STUDENT.COURSES)) return 'Courses';
  if (pathname.startsWith(ROUTES.STUDENT.LIVE_SESSIONS)) return 'Live Sessions';
  if (pathname.startsWith(ROUTES.STUDENT.VIDEOS)) return 'Videos';
  if (pathname.startsWith(ROUTES.STUDENT.TESTS)) return 'Tests';
  if (pathname.startsWith(ROUTES.STUDENT.RESULTS)) return 'Results';
  if (pathname.startsWith(ROUTES.STUDENT.NOTIFICATIONS)) return 'Notifications';
  if (pathname.startsWith('/student/profile')) return 'Profile';
  return 'Student Dashboard';
}

export function StudentTopBar() {
  const pathname = usePathname();
  const label = getTopBarLabel(pathname);
  return <span className="text-sm font-medium text-text-secondary">{label}</span>;
}
