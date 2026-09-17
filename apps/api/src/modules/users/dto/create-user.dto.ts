/*
 * DTO for creating a new user — validated by the global ValidationPipe
 *
 * Why this DTO exists:
 *   - Ensures every required field is present and correctly formatted before the
 *     service layer processes it.
 *   - The `role` field uses the shared UserRole enum so values are always consistent.
 *
 * A junior should know:
 *   - password has a minimum length of 8 — enforced at the API level.
 *   - zoomUserId is only needed for teachers who will host Zoom webinars.
 *   - The ValidationPipe will return a 400 error automatically if validation fails.
 */
import { IsEmail, IsString, IsEnum, IsOptional, MinLength } from 'class-validator';
import { UserRole } from '@lms/shared-types';

export class CreateUserDto {
  /** Full display name shown across the platform */
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  name: string;

  /** Login email — also used for password reset and notifications */
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  /** Initial password (min 8 characters) — hashed by Supabase Auth automatically. Optional: server generates if not provided */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password?: string;

  /** Optional phone number for SMS notifications */
  @IsString()
  @IsOptional()
  phone?: string;

  /** What this user is allowed to do — admin, teacher, or student */
  @IsEnum(UserRole, { message: 'Role must be one of: admin, teacher, student' })
  role: UserRole;

  /** Zoom user ID, required for teachers so they can host webinars */
  @IsString()
  @IsOptional()
  zoomUserId?: string;
}
