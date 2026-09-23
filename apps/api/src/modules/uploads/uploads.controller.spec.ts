import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { SupabaseService } from '../../common/services/supabase.service';

function createMockSupabase(overrides?: { uploadError?: any; signedUrl?: string; signedError?: any }) {
  const uploadMock = jest.fn().mockResolvedValue(overrides?.uploadError ? { error: overrides.uploadError } : { error: null });
  const signedMock = jest.fn().mockResolvedValue(
    overrides?.signedError
      ? { data: null, error: overrides.signedError }
      : { data: { signedUrl: overrides?.signedUrl ?? 'https://example.com/signed' }, error: null },
  );
  const fromMock = jest.fn().mockReturnValue({ upload: uploadMock, createSignedUrl: signedMock });
  return {
    client: { storage: { from: fromMock } },
    fromMock,
    uploadMock,
    signedMock,
  };
}

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    originalname: 'test.png',
    mimetype: 'image/png',
    size: 1024,
    buffer: Buffer.from('fake'),
    fieldname: 'file',
    encoding: '7bit',
    destination: '',
    filename: '',
    path: '',
    stream: null as any,
    ...overrides,
  } as Express.Multer.File;
}

describe('UploadsController', () => {
  let controller: UploadsController;
  let supabaseMock: ReturnType<typeof createMockSupabase>;

  beforeEach(async () => {
    supabaseMock = createMockSupabase();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UploadsController],
      providers: [{ provide: SupabaseService, useValue: supabaseMock }],
    }).compile();
    controller = module.get(UploadsController);
  });

  describe('question-image upload', () => {
    it('PNG → allowed', async () => {
      const file = makeFile({ originalname: 'photo.png', mimetype: 'image/png' });
      const res = await controller.uploadQuestionImage(file as any, { id: 'userA' } as any);
      expect(res.mimeType).toBe('image/png');
      expect(supabaseMock.uploadMock).toHaveBeenCalled();
      expect(res.storagePath).toMatch(/^question-answers\/userA\/q-\d+-[a-z0-9]{4}\.png$/);
    });

    it('JPEG → allowed (jpg)', async () => {
      const file = makeFile({ originalname: 'photo.jpg', mimetype: 'image/jpeg' });
      const res = await controller.uploadQuestionImage(file as any, { id: 'userA' } as any);
      expect(res.storagePath).toMatch(/\.jpg$/);
    });

    it('WEBP → allowed', async () => {
      const file = makeFile({ originalname: 'a.webp', mimetype: 'image/webp' });
      const res = await controller.uploadQuestionImage(file as any, { id: 'userA' } as any);
      expect(res.storagePath).toMatch(/\.webp$/);
    });

    it('GIF → allowed', async () => {
      const file = makeFile({ originalname: 'anim.gif', mimetype: 'image/gif' });
      const res = await controller.uploadQuestionImage(file as any, { id: 'userA' } as any);
      expect(res.storagePath).toMatch(/\.gif$/);
    });

    it('PDF → allowed', async () => {
      const file = makeFile({ originalname: 'doc.pdf', mimetype: 'application/pdf' });
      const res = await controller.uploadQuestionImage(file as any, { id: 'userA' } as any);
      expect(res.storagePath).toMatch(/\.pdf$/);
      expect(res.mimeType).toBe('application/pdf');
    });

    it('Invalid MIME → denied', async () => {
      const file = makeFile({ originalname: 'evil.txt', mimetype: 'text/plain' });
      await expect(controller.uploadQuestionImage(file as any, { id: 'userA' } as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(supabaseMock.uploadMock).not.toHaveBeenCalled();
    });

    it('Invalid MIME text/html → denied', async () => {
      const file = makeFile({ originalname: 'x.html', mimetype: 'text/html' });
      await expect(controller.uploadQuestionImage(file as any, { id: 'userA' } as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('>10 MB → denied', async () => {
      const file = makeFile({ mimetype: 'image/png', size: 11 * 1024 * 1024 });
      await expect(controller.uploadQuestionImage(file as any, { id: 'userA' } as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('10 MB exact → allowed', async () => {
      const file = makeFile({ mimetype: 'image/png', size: 10 * 1024 * 1024 });
      const res = await controller.uploadQuestionImage(file as any, { id: 'userA' } as any);
      expect(res.storagePath).toBeDefined();
    });

    it('path traversal via originalname → denied/sanitized', async () => {
      const file = makeFile({ originalname: '../../etc/passwd.png', mimetype: 'image/png' });
      const res = await controller.uploadQuestionImage(file as any, { id: 'userA' } as any);
      // storagePath must not contain .. and must be scoped to userA
      expect(res.storagePath).not.toContain('..');
      expect(res.storagePath).not.toContain('etc');
      expect(res.storagePath).toMatch(/^question-answers\/userA\/q-.*\.png$/);
      // ext fallback still png
      expect(supabaseMock.fromMock).toHaveBeenCalledWith('uploads');
      const uploadPath = supabaseMock.uploadMock.mock.calls[0][0];
      expect(uploadPath).toBe(res.storagePath);
    });

    it('path traversal with absolute path → sanitized', async () => {
      const file = makeFile({ originalname: '/tmp/evil.pdf', mimetype: 'application/pdf' });
      const res = await controller.uploadQuestionImage(file as any, { id: 'userA' } as any);
      expect(res.storagePath).not.toContain('/tmp');
      expect(res.storagePath).toMatch(/^question-answers\/userA\/q-.*\.pdf$/);
    });

    it('ownership: storagePath scoped to CurrentUser id', async () => {
      const file = makeFile({ mimetype: 'image/png' });
      const resA = await controller.uploadQuestionImage(file as any, { id: 'studentA-id' } as any);
      expect(resA.storagePath.startsWith('question-answers/studentA-id/')).toBe(true);
      const resB = await controller.uploadQuestionImage(file as any, { id: 'studentB-id' } as any);
      expect(resB.storagePath.startsWith('question-answers/studentB-id/')).toBe(true);
      expect(resA.storagePath).not.toEqual(resB.storagePath);
    });

    it('user B cannot craft path for user A (server derives from auth)', async () => {
      const file = makeFile({ originalname: 'attemptA.png', mimetype: 'image/png' });
      // Even if client tries to hint at another user via filename, server ignores it
      const res = await controller.uploadQuestionImage(file as any, { id: 'studentB-id' } as any);
      expect(res.storagePath).toContain('studentB-id');
      expect(res.storagePath).not.toContain('studentA');
    });

    it('No file → 400', async () => {
      await expect(controller.uploadQuestionImage(null as any, { id: 'userA' } as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('upload error from storage → 400', async () => {
      const mockWithError = createMockSupabase({ uploadError: { message: 'boom' } });
      const mod = await Test.createTestingModule({
        controllers: [UploadsController],
        providers: [{ provide: SupabaseService, useValue: mockWithError }],
      }).compile();
      const ctrl = mod.get(UploadsController);
      const file = makeFile({ mimetype: 'image/png' });
      await expect(ctrl.uploadQuestionImage(file as any, { id: 'userA' } as any)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
