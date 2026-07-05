'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import {
  WATERMARK_OPACITY,
  WATERMARK_FONT_SIZE,
  WATERMARK_MIN_INTERVAL,
  WATERMARK_MAX_INTERVAL,
  WATERMARK_FADE_DURATION,
} from '@/lib/watermark/constants';

interface WatermarkOverlayProps {
  sessionId: string;
}

interface Position {
  top: number;
  left: number;
}

const SAFE_ZONES = [
  { top: 5, left: 5 },
  { top: 5, left: 50 },
  { top: 50, left: 5 },
  { top: 50, left: 50 },
  { top: 5, left: 25 },
  { top: 25, left: 5 },
  { top: 25, left: 65 },
  { top: 60, left: 65 },
  { top: 5, left: 75 },
  { top: 35, left: 35 },
  { top: 65, left: 30 },
  { top: 10, left: 60 },
  { top: 60, left: 10 },
  { top: 30, left: 70 },
];

function randomPosition(): Position {
  const zone = SAFE_ZONES[Math.floor(Math.random() * SAFE_ZONES.length)];
  return {
    top: zone.top + Math.random() * 8,
    left: zone.left + Math.random() * 8,
  };
}

function randomInterval(): number {
  return Math.floor(
    Math.random() * (WATERMARK_MAX_INTERVAL - WATERMARK_MIN_INTERVAL + 1) +
      WATERMARK_MIN_INTERVAL,
  );
}

function formatTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function WatermarkOverlay({ sessionId }: WatermarkOverlayProps) {
  const user = useAuthStore((s) => s.user);
  const [timestamp, setTimestamp] = useState(formatTimestamp);
  const [pos, setPos] = useState<Position>(randomPosition);
  const [visible, setVisible] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    const ts = setInterval(() => setTimestamp(formatTimestamp()), 30_000);
    return () => clearInterval(ts);
  }, []);

  const moveWatermark = useCallback(() => {
    setVisible(false);
    setTimeout(() => {
      if (!mountedRef.current) return;
      setPos(randomPosition());
      setVisible(true);
    }, WATERMARK_FADE_DURATION);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const scheduleNext = () => {
      const delay = randomInterval();
      return setTimeout(() => {
        moveWatermark();
        timerRef.current = scheduleNext();
      }, delay);
    };
    const timerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
    timerRef.current = scheduleNext();
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [moveWatermark]);

  const displayName = user?.name || user?.email?.split('@')[0] || 'Student';

  return (
    <div
      className="pointer-events-none absolute inset-0 z-40 select-none overflow-hidden"
      aria-hidden="true"
    >
      <div
        className="absolute whitespace-nowrap transition-opacity duration-500 ease-in-out"
        style={{
          top: `${pos.top}%`,
          left: `${pos.left}%`,
          opacity: visible ? Number(WATERMARK_OPACITY) : 0,
          fontSize: `${WATERMARK_FONT_SIZE}px`,
          lineHeight: '1.5',
          color: 'rgba(200, 200, 205, 0.15)',
          textShadow: '0 1px 3px rgba(0,0,0,0.5)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontWeight: 500,
          letterSpacing: '0.03em',
        }}
      >
        <div>{displayName}</div>
        <div>{user?.email || ''}</div>
        <div>{timestamp}</div>
        <div style={{ fontSize: `${WATERMARK_FONT_SIZE - 1}px`, opacity: 0.7 }}>
          SID: {sessionId.slice(0, 8)}
        </div>
      </div>
    </div>
  );
}