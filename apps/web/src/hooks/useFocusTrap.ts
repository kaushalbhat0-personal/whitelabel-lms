'use client';

import { useCallback, useEffect } from 'react';

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  const selector =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.offsetParent !== null || el.getClientRects().length > 0,
  );
}

export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement>,
  isOpen: boolean,
  onClose: () => void,
) {
  const handleTab = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !isOpen) return;
      const focusable = getFocusableElements(containerRef.current);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [containerRef, isOpen],
  );

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    },
    [isOpen, onClose],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleTab);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleTab);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, handleTab, handleEscape]);

  // Move focus into container when opened
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      const focusable = getFocusableElements(containerRef.current);
      if (focusable.length > 0) focusable[0].focus();
      else containerRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [isOpen, containerRef]);
}

export { getFocusableElements };
