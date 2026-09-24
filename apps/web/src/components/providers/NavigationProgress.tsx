'use client';

import { useNavigationPending } from './NavigationProvider';

export function NavigationProgress() {
  const isDelayedPending = useNavigationPending();

  // No DOM animation when not pending — avoids permanent CPU and SR noise
  if (!isDelayedPending) return null;

  return (
    <div
      className="pointer-events-none fixed left-0 right-0 top-0 z-40 h-0.5 overflow-hidden"
      aria-hidden="true"
    >
      <div
        className="h-full w-full origin-left bg-brand-600 motion-safe:animate-pulse"
        style={{
          // Runtime brand primary — validated hex via CSS var; fallback matches DEFAULT_THEME_PRIMARY
          background: 'linear-gradient(90deg, var(--brand-primary) 0%, var(--brand-primary) 50%, var(--brand-primary) 100%)',
          backgroundSize: '200% 100%',
        }}
      />
    </div>
  );
}
