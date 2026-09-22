'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { Calendar, X } from 'lucide-react';
import Hls from 'hls.js';
import { usePlaybackToken } from '@/hooks/usePlaybackToken';
import { usePlayerPreferences } from '@/hooks/usePlayerPreferences';
import { updateVideoProgress } from '@/lib/api/videos';
import { WatermarkOverlay } from '@/components/shared/WatermarkOverlay';
import { ScreenRecordingDetector } from '@/components/shared/ScreenRecordingDetector';
import {
  VideoControls,
  KeyboardShortcuts,
  PlayerOverlay,
  ResumeDialog,
  MiniPlayer,
} from '@/components/player';
import { MobileGestures } from '@/components/player/MobileGestures';

interface Level {
  index: number;
  height: number;
  width: number;
  bitrate: number;
  name: string;
}

interface Props {
  recordingId: string;
  sessionId: string;
  title: string;
  date: string;
}

function formatLabel(height: number): string {
  if (height >= 1000) return `${height}p HD`;
  if (height >= 700) return `${height}p HD`;
  if (height >= 450) return `${height}p`;
  return `${height}p`;
}

export function VideoPlayerClient({
  recordingId,
  sessionId,
  title,
  date,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastReportRef = useRef(0);
  const lastTimeUpdateSave = useRef(0);
  const hlsRef = useRef<Hls | null>(null);
  const seekToOnReady = useRef<number | null>(null);
  const doubleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<{ x: number; time: number } | null>(null);
  const prefsApplied = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [levels, setLevels] = useState<Level[]>([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [isBuffering, setIsBuffering] = useState(false);
  const [showResume, setShowResume] = useState(true);
  const [qualityLabel, setQualityLabel] = useState('Auto');
  const [playerReady, setPlayerReady] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [isMini, setIsMini] = useState(false);

  const {
    playbackUrl,
    thumbnail: thumbnailUrl,
    loading,
    error,
    reportEvent,
    refreshUrl,
  } = usePlaybackToken({
    recordingId,
    deviceId: undefined,
  });

  const {
    prefs,
    updatePrefs,
    setSpeed: saveSpeed,
    setVolume: saveVolume,
    setMuted: saveMuted,
    setQuality: saveQuality,
  } = usePlayerPreferences();

  // Apply saved preferences once playback is ready
  useEffect(() => {
    if (!playbackUrl || prefsApplied.current) return;
    const video = videoRef.current;
    if (!video) return;

    video.volume = prefs.volume;
    video.muted = prefs.muted;
    video.playbackRate = prefs.speed;
    setVolume(prefs.volume);
    setMuted(prefs.muted);
    setSpeed(prefs.speed);

    if (prefs.quality !== -1 && hlsRef.current) {
      hlsRef.current.currentLevel = prefs.quality;
      setCurrentLevel(prefs.quality);
    }

    prefsApplied.current = true;
  }, [playbackUrl]);

  // Track playing state
  const handlePlay = useCallback(() => {
    setPlaying(true);
    reportEvent('play', videoRef.current?.currentTime);
  }, [reportEvent]);

  const handlePause = useCallback(() => {
    setPlaying(false);
    reportEvent('pause', videoRef.current?.currentTime);
    // Save progress on pause
    const t = videoRef.current?.currentTime;
    if (t && Math.floor(t) !== lastTimeUpdateSave.current) {
      lastTimeUpdateSave.current = Math.floor(t);
      updateVideoProgress(recordingId, Math.floor(t)).catch(() => {});
    }
  }, [reportEvent, recordingId]);

  const handleEnded = useCallback(() => {
    setPlaying(false);
    reportEvent('ended', videoRef.current?.currentTime);
    updateVideoProgress(recordingId, duration, true).catch(() => {});
  }, [reportEvent, recordingId, duration]);

  const handleSeeked = useCallback(() => {
    reportEvent('seek', videoRef.current?.currentTime);
    // Save progress on seek
    const t = videoRef.current?.currentTime;
    if (t) {
      lastTimeUpdateSave.current = Math.floor(t);
      updateVideoProgress(recordingId, Math.floor(t)).catch(() => {});
    }
  }, [reportEvent, recordingId]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);

    // Save every 15-30 seconds
    const elapsed = video.currentTime - lastTimeUpdateSave.current;
    if (elapsed >= 20) {
      lastTimeUpdateSave.current = Math.floor(video.currentTime);
      updateVideoProgress(recordingId, Math.floor(video.currentTime)).catch(
        () => {},
      );
    }

    // Heartbeat report every 30s
    if (Math.abs(video.currentTime - lastReportRef.current) > 29) {
      reportEvent('heartbeat', video.currentTime);
      lastReportRef.current = video.currentTime;
    }
  }, [recordingId, reportEvent]);

  const handleDurationChange = useCallback(() => {
    const video = videoRef.current;
    if (video) setDuration(video.duration || 0);
  }, []);

  const handleVolumeChange = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      setVolume(video.volume);
      setMuted(video.muted);
      updatePrefs({ volume: video.volume, muted: video.muted });
    }
  }, [updatePrefs]);

  // Quality tracking
  const updateLevels = useCallback((hls: Hls) => {
    const lvls = hls.levels.map((l, idx) => ({
      index: idx,
      height: l.height,
      width: l.width,
      bitrate: l.bitrate,
      name: `${l.height}p`,
    }));
    setLevels(lvls);

    if (lvls.length > 0) {
      const auto = hls.currentLevel;
      if (auto === -1) {
        const fallback = lvls.find(
          (l) => l.height >= 360 && l.height <= 720,
        ) ?? lvls[lvls.length - 1];
        setQualityLabel(`Auto (${formatLabel(fallback.height)})`);
      } else {
        setQualityLabel(formatLabel(hls.levels[auto]?.height ?? 0));
      }
    }
  }, []);

  const handleLevelChanged = useCallback(
    (_levelIndex: number, hls: Hls) => {
      const cl = hls.currentLevel;
      setCurrentLevel(cl);
      saveQuality(cl);
      const lvls = hls.levels;
      if (cl === -1) {
        const fallback = lvls.find(
          (l) => l.height >= 360 && l.height <= 720,
        ) ?? lvls[lvls.length - 1];
        setQualityLabel(`Auto (${formatLabel(fallback.height)})`);
      } else {
        setQualityLabel(formatLabel(lvls[cl]?.height ?? 0));
      }
    },
    [saveQuality],
  );

  // HLS setup — only recreates when playbackUrl changes
  useEffect(() => {
    const video = videoRef.current;
    if (!playbackUrl || !video) return;

    const isSafari =
      typeof window !== 'undefined' &&
      /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    if (isSafari && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playbackUrl;
      video.addEventListener('loadedmetadata', () => {
        setDuration(video.duration || 0);
      });
    } else if (Hls.isSupported()) {
      if (hlsRef.current) hlsRef.current.destroy();
      const hls = new Hls();
      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        updateLevels(hls);
        setDuration(video.duration || 0);
        if (seekToOnReady.current !== null) {
          video.currentTime = seekToOnReady.current;
          seekToOnReady.current = null;
        }
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        handleLevelChanged(data.level, hls);
      });

      hls.on(Hls.Events.BUFFER_APPENDED, () => {
        const b = hls.media?.buffered;
        if (b && b.length > 0) {
          setBuffered(b.end(b.length - 1));
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          hls.destroy();
          hlsRef.current = null;
        }
      });

      hls.loadSource(playbackUrl);
      hls.attachMedia(video);
    } else {
      video.src = playbackUrl;
    }

    video.load();

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [playbackUrl, updateLevels, handleLevelChanged]);

  // Attach native video event listeners
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const onPlay = () => handlePlay();
    const onPause = () => handlePause();
    const onSeeked = () => handleSeeked();
    const onEnded = () => handleEnded();
    const onTimeUpdate = () => handleTimeUpdate();
    const onDurationChange = () => handleDurationChange();
    const onVolumeChange = () => handleVolumeChange();
    const onWaiting = () => setIsBuffering(true);
    const onCanPlay = () => setIsBuffering(false);
    const onPlaying = () => setIsBuffering(false);

    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('seeked', onSeeked);
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('durationchange', onDurationChange);
    el.addEventListener('volumechange', onVolumeChange);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('canplay', onCanPlay);
    el.addEventListener('playing', onPlaying);

    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('seeked', onSeeked);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('durationchange', onDurationChange);
      el.removeEventListener('volumechange', onVolumeChange);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('canplay', onCanPlay);
      el.removeEventListener('playing', onPlaying);
    };
  }, [
    handlePlay,
    handlePause,
    handleSeeked,
    handleEnded,
    handleTimeUpdate,
    handleDurationChange,
    handleVolumeChange,
  ]);

  // Save progress reliably on unload / visibility change / unmount (throttled elsewhere, but ensure last position persists)
  useEffect(() => {
    const saveNow = () => {
      const t = videoRef.current?.currentTime;
      if (!t || !isFinite(t) || t < 1) return;
      const floored = Math.floor(t);
      if (floored === lastTimeUpdateSave.current) return;
      lastTimeUpdateSave.current = floored;
      // Use fetch with keepalive so it survives pagehide/unload; fallback to updateVideoProgress helper
      try {
        const token = typeof document !== 'undefined' ? document.cookie.match(/access_token=([^;]+)/)?.[1] : null;
        const url = `${process.env.NEXT_PUBLIC_API_URL || ''}/recordings/${recordingId}/progress`;
        const body = JSON.stringify({ watchedSeconds: floored });
        if (token) {
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body,
            keepalive: true,
          }).catch(() => {});
        } else {
          updateVideoProgress(recordingId, floored).catch(() => {});
        }
      } catch {
        updateVideoProgress(recordingId, Math.floor(t)).catch(() => {});
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') saveNow();
    };
    const handlePageHide = () => saveNow();
    const handleBeforeUnload = () => saveNow();

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Final save on unmount (navigation away within SPA)
      saveNow();
    };
  }, [recordingId]);

  // PiP support detection
  useEffect(() => {
    setPipSupported(
      typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled,
    );
  }, []);

  // Fullscreen change tracking
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Action handlers
  const handlePlayAction = useCallback(() => {
    videoRef.current?.play().catch(() => {});
  }, []);

  const handlePauseAction = useCallback(() => {
    videoRef.current?.pause();
  }, []);

  const handleSeek = useCallback((time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  }, []);

  const handleVolumeAction = useCallback(
    (v: number) => {
      const video = videoRef.current;
      if (video) {
        video.volume = v;
        setVolume(v);
        saveVolume(v);
        if (v > 0 && video.muted) {
          video.muted = false;
          saveMuted(false);
        }
      }
    },
    [saveVolume, saveMuted],
  );

  const handleMute = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = !video.muted;
      saveMuted(video.muted);
    }
  }, [saveMuted]);

  const handleSpeedChange = useCallback(
    (s: number) => {
      const video = videoRef.current;
      if (video) {
        video.playbackRate = s;
        setSpeed(s);
        saveSpeed(s);
      }
    },
    [saveSpeed],
  );

  const handleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      containerRef.current?.requestFullscreen().catch(() => {});
    }
  }, []);

  const handlePictureInPicture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {}
  }, []);

  // Resume handlers
  const handleResume = useCallback((time: number) => {
    if (videoRef.current) {
      if (hlsRef.current && !videoRef.current.readyState) {
        seekToOnReady.current = time;
      } else {
        videoRef.current.currentTime = time;
      }
    }
    setShowResume(false);
    videoRef.current?.play().catch(() => {});
  }, []);

  const handleStartOver = useCallback(() => {
    setShowResume(false);
    videoRef.current?.play().catch(() => {});
  }, []);

  const handleDismissResume = useCallback(() => {
    setShowResume(false);
  }, []);

  const handlePlayerReady = useCallback(() => {
    setPlayerReady(true);
  }, []);

  // Mobile double-tap for seek
  const handleContainerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const now = Date.now();
      const last = lastTapRef.current;

      if (last && now - last.time < 400) {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const width = rect.width;
        const third = width / 3;

        if (x < third) {
          handleSeek(Math.max(0, (videoRef.current?.currentTime || 0) - 10));
        } else if (x > third * 2) {
          handleSeek(
            Math.min(
              videoRef.current?.duration || Infinity,
              (videoRef.current?.currentTime || 0) + 10,
            ),
          );
        }

        lastTapRef.current = null;
        if (doubleTapTimer.current) clearTimeout(doubleTapTimer.current);
      } else {
        lastTapRef.current = { x: e.clientX, time: now };
        if (doubleTapTimer.current) clearTimeout(doubleTapTimer.current);
        doubleTapTimer.current = setTimeout(() => {
          lastTapRef.current = null;
        }, 400);
      }
    },
    [handleSeek],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const videoElement = (
    <video
      ref={videoRef}
      className="h-full w-full"
      poster={thumbnailUrl || undefined}
      controlsList="nodownload noremoteplayback"
      onContextMenu={handleContextMenu}
      preload="metadata"
      playsInline
    />
  );

  return (
    <div>
      <ScreenRecordingDetector
        contextType="recording"
        contextId={recordingId}
      >
        <div
          ref={containerRef}
          className={`relative aspect-video w-full bg-black overflow-hidden group select-none transition-all duration-300 ${
            isMini
              ? 'fixed bottom-[calc(1rem+56px+env(safe-area-inset-bottom,0px))] md:bottom-4 right-4 z-50 w-72 rounded-xl shadow-2xl border border-white/10'
              : ''
          }`}
          onDoubleClick={handleFullscreen}
          onClick={handleContainerClick}
          role="application"
          aria-label="Video player"
        >
          {videoElement}

          {isMini && (
            <button
              type="button"
              onClick={() => setIsMini(false)}
              className="absolute top-2 right-2 z-10 rounded-full bg-black/60 p-1 text-white/80 hover:bg-black/80 hover:text-white transition-colors"
              aria-label="Close mini player"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          <KeyboardShortcuts
            videoRef={videoRef}
            containerRef={containerRef}
            enabled={!showResume && playerReady}
          />

          <MobileGestures
            videoRef={videoRef}
            containerRef={containerRef}
            onVolumeChange={handleVolumeAction}
            onSpeedChange={handleSpeedChange}
          />

          <PlayerOverlay
            loading={loading}
            buffering={isBuffering}
            error={error}
            thumbnail={thumbnailUrl}
            onRetry={refreshUrl}
            onReady={handlePlayerReady}
          />

          {showResume && !loading && !error && playbackUrl && (
            <ResumeDialog
              recordingId={recordingId}
              duration={duration}
              onResume={handleResume}
              onStartOver={handleStartOver}
              onDismiss={handleDismissResume}
            />
          )}

          <VideoControls
            videoRef={videoRef}
            containerRef={containerRef}
            hlsRef={hlsRef}
            levels={levels}
            currentLevel={currentLevel}
            playing={playing}
            muted={muted}
            volume={volume}
            currentTime={currentTime}
            duration={duration}
            buffered={buffered}
            qualityLabel={qualityLabel}
            speed={speed}
            isFullscreen={isFullscreen}
            thumbnailUrl={thumbnailUrl}
            pipEnabled={pipSupported}
            onPlay={handlePlayAction}
            onPictureInPicture={handlePictureInPicture}
            onPause={handlePauseAction}
            onSeek={handleSeek}
            onVolumeChange={handleVolumeAction}
            onMute={handleMute}
            onSpeedChange={handleSpeedChange}
            onFullscreen={handleFullscreen}
          />

          <WatermarkOverlay sessionId={sessionId} />
        </div>

        <MiniPlayer
          containerRef={containerRef}
          enabled={playerReady}
          onMiniChange={setIsMini}
        />
      </ScreenRecordingDetector>

      {isMini && <div className="aspect-video w-full" aria-hidden />}

      <div className="px-4 py-4 md:px-0">
        <div className="rounded-card border border-surface-border bg-surface-card p-4 md:p-5">
          <h2 className="text-base font-bold leading-tight text-text-primary line-clamp-2">
            {title || 'Recording'}
          </h2>
          {date && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-text-muted">
              <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {date}
            </p>
          )}
          <p className="mt-2 text-xs leading-relaxed text-text-secondary">
            Part of your batch curriculum — continue where you left off. Progress saves automatically.
          </p>
        </div>
      </div>
    </div>
  );
}