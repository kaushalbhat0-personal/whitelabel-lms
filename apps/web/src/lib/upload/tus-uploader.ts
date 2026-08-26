/*
 * Minimal TUS 1.0.0 uploader for Bunny Stream direct browser uploads
 * (Phase 7E). Implemented with plain XHR — no new dependencies.
 *
 * LIVE-VERIFIED PROTOCOL (Phase 7E smoke against video.bunnycdn.com):
 *   1. POST  {endpoint}            — TUS creation extension. Headers:
 *          presigned credentials + TUS-Resumable + Upload-Length (total) +
 *          Upload-Metadata ("filetype <b64>,title <b64>", comma-separated,
 *          NO space between pairs).
 *      -> 201 Created with Location header. Location may be RELATIVE
 *         ("/tusupload/<session>") and MUST be resolved against the endpoint
 *         origin — otherwise a browser XHR would hit OUR OWN domain.
 *   2. PATCH {resolved session}    — chunk bytes. Headers: presigned
 *          credentials + TUS-Resumable + Upload-Offset +
 *          application/offset+octet-stream. Do NOT resend Upload-Length
 *          ("Upload-Length cannot be updated once set").
 *   3. Response Upload-Offset header carries the authoritative offset.
 *
 * The presigned signature covers ONLY this video id and expires — the library
 * API key itself never reaches the browser.
 */

export const TUS_RESUMABLE_VERSION = '1.0.0';

/** 32 MiB chunks — few requests for large files while keeping retries cheap. */
export const DEFAULT_TUS_CHUNK_SIZE = 32 * 1024 * 1024;

const MAX_CREATE_ATTEMPTS = 2;
const MAX_CHUNK_ATTEMPTS = 3;

export interface TusUploadOptions {
  endpoint: string;
  /** Per-upload presigned credentials from the LMS upload-authorize response. */
  headers: Record<string, string>;
  file: File;
  chunkSize?: number;
  /** Receives 0..1 upload fraction (exact at chunk boundaries). */
  onProgress?: (fraction: number) => void;
  /**
   * Receives the in-flight XHR (null when idle) so callers can implement
   * cancellation by calling .abort() — mirrors the existing modal UX.
   */
  registerXhr?: (xhr: XMLHttpRequest | null) => void;
}

function sendTusRequest(
  method: 'POST' | 'PATCH' | 'HEAD',
  url: string,
  opts: TusUploadOptions,
  init: {
    body?: Blob | null;
    uploadLength?: number;
    metadata?: string;
    uploadOffset?: number;
    trackProgressFrom?: number;
  } = {},
): Promise<XMLHttpRequest> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    opts.registerXhr?.(xhr);

    xhr.open(method, url);
    for (const [k, v] of Object.entries(opts.headers)) {
      xhr.setRequestHeader(k, v);
    }
    xhr.setRequestHeader('TUS-Resumable', TUS_RESUMABLE_VERSION);
    if (init.uploadLength !== undefined) {
      xhr.setRequestHeader('Upload-Length', String(init.uploadLength));
    }
    if (init.metadata) {
      xhr.setRequestHeader('Upload-Metadata', init.metadata);
    }
    if (init.uploadOffset !== undefined) {
      xhr.setRequestHeader('Upload-Offset', String(init.uploadOffset));
    }
    if (method === 'PATCH') {
      xhr.setRequestHeader('Content-Type', 'application/offset+octet-stream');
      const base = init.trackProgressFrom ?? 0;
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const done = base + e.loaded;
          opts.onProgress?.(Math.min(done / opts.file.size, 1));
        }
      });
    }

    xhr.addEventListener('load', () => resolve(xhr));
    xhr.addEventListener('error', () =>
      reject(new Error(`Network error during TUS ${method}`)),
    );
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

    xhr.send(init.body ?? null);
  });
}

function b64(s: string): string {
  // Browser base64 that survives non-ASCII titles (TUS metadata is ASCII-safe).
  return btoa(unescape(encodeURIComponent(s)));
}

async function createSession(opts: TusUploadOptions): Promise<string> {
  const metadata =
    `filetype ${b64(opts.file.type || 'video/mp4')}` +
    `,title ${b64(opts.file.name.slice(0, 128) || 'recording')}`;

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt++) {
    try {
      const xhr = await sendTusRequest('POST', opts.endpoint, opts, {
        uploadLength: opts.file.size,
        metadata,
      });
      if (xhr.status !== 201) {
        throw new Error(`Bunny TUS session create responded ${xhr.status}`);
      }
      const location = xhr.getResponseHeader('Location');
      if (!location) throw new Error('Bunny TUS response missing Location');
      // Location may be relative ("/tusupload/<session>") — MUST resolve
      // against the ENDPOINT origin, not the page origin.
      return new URL(location, opts.endpoint).toString();
    } catch (err) {
      if ((err as Error).message === 'Upload cancelled') throw err;
      lastError = err as Error;
    }
  }
  throw new Error(`Upload failed creating TUS session: ${lastError?.message}`);
}

async function resyncOffset(
  sessionUrl: string,
  opts: TusUploadOptions,
): Promise<number> {
  const xhr = await sendTusRequest('HEAD', sessionUrl, opts);
  const header = xhr.getResponseHeader('Upload-Offset');
  const value = header === null ? Number.NaN : parseInt(header, 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Upload `file` to `endpoint` using the TUS resumable protocol.
 * Resolves once every byte is acknowledged by Bunny.
 */
export async function tusUpload(
  opts: TusUploadOptions,
): Promise<{ offset: number }> {
  const chunkSize = opts.chunkSize ?? DEFAULT_TUS_CHUNK_SIZE;
  const sessionUrl = await createSession(opts);

  let offset = await resyncOffset(sessionUrl, opts); // normally 0
  opts.onProgress?.(Math.min(offset / Math.max(opts.file.size, 1), 1));

  while (offset < opts.file.size) {
    const chunkEnd = Math.min(offset + chunkSize, opts.file.size);
    const chunk = opts.file.slice(offset, chunkEnd);

    let attempts = 0;
    for (;;) {
      attempts += 1;
      try {
        const xhr = await sendTusRequest('PATCH', sessionUrl, opts, {
          body: chunk,
          uploadOffset: offset,
          trackProgressFrom: offset,
        });
        if (xhr.status < 200 || xhr.status >= 300) {
          throw new Error(
            `Bunny TUS responded ${xhr.status} at offset ${offset}`,
          );
        }
        const header = xhr.getResponseHeader('Upload-Offset');
        const newOffset =
          header === null ? Number.NaN : parseInt(header, 10);
        if (!Number.isFinite(newOffset)) {
          throw new Error('Bunny TUS response missing Upload-Offset');
        }
        offset = newOffset;
        opts.onProgress?.(Math.min(offset / opts.file.size, 1));
        break;
      } catch (err) {
        if ((err as Error).message === 'Upload cancelled') throw err;
        if (attempts >= MAX_CHUNK_ATTEMPTS) {
          throw new Error(
            `Upload failed after ${MAX_CHUNK_ATTEMPTS} attempts at offset ${offset}: ` +
              `${(err as Error).message}`,
          );
        }
        try {
          offset = await resyncOffset(sessionUrl, opts);
        } catch {
          /* keep last known offset if even HEAD fails */
        }
      }
    }
  }

  opts.registerXhr?.(null);
  return { offset };
}
