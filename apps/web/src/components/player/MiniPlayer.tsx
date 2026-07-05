'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { X } from 'lucide-react';

interface MiniPlayerProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
  enabled?: boolean;
}

export function MiniPlayer({
  containerRef,
  children,
  enabled = true,
}: MiniPlayerProps) {
  const [isMini, setIsMini] = useState(false);
  const [showMini, setShowMini] = useState(false);
  const originalRectRef = useRef<DOMRect | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const miniRef = useRef<HTMLDivElement>(null);
  const scrollCheckRef = useRef<number>(0);

  const handleClose = useCallback(() => {
    setShowMini(false);
    setIsMini(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
          if (!originalRectRef.current) {
            originalRectRef.current = entry.boundingClientRect;
          }
          setIsMini(true);
          setShowMini(true);
        } else if (entry.isIntersecting && entry.boundingClientRect.top >= 0) {
          setIsMini(false);
          setShowMini(false);
        }
      },
      { threshold: 0, rootMargin: '0px' },
    );

    observerRef.current.observe(container);

    return () => {
      observerRef.current?.disconnect();
    };
  }, [containerRef, enabled]);

  if (!isMini) return null;

  return (
    <div
      ref={miniRef}
      className={`fixed bottom-4 right-4 z-50 w-72 aspect-video rounded-xl overflow-hidden shadow-2xl border border-white/10 bg-black transition-all duration-300 ${
        showMini ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
      }`}
    >
      {children}
      <button
        type="button"
        onClick={handleClose}
        className="absolute top-2 right-2 z-10 rounded-full bg-black/60 p-1 text-white/80 hover:bg-black/80 hover:text-white transition-colors"
        aria-label="Close mini player"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}