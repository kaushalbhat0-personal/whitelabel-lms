'use client';

import { useSession } from '@/hooks/useSession';
import { LogOut, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export function SessionExpiredOverlay() {
  const { isExpired, isTakeover, error, logout, isLoggingOut } = useSession();

  if (!isExpired && !isTakeover) return null;

  const isTakeoverActive = isTakeover;
  const title = isTakeoverActive ? 'Session taken over' : 'Session expired';
  const description = error || (isTakeoverActive
    ? 'Another device logged into your account.'
    : 'Please login again.');

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-2xl">
        <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${isTakeoverActive ? 'bg-orange-50' : 'bg-red-50'}`}>
          {isTakeoverActive ? (
            <AlertTriangle className="h-6 w-6 text-orange-500" />
          ) : (
            <LogOut className="h-6 w-6 text-red-500" />
          )}
        </div>
        <h2 className="mt-4 text-lg font-bold text-gray-900">{title}</h2>
        <p className="mt-2 text-sm text-gray-500">{description}</p>
        <Button
          onClick={logout}
          loading={isLoggingOut}
          className="mt-6 w-full rounded-lg bg-brand-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-navyDark min-h-[44px]"
        >
          {isLoggingOut ? 'Signing out…' : 'Go to Login'}
        </Button>
      </div>
    </div>
  );
}
