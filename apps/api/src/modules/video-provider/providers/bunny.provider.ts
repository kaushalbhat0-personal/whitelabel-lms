/*
 * BunnyProvider — Bunny Stream implementation of VideoProvider.
 *
 * PHASE 7B STATUS: CONFIGURATION PATH ONLY — NOT OPERATIONAL.
 *
 * The repository contains ZERO prior Bunny integration evidence (no package,
 * credentials, docs, or API client). Per migration constraint #14/#15:
 *   - We do NOT invent API endpoints, request shapes, token math, or webhook
 *     signature schemes.
 *   - We do NOT fake successful Bunny calls.
 *
 * Therefore every operation below is gated:
 *   1. If Bunny is not enabled/configured -> ServiceUnavailableException.
 *   2. Even when configured, operations throw an explicit "requires external
 *      confirmation" error until the Bunny integration spike verifies the API
 *      surface (blockers B-1/B-2 in docs/rccf-phase7b-preimplementation-audit.md).
 *
 * Failure is ALWAYS observable — the resolver never silently falls back to Mux
 * for a recording whose provider is 'bunny' (migration constraint #16).
 */
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateAssetFromSourceOptions,
  DirectUploadHandle,
  PlaybackUrlContext,
  ProviderAssetStatus,
  ProviderPlaybackUrls,
  VideoProvider,
  VideoProviderName,
} from '../video-provider.types';

@Injectable()
export class BunnyProvider implements VideoProvider {
  readonly name: VideoProviderName = 'bunny';
  private readonly logger = new Logger(BunnyProvider.name);

  constructor(private readonly configService: ConfigService) {}

  /** True only when Bunny has been explicitly enabled AND fully configured. */
  get isConfigured(): boolean {
    if (!this.enabled) return false;
    return (
      !!this.configService.get<string>('BUNNY_LIBRARY_ID') &&
      !!this.configService.get<string>('BUNNY_API_KEY') &&
      !!this.configService.get<string>('BUNNY_CDN_HOSTNAME')
    );
  }

  /** Explicit opt-in switch — Bunny never activates implicitly. */
  get enabled(): boolean {
    const raw = this.configService.get<string | undefined>('BUNNY_ENABLED');
    return String(raw).toLowerCase() === 'true';
  }

  async createDirectUpload(opts: { title: string }): Promise<DirectUploadHandle> {
    this.assertOperational('createDirectUpload');
    this.logger.warn(
      `BunnyProvider.createDirectUpload invoked for "${opts.title}" but is blocked pending external verification`,
    );
    throw this.notVerified('createDirectUpload');
  }

  async createAssetFromSource(
    opts: CreateAssetFromSourceOptions,
  ): Promise<{ assetId: string }> {
    this.assertOperational('createAssetFromSource');
    this.logger.warn(
      `BunnyProvider.createAssetFromSource invoked for ${opts.sourceUrl} but is blocked pending external verification`,
    );
    throw this.notVerified('createAssetFromSource');
  }

  async getAssetStatus(assetId: string): Promise<ProviderAssetStatus> {
    this.assertOperational('getAssetStatus');
    throw this.notVerified('getAssetStatus');
  }

  async getPlaybackUrls(
    playbackId: string,
    ctx: PlaybackUrlContext,
  ): Promise<ProviderPlaybackUrls> {
    this.assertOperational('getPlaybackUrls');
    throw this.notVerified('getPlaybackUrls');
  }

  async deleteAsset(assetId: string): Promise<void> {
    this.assertOperational('deleteAsset');
    throw this.notVerified('deleteAsset');
  }

  // ── internals ───────────────────────────────────────────────

  private assertOperational(operation: string): void {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        `Bunny video provider is not enabled/configured (${operation}). ` +
          `Set BUNNY_ENABLED=true plus BUNNY_LIBRARY_ID/BUNNY_API_KEY/BUNNY_CDN_HOSTNAME ` +
          `after completing the verification spike (audit blockers B-1/B-2).`,
      );
    }
  }

  private notVerified(operation: string): ServiceUnavailableException {
    return new ServiceUnavailableException(
      `BunnyProvider.${operation} is intentionally not implemented: Bunny API behaviour ` +
        `is not yet confirmed from repository evidence (blockers B-1/B-2, see ` +
        `docs/rccf-phase7b-preimplementation-audit.md). This failure is deliberate and observable.`,
    );
  }
}
