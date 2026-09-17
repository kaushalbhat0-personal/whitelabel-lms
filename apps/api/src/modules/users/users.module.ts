/*
 * Users module — manages user profiles and batch memberships
 *
 * Why this module exists:
 *   - Groups all user-related code in one place (following NestJS convention).
 *   - Imports AuthModule so it can call AuthService.forceLogoutUser() when suspending
 *     accounts — circular dependency is avoided by NestJS's module system.
 *   - Exports UsersService so other modules (e.g. AttendanceModule) can look up users.
 *
 * A junior should know:
 *   - Adding a new provider? Put it in the `providers` array.
 *   - If another module needs UsersService, add it to `exports`.
 */
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuthModule, EmailModule, AuditModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
