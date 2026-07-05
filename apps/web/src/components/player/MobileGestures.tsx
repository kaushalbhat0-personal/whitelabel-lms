'use client';

import { useEffect, useRef, useCallback } from 'react';

interface MobileGesturesProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onVolumeChange: (volume: number) => void;
  onSpeedChange: (speed: number) => void;
}

export function MobileGestures({
  videoRef,
  containerRef,
  onVolumeChange,
  onSpeedChange,
}: MobileGesturesProps) {
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSpeedRef = useRef<number>(1);
  const gestureIndicatorRef = useRef<HTMLDivElement | null>(null);

  const showGesture = useCallback((text: string) => {
    const container = containerRef.current;
    if (!container) return;
    let el = gestureIndicatorRef.current;
    if (!el) {
      el = document.createElement('div');
      el.className =
        'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 rounded-lg bg-black/60 px-4 py-2 text-sm font-semibold text-white pointer-events-none animate-fade-out';
      el.style.animationDuration = '800ms';
      container.appendChild(el);
      gestureIndicatorRef.current = el;
    }
    el.textContent = text;
    el.style.opacity = '1';
    el.style.animation = 'none';
    requestAnimationFrame(() => {
      el.style.animation = '';
      setTimeout(() => {
        el.style.opacity = '0';
      }, 600);
    });
  }, [containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };

      longPressRef.current = setTimeout(() => {
        const video = videoRef.current;
        if (video) {
          prevSpeedRef.current = video.playbackRate;
          video.playbackRate = 2;
          onSpeedChange(2);
          showGesture('2x');
        }
      }, 600);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (longPressRef.current) {
        clearTimeout(longPressRef.current);
        longPressRef.current = null;
      }

      if (!touchStartRef.current) return;
      const touch = e.touches[0];
      const deltaY = touchStartRef.current.y - touch.clientY;
      const deltaX = touch.clientX - touchStartRef.current.x;
      const rect = container.getBoundingClientRect();
      const relX = touch.clientX - rect.left;
      const rightHalf = relX > rect.width / 2;

      if (Math.abs(deltaY) > 20 && Math.abs(deltaX) < 30) {
        if (rightHalf) {
          const video = videoRef.current;
          if (video) {
            const change = deltaY / rect.height;
            const newVol = Math.max(0, Math.min(1, video.volume + change));
            video.volume = newVol;
            onVolumeChange(newVol);
          }
        }
      }
    };

    const onTouchEnd = () => {
      if (longPressRef.current) {
        clearTimeout(longPressRef.current);
        longPressRef.current = null;
      }

      const video = videoRef.current;
      if (video && video.playbackRate !== prevSpeedRef.current) {
        video.playbackRate = prevSpeedRef.current;
        onSpeedChange(prevSpeedRef.current);
      }

      touchStartRef.current = null;
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: true });
    container.addEventListener('touchend', onTouchEnd);

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      if (longPressRef.current) clearTimeout(longPressRef.current);
    };
  }, [containerRef, videoRef, onVolumeChange, onSpeedChange, showGesture]);

  return null;
}