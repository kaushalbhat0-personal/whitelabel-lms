'use client';

import { createContext, useContext, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface NavigationContextValue {
  isPending: boolean;
  isDelayedPending: boolean;
  push: (href: string) => void;
  replace: (href: string) => void;
  refresh: () => void;
}

const NavigationContext = createContext<NavigationContextValue>({
  isPending: false,
  isDelayedPending: false,
  push: () => {},
  replace: () => {},
  refresh: () => {},
});

export function useNavigation() {
  return useContext(NavigationContext);
}

export function useNavigationPending() {
  return useContext(NavigationContext).isDelayedPending;
}

const DELAY_MS = 150;

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isDelayedPending, setDelayedPending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isPending) {
      clearTimer();
      timerRef.current = setTimeout(() => {
        setDelayedPending(true);
      }, DELAY_MS);
    } else {
      clearTimer();
      setDelayedPending(false);
    }

    return () => {
      clearTimer();
    };
  }, [isPending, clearTimer]);

  // Ensure cleanup on unmount — never leave stuck progress
  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  const push = useCallback(
    (href: string) => {
      startTransition(() => {
        router.push(href);
      });
    },
    [router, startTransition],
  );

  const replace = useCallback(
    (href: string) => {
      startTransition(() => {
        router.replace(href);
      });
    },
    [router, startTransition],
  );

  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router, startTransition]);

  return (
    <NavigationContext.Provider value={{ isPending, isDelayedPending, push, replace, refresh }}>
      {children}
    </NavigationContext.Provider>
  );
}
