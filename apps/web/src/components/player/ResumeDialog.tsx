'use client';

import { useCallback, useEffect, useState } from 'react';
import { getMyVideos } from '@/lib/api/videos';

interface ResumeDialogProps {
  recordingId: string;
  duration: number;
  onResume: (time: number) => void;
  onStartOver: () => void;
  onDismiss: () => void;
}

function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ResumeDialog({
  recordingId,
  duration,
  onResume,
  onStartOver,
  onDismiss,
}: ResumeDialogProps) {
  const [watchedSeconds, setWatchedSeconds] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getMyVideos()
      .then((videos) => {
        if (cancelled) return;
        const video = videos.find((v: any) => v.id === recordingId);
        const progress = video?.progress?.watched_seconds;
        // Respect completed flag: if completed, don't offer resume (restart from 0)
        const completed = video?.progress?.completed === true;
        if (completed) {
          setWatchedSeconds(null);
          return;
        }
        const remaining = duration > 0 ? duration - (progress || 0) : 0;
        if (
          progress &&
          progress > 5 &&
          remaining > 5
        ) {
          setWatchedSeconds(progress);
        } else {
          setWatchedSeconds(null);
        }
      })
      .catch(() => {
        if (!cancelled) setWatchedSeconds(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recordingId, duration]);

  const handleResume = useCallback(() => {
    if (watchedSeconds) onResume(watchedSeconds);
  }, [watchedSeconds, onResume]);

  // Notify parent to hide dialog when no resume needed — deferred to effect to avoid render side-effect
  useEffect(() => {
    if (!loading && !watchedSeconds) {
      onDismiss();
    }
  }, [loading, watchedSeconds, onDismiss]);

  if (loading || !watchedSeconds) {
    return null;
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-label="Resume playback"
    >
      <div className="rounded-xl bg-gray-900/95 backdrop-blur-sm border border-white/10 p-6 shadow-2xl max-w-xs w-full mx-4 text-center">
        <p className="text-sm text-white/80 mb-1">
          Resume from{' '}
          <span className="font-mono font-semibold text-white">
            {formatDuration(watchedSeconds)}
          </span>
        </p>
        <p className="text-xs text-white/50 font-mono mb-4">
          {formatDuration(watchedSeconds)} / {formatDuration(duration)}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            type="button"
            onClick={handleResume}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            aria-label={`Resume from ${formatDuration(watchedSeconds)}`}
            autoFocus
          >
            Resume
          </button>
          <button
            type="button"
            onClick={onStartOver}
            className="rounded-lg bg-white/5 px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            aria-label="Start from beginning"
          >
            Start Over
          </button>
        </div>
      </div>
    </div>
  );
}