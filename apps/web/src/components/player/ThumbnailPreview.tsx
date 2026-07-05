'use client';

import { useRef, useState, useCallback, useEffect } from 'react';

interface ThumbnailPreviewProps {
  thumbnailBaseUrl: string | null;
  duration: number;
  onSeek: (time: number) => void;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ThumbnailPreview({
  thumbnailBaseUrl,
  duration,
  onSeek,
}: ThumbnailPreviewProps) {
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      setHoverTime(ratio * duration);
      setHoverX(e.clientX - rect.left);
    },
    [duration],
  );

  const handleMouseLeave = useCallback(() => {
    setHoverTime(null);
  }, []);

  const handleClick = useCallback(
    (e: MouseEvent) => {
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onSeek(ratio * duration);
    },
    [duration, onSeek],
  );

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    el.addEventListener('mousemove', handleMouseMove);
    el.addEventListener('mouseleave', handleMouseLeave);
    el.addEventListener('click', handleClick);
    return () => {
      el.removeEventListener('mousemove', handleMouseMove);
      el.removeEventListener('mouseleave', handleMouseLeave);
      el.removeEventListener('click', handleClick);
    };
  }, [handleMouseMove, handleMouseLeave, handleClick]);

  if (!thumbnailBaseUrl || hoverTime === null) return null;

  const thumbUrl = `${thumbnailBaseUrl}${thumbnailBaseUrl.includes('?') ? '&' : '?'}time=${Math.floor(hoverTime)}`;

  return (
    <div
      className="absolute bottom-full mb-3 -translate-x-1/2 pointer-events-none z-30"
      style={{ left: `${hoverX}px` }}
    >
      <div className="overflow-hidden rounded-lg border border-white/20 shadow-2xl bg-black">
        <img
          src={thumbUrl}
          alt=""
          className="block w-[160px] h-auto"
          draggable={false}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
        <div className="px-2 py-1 text-center">
          <span className="text-[11px] font-medium text-white/90 tabular-nums">
            {formatTime(hoverTime)}
          </span>
        </div>
      </div>
    </div>
  );
}