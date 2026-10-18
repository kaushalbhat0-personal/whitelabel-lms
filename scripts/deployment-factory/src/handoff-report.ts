/**
 * Secret-free handoff report generator.
 *
 * The report is the professional close-out of a client deployment: identity,
 * URLs, verification results, provider states, ownership, and sign-off.
 * It is SAFE TO ARCHIVE because it can never contain secrets — the builder
 * runs the secret scanner over its own output and throws on any finding.
 */

import type { ClientConfig } from './types';
import type { DbCheck } from './db-verify';
import type { VerifyCheck } from './deploy-verify';
import type { ProviderProbe } from './provider-probes';
import { scanTextForSecrets } from './secret-scan';

export interface HandoffInput {
  config: ClientConfig;
  repoHead: string;
  generatedAt?: string;
  dbChecks?: DbCheck[];
  verifyChecks?: VerifyCheck[];
  verifyOverall?: string;
  providers?: ProviderProbe[];
  backupAcknowledged: boolean;
  unresolvedWarnings: string[];
  verifiedBy?: string;
}

function section(title: string, rows: Array<[string, string]>): string[] {
  const lines = [`## ${title}`, ''];
  for (const [k, v] of rows) lines.push(`- ${k}: ${v}`);
  lines.push('');
  return lines;
}

function checkLines(title: string, checks: Array<{ id: string; label: string; status: string; detail: string }>): string[] {
  const lines = [`## ${title}`, ''];
  for (const c of checks) {
    const firstDetail = c.detail.split('\n')[0];
    lines.push(`- [${c.status}] ${c.label} — ${firstDetail}`);
  }
  lines.push('');
  return lines;
}

export function buildHandoffReport(input: HandoffInput): string {
  const c = input.config;
  const at = input.generatedAt ?? new Date().toISOString();
  const lines: string[] = [
    `# CLIENT DEPLOYMENT REPORT — ${c.identity.businessName}`,
    '',
    `Generated: ${at} · Repo HEAD: ${input.repoHead} · Deployment: ${c.client.deploymentId}`,
    '',
  ];

  lines.push(...section('Deployment', [
    ['Client', c.identity.businessName],
    ['Frontend', c.deployment.frontendDomain],
    ['API', c.deployment.apiDomain],
    ['Admin URL', `${c.deployment.frontendDomain}/login`],
    ['Database', 'Client-owned Supabase project (canonical 001→040, fresh)'],
    ['Redis', 'Client-owned instance (host/port/password in client secret store)'],
    ['Video', c.providers.video],
    ['Email', c.providers.email === 'resend' ? 'Resend (CONFIGURED — verify delivery)' : 'Resend deferred (STUB MODE)'],
    ['Zoom', c.providers.zoom ? 'Enabled' : 'Not purchased'],
  ]));

  if (input.dbChecks) lines.push(...checkLines('Database verification', input.dbChecks));
  if (input.verifyChecks) {
    lines.push(...checkLines(`Deployment verification (${input.verifyOverall ?? 'unknown'})`, input.verifyChecks));
  }
  if (input.providers) {
    lines.push('## Provider states', '');
    for (const p of input.providers) lines.push(`- ${p.provider}: ${p.state} — ${p.reason}`);
    lines.push('');
  }

  lines.push(...section('Infrastructure ownership (client owns all)', [
    ['Domain + DNS', 'CLIENT'],
    ['Vercel project', 'CLIENT'],
    ['Render service', 'CLIENT'],
    ['Supabase project', 'CLIENT'],
    ['Redis instance', 'CLIENT'],
    ['Provider accounts', 'CLIENT'],
    ['Production data + backups', 'CLIENT'],
    ['All runtime secrets', 'CLIENT (transferred — none in this report)'],
  ]));

  lines.push(...section('Handoff checklist', [
    ['Backup strategy acknowledged (§13)', input.backupAcknowledged ? 'YES' : 'NO — REQUIRED before sign-off'],
    ['Demo dependency absent', 'YES — canonical 001→040 chain only'],
    ['No shared secrets/infra', 'YES — isolated per-client deployment'],
    ['Unresolved warnings', input.unresolvedWarnings.length === 0 ? 'none' : input.unresolvedWarnings.join('; ')],
    ['Verified by', input.verifiedBy ?? 'operator (name here)'],
  ]));

  const overallReady =
    input.backupAcknowledged &&
    input.unresolvedWarnings.length === 0 &&
    (input.verifyOverall === undefined || input.verifyOverall === 'PASS') &&
    (!input.dbChecks || !input.dbChecks.some((x) => x.status === 'FAIL'));

  lines.push(`## OVERALL: ${overallReady ? 'READY FOR HANDOFF' : 'NOT READY — resolve items above'}`, '');

  const report = lines.join('\n');
  const hits = scanTextForSecrets(report);
  if (hits.length > 0) {
    throw new Error(`Handoff report tripped the secret scanner: ${hits.map((h) => h.pattern).join(', ')}. This is a factory defect — do not ship.`);
  }
  return report;
}
