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
  const [prefs, setPrefs] = useState<PlayerPreferences>(() => {
    const loaded = load();
    return loaded;
  });

  useEffect(() => {
    save(prefs);
  }, [prefs]);

  const updatePrefs = useCallback((updates: Partial<PlayerPreferences>) => {
    setPrefs((p) => ({ ...p, ...updates }));
  }, []);

  const setSpeed = useCallback((speed: number) => {
    updatePrefs({ speed });
  }, [updatePrefs]);

  const setVolume = useCallback((volume: number) => {
    updatePrefs({ volume });
  }, [updatePrefs]);

  const setMuted = useCallback((muted: boolean) => {
    updatePrefs({ muted });
  }, [updatePrefs]);

  const setQuality = useCallback((quality: number) => {
    updatePrefs({ quality });
  }, [updatePrefs]);

  return {
    prefs,
    updatePrefs,
    setSpeed,
    setVolume,
    setMuted,
    setQuality,
  };
}