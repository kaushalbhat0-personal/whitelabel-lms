/*
 * Video provider abstraction — Phase 7B staged Mux -> Bunny migration.
 *
 * Why this exists:
 *   - The rest of the LMS (recordings service, playback guard, jobs) must not know
 *     or care whether a recording's asset lives on Mux or Bunny.
 *   - Provider selection is centralized: uploads route through
 *     RecordingProviderResolver.resolveUploadProvider(batchIds); playback/deletion
 *     route through RecordingProviderResolver.providerFor(recording).
 *
 * Canonical status mapping (schema CHECK allows only these values):
 *   provider processing -> 'processing'
 *   provider ready      -> 'ready'
 *   provider error      -> 'failed'    (never write 'error'; see audit R3)
 */

export type VideoProviderName = 'mux' | 'bunny';

export type CanonicalRecordingStatus = 'processing' | 'ready' | 'failed';

export interface DirectUploadHandle {
  /** Browser-facing upload URL (admin PUTs the file directly). */
  uploadUrl: string;
  /** Provider-side upload identifier stored on the recording row. */
  uploadId: string;
}

export interface CreateAssetFromSourceOptions {
  /** Provider-reachable source URL (e.g. authenticated Zoom download URL). */
  sourceUrl: string;
  /** Opaque metadata echoed back by webhooks (sessionId, title, ...). */
  passthrough?: Record<string, unknown>;
}

export interface ProviderAssetStatus {
  status: CanonicalRecordingStatus;
  durationSeconds?: number;
  playbackId?: string;
}

export interface PlaybackUrlContext {
  /** Per-request playback session UUID (audit traceability / watermarking). */
  sessionId: string;
}

export interface ProviderPlaybackUrls {
  /** HLS master playlist URL — signed if the provider requires it. */
  url: string;
  /** ISO timestamp after which `url` may stop working. */
  expiresAt: string;
  /** Poster/thumbnail image URL (may be signed; opaque to callers). */
  thumbnailUrl: string;
}

export interface VideoProvider {
  readonly name: VideoProviderName;

  /** Direct browser upload (createRecordingWithUpload + requestUploadUrl flows). */
  createDirectUpload(opts: { title: string }): Promise<DirectUploadHandle>;

  /** Server-side pull import (Zoom auto-pipeline). */
  createAssetFromSource(
    opts: CreateAssetFromSourceOptions,
  ): Promise<{ assetId: string }>;

  /** Webhook backfill + future reconciliation sweeps. */
  getAssetStatus(assetId: string): Promise<ProviderAssetStatus>;

  /**
   * Playback URLs. Called ONLY after LMS authorization (validateAccess +
   * PlaybackGuard token checks). Must never bypass or replace LMS access control.
   */
  getPlaybackUrls(
    playbackId: string,
    ctx: PlaybackUrlContext,
  ): Promise<ProviderPlaybackUrls>;

  /** Delete the underlying asset. Must tolerate already-deleted assets (404). */
  deleteAsset(assetId: string): Promise<void>;
}

/**
 * Map any provider-reported lifecycle state onto the canonical DB vocabulary.
 * Unknown/intermediate states are conservatively treated as still processing.
 */
export function toCanonicalStatus(raw: unknown): CanonicalRecordingStatus {
  const value = String(raw ?? '').toLowerCase();
  if (value === 'ready') return 'ready';
  if (value === 'failed' || value === 'error' || value === 'errored') {
    return 'failed';
  }
  return 'processing';
}
