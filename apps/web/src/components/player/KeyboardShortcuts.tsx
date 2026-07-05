'use client';

import { useEffect, useCallback } from 'react';

interface KeyboardShortcutsProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  enabled?: boolean;
}

export function KeyboardShortcuts({
  videoRef,
  containerRef,
  enabled = true,
}: KeyboardShortcutsProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled || !videoRef.current) return;

      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const video = videoRef.current;

      switch (e.code) {
        case 'Space': {
          e.preventDefault();
          if (video.paused) video.play().catch(() => {});
          else video.pause();
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          video.currentTime = Math.min(
            video.duration || Infinity,
            video.currentTime + 10,
          );
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          break;
        }
        case 'KeyM': {
          e.preventDefault();
          video.muted = !video.muted;
          break;
        }
        case 'KeyF': {
          e.preventDefault();
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          } else {
            containerRef.current?.requestFullscreen().catch(() => {});
          }
          break;
        }
      }
    },
    [videoRef, containerRef, enabled],
  );

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, enabled]);

  return null;
}