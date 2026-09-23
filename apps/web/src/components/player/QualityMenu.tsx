'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Check } from 'lucide-react';
import type Hls from 'hls.js';

interface Level {
  index: number;
  height: number;
  width: number;
  bitrate: number;
  name: string;
}

interface QualityMenuProps {
  hlsRef: React.MutableRefObject<Hls | null>;
  levels: Level[];
  currentLevel: number;
}

function formatLabel(height: number): string {
  if (height >= 1000) return `${height}p HD`;
  if (height >= 700) return `${height}p HD`;
  if (height >= 450) return `${height}p`;
  return `${height}p`;
}

function formatBitrate(bps: number) {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bps / 1000)} kbps`;
}

export function QualityMenu({ hlsRef, levels, currentLevel }: QualityMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleQualityChange = useCallback(
    (levelIndex: number) => {
      const hls = hlsRef.current;
      if (!hls) return;
      hls.currentLevel = levelIndex;
      setOpen(false);
    },
    [hlsRef],
  );

  const currentLabel =
    currentLevel === -1
      ? 'Auto'
      : levels.find((l) => l.index === currentLevel)?.name ?? `${currentLevel}`;

  const displayLabel =
    currentLevel === -1
      ? 'Auto'
      : formatLabel(levels.find((l) => l.index === currentLevel)?.height ?? 0);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 min-h-[44px] min-w-[44px] justify-center"
        aria-label={`Video quality: ${currentLabel}`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span>{displayLabel}</span>
      </button>

      {open && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 min-w-[180px] rounded-lg bg-gray-900/95 backdrop-blur-sm border border-white/10 shadow-xl py-1 max-h-[300px] overflow-y-auto"
          role="menu"
          aria-label="Video quality options"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => handleQualityChange(-1)}
            className={`flex items-center justify-between w-full px-3 py-2.5 text-xs text-left transition-colors hover:bg-white/10 min-h-[44px] ${
              currentLevel === -1
                ? 'text-white font-semibold bg-white/5'
                : 'text-white/70'
            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/30`}
            aria-current={currentLevel === -1 ? 'true' : undefined}
          >
            <span>Auto</span>
            {currentLevel === -1 && (
              <Check className="h-3.5 w-3.5 text-white/80" />
            )}
          </button>

          {levels.map((level) => (
            <button
              key={level.index}
              type="button"
              role="menuitem"
              onClick={() => handleQualityChange(level.index)}
              className={`flex items-center justify-between w-full px-3 py-2.5 text-xs text-left transition-colors hover:bg-white/10 min-h-[44px] ${
                currentLevel === level.index
                  ? 'text-white font-semibold bg-white/5'
                  : 'text-white/70'
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/30`}
              aria-current={
                currentLevel === level.index ? 'true' : undefined
              }
            >
              <div>
                <div className="font-medium">{formatLabel(level.height)}</div>
                <div className="text-[10px] text-white/40">
                  {formatBitrate(level.bitrate)}
                </div>
              </div>
              {currentLevel === level.index && (
                <Check className="h-3.5 w-3.5 text-white/80 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}