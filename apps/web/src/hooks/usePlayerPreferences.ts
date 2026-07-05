'use client';

import { useState, useCallback, useEffect } from 'react';

const STORAGE_PREFIX = 'mctlms_player_';

interface PlayerPreferences {
  speed: number;
  volume: number;
  muted: boolean;
  quality: number;
}

const DEFAULTS: PlayerPreferences = {
  speed: 1,
  volume: 1,
  muted: false,
  quality: -1,
};

function load(): PlayerPreferences {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}prefs`);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    }
  } catch {}
  return { ...DEFAULTS };
}

function save(prefs: PlayerPreferences) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${STORAGE_PREFIX}prefs`, JSON.stringify(prefs));
  } catch {}
}

export function usePlayerPreferences() {
  const [prefs, setPrefs] = useState<PlayerPreferences>(load);

  useEffect(() => {
    save(prefs);
  }, [prefs]);

  const setSpeed = useCallback((speed: number) => {
    setPrefs((p) => ({ ...p, speed }));
  }, []);

  const setVolume = useCallback((volume: number) => {
    setPrefs((p) => ({ ...p, volume }));
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    setPrefs((p) => ({ ...p, muted }));
  }, []);

  const setQuality = useCallback((quality: number) => {
    setPrefs((p) => ({ ...p, quality }));
  }, []);

  return {
    prefs,
    setSpeed,
    setVolume,
    setMuted,
    setQuality,
  };
}