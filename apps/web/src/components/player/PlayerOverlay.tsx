'use client';

import { useState, useEffect } from 'react';

interface PlayerOverlayProps {
  loading: boolean;
  buffering: boolean;
  error: string | null;
  thumbnail: string | null;
  onRetry: () => void;
  onReady: () => void;
}

export function PlayerOverlay({
  loading,
  buffering,
  error,
  thumbnail,
  onRetry,
  onReady,
}: PlayerOverlayProps) {
  const [loaded, setLoaded] = useState(false);
  const [fadeIn, setFadeIn] = useState(false);

  useEffect(() => {
    if (!loading && !error) {
      setLoaded(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setFadeIn(true));
      });
      const timeout = setTimeout(() => onReady(), 600);
      return () => clearTimeout(timeout);
    } else {
      setLoaded(false);
      setFadeIn(false);
    }
  }, [loading, error, onReady]);

  if (error) {
    return (
      <div
        className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/70 gap-4"
        role="alert"
        aria-live="assertive"
      >
        <div className="rounded-full bg-red-500/20 p-3">
          <svg
            className="h-8 w-8 text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-white">Unable to play video</p>
          <p className="mt-1 text-xs text-white/60 max-w-xs">{error}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          aria-label="Retry loading video"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Blurred thumbnail background while loading */}
      {!loaded && thumbnail && (
        <div className="absolute inset-0 z-20 overflow-hidden">
          <img
            src={thumbnail}
            alt=""
            className="h-full w-full object-cover blur-xl scale-110 opacity-60"
            draggable={false}
          />
        </div>
      )}

      {/* Loading spinner */}
      {loading && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/20"
          role="status"
          aria-label="Loading video"
        >
          <div className="flex flex-col items-center gap-3">
            <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/20 border-t-white" />
            <span className="text-xs text-white/60">Loading video...</span>
          </div>
        </div>
      )}

      {/* Skeleton controls */}
      {!loaded && (
        <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/60 via-black/20 to-transparent pt-16 pb-4 px-4">
          <div className="h-1 w-full rounded-full bg-white/10 mb-4">
            <div className="h-full w-0 rounded-full bg-white/20 animate-pulse" />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded bg-white/10 animate-pulse" />
              <div className="h-8 w-8 rounded-full bg-white/10 animate-pulse" />
              <div className="h-8 w-8 rounded bg-white/10 animate-pulse" />
              <div className="h-4 w-24 rounded bg-white/10 animate-pulse" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4 w-6 rounded bg-white/10 animate-pulse" />
              <div className="h-4 w-8 rounded bg-white/10 animate-pulse" />
              <div className="h-4 w-6 rounded bg-white/10 animate-pulse" />
              <div className="h-4 w-6 rounded bg-white/10 animate-pulse" />
            </div>
          </div>
        </div>
      )}

      {/* Buffering indicator */}
      {buffering && loaded && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/10 pointer-events-none"
          role="status"
          aria-label="Buffering"
        >
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/20 border-t-white/80" />
        </div>
      )}

      {/* Fade-in overlay */}
      {loaded && !fadeIn && (
        <div className="absolute inset-0 z-10 bg-black transition-opacity duration-500" />
      )}
    </>
  );
}