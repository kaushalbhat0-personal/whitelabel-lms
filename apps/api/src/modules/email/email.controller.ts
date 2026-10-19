import { Controller, Post, Body, Get, Patch, Delete, Param, Headers, UnauthorizedException, Logger, Req } from '@nestjs/common';
import { UserRole } from '@lms/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { EmailService } from './email.service';
import { EmailWebhookService } from './email-webhook.service';
import { ConfigService } from '@nestjs/config';
import { EmailTemplatesService } from './email-templates.service';
import { SendTestEmailDto } from './dto/send-test-email.dto';
import { UpsertTemplateDto } from './dto/upsert-template.dto';
import { createHmac, timingSafeEqual } from 'crypto';

@Controller('email')
export class EmailController {
  private readonly logger = new Logger(EmailController.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly emailWebhookService: EmailWebhookService,
    private readonly emailTemplatesService: EmailTemplatesService,
    private readonly configService: ConfigService,
  ) {}

  @Post('test')
  @Roles(UserRole.ADMIN)
  async sendTest(@Body() dto: SendTestEmailDto) {
    const sent = await this.emailService.sendEmail(
      dto.email,
      'Test Email from LMS Platform',
      '<h1>Test Email</h1><p>If you received this, the email service is configured correctly.</p>',
    );

    return {
      success: sent,
      message: sent
        ? `Test email sent to ${dto.email}.`
        : 'Failed to send test email. Check server logs.',
    };
  }

  @Public()
  @Post('webhooks/resend')
  async handleResendWebhook(
    @Req() req: any,
    @Body() payload: any,
    @Headers('svix-id') svixId?: string,
    @Headers('svix-timestamp') svixTimestamp?: string,
    @Headers('svix-signature') svixSignature?: string,
  ) {
    const webhookSecret = this.configService.get<string>('RESEND_WEBHOOK_SECRET');
    if (!webhookSecret) {
      // Fail closed: an unverifiable webhook must never be accepted silently.
      // Client deployments must set RESEND_WEBHOOK_SECRET (see .env.example).
      this.logger.error(
        'RESEND_WEBHOOK_SECRET is not configured — rejecting Resend webhook. Set the secret to receive delivery events.',
      );
      throw new UnauthorizedException('Webhook verification is not configured');
    }
    if (!svixId || !svixTimestamp || !svixSignature) {
      this.logger.warn('Webhook verification failed: missing signature headers');
      throw new UnauthorizedException('Missing webhook signature headers');
    }

      const timestampInt = parseInt(svixTimestamp, 10);
      const tolerance = 300;
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestampInt) > tolerance) {
        this.logger.warn(`Webhook timestamp expired: diff=${Math.abs(now - timestampInt)}s`);
        throw new UnauthorizedException('Webhook timestamp expired');
      }

      try {
        const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(payload);
        const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;

        const secretPrefix = 'whsec_';
        const secret = webhookSecret.startsWith(secretPrefix)
          ? webhookSecret.slice(secretPrefix.length)
          : webhookSecret;

        const computed = createHmac('sha256', Buffer.from(secret, 'base64'))
          .update(signedContent)
          .digest();

        const expectedParts = svixSignature.split(' ');
        let matched = false;
        for (const part of expectedParts) {
          const [version, sigBase64] = part.trim().split(',');
          if (version !== 'v1' || !sigBase64) continue;

          const expected = Buffer.from(sigBase64, 'base64');
          if (expected.length === computed.length) {
            try { matched = timingSafeEqual(computed, expected); } catch { matched = false; }
          }
          if (matched) break;
        }

        if (!matched) {
          this.logger.warn('Webhook signature mismatch');
          throw new UnauthorizedException('Invalid webhook signature');
        }
      } catch (err: any) {
        if (err instanceof UnauthorizedException) throw err;
        this.logger.error(`Webhook signature verification error: ${err.message}`);
        throw new UnauthorizedException('Invalid webhook signature');
      }

    await this.emailWebhookService.handleResendWebhook(payload);
    return { received: true };
  }

  @Roles(UserRole.ADMIN)
  @Get('templates')
  async listTemplates() {
    return this.emailTemplatesService.findAll();
  }

  @Roles(UserRole.ADMIN)
  @Post('templates')
  async upsertTemplate(@Body() dto: UpsertTemplateDto) {
    return this.emailTemplatesService.upsertTemplate(dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch('templates/:name/toggle')
  async toggleTemplate(
    @Param('name') name: string,
    @Body('isActive') isActive: boolean,
  ) {
    await this.emailTemplatesService.toggleActive(name, isActive);
    return { success: true };
  }
}
