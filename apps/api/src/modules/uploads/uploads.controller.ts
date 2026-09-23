import { Controller, Post, UseInterceptors, UploadedFile, Logger, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SupabaseService } from '../../common/services/supabase.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf']);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

@Controller('uploads')
export class UploadsController {
  private readonly logger = new Logger(UploadsController.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  @Post('question-image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE_BYTES } }))
  async uploadQuestionImage(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { id: string },
  ) {
    if (!file) throw new BadRequestException('No file provided');

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException('File must be smaller than 10MB');
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`Unsupported file type: ${file.mimetype}. Allowed: PNG, JPG, WEBP, GIF, PDF`);
    }

    const rawExt = (file.originalname.split('.').pop() ?? 'png').toLowerCase();
    const ext = ALLOWED_EXTENSIONS.has(rawExt) ? rawExt : 'png';

    // Scoped path: question-answers/{userId}/{timestamp}-{random}.{ext}
    // Keeps first folder as question-answers for existing RLS policy (foldername(name)[1]='question-answers')
    // but adds user isolation. Attempt/question scoping can be added later if caller provides those IDs.
    const safeRandom = Math.random().toString(36).slice(2, 6);
    const fileName = `q-${Date.now()}-${safeRandom}.${ext}`;
    const storagePath = `question-answers/${user.id}/${fileName}`;

    const { error: uploadError } = await this.supabaseService.client
      .storage
      .from('uploads')
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      this.logger.error(`Upload failed: ${uploadError.message}`);
      throw new BadRequestException('Failed to upload file');
    }

    const { data: signedUrl, error: signedError } = await this.supabaseService.client
      .storage
      .from('uploads')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 30);

    if (signedError) {
      this.logger.warn(`Signed URL creation failed for ${storagePath}: ${signedError.message}`);
    }

    return { url: signedUrl?.signedUrl ?? storagePath, fileName, storagePath, mimeType: file.mimetype };
  }
}
