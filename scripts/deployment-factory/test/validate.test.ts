/**
 * Focused tests: client config validation.
 * Run: pnpm factory:test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { validateClientConfig } from '../src/validate';

function acme(): any {
  const p = path.join(__dirname, '..', 'examples', 'acme-learning-academy.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function fields(errors: { field: string }[]): string[] {
  return errors.map((e) => e.field);
}

describe('validateClientConfig', () => {
  it('accepts the valid Acme client', () => {
    assert.deepEqual(validateClientConfig(acme()), []);
  });

  it('rejects missing required fields', () => {
    const c = acme();
    delete c.identity.businessName;
    delete c.localization;
    delete c.tax;
    const errs = validateClientConfig(c);
    assert.ok(fields(errs).includes('identity.businessName'));
    assert.ok(fields(errs).includes('localization'));
    assert.ok(fields(errs).includes('tax'));
  });

  it('rejects invalid locale/timezone/currency/fyStartMonth', () => {
    const c = acme();
    c.localization.locale = 'not a locale!!!';
    c.localization.timezone = 'Mars/Olympus';
    c.localization.currency = 'usd';
    c.localization.fyStartMonth = 12;
    const f = fields(validateClientConfig(c));
    assert.ok(f.includes('localization.locale'));
    assert.ok(f.includes('localization.timezone'));
    assert.ok(f.includes('localization.currency'));
    assert.ok(f.includes('localization.fyStartMonth'));
  });

  it('rejects invalid tax mode/rate and zero-mode mismatch', () => {
    const c = acme();
    c.tax.mode = 'sometimes';
    c.tax.rate = 101;
    const f = fields(validateClientConfig(c));
    assert.ok(f.includes('tax.mode'));
    assert.ok(f.includes('tax.rate'));

    const c2 = acme();
    c2.tax.mode = 'zero';
    c2.tax.rate = 5;
    assert.ok(fields(validateClientConfig(c2)).includes('tax.rate'));
  });

  it('rejects non-hex theme values with an actionable message', () => {
    const c = acme();
    c.theme.primary = 'blue';
    const errs = validateClientConfig(c);
    assert.ok(fields(errs).includes('theme.primary'));
    assert.ok(errs.find((e) => e.field === 'theme.primary')!.message.includes('#RRGGBB'));
  });

  it('rejects unknown fields anywhere', () => {
    const c = acme();
    c.bogus = 1;
    c.theme.neon = '#ffffff';
    c.providers.sms = true;
    const f = fields(validateClientConfig(c));
    assert.ok(f.includes('bogus'));
    assert.ok(f.includes('theme.neon'));
    assert.ok(f.includes('providers.sms'));
  });

  it('rejects trailing slashes and identical frontend/api origins', () => {
    const c = acme();
    c.deployment.frontendDomain = 'https://learn.acmelearningacademy.com/';
    assert.ok(fields(validateClientConfig(c)).includes('deployment.frontendDomain'));

    const c2 = acme();
    c2.deployment.apiDomain = c2.deployment.frontendDomain;
    assert.ok(fields(validateClientConfig(c2)).includes('deployment.apiDomain'));
  });

  it('rejects localhost origins', () => {
    const c = acme();
    c.deployment.apiDomain = 'http://localhost:3001';
    assert.ok(fields(validateClientConfig(c)).some((f) => f.includes('deployment.apiDomain')));
  });

  it('rejects demo business names and reserved domains', () => {
    const c = acme();
    c.identity.businessName = 'Demo Organization';
    assert.ok(fields(validateClientConfig(c)).some((f) => f.includes('DEMO_BUSINESS_NAME')));

    const c2 = acme();
    c2.deployment.frontendDomain = 'https://learn.example.com';
    assert.ok(fields(validateClientConfig(c2)).some((f) => f.includes('RESERVED_DOMAIN')));
  });

  it('rejects non-objects and bad deployment ids', () => {
    assert.ok(validateClientConfig(null).length > 0);
    assert.ok(validateClientConfig([]).length > 0);
    const c = acme();
    c.client.deploymentId = 'Acme 2026!!';
    assert.ok(fields(validateClientConfig(c)).includes('client.deploymentId'));
  });

  it('flags known-domain reuse when provided', () => {
    const c = acme();
    const errs = validateClientConfig(c, { knownDomains: ['https://learn.acmelearningacademy.com'] });
    assert.ok(fields(errs).some((f) => f.includes('DOMAIN_REUSE')));
  });
});
