/*
 * GoogleMeetLiveProvider — Phase 1 unit/contract tests (RCCF-LIVE-GMEET-04).
 *
 * All Google traffic is mocked at the axios boundary (no network, no real
 * credentials). A throwaway RSA keypair is generated in-process for the JWT
 * assertion path — the signed assertion is decoded and its claims asserted
 * (iss/sub/scope/aud), proving the DWD impersonation contract without any
 * Google account.
 */
import { generateKeyPairSync } from 'crypto';
import axios from 'axios';
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DEFAULT_TIMEZONE } from '../../common/config/defaults';
import {
  GoogleMeetLiveProvider,
  googleMeetEnvFrom,
} from './google-meet-live.provider';
import {
  validateGoogleMeetConfig,
  ServiceAccountAuth,
  GOOGLE_CALENDAR_SCOPE,
} from './google-auth';

const MEET_URL = 'https://meet.google.com/abc-defg-hij';

function makeKey() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

function makeSaJson(privateKey: string) {
  return JSON.stringify({
    type: 'service_account',
    project_id: 'client-proj',
    private_key_id: 'kid-1',
    private_key: privateKey,
    client_email: 'lms-meet@client-proj.iam.gserviceaccount.com',
    token_uri: 'https://oauth2.googleapis.com/token',
  });
}

function configWith(env: Record<string, string | undefined>) {
  return { get: ((key: string) => env[key]) as (key: string) => string | undefined };
}

function supabaseWithTimezone(tz: string | null, fail = false) {
  const single = fail
    ? jest.fn().mockResolvedValue({ data: null, error: new Error('db down') })
    : jest.fn().mockResolvedValue({ data: tz ? { timezone: tz } : null, error: null });
  const chain: any = {
    select: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    single,
  };
  return { client: { from: jest.fn(() => chain) } };
}

