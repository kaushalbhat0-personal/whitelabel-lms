'use client';

import Link from 'next/link';
import { User, Shield, Lock, LogOut, Users } from 'lucide-react';
import { ROUTES } from '@/lib/constants';
import { useSession } from '@/hooks/useSession';

interface Props {
  email: string;
  batchNames: string[];
}

export function ProfileClient({ email, batchNames }: Props) {
  const { logout, user } = useSession();
  const displayEmail = email || user?.email || '';

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-surface-border bg-surface-card p-5 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-navy/10">
          <User className="h-8 w-8 text-brand-navy" />
        </div>
        <p className="mt-3 text-sm font-medium text-text-primary">{displayEmail || 'Student'}</p>
        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-text-secondary">
          <Shield className="h-3 w-3" />
          Student
        </span>
      </div>

      {batchNames.length > 0 && (
        <div className="rounded-card border border-surface-border bg-surface-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            My Batches
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {batchNames.map((name, i) => (
              <span
                key={i}
                className="rounded-full bg-brand-navy/10 px-2.5 py-0.5 text-xs font-medium text-brand-navy"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      <Link
        href={ROUTES.CHANGE_PASSWORD}
        className="flex items-center gap-3 rounded-card border border-surface-border bg-surface-card p-4 transition-colors hover:bg-surface-muted"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-muted">
          <Lock className="h-4 w-4 text-text-secondary" />
        </div>
        <span className="flex-1 text-sm font-medium text-text-primary">
          Change Password
        </span>
        <span className="text-sm text-text-muted">&rarr;</span>
      </Link>

      <button
        onClick={logout}
        className="flex w-full items-center justify-center gap-2 rounded-card border border-status-live px-4 py-3 text-sm font-semibold text-status-live transition-colors hover:bg-red-50"
      >
        <LogOut className="h-4 w-4" />
        Logout
      </button>
    </div>
  );
}
