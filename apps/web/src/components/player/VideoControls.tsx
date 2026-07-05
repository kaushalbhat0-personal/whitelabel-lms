'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Volume1,
  VolumeX,
  Maximize,
  Minimize,
} from 'lucide-react';
import { SpeedMenu } from './SpeedMenu';
import { QualityMenu } from './QualityMenu';
import { ThumbnailPreview } from './ThumbnailPreview';
import { PictureInPicture2 } from 'lucide-react';
import type Hls from 'hls.js';

interface Level {
  index: number;
  height: number;
  width: number;
  bitrate: number;
  name: string;
}

interface VideoControlsProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  hlsRef: React.MutableRefObject<Hls | null>;
  levels: Level[];
  currentLevel: number;
  playing: boolean;
  muted: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  buffered: number;
  qualityLabel: string;
  speed: number;
  isFullscreen: boolean;
  thumbnailUrl: string | null;
  pipEnabled: boolean;
  onPlay: () => void;
  onPictureInPicture: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (volume: number) => void;
  onMute: () => void;
  onSpeedChange: (speed: number) => void;
  onFullscreen: () => void;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function VideoControls({
  videoRef,
  containerRef,
  hlsRef,
  levels,
  currentLevel,
  playing,
  muted,
  volume,
  currentTime,
  duration,
  buffered,
  qualityLabel,
  speed,
  isFullscreen,
  thumbnailUrl,
  onPlay,
  onPause,
  onSeek,
  onVolumeChange,
  onMute,
  onSpeedChange,
  onFullscreen,
  onPictureInPicture,
  pipEnabled,
}: VideoControlsProps) {
  const [showControls, setShowControls] = useState(true);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [showThumbnail, setShowThumbnail] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const startHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (playing) {
      hideTimerRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  }, [playing]);

  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    startHideTimer();
  }, [startHideTimer]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseMove = () => showControlsTemporarily();
    const handleMouseLeave = () => {
      if (playing) setShowControls(false);
    };

    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [containerRef, playing, showControlsTemporarily]);

  useEffect(() => {
    if (playing) {
      startHideTimer();
    } else {
      setShowControls(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }
  }, [playing, startHideTimer]);

  const handlePlayPause = useCallback(() => {
    if (playing) onPause();
    else onPlay();
    showControlsTemporarily();
  }, [playing, onPlay, onPause, showControlsTemporarily]);

  const handleSeekBack = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      onSeek(Math.max(0, video.currentTime - 10));
    }
    showControlsTemporarily();
  }, [videoRef, onSeek, showControlsTemporarily]);

  const handleSeekForward = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      onSeek(Math.min(video.duration || Infinity, video.currentTime + 10));
    }
    showControlsTemporarily();
  }, [videoRef, onSeek, showControlsTemporarily]);

  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const time = ratio * duration;
      onSeek(time);
      showControlsTemporarily();
    },
    [duration, onSeek, showControlsTemporarily],
  );

  const handleProgressHover = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      setShowThumbnail(true);
    },
    [],
  );

  const handleProgressLeave = useCallback(() => {
    setShowThumbnail(false);
  }, []);

  const handleVolumeSlider = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onVolumeChange(ratio);
    },
    [onVolumeChange],
  );

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferProgress = duration > 0 ? (buffered / duration) * 100 : 0;

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <>
      {!showControls && (
        <div
          className="absolute inset-0 z-20 cursor-pointer"
          onClick={showControlsTemporarily}
          role="presentation"
        />
      )}

      <div
        ref={controlsRef}
        className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 via-black/30 to-transparent pt-12 pb-3 px-3 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        role="toolbar"
        aria-label="Video controls"
      >
        {/* Progress bar */}
        <div
          ref={progressRef}
          className="group relative mb-3 flex h-5 cursor-pointer items-center px-0.5"
          onMouseEnter={handleProgressHover}
          onMouseLeave={handleProgressLeave}
          role="slider"
          aria-label="Video progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              const step = e.key === 'ArrowLeft' ? -5 : 5;
              onSeek(Math.max(0, Math.min(duration, currentTime + step)));
            }
          }}
        >
          {/* Thumbnail preview */}
          {showThumbnail && thumbnailUrl && duration > 0 && (
            <ThumbnailPreview
              thumbnailBaseUrl={thumbnailUrl}
              duration={duration}
              onSeek={onSeek}
            />
          )}

          <div
            className="h-1 w-full rounded-full bg-white/20 transition-all group-hover:h-1.5"
            onClick={handleProgressClick}
          >
            <div
              className="absolute h-1 rounded-full bg-white/40 transition-all group-hover:h-1.5"
              style={{ width: `${bufferProgress}%` }}
            />
            <div
              className="absolute h-1 rounded-full bg-white transition-all group-hover:h-1.5"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 translate-x-1/2 rounded-full bg-white opacity-0 transition-opacity group-hover:opacity-100 shadow-md" />
            </div>
          </div>
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleSeekBack}
              className="rounded p-1.5 text-white/80 hover:bg-white/10 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 min-w-[36px] min-h-[36px] flex items-center justify-center"
              aria-label="Rewind 10 seconds"
            >
              <SkipBack className="h-5 w-5" fill="currentColor" />
            </button>

            <button
              type="button"
              onClick={handlePlayPause}
              className="rounded p-1.5 text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 min-w-[40px] min-h-[40px] flex items-center justify-center"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? (
                <Pause className="h-6 w-6" fill="currentColor" />
              ) : (
                <Play className="h-6 w-6" fill="currentColor" />
              )}
            </button>

            <button
              type="button"
              onClick={handleSeekForward}
              className="rounded p-1.5 text-white/80 hover:bg-white/10 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 min-w-[36px] min-h-[36px] flex items-center justify-center"
              aria-label="Forward 10 seconds"
            >
              <SkipForward className="h-5 w-5" fill="currentColor" />
            </button>

            <span className="ml-1 text-xs text-white/70 font-medium tabular-nums select-none">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <div
              className="relative flex items-center"
              onMouseEnter={() => setShowVolumeSlider(true)}
              onMouseLeave={() => setShowVolumeSlider(false)}
            >
              <button
                type="button"
                onClick={onMute}
                className="rounded p-1.5 text-white/80 hover:bg-white/10 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 min-w-[32px] min-h-[32px] flex items-center justify-center"
                aria-label={muted ? 'Unmute' : 'Mute'}
              >
                <VolumeIcon className="h-4 w-4" />
              </button>
              {showVolumeSlider && (
                <div
                  className="flex h-8 w-20 items-center rounded bg-gray-900/90 backdrop-blur-sm px-2 mx-1"
                  onClick={handleVolumeSlider}
                  role="slider"
                  aria-label="Volume"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(muted ? 0 : volume * 100)}
                >
                  <div className="relative h-1 w-full rounded-full bg-white/20">
                    <div
                      className="absolute h-full rounded-full bg-white"
                      style={{ width: `${muted ? 0 : volume * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <QualityMenu
              hlsRef={hlsRef}
              levels={levels}
              currentLevel={currentLevel}
            />

            <SpeedMenu speed={speed} onSpeedChange={onSpeedChange} />

            {pipEnabled && (
              <button
                type="button"
                onClick={onPictureInPicture}
                className="rounded p-1.5 text-white/80 hover:bg-white/10 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 min-w-[32px] min-h-[32px] flex items-center justify-center"
                aria-label="Picture in Picture"
              >
                <PictureInPicture2 className="h-4 w-4" />
              </button>
            )}

            <button
              type="button"
              onClick={onFullscreen}
              className="rounded p-1.5 text-white/80 hover:bg-white/10 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 min-w-[32px] min-h-[32px] flex items-center justify-center"
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isFullscreen ? (
                <Minimize className="h-4 w-4" />
              ) : (
                <Maximize className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}