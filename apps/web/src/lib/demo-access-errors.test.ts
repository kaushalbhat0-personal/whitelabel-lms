/*
 * Executable contract for the demo-access error copy map.
 * Run: pnpm --filter web exec tsx --test src/lib/demo-access-errors.test.ts
 * (relative import on purpose: no path aliases outside the Next.js build).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDemoAccessError,
  DEMO_COLD_START_TITLE,
  DEMO_COLD_START_BODY,
  DEMO_RATE_LIMIT_BODY,
  DEMO_DISABLED_BODY,
  DEMO_UNAVAILABLE_BODY,
} from './demo-access-errors.js';

const COLD = { kind: 'cold-start', title: DEMO_COLD_START_TITLE, message: DEMO_COLD_START_BODY };

describe('classifyDemoAccessError', () => {
  it('maps transport/timeout/parse failures (0/null) to the waking-up state', () => {
    assert.deepEqual(classifyDemoAccessError(0), COLD);
    assert.deepEqual(classifyDemoAccessError(null), COLD);
    assert.deepEqual(classifyDemoAccessError(0, 'fetch failed'), COLD);
    assert.deepEqual(classifyDemoAccessError(0, 'Unexpected token < in JSON'), COLD);
  });

  for (const status of [408, 502, 504]) {
    it(`maps ${status} to the waking-up state`, () => {
      assert.deepEqual(classifyDemoAccessError(status), COLD);
    });
  }

  it('maps proxy/startup 503 (foreign body) to the waking-up state', () => {
    assert.deepEqual(classifyDemoAccessError(503, 'Service Unavailable'), COLD);
    assert.deepEqual(classifyDemoAccessError(503, '<html>…</html>'), COLD);
    assert.deepEqual(classifyDemoAccessError(503), COLD);
  });

  it('maps own-API 503 (known neutral body) to generic unavailable, never cold-start', () => {
    const copy = classifyDemoAccessError(
      503,
      'Demo access is temporarily unavailable. Please try again later.',
    );
    assert.equal(copy.kind, 'unavailable');
    assert.equal(copy.title, undefined);
    assert.equal(copy.message, DEMO_UNAVAILABLE_BODY);
  });

  it('maps 429 to the rate-limit state with wait-before-retry copy', () => {
    const copy = classifyDemoAccessError(429);
    assert.equal(copy.kind, 'rate-limit');
    assert.equal(copy.message, DEMO_RATE_LIMIT_BODY);
  });

  it('maps 404 to the disabled state without config details', () => {
    const copy = classifyDemoAccessError(404);
    assert.equal(copy.kind, 'disabled');
    assert.equal(copy.message, DEMO_DISABLED_BODY);
  });

  it('maps unexpected statuses to generic unavailable', () => {
    for (const status of [400, 401, 403, 500]) {
      const copy = classifyDemoAccessError(status, 'boom');
      assert.equal(copy.kind, 'unavailable');
      assert.equal(copy.message, DEMO_UNAVAILABLE_BODY);
    }
  });

  it('never echoes response internals in any copy', () => {
    const sensitive = ['render', 'vercel', 'supabase', 'redis', 'secret', 'stack', '502', 'statusText'];
    const copies = [0, 404, 408, 429, 502, 503, 504, 500, null].map((s) =>
      classifyDemoAccessError(s, 'db connection refused (secret)'),
    );
    for (const copy of copies) {
      const text = `${copy.title ?? ''}\n${copy.message}`.toLowerCase();
      for (const word of sensitive) {
        assert.ok(!text.includes(word), `leaked "${word}" in ${copy.kind}`);
      }
    }
  });
});