describe('GoogleMeetLiveProvider (GMEET-04)', () => {
  const privateKey = makeKey();
  let requestSpy: jest.SpyInstance;

  beforeEach(() => {
    requestSpy = jest.spyOn(axios, 'request');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const baseEnv = () => ({
    GOOGLE_MEET_SERVICE_ACCOUNT_JSON: makeSaJson(privateKey),
    GOOGLE_MEET_ORGANIZER_EMAIL: 'teacher@example.com',
    GOOGLE_MEET_CALENDAR_ID: 'primary',
  });

  const providerWith = (
    env: Record<string, string | undefined>,
    supabase: any = supabaseWithTimezone(null, true),
  ) => new GoogleMeetLiveProvider(configWith(env) as any, supabase);

  describe('identity + config validation', () => {
    it('name is google-meet', () => {
      expect(providerWith(baseEnv()).name).toBe('google-meet');
    });

    it('create rejects with neutral 503 when Google config is missing', async () => {
      const p = providerWith({});
      await expect(
        p.createWebinar({ topic: 'T', startTime: '2026-12-01T10:00:00.000Z', durationMinutes: 60 }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(
        p.createWebinar({ topic: 'T', startTime: '2026-12-01T10:00:00.000Z', durationMinutes: 60 }),
      ).rejects.toThrow(/not configured/i);
      expect(requestSpy).not.toHaveBeenCalled();
    });

    it('validateGoogleMeetConfig accepts a complete deployment config', () => {
      const cfg = validateGoogleMeetConfig(googleMeetEnvFrom(configWith(baseEnv()) as any));
      expect(cfg.organizerEmail).toBe('teacher@example.com');
      expect(cfg.calendarId).toBe('primary');
      expect(cfg.serviceAccount.client_email).toContain('client-proj');
    });

    it.each([
      [{}, /GOOGLE_MEET_SERVICE_ACCOUNT_JSON/],
      [{ GOOGLE_MEET_SERVICE_ACCOUNT_JSON: 'not-json' }, /not valid JSON/],
      [
        { GOOGLE_MEET_SERVICE_ACCOUNT_JSON: JSON.stringify({ private_key: 'x' }) },
        /client_email/,
      ],
      [
        {
          GOOGLE_MEET_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'a@b.c' }),
          GOOGLE_MEET_ORGANIZER_EMAIL: 'teacher@example.com',
        },
        /private_key/,
      ],
      [
        { GOOGLE_MEET_SERVICE_ACCOUNT_JSON: makeSaJson(privateKey) },
        /ORGANIZER_EMAIL/,
      ],
      [
        {
          GOOGLE_MEET_SERVICE_ACCOUNT_JSON: makeSaJson(privateKey),
          GOOGLE_MEET_ORGANIZER_EMAIL: 'not-an-email',
        },
        /ORGANIZER_EMAIL/,
      ],
    ])('validateGoogleMeetConfig rejects %p', (env, pattern) => {
      expect(() => validateGoogleMeetConfig(googleMeetEnvFrom(configWith(env) as any))).toThrow(
        pattern,
      );
    });

    it('calendarId defaults to primary when unset', () => {
      const { GOOGLE_MEET_CALENDAR_ID: _drop, ...rest } = baseEnv();
      const cfg = validateGoogleMeetConfig(googleMeetEnvFrom(configWith(rest) as any));
      expect(cfg.calendarId).toBe('primary');
    });
  });

  describe('JWT assertion (service account + DWD)', () => {
    it('signs iss/sub/scope/aud claims with the deployment key', async () => {
      const auth = new ServiceAccountAuth(
        { client_email: 'lms-meet@client-proj.iam.gserviceaccount.com', private_key: privateKey },
        'teacher@example.com',
      );
      requestSpy.mockResolvedValue({ data: { access_token: 'ya29.test' } });
      const token = await auth.getAccessToken([GOOGLE_CALENDAR_SCOPE]);
      expect(token).toBe('ya29.test');

      const body = new URLSearchParams(requestSpy.mock.calls[0][0].data);
      expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
      const [, payloadB64] = (body.get('assertion') as string).split('.');
      const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      expect(claims.iss).toBe('lms-meet@client-proj.iam.gserviceaccount.com');
      expect(claims.sub).toBe('teacher@example.com');
      expect(claims.scope).toBe(GOOGLE_CALENDAR_SCOPE);
      expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
    });

    it('surfaces auth failure without leaking key material', async () => {
      const auth = new ServiceAccountAuth(
        { client_email: 'x@y.iam.gserviceaccount.com', private_key: 'BAD-KEY' },
        'teacher@example.com',
      );
      await expect(auth.getAccessToken([GOOGLE_CALENDAR_SCOPE])).rejects.toThrow(
        /Google authentication failed/,
      );
    });
  });

  describe('createWebinar (Calendar-first)', () => {
    function mockTokenAndInsert(insertBody: any) {
      requestSpy.mockImplementation(async (opts: any) => {
        if (opts.url === 'https://oauth2.googleapis.com/token') {
          return { data: { access_token: 'ya29.test' } };
        }
        if (opts.method === 'POST' && opts.url.includes('/events?')) {
          return { data: insertBody };
        }
        throw new Error(`unexpected call ${opts.method} ${opts.url}`);
      });
    }

    it('creates a scheduled event and maps provider-neutral result', async () => {
      mockTokenAndInsert({ id: 'evt1', hangoutLink: MEET_URL });
      const p = providerWith(baseEnv(), supabaseWithTimezone('Asia/Dubai'));

      const result = await p.createWebinar({
        topic: 'Forex Basics',
        agenda: 'Intro',
        startTime: '2026-12-01T10:00:00.000Z',
        durationMinutes: 60,
      });

      expect(result).toEqual({ webinarId: 'evt1', joinUrl: MEET_URL, startUrl: MEET_URL });

      const insertCall = requestSpy.mock.calls.find((c) => c[0].method === 'POST' && c[0].url.includes('/events?'));
      expect(insertCall[0].url).toContain('conferenceDataVersion=1');
      expect(insertCall[0].url).toContain('sendUpdates=none');
      expect(insertCall[0].headers.Authorization).toBe('Bearer ya29.test');
      const body = insertCall[0].data;
      expect(body.summary).toBe('Forex Basics');
      expect(body.description).toBe('Intro');
      expect(body.start).toMatchObject({ dateTime: '2026-12-01T10:00:00.000Z', timeZone: 'Asia/Dubai' });
      expect(body.end.dateTime).toBe('2026-12-01T11:00:00.000Z');
      expect(body.conferenceData.createRequest.conferenceSolutionKey).toEqual({ type: 'hangoutsMeet' });
      expect(body.conferenceData.createRequest.requestId).toBeDefined();
      expect(body.attendees).toBeUndefined();
    });

    it('uses BusinessConfig timezone, falling back to the centralized default', async () => {
      mockTokenAndInsert({ id: 'evt9', hangoutLink: MEET_URL });
      // DB read fails → caller hint absent → DEFAULT_TIMEZONE (never a new literal).
      const p = providerWith(baseEnv(), supabaseWithTimezone(null, true));
      await p.createWebinar({
        topic: 'T',
        startTime: '2026-12-01T10:00:00.000Z',
        durationMinutes: 30,
      });
      const insertCall = requestSpy.mock.calls.find((c) => c[0].method === 'POST' && c[0].url.includes('/events?'));
      expect(insertCall[0].data.start.timeZone).toBe(DEFAULT_TIMEZONE);
    });

    it('polls events.get when the conference URL is not ready yet', async () => {
      let gets = 0;
      requestSpy.mockImplementation(async (opts: any) => {
        if (opts.url === 'https://oauth2.googleapis.com/token') {
          return { data: { access_token: 'ya29.test' } };
        }
        if (opts.method === 'POST') return { data: { id: 'evt2' } };
        gets++;
        if (gets < 2) return { data: { id: 'evt2' } };
        return { data: { id: 'evt2', hangoutLink: MEET_URL } };
      });
      const p = providerWith(baseEnv(), supabaseWithTimezone(null, true));
      const result = await p.createWebinar({
        topic: 'T',
        startTime: '2026-12-01T10:00:00.000Z',
        durationMinutes: 30,
      });
      expect(result.joinUrl).toBe(MEET_URL);
      expect(gets).toBeGreaterThanOrEqual(2);
    });

    it('rejects invalid input without calling Google', async () => {
      const p = providerWith(baseEnv(), supabaseWithTimezone(null, true));
      await expect(
        p.createWebinar({ topic: 'T', startTime: 'not-a-date', durationMinutes: 30 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        p.createWebinar({ topic: 'T', startTime: '2026-12-01T10:00:00.000Z', durationMinutes: 0 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(requestSpy).not.toHaveBeenCalled();
    });

    it('maps Google failures to neutral errors (no raw API objects outward)', async () => {
      requestSpy.mockImplementation(async (opts: any) => {
        if (opts.url === 'https://oauth2.googleapis.com/token') {
          return { data: { access_token: 'ya29.test' } };
        }
        const err: any = new Error('request failed');
        err.response = { status: 403, data: { error: { message: 'Calendar usage limits exceeded' } } };
        throw err;
      });
      const p = providerWith(baseEnv(), supabaseWithTimezone(null, true));
      const promise = p.createWebinar({
        topic: 'T',
        startTime: '2026-12-01T10:00:00.000Z',
        durationMinutes: 30,
      });
      await expect(promise).rejects.toThrow(/refused/i);
      await expect(promise).rejects.not.toThrow(/usage limits/i);
    });

    it('returned objects carry no credentials', async () => {
      mockTokenAndInsert({ id: 'evt1', hangoutLink: MEET_URL });
      const p = providerWith(baseEnv(), supabaseWithTimezone(null, true));
      const result = await p.createWebinar({
        topic: 'T',
        startTime: '2026-12-01T10:00:00.000Z',
        durationMinutes: 30,
      });
      expect(Object.keys(result).sort()).toEqual(['joinUrl', 'startUrl', 'webinarId']);
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
    });
  });

  describe('deleteWebinar', () => {
    it('targets only the LMS-created event and tolerates nothing silently', async () => {
      requestSpy.mockImplementation(async (opts: any) => {
        if (opts.url === 'https://oauth2.googleapis.com/token') {
          return { data: { access_token: 'ya29.test' } };
        }
        return { data: {} };
      });
      const p = providerWith(baseEnv(), supabaseWithTimezone(null, true));
      await p.deleteWebinar('evt1');
      const del = requestSpy.mock.calls.find((c) => c[0].method === 'DELETE');
      expect(del[0].url).toContain('/calendars/primary/events/evt1');
      expect(del[0].url).toContain('sendUpdates=none');
    });

    it('maps provider 404 to NotFound', async () => {
      requestSpy.mockImplementation(async (opts: any) => {
        if (opts.url === 'https://oauth2.googleapis.com/token') {
          return { data: { access_token: 'ya29.test' } };
        }
        const err: any = new Error('not found');
        err.response = { status: 404, data: { error: { message: 'Not Found' } } };
        throw err;
      });
      const p = providerWith(baseEnv(), supabaseWithTimezone(null, true));
      await expect(p.deleteWebinar('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('registerAttendee (shared meeting URL)', () => {
    it('returns the shared URL without per-student Google state', async () => {
      let gets = 0;
      requestSpy.mockImplementation(async (opts: any) => {
        if (opts.url === 'https://oauth2.googleapis.com/token') {
          return { data: { access_token: 'ya29.test' } };
        }
        gets++;
        return { data: { id: 'evt1', hangoutLink: MEET_URL } };
      });
      const p = providerWith(baseEnv(), supabaseWithTimezone(null, true));
      const first = await p.registerAttendee('evt1', { name: 'A B', email: 'a@test.com' });
      const second = await p.registerAttendee('evt1', { name: 'C D', email: 'c@test.com' });
      expect(first).toBe(MEET_URL);
      expect(second).toBe(MEET_URL);
      // Second student served from the in-memory cache — one provider read total.
      expect(gets).toBe(1);
    });

    it('maps a missing event to NotFound', async () => {
      requestSpy.mockImplementation(async (opts: any) => {
        if (opts.url === 'https://oauth2.googleapis.com/token') {
          return { data: { access_token: 'ya29.test' } };
        }
        const err: any = new Error('not found');
        err.response = { status: 404, data: { error: { message: 'Not Found' } } };
        throw err;
      });
      const p = providerWith(baseEnv(), supabaseWithTimezone(null, true));
      await expect(
        p.registerAttendee('gone', { name: 'A', email: 'a@test.com' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
