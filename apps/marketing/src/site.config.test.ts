/**
 * URL normalization tests for the marketing demo handoff (DEMO-07).
 *
 * The launch link is `${demoUrl}/login`. These tests prove the resolver can
 * never produce `/login/login`, regardless of how NEXT_PUBLIC_DEMO_URL is
 * shaped in the Vercel dashboard.
 *
 * Run: pnpm test:marketing (tsx --test, no build step required)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDemoUrl } from './site.config';

describe('normalizeDemoUrl — demo launch URL contract', () => {
  it('bare origin passes through unchanged', () => {
    assert.equal(normalizeDemoUrl('https://whitelabel-lms-opal.vercel.app'), 'https://whitelabel-lms-opal.vercel.app');
  });

  it('trailing slash is stripped', () => {
    assert.equal(normalizeDemoUrl('https://whitelabel-lms-opal.vercel.app/'), 'https://whitelabel-lms-opal.vercel.app');
    assert.equal(normalizeDemoUrl('https://whitelabel-lms-opal.vercel.app///'), 'https://whitelabel-lms-opal.vercel.app');
  });

  it('a trailing /login path is tolerated, never duplicated', () => {
    assert.equal(normalizeDemoUrl('https://whitelabel-lms-opal.vercel.app/login'), 'https://whitelabel-lms-opal.vercel.app');
    assert.equal(normalizeDemoUrl('https://whitelabel-lms-opal.vercel.app/login/'), 'https://whitelabel-lms-opal.vercel.app');
  });

  it('launch-link construction never yields /login/login', () => {
    for (const raw of [
      'https://whitelabel-lms-opal.vercel.app',
      'https://whitelabel-lms-opal.vercel.app/',
      'https://whitelabel-lms-opal.vercel.app/login',
      'https://whitelabel-lms-opal.vercel.app/login/',
    ]) {
      const base = normalizeDemoUrl(raw);
      assert.ok(base, `expected a usable base for ${raw}`);
      assert.equal(`${base}/login`, 'https://whitelabel-lms-opal.vercel.app/login');
    }
  });

  it('surrounding whitespace is ignored', () => {
    assert.equal(normalizeDemoUrl('  https://whitelabel-lms-opal.vercel.app/login  '), 'https://whitelabel-lms-opal.vercel.app');
  });

  it('non-https origins are rejected', () => {
    assert.equal(normalizeDemoUrl('http://whitelabel-lms-opal.vercel.app'), undefined);
    assert.equal(normalizeDemoUrl('http://whitelabel-lms-opal.vercel.app/login'), undefined);
  });

  it('empty and unparsable values fail safe to undefined', () => {
    assert.equal(normalizeDemoUrl(''), undefined);
    assert.equal(normalizeDemoUrl('   '), undefined);
    assert.equal(normalizeDemoUrl('not-a-url'), undefined);
    assert.equal(normalizeDemoUrl('https://'), undefined);
  });

  it('production demo URL never falls back to localhost', () => {
    const base = normalizeDemoUrl('https://whitelabel-lms-opal.vercel.app/login');
    assert.ok(base && !base.includes('localhost'));
  });
});
