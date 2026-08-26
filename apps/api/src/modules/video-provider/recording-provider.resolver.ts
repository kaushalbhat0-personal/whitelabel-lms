/*
 * RecordingProviderResolver — THE single point of provider selection.
 *
 * Upload-time routing policy (preimplementation audit A-1/A-2/A-3):
 *   - Bunny is used for a NEW upload only when:
 *       (a) BUNNY_ENABLED=true, AND
 *       (b) VIDEO_BUNNY_BATCH_IDS lists batch UUIDs, AND
 *       (c) EVERY target batch of the upload appears in that list.
 *   - Any other case (Bunny disabled, unknown/legacy batch present, mixed
 *     Batch-1+Batch-2 selection, empty draft-upload batch set) routes to Mux.
 *   - Default with no configuration = 100% Mux = zero production behaviour
 *     change until operations explicitly enable Bunny.
 *
 * Playback/deletion routing is recording-level: recordings.provider decides,
 * with pre-migration rows (provider NULL/'mux') treated as Mux. An explicit
 * 'bunny' row NEVER silently falls back to Mux — BunnyProvider failures are
 * observable ServiceUnavailable errors (constraint #16).
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BunnyProvider } from './providers/bunny.provider';
import { MuxProvider } from './providers/mux.provider';
import {
  VideoProvider,
  VideoProviderName,
} from './video-provider.types';

@Injectable()
export class RecordingProviderResolver {
  private readonly logger = new Logger(RecordingProviderResolver.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly muxProvider: MuxProvider,
    private readonly bunnyProvider: BunnyProvider,
  ) {}

  /** Batch UUIDs whose NEW uploads should route to Bunny (ops-configured). */
  get bunnyBatchIds(): string[] {
    const raw = this.configService.get<string>('VIDEO_BUNNY_BATCH_IDS') ?? '';
    return raw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
  }

  /**
   * Decide the provider for a NEW upload given its target batches.
   * Conservative rule: one unknown/unlisted batch forces the whole upload to
   * Mux because a single shared asset can only live on one provider (A-2).
   */
  resolveUploadProvider(batchIds: string[] = []): VideoProviderName {
    if (!this.bunnyProvider.enabled) return 'mux';

    const bunnyBatches = this.bunnyBatchIds;
    if (bunnyBatches.length === 0) return 'mux';
    if (!batchIds || batchIds.length === 0) return 'mux'; // A-3: draft flow

    const allListed = batchIds.every((batchId) =>
      bunnyBatches.includes(batchId),
    );
    if (!allListed) {
      this.logger.log(
        `Upload provider resolution -> mux (mixed/unlisted batches; bunnyBatches=${bunnyBatches.length})`,
      );
      return 'mux';
    }

    this.logger.log(`Upload provider resolution -> bunny (${batchIds.length} batch/es)`);
    return 'bunny';
  }

  /** Provider instance that OWNS an existing recording's asset. */
  providerFor(recording: { provider?: string | null }): VideoProvider {
    const name = this.resolveRecordingProviderName(recording);
    return this.resolve(name);
  }

  /** Resolve a provider by name. Unknown values are treated as 'mux' with a warning. */
  resolve(name: VideoProviderName | string | null | undefined): VideoProvider {
    if (name === 'bunny') {
      // Observable failure — never silently substitute Mux for a Bunny recording.
      return this.bunnyProvider;
    }
    if (name !== 'mux' && name != null) {
      this.logger.warn(
        `Unknown recording provider "${name}" — treating as mux (legacy row?)`,
      );
    }
    return this.muxProvider;
  }

  private resolveRecordingProviderName(
    recording: { provider?: string | null } | null | undefined,
  ): VideoProviderName {
    // Rows created before migration 035 have no provider value; they are Mux.
    return recording?.provider === 'bunny' ? 'bunny' : 'mux';
  }
}
