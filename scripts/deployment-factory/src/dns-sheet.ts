/**
 * DNS instruction sheet generator.
 *
 * Why this file exists:
 *   - DNS values are platform-assigned (Vercel/Render show the exact targets in
 *     their dashboards), so the factory must NEVER invent record targets.
 *     Unknown values are explicit <COPY FROM ...> placeholders.
 *   - The operator gets a precise per-client sheet instead of figuring out
 *     records from memory. Execution stays manual + client-approved.
 *   - DNS changes are never automated by this tool.
 */

import type { ClientConfig } from './types';

export function buildDnsSheet(config: ClientConfig): string {
  const frontend = new URL(config.deployment.frontendDomain);
  const api = new URL(config.deployment.apiDomain);
  const lines: string[] = [
    `# DNS setup — ${config.client.name} (${config.client.deploymentId})`,
    '',
    'Execution is MANUAL and requires client/domain-owner approval.',
    'Verify each row with the command shown, then tick it off.',
    '',
    '## 1. Frontend (Vercel)',
    '',
    `Served at: \`${config.deployment.frontendDomain}\``,
    '',
    '| Host | Type | Value |',
    '|---|---|---|',
    '| (apex or subdomain per registrar) | PLATFORM_DEFINED | `<COPY FROM Vercel dashboard → Domains>` |',
    '',
    'Vercel assigns the exact record (A 76.76.21.21 for apex, or CNAME cname.vercel-dns.com).',
    'Copy it from the project → Settings → Domains panel. Do not guess.',
    '',
    'Verify:',
    '```',
    `nslookup ${frontend.hostname}`,
    '```',
    '- [ ] Frontend domain resolves and serves the LMS (HTTPS, valid cert)',
    '',
    '## 2. API (Render)',
    '',
    `Served at: \`${config.deployment.apiDomain}\``,
    '',
    '| Host | Type | Value |',
    '|---|---|---|',
    `| ${api.hostname.split('.')[0]} | CNAME | \`<COPY FROM Render dashboard → Custom Domains>\` |`,
    '',
    'Add the custom domain in Render first, then create the CNAME at the registrar.',
    '',
    'Verify:',
    '```',
    `nslookup ${api.hostname}`,
    `curl -s -o /dev/null -w "%{http_code}" ${config.deployment.apiDomain}/health   # expect 200`,
    '```',
    '- [ ] API domain resolves; /health returns 200',
    '',
  ];

  if (config.providers.email === 'resend') {
    lines.push(
      '## 3. Email sender domain (Resend)',
      '',
      `Sender: \`${config.identity.supportEmail}\``,
      '',
      '| Host | Type | Value |',
      '|---|---|---|',
      '| (provided by Resend) | TXT (SPF/DKIM) | `<COPY FROM Resend dashboard → Domains>` |',
      '',
      'Domain must be verified in Resend BEFORE production mail. Until then the app',
      'runs in STUB MODE (logged, not sent) — that is expected, not a failure.',
      '',
      '- [ ] Sender domain verified in Resend (or explicitly deferred)',
      '',
    );
  } else {
    lines.push(
      '## 3. Email sender domain — SKIPPED (providers.email=none)',
      '',
      'Resend deferred. App runs in STUB MODE. Revisit when the client buys email.',
      '',
    );
  }

  lines.push(
    '## 4. Post-DNS application checks',
    '',
    `- [ ] Render FRONTEND_URL equals exactly \`${config.deployment.frontendDomain}\` (no trailing slash)`,
    `- [ ] Vercel NEXT_PUBLIC_API_URL equals exactly \`${config.deployment.apiDomain}\` (redeployed after change)`,
    `- [ ] Run the factory origin check: \`pnpm factory validate <config>\` (origin rules included)`,
    '',
  );

  return lines.join('\n');
}
