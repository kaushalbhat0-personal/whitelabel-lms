'use client';

import { useEffect, useRef } from 'react';

interface MiniPlayerProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  enabled?: boolean;
  onMiniChange?: (isMini: boolean) => void;
}

export function MiniPlayer({
  containerRef,
  enabled = true,
  onMiniChange,
}: MiniPlayerProps) {
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
          onMiniChange?.(true);
        } else if (entry.isIntersecting && entry.boundingClientRect.top >= 0) {
          onMiniChange?.(false);
        }
      },
      { threshold: 0, rootMargin: '0px' },
    );

    observerRef.current.observe(container);

    return () => {
      observerRef.current?.disconnect();
    };
  }, [containerRef, enabled, onMiniChange]);

  return null;
}