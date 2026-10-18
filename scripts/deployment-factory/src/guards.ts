/**
 * Client isolation guards — make it hard to ship the wrong config to a client.
 *
 * Why this file exists:
 *   - The factory is stateless (no central client database by design), so it
 *     cannot know every previous client. It CAN reject values that are never
 *     valid in a production client config: demo content, localhost origins,
 *     documentation-reserved domains, and the repo's own default fallbacks.
 *   - Operators can additionally pass previously-used domains via
 *     --known-domains to catch accidental reuse.
 */

const DEMO_BUSINESS_NAMES = new Set(
  [
    'demo organization',
    'demo',
    'test organization',
    'test',
    'lms platform', // repo DEFAULT_BUSINESS_NAME — never a real client name
    'dhanlabh with shubh', // legacy bulk-upload template course name in repo
    'example',
  ].map((s) => s.toLowerCase()),
);

/** Domains/hosts that are never valid in a client config. */
const RESERVED_HOSTS_EXACT = new Set(['localhost', '127.0.0.1', '::1']);

/** Domains reserved for documentation/testing — never valid for a client. */
const RESERVED_DOMAIN_SUFFIXES = ['example.com', 'example.org', 'example.net', '.invalid', '.test', '.localhost'];

/** Emails that obviously came from a template and were never replaced. */
const PLACEHOLDER_EMAIL_LOCALS = new Set(['hello', 'admin', 'support', 'info', 'test', 'demo']);

export interface GuardFinding {
  code: string;
  message: string;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isReservedHost(host: string): boolean {
  if (RESERVED_HOSTS_EXACT.has(host)) return true;
  return RESERVED_DOMAIN_SUFFIXES.some((s) => host === s || host.endsWith(s));
}

/**
 * Inspect a raw parsed config for demo/placeholder/cross-client-reuse signals.
 * Returns findings (each is a validation error — guards are blocking).
 */
export function isolationGuards(config: Record<string, any>, knownDomains: string[] = []): GuardFinding[] {
  const findings: GuardFinding[] = [];

  const businessName = String(config?.identity?.businessName ?? '').trim();
  if (businessName && DEMO_BUSINESS_NAMES.has(businessName.toLowerCase())) {
    findings.push({
      code: 'DEMO_BUSINESS_NAME',
      message:
        `identity.businessName is a demo/placeholder value: "${businessName}". ` +
        `Replace with the client's real registered business name.`,
    });
  }

  const urlsToCheck: Array<[string, string]> = [
    ['identity.logoUrl', config?.identity?.logoUrl],
    ['identity.faviconUrl', config?.identity?.faviconUrl],
    ['identity.signatureUrl', config?.identity?.signatureUrl],
    ['identity.website', config?.identity?.website],
    ['deployment.frontendDomain', config?.deployment?.frontendDomain],
    ['deployment.apiDomain', config?.deployment?.apiDomain],
  ];
  for (const [field, value] of urlsToCheck) {
    if (typeof value !== 'string' || value.length === 0) continue;
    const host = hostOf(value);
    if (host && isReservedHost(host)) {
      findings.push({
        code: 'RESERVED_DOMAIN',
        message:
          `${field} uses documentation-reserved host "${host}". ` +
          `Replace with the client's real domain. Received: "${value}"`,
      });
    }
    if (host && (host === 'localhost' || host.startsWith('localhost:') || host === '127.0.0.1')) {
      findings.push({
        code: 'LOCALHOST_ORIGIN',
        message:
          `${field} points at localhost ("${value}"). ` +
          `Client deployments must use real HTTPS origins. Localhost is never valid here.`,
      });
    }
  }

  const emailsToCheck: Array<[string, string]> = [
    ['identity.supportEmail', config?.identity?.supportEmail],
    ['identity.email', config?.identity?.email],
    ['admin.email', config?.admin?.email],
  ];
  for (const [field, value] of emailsToCheck) {
    if (typeof value !== 'string' || !value.includes('@')) continue;
    const [local, domain] = value.toLowerCase().split('@');
    if (domain && isReservedHost(domain)) {
      findings.push({
        code: 'RESERVED_EMAIL_DOMAIN',
        message: `${field} uses documentation-reserved domain "${domain}". Replace with the client's real mailbox.`,
      });
    }
    if (domain === 'example.com' && PLACEHOLDER_EMAIL_LOCALS.has(local)) {
      findings.push({
        code: 'PLACEHOLDER_EMAIL',
        message: `${field} looks like an unreplaced template value ("${value}"). Replace with the client's real mailbox.`,
      });
    }
  }

  if (knownDomains.length > 0) {
    const known = new Set(
      knownDomains.map((d) => d.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')),
    );
    for (const field of ['frontendDomain', 'apiDomain'] as const) {
      const raw = String(config?.deployment?.[field] ?? '');
      const host = hostOf(raw) ?? raw.toLowerCase().replace(/\/$/, '');
      if (host && known.has(host)) {
        findings.push({
          code: 'DOMAIN_REUSE',
          message:
            `deployment.${field} ("${raw}") matches a previously-used client domain. ` +
            `Each client needs isolated infrastructure — confirm this is not another client's domain.`,
        });
      }
    }
  }

  return findings;
}
