/*
 * DTO for creating a new live session — validated by the global ValidationPipe
 *
 * Why this DTO exists:
 *   - Ensures every required field is present and within allowable ranges.
 *   - batchIds is plural — a session can be assigned to MULTIPLE batches (cross-batch).
 *   - The global ValidationPipe rejects bad input before it reaches the service.
 *
 * A junior should know:
 *   - startTime must be ISO 8601 format, e.g. "2026-03-15T10:00:00+05:30"
 *   - durationMinutes must be between 15 and 480 (15 min – 8 hours).
 *   - At least one batchId is required (ArrayMinSize(1)).
 *   - teacherId must be a UUID referencing a user with role='teacher' and a zoomUserId set.
 */
import {
  IsString,
  IsDateString,
  IsInt,
  IsArray,
  IsUUID,
  Min,
  Max,
  ArrayMinSize,
  MinLength,
  IsOptional,
} from 'class-validator';

export class CreateSessionDto {
  /** Short title shown on the dashboard, e.g. "React Hooks Deep Dive" */
  @IsString()
  @MinLength(3, { message: 'Topic must be at least 3 characters' })
  topic: string;

  /** Optional description/agenda shown to students before the session */
  @IsString()
  @IsOptional()
  agenda?: string;

  /** Must be ISO 8601 format, e.g. 2024-03-15T10:00:00+05:30 */
  @IsDateString({}, { message: 'startTime must be a valid ISO 8601 date string' })
  startTime: string;

  /** How long the session runs in minutes (min 15, max 480) */
  @IsInt({ message: 'Duration must be a whole number' })
  @Min(15, { message: 'Duration must be at least 15 minutes' })
  @Max(480, { message: 'Duration cannot exceed 480 minutes (8 hours)' })
  durationMinutes: number;

  /** Assign to one or more batches — this is the cross-batch feature */
  @IsArray({ message: 'At least one batch must be selected' })
  @IsUUID('4', { each: true, message: 'Each batch ID must be a valid UUID' })
  @ArrayMinSize(1, { message: 'At least one batch must be selected' })
  batchIds: string[];

  /** The host who will run the session — must have a zoomUserId set in their profile.
   *  Optional: when omitted, the host is resolved automatically (default host or first
   *  profile with a configured Zoom user). */
  @IsOptional()
  @IsUUID('4', { message: 'Teacher ID must be a valid UUID' })
  teacherId?: string;
}
