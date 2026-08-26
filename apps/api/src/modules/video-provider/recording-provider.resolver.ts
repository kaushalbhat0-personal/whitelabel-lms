/*
 * RecordingProviderResolver — THE single point of provider selection.
 *
 * PRODUCTION POLICY (Phase 7E business decision):
 *   The LMS launches with NO existing student content, so there is nothing to
 *   migrate. ALL newly created recordings route to Bunny from day one:
 *
 *     VIDEO_UPLOAD_PROVIDER=bunny (default)
 *       → every NEW upload (batch-linked OR draft, admin OR Zoom auto-pipeline)
 *         uses provider='bunny'.
 *       → if Bunny is not enabled/configured the upload FAILS VISIBLY with 503.
 *         There is NEVER a silent fallback to Mux.
 *     VIDEO_UPLOAD_PROVIDER=mux
 *       → dormant emergency switch: temporarily routes NEW uploads back to Mux
 *         without any code change (Mux stays compiled, registered and idle).
 *
 *   Playback/deletion routing remains recording-level: recordings.provider
 *   decides via providerFor(), with pre-migration rows (provider NULL/'mux')
 *   treated as Mux. An explicit 'bunny' row NEVER silently falls back to Mux —
 *   BunnyProvider failures are observable ServiceUnavailable errors.
 */
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
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

  /** Production provider for NEW uploads ('bunny' by default; 'mux' is the
   *  documented emergency rollback switch). Unknown values fail closed to the
   *  safe default rather than guessing. */
  get productionUploadProvider(): VideoProviderName {
    const raw = String(
      this.configService.get<string>('VIDEO_UPLOAD_PROVIDER') ?? 'bunny',
    )
      .trim()
      .toLowerCase();
    return raw === 'mux' ? 'mux' : 'bunny';
  }

  /**
   * Decide the provider for a NEW upload. Batch numbers are irrelevant under
   * the bunny-first launch policy (the previous Batch1=Mux/Batch2+=Bunny plan
   * was migration scaffolding only). The batchIds parameter is retained for
   * call-site compatibility and future per-batch overrides.
   */
  resolveUploadProvider(batchIds: string[] = []): VideoProviderName {
    void batchIds;

    const configured = this.productionUploadProvider;
    if (configured === 'mux') {
      this.logger.warn(
        'VIDEO_UPLOAD_PROVIDER=mux — routing NEW upload to Mux (dormant fallback switch active)',
      );
      return 'mux';
    }

    // bunny-first production policy: visible failure instead of silent fallback.
    if (!this.bunnyProvider.enabled || !this.bunnyProvider.isConfigured) {
      throw new ServiceUnavailableException(
        'Bunny is the configured production video provider but it is not ' +
          'enabled/configured (VIDEO_UPLOAD_PROVIDER=bunny requires BUNNY_ENABLED=true ' +
          'plus BUNNY_LIBRARY_ID/BUNNY_API_KEY/BUNNY_CDN_HOSTNAME). ' +
          'Upload refused — set the Bunny credentials or explicitly switch ' +
          'VIDEO_UPLOAD_PROVIDER=mux.',
      );
    }

    this.logger.log('Upload provider resolution -> bunny (production default)');
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
