import { MuxProvider } from './mux.provider';
import { toCanonicalStatus } from '../video-provider.types';

describe('MuxProvider', () => {
  let provider: MuxProvider;
  let muxService: any;

  beforeEach(() => {
    jest.clearAllMocks();
    muxService = {
      createDirectUploadUrl: jest.fn().mockResolvedValue({
        uploadUrl: 'https://upload.mux.com/put',
        uploadId: 'mux-upload-1',
      }),
      uploadFromUrl: jest.fn().mockResolvedValue('mux-asset-1'),
      getAssetStatus: jest.fn(),
      getSignedPlaybackUrl: jest.fn().mockResolvedValue({
        url: 'https://stream.mux.com/pb.m3u8?token=jwt',
        expiresAt: '2026-01-01T00:01:00.000Z',
      }),
      getSignedThumbnailUrl: jest.fn().mockResolvedValue({
        url: 'https://image.mux.com/pb/thumbnail.jpg?token=jwt',
        expiresAt: '2026-01-01T00:05:00.000Z',
      }),
      deleteAsset: jest.fn().mockResolvedValue(undefined),
    };
    provider = new MuxProvider(muxService);
  });

  it('exposes the mux provider name', () => {
    expect(provider.name).toBe('mux');
  });

  describe('createDirectUpload', () => {
    it('delegates to createDirectUploadUrl', async () => {
      const handle = await provider.createDirectUpload({ title: 'Lesson 1' });
      expect(muxService.createDirectUploadUrl).toHaveBeenCalledWith('Lesson 1');
      expect(handle).toEqual({
        uploadUrl: 'https://upload.mux.com/put',
        uploadId: 'mux-upload-1',
      });
    });
  });

  describe('createAssetFromSource', () => {
    it('maps source + passthrough onto uploadFromUrl', async () => {
      const result = await provider.createAssetFromSource({
        sourceUrl: 'https://zoom.us/rec/download?t=token',
        passthrough: { sessionId: 'sess-1', title: 'Recording' },
      });
      expect(muxService.uploadFromUrl).toHaveBeenCalledWith(
        'sess-1',
        'https://zoom.us/rec/download?t=token',
        'Recording',
      );
      expect(result).toEqual({ assetId: 'mux-asset-1' });
    });
  });

  describe('getPlaybackUrls', () => {
    it('combines signed playback and thumbnail URLs', async () => {
      const urls = await provider.getPlaybackUrls('pb', { sessionId: 'sess-uuid' });
      expect(muxService.getSignedPlaybackUrl).toHaveBeenCalledWith('pb', 'sess-uuid');
      expect(muxService.getSignedThumbnailUrl).toHaveBeenCalledWith('pb', 'sess-uuid');
      expect(urls.url).toContain('stream.mux.com/pb.m3u8');
      expect(urls.thumbnailUrl).toContain('image.mux.com/pb/thumbnail.jpg');
      expect(urls.expiresAt).toBe('2026-01-01T00:01:00.000Z');
    });
  });

  describe('getAssetStatus', () => {
    it('delegates to the mux service status accessor', async () => {
      muxService.getAssetStatus.mockResolvedValueOnce({
        status: 'ready',
        durationSeconds: 61,
        playbackId: 'pb',
      });
      const status = await provider.getAssetStatus('mux-asset-1');
      expect(muxService.getAssetStatus).toHaveBeenCalledWith('mux-asset-1');
      expect(status.status).toBe('ready');
      expect(status.durationSeconds).toBe(61);
    });
  });

  describe('deleteAsset', () => {
    it('delegates deletion (404 tolerance lives in MuxService)', async () => {
      await provider.deleteAsset('gone');
      expect(muxService.deleteAsset).toHaveBeenCalledWith('gone');
    });
  });

  describe('toCanonicalStatus', () => {
    it('maps provider states onto the schema CHECK vocabulary', () => {
      expect(toCanonicalStatus('ready')).toBe('ready');
      expect(toCanonicalStatus('errored')).toBe('failed'); // never write 'error'
      expect(toCanonicalStatus('error')).toBe('failed');
      expect(toCanonicalStatus('failed')).toBe('failed');
      expect(toCanonicalStatus('preparing')).toBe('processing');
      expect(toCanonicalStatus(undefined)).toBe('processing');
    });
  });
});
