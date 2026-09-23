'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

interface SpeedMenuProps {
  speed: number;
  onSpeedChange: (speed: number) => void;
}

export function SpeedMenu({ speed, onSpeedChange }: SpeedMenuProps) {
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

  const handleSpeedChange = useCallback(
    (s: number) => {
      onSpeedChange(s);
      setOpen(false);
    },
    [onSpeedChange],
  );

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 min-h-[44px] min-w-[44px] justify-center"
        aria-label={`Playback speed ${speed}x`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span>{speed}x</span>
      </button>

      {open && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 min-w-[80px] rounded-lg bg-gray-900/95 backdrop-blur-sm border border-white/10 shadow-xl py-1"
          role="menu"
          aria-label="Playback speed options"
        >
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              role="menuitem"
              onClick={() => handleSpeedChange(s)}
              className={`w-full px-3 py-2.5 text-xs text-left transition-colors hover:bg-white/10 min-h-[44px] flex items-center ${
                s === speed
                  ? 'text-white font-semibold bg-white/5'
                  : 'text-white/70'
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/30`}
              aria-label={`${s}x speed`}
              aria-current={s === speed ? 'true' : undefined}
            >
              {s === 1 ? 'Normal' : `${s}x`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}