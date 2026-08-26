/*
 * MuxProvider — thin adapter exposing the existing MuxService behind the
 * VideoProvider interface.
 *
 * Why an adapter instead of a rewrite:
 *   MuxService is the battle-tested chokepoint for all Mux API access. Phase 7B
 *   must NOT change existing Mux behaviour, so this provider delegates 1:1 and
 *   adds nothing except interface conformance.
 */
import { Injectable } from '@nestjs/common';
import { MuxService } from '../../mux/mux.service';
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
export class MuxProvider implements VideoProvider {
  readonly name: VideoProviderName = 'mux';

  constructor(private readonly muxService: MuxService) {}

  async createDirectUpload(opts: { title: string }): Promise<DirectUploadHandle> {
    return this.muxService.createDirectUploadUrl(opts.title);
  }

  async createAssetFromSource(
    opts: CreateAssetFromSourceOptions,
  ): Promise<{ assetId: string }> {
    const passthrough = opts.passthrough ?? {};
    const assetId = await this.muxService.uploadFromUrl(
      String(passthrough.sessionId ?? ''),
      opts.sourceUrl,
      String(passthrough.title ?? 'Recording'),
    );
    return { assetId };
  }

  async getAssetStatus(assetId: string): Promise<ProviderAssetStatus> {
    return this.muxService.getAssetStatus(assetId);
  }

  async getPlaybackUrls(
    playbackId: string,
    ctx: PlaybackUrlContext,
  ): Promise<ProviderPlaybackUrls> {
    const [playback, thumbnail] = await Promise.all([
      this.muxService.getSignedPlaybackUrl(playbackId, ctx.sessionId),
      this.muxService.getSignedThumbnailUrl(playbackId, ctx.sessionId),
    ]);
    return {
      url: playback.url,
      expiresAt: playback.expiresAt,
      thumbnailUrl: thumbnail.url,
    };
  }

  async deleteAsset(assetId: string): Promise<void> {
    await this.muxService.deleteAsset(assetId);
  }
}
