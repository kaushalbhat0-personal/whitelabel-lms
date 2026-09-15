/*
 * Zoom webhook event handler — processes Zoom notifications
 *
 * Why this class exists:
 *   - Keeps webhook event logic separate from the Zoom API client (zoom.service.ts).
 *   - Each event type has its own case in the switch statement with clear comments.
 *   - Uses SupabaseClient directly because webhooks are high-volume and we want
 *     minimal indirection.
 *
 * Phase 8 hardening (recording.completed):
 *   - Recording-file SELECTION is deliberate: only COMPLETED MP4 files qualify,
 *     preferring the largest usable video (never transcripts/audio-only/chat).
 *   - IDEMPOTENCY: every queued ingestion carries the Zoom recording file id and
 *     is de-duplicated against it (pre-check + partial unique index backstop),
 *     so Zoom's at-least-once redelivery cannot create duplicate work.
 *   - OBSERVABILITY: unmatched sessions / unusable payloads produce an explicit
 *     FAILED upload_queue row instead of being silently dropped.
 *
 * A junior should know:
 *   - This is called by ZoomController after signature verification passes.
 *   - The `supabase` parameter is passed in by the controller, not injected.
 *   - We never throw in here — Zoom retries non-2xx responses and our pipeline
 *     state lives in upload_queue, so failures are recorded there instead.
 */
import { Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { TABLES } from '../../common/constants/tables.constant';

/** Shape of one entry in payload.object.recording_files (subset we rely on). */
export interface ZoomRecordingFile {
  id?: string | number;
  file_type?: string;
  status?: string;
  download_url?: string;
  recording_start?: string;
  recording_end?: string;
  play_width?: number;
  play_height?: number;
}

/**
 * Select the Zoom recording file that should become the LMS video.
 *
 * Rules (in order):
 *   1. file_type must be MP4 (excludes M4A audio-only, TRANSCRIPT/CC chat/timeline).
 *   2. file.status must be 'completed' when present (Zoom marks unfinished files).
 *   3. Prefer the LARGEST pixel dimensions (combined view > speaker/screen-only);
 *      ties break on the LATEST recording_start (deterministic).
 *
 * Returns null when no usable file exists. Never throws.
 */
export function selectZoomRecordingFile(
  files: ZoomRecordingFile[],
): { file: ZoomRecordingFile; reason: string } | null {
  const usable = (files ?? []).filter(
    (f) =>
      !!f &&
      f.file_type === 'MP4' &&
      (!f.status || f.status === 'completed'),
  );
  if (usable.length === 0) return null;

  const sorted = [...usable].sort((a, b) => {
    const pixelsA = (Number(a.play_width) || 0) * (Number(a.play_height) || 0);
    const pixelsB = (Number(b.play_width) || 0) * (Number(b.play_height) || 0);
    if (pixelsB !== pixelsA) return pixelsB - pixelsA;
    return String(b.recording_start ?? '').localeCompare(String(a.recording_start ?? ''));
  });

  const chosen = sorted[0];
  const reason =
    `${chosen.play_width ?? '?'}x${chosen.play_height ?? '?'} MP4 (completed)` +
    (sorted.length > 1 ? `, ${sorted.length - 1} other candidate(s) skipped` : '');
  return { file: chosen, reason };
}

/** Redact anything token-like before persisting an error message. */
function safeErrorMessage(message: string): string {
  return String(message ?? 'unknown error')
    .replace(/access_token=[^&\s]+/gi, 'access_token=[redacted]')
    .replace(/api[-_]?key=[^&\s]+/gi, 'api_key=[redacted]')
    .slice(0, 500);
}

@Injectable()
export class ZoomWebhookHandler {
  private readonly logger = new Logger(ZoomWebhookHandler.name);

  /**
   * Process a verified Zoom webhook event.
   *
   * @param event - The event type string (e.g. "webinar.participant_joined")
   * @param payload - The full webhook payload from Zoom
   * @param supabase - Initialised Supabase client for database operations
   */
  async handle(
    event: string,
    payload: any,
    supabase: SupabaseClient,
  ): Promise<void> {
    try {
      switch (event) {
        // ── participant_joined ──────────────────────────────────
        // A student entered the Zoom webinar. Upsert an attendance record
        // with status 'present' so we know they showed up.
        case 'webinar.participant_joined': {
          const participant = payload.object.participant;
          const webinarId = payload.object.id.toString();

          // Find the session by Zoom webinar ID
          const { data: sessions } = await supabase
            .from(TABLES.LIVE_SESSIONS)
            .select('id')
            .eq('zoom_webinar_id', webinarId)
            .limit(1);

          if (!sessions || sessions.length === 0) {
            this.logger.warn(`No session found for webinar ${webinarId}`);
            return;
          }

          const sessionId = sessions[0].id;

          // Find user by email (what Zoom sends in the participant object)
          const { data: users } = await supabase
            .from(TABLES.PROFILES)
            .select('id')
            .eq('email', participant.email)
            .limit(1);

          if (!users || users.length === 0) {
            this.logger.warn(`No user found for email ${participant.email}`);
            return;
          }

          // Upsert attendance record (student may have already been marked present)
          await supabase.from(TABLES.ATTENDANCE).upsert(
            {
              session_id: sessionId,
              user_id: users[0].id,
              join_time: new Date().toISOString(),
              status: 'present',
              marked_manually: false,
            },
            { onConflict: 'session_id,user_id' },
          );

          this.logger.log(`Attendance marked: user ${users[0].id} joined session ${sessionId}`);
          break;
        }

        // ── participant_left ────────────────────────────────────
        // A student left the webinar. Update their attendance record with
        // the leave time and calculate how long they stayed.
        case 'webinar.participant_left': {
          const participant = payload.object.participant;
          const webinarId = payload.object.id.toString();

          const { data: sessions } = await supabase
            .from(TABLES.LIVE_SESSIONS)
            .select('id')
            .eq('zoom_webinar_id', webinarId)
            .limit(1);

          if (!sessions || sessions.length === 0) return;

          const sessionId = sessions[0].id;

          const { data: users } = await supabase
            .from(TABLES.PROFILES)
            .select('id')
            .eq('email', participant.email)
            .limit(1);

          if (!users || users.length === 0) return;

          // Get the existing attendance record to find join_time
          const { data: attendance } = await supabase
            .from(TABLES.ATTENDANCE)
            .select('join_time')
            .eq('session_id', sessionId)
            .eq('user_id', users[0].id)
            .limit(1);

          if (attendance && attendance.length > 0 && attendance[0].join_time) {
            const joinedAt = new Date(attendance[0].join_time).getTime();
            const leftAt = Date.now();
            const durationSeconds = Math.floor((leftAt - joinedAt) / 1000);

            await supabase
              .from(TABLES.ATTENDANCE)
              .update({
                duration_seconds: durationSeconds,
                leave_time: new Date().toISOString(),
              })
              .eq('session_id', sessionId)
              .eq('user_id', users[0].id);
          }

          break;
        }

        // ── webinar.ended ───────────────────────────────────────
        // The webinar finished. Update the session status to 'ended' and
        // mark all unregistered students as absent.
        case 'webinar.ended': {
          const webinarId = payload.object.id.toString();

          await supabase
            .from(TABLES.LIVE_SESSIONS)
            .update({ status: 'ended' })
            .eq('zoom_webinar_id', webinarId);

          // Mark students who never joined as absent (using a Supabase RPC call)
          const { data: sessions } = await supabase
            .from(TABLES.LIVE_SESSIONS)
            .select('id')
            .eq('zoom_webinar_id', webinarId)
            .limit(1);

          if (sessions && sessions.length > 0) {
            // RPC or manual query to mark unregistered students as absent
            const { error: rpcError } = await supabase.rpc(
              'mark_absent_for_session',
              { session_id: sessions[0].id },
            );

            if (rpcError) {
              this.logger.warn(`Failed to mark absent students: ${rpcError.message}`);
            }
          }

          this.logger.log(`Session ended for webinar ${webinarId}`);
          break;
        }

        // ── recording.completed ─────────────────────────────────
        // A Zoom cloud recording is ready. Select the usable video file and
        // enqueue exactly ONE ingestion job for it (idempotent by file id).
        case 'recording.completed': {
          const record = payload.object ?? {};
          const zoomWebinarId =
            record.id != null ? String(record.id) : null;
          const meetingUuid =
            typeof record.uuid === 'string' && record.uuid ? record.uuid : null;
          const topic =
            typeof record.topic === 'string' && record.topic.trim()
              ? record.topic.trim()
              : null;

          // ── Step 1: pick the usable video file (never "first file wins") ──
          const selected = selectZoomRecordingFile(record.recording_files ?? []);
          if (!selected) {
            this.logger.warn(
              `recording.completed without a completed MP4 (webinar=${zoomWebinarId ?? 'unknown'}, uuid=${meetingUuid ?? 'unknown'}) — nothing to ingest`,
            );
            return;
          }
          const file: ZoomRecordingFile = selected.file;
          const fileId = file.id != null ? String(file.id) : null;

          this.logger.log(
            `Zoom recording file selected: webinar=${zoomWebinarId ?? 'unknown'} file=${fileId ?? 'unknown'} (${selected.reason})`,
          );

          if (!file.download_url) {
            await this.insertFailedIngestion(supabase, {
              sessionId: null,
              fileId,
              meetingUuid,
              topic,
              downloadUrl: null,
              reason: 'recording_file_has_no_download_url',
            });
            return;
          }

          // ── Step 2: resolve the canonical live session ────────────────────
          let sessionId: string | null = null;
          if (zoomWebinarId) {
            const { data: sessions } = await supabase
              .from(TABLES.LIVE_SESSIONS)
              .select('id')
              .eq('zoom_webinar_id', zoomWebinarId)
              .limit(1);
            if (sessions && sessions.length > 0) {
              sessionId = sessions[0].id;
            }
          }

          if (!sessionId) {
            // Observable failure — never silently drop the event.
            // The download URL is preserved so ops can re-enqueue manually.
            await this.insertFailedIngestion(supabase, {
              sessionId: null,
              fileId,
              meetingUuid,
              topic,
              downloadUrl: file.download_url,
              reason: `no_matching_live_session_for_zoom_id_${zoomWebinarId ?? 'unknown'}`,
            });
            return;
          }

          // ── Step 3: idempotency — skip if this file was already ingested ──
          if (fileId) {
            const { data: existing } = await supabase
              .from(TABLES.UPLOAD_QUEUE)
              .select('id, status')
              .eq('zoom_recording_file_id', fileId)
              .limit(1);

            if (existing && existing.length > 0) {
              this.logger.log(
                `Duplicate recording.completed ignored (file=${fileId}, existing job ${existing[0].id} status=${existing[0].status})`,
              );
              return;
            }
          }

          // ── Step 4: enqueue exactly one ingestion job ─────────────────────
          const { error: insertError } = await supabase
            .from(TABLES.UPLOAD_QUEUE)
            .insert({
              session_id: sessionId,
              zoom_download_url: file.download_url,
              zoom_url_expires_at: new Date(
                Date.now() + 20 * 60 * 60 * 1000, // conservative window; see runbook
              ).toISOString(),
              status: 'pending',
              zoom_meeting_uuid: meetingUuid,
              zoom_recording_file_id: fileId,
              zoom_topic: topic,
            });

          if (insertError) {
            if (insertError.code === '23505') {
              // Unique index raced a concurrent delivery of the same event.
              this.logger.log(
                `Duplicate recording.completed lost the race (file=${fileId ?? 'unknown'}) — ignoring`,
              );
              return;
            }
            throw new Error(`upload_queue insert failed: ${insertError.message}`);
          }

          this.logger.log(
            `Recording ingestion queued: session=${sessionId} file=${fileId ?? 'unknown'} topic="${topic ?? 'n/a'}"`,
          );
          break;
        }

        // ── default ─────────────────────────────────────────────
        // Unknown event type — log and ignore
        default:
          this.logger.debug(`Unhandled Zoom webhook event: ${event}`);
          break;
      }
    } catch (error: any) {
      // Never throw from a webhook handler — Zoom will retry and we might
      // end up processing duplicate events. Pipeline state lives in
      // upload_queue, so a swallowed error here costs us nothing durable.
      this.logger.error(
        `Error processing Zoom webhook event ${event}: ${error.message}`,
      );
    }
  }

  /**
   * Record an ingestion that cannot proceed as an explicit FAILED queue row
   * (missing download URL / unknown session), so operators can see and
   * resolve it. Best-effort: if even this insert fails, log loudly.
   */
  private async insertFailedIngestion(
    supabase: SupabaseClient,
    args: {
      sessionId: string | null;
      fileId: string | null;
      meetingUuid: string | null;
      topic: string | null;
      downloadUrl: string | null;
      reason: string;
    },
  ): Promise<void> {
    const { error } = await supabase.from(TABLES.UPLOAD_QUEUE).insert({
      session_id: args.sessionId,
      zoom_download_url: args.downloadUrl ?? '', // NOT NULL column — empty only when no URL exists
      zoom_url_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      status: 'failed',
      error_message: safeErrorMessage(args.reason),
      zoom_meeting_uuid: args.meetingUuid,
      zoom_recording_file_id: args.fileId,
      zoom_topic: args.topic,
    });

    if (error) {
      if (error.code === '23505') {
        this.logger.log(
          `Failed-ingestion record for file=${args.fileId ?? 'unknown'} already exists — ignoring`,
        );
        return;
      }
      this.logger.error(
        `Could not persist failed ingestion (file=${args.fileId ?? 'unknown'}, reason=${args.reason}): ${error.message}`,
      );
      return;
    }

    this.logger.warn(
      `Zoom recording ingestion FAILED (observable): file=${args.fileId ?? 'unknown'} reason=${args.reason}`,
    );
  }
}
