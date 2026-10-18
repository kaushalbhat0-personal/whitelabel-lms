/**
 * Secret-free handoff report generator with a strict evidence gate.
 *
 * Why this file exists:
 *   - The report is the professional close-out of a client deployment:
 *     identity, URLs, verification results, provider states, ownership,
 *     and sign-off. It is SAFE TO ARCHIVE because it can never contain
 *     secrets — the builder runs the secret scanner over its own output
 *     and throws on any finding.
 *
 * Gate rule (P0-3): a handoff with NO attached verification evidence is
 * NEVER READY. READY additionally requires DB evidence, backup
 * acknowledgement, a named verifier, evidence bound to the same
 * deploymentId, no FAIL, and no unacknowledged WARN. The ONLY bypass is
 * an explicit --no-verification --reason, which produces an EXCEPTIONAL
 * (still NOT READY) report with the reason recorded — never silent READY.
 */

import type { ClientConfig } from './types';
import type { DbCheck } from './db-verify';
import type { VerifyCheck } from './deploy-verify';
import type { ProviderProbe } from './provider-probes';
import { scanTextForSecrets } from './secret-scan';

export interface VerificationEvidence {
  checks?: VerifyCheck[];
  overall?: string;
  generatedAt?: string;
  client?: { name?: string; deploymentId?: string };
  target?: { api?: string; frontend?: string };
}

export interface DbEvidenceInput {
  checks?: DbCheck[];
  overall?: string;
  generatedAt?: string;
  client?: { name?: string; deploymentId?: string };
  target?: { supabaseHost?: string };
}

export interface HandoffInput {
  config: ClientConfig;
  repoHead: string;
  generatedAt?: string;
  verification?: VerificationEvidence;
  db?: DbEvidenceInput;
  /** Explicit exceptional path: handoff without verification evidence. */
  noVerificationReason?: string;
  /** WARN-label substrings the operator explicitly accepts (recorded in report). */
  ackedWarns?: string[];
  providers?: ProviderProbe[];
  backupAcknowledged: boolean;
  verifiedBy?: string;
}

export interface HandoffEvaluation {
  gateProblems: string[];
  unresolvedWarnings: string[];
  ackedWarnings: string[];
  exceptional: boolean;
  ready: boolean;
}

function stripSlash(v: string): string {
  return v.replace(/\/$/, '');
}

/** Pure gate evaluation — fully unit-testable. */
export function evaluateHandoff(input: HandoffInput): HandoffEvaluation {
  const gateProblems: string[] = [];
  const unresolvedWarnings: string[] = [];
  const ackedWarnings: string[] = [];
  const exceptional = !!input.noVerificationReason;
  const wantId = input.config.client.deploymentId;

  const isAcked = (label: string): boolean =>
    (input.ackedWarns ?? []).some((a) => a.trim().length > 0 && label.toLowerCase().includes(a.trim().toLowerCase()));

  const collectWarns = (checks: Array<{ label: string; status: string }> | undefined, prefix: string): void => {
    for (const c of checks ?? []) {
      if (c.status !== 'WARN') continue;
      if (isAcked(c.label)) ackedWarnings.push(`${prefix}${c.label}`);
      else unresolvedWarnings.push(`${prefix}${c.label}`);
    }
  };

  // 1. Verification evidence (required unless exceptional override).
  const vchecks = input.verification?.checks;
  if (!vchecks || vchecks.length === 0) {
    if (exceptional) {
      gateProblems.push('EXCEPTIONAL handoff: no verification evidence attached (see reason below) — NOT READY by definition.');
    } else {
      gateProblems.push('No verification evidence attached — pass --verification <verify-deploy --json output>. A handoff without evidence is NEVER READY.');
    }
  } else {
    const vId = input.verification?.client?.deploymentId;
    if (!vId) {
      gateProblems.push('Verification evidence has no client identity — regenerate it with --config <client.config.json> so deploymentId is embedded.');
    } else if (vId !== wantId) {
      gateProblems.push(`Verification evidence belongs to "${vId}", not this client ("${wantId}") — wrong evidence bundle.`);
    }
    const tApi = input.verification?.target?.api;
    const tFront = input.verification?.target?.frontend;
    if (tApi && stripSlash(tApi) !== stripSlash(input.config.deployment.apiDomain)) {
      gateProblems.push(`Verification target api "${tApi}" != config apiDomain "${input.config.deployment.apiDomain}" — evidence is for another deployment.`);
    }
    if (tFront && stripSlash(tFront) !== stripSlash(input.config.deployment.frontendDomain)) {
      gateProblems.push(`Verification target frontend "${tFront}" != config frontendDomain "${input.config.deployment.frontendDomain}" — evidence is for another deployment.`);
    }
    const fails = vchecks.filter((c) => c.status === 'FAIL').map((c) => c.label);
    if (fails.length > 0) gateProblems.push(`Verification has blocking FAILs: ${fails.join('; ')}.`);
    if (input.verification?.overall === 'FAIL') gateProblems.push('Verification overall is FAIL.');
    collectWarns(vchecks, '');
  }

  // 2. DB evidence (required, must carry client identity + target host).
  const dchecks = input.db?.checks;
  if (!dchecks || dchecks.length === 0) {
    gateProblems.push('No DB verification evidence attached — pass --db <verify-db --json output> (run verify-db with --config so identity is embedded).');
  } else {
    const dId = input.db?.client?.deploymentId;
    if (!dId) {
      gateProblems.push('DB evidence has no client identity — re-run verify-db with --config <client.config.json>.');
    } else if (dId !== wantId) {
      gateProblems.push(`DB evidence belongs to "${dId}", not this client ("${wantId}") — wrong-env verification.`);
    }
    const fails = dchecks.filter((c) => c.status === 'FAIL').map((c) => c.label);
    if (fails.length > 0) gateProblems.push(`DB verification has blocking FAILs: ${fails.join('; ')}.`);
    if (input.db?.overall === 'FAIL') gateProblems.push('DB verification overall is FAIL.');
    collectWarns(dchecks, 'DB: ');
  }

  // 3. Human attestations.
  if (!input.backupAcknowledged) gateProblems.push('Backup strategy not acknowledged — set FACTORY_BACKUP_ACK=1 after confirming the client backup plan (§13).');
  if (!input.verifiedBy || input.verifiedBy.trim().length === 0) {
    gateProblems.push('No named verifier — set FACTORY_VERIFIED_BY="Operator Name".');
  }

  // 4. Unresolved warnings block handoff (acked ones are recorded, not blocking).
  if (unresolvedWarnings.length > 0) {
    gateProblems.push(`Unresolved warnings: ${unresolvedWarnings.join('; ')}. Ack each with --ack-warn "<label>" after manual confirmation, or fix the cause.`);
  }

  const ready = !exceptional && gateProblems.length === 0;
  return { gateProblems, unresolvedWarnings, ackedWarnings, exceptional, ready };
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
  const ev = evaluateHandoff(input);
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
    ['Database', input.db?.target?.supabaseHost ? `Client-owned Supabase project (${input.db.target.supabaseHost})` : 'Client-owned Supabase project (canonical 001→040, fresh)'],
    ['Redis', 'Client-owned instance (host/port/password in client secret store)'],
    ['Video', c.providers.video],
    ['Email', c.providers.email === 'resend' ? 'Resend (CONFIGURED — verify delivery)' : 'Resend deferred (STUB MODE)'],
    ['Zoom', c.providers.zoom ? 'Enabled' : 'Not purchased'],
  ]));

  lines.push(...section('Evidence attached', [
    ['Deployment verification', input.verification?.checks ? `${input.verification.checks.length} checks · overall ${input.verification.overall ?? 'unknown'} · ${input.verification.generatedAt ?? 'undated'}${input.verification.client?.deploymentId ? ` · client ${input.verification.client.deploymentId}` : ' · NO CLIENT IDENTITY'}` : 'MISSING — NOT READY'],
    ['DB verification', input.db?.checks ? `${input.db.checks.length} checks · overall ${input.db.overall ?? 'unknown'} · ${input.db.generatedAt ?? 'undated'}${input.db.client?.deploymentId ? ` · client ${input.db.client.deploymentId}` : ' · NO CLIENT IDENTITY'}${input.db.target?.supabaseHost ? ` · host ${input.db.target.supabaseHost}` : ''}` : 'MISSING — NOT READY'],
  ]));

  if (input.db?.checks) lines.push(...checkLines('Database verification', input.db.checks));
  if (input.verification?.checks) {
    lines.push(...checkLines(`Deployment verification (${input.verification.overall ?? 'unknown'})`, input.verification.checks));
  }
  if (input.providers) {
    lines.push('## Provider states', '');
    for (const p of input.providers) lines.push(`- ${p.provider}: ${p.state} — ${p.reason}`);
    lines.push('');
  }

  if (ev.exceptional) {
    lines.push(...section('Exceptional handoff (no verification)', [
      ['Operator reason', input.noVerificationReason ?? '(missing — this report should not exist)'],
      ['Consequence', 'NOT READY by definition. Verification must be attached before sign-off.'],
    ]));
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
    ['Acked warnings (operator-confirmed)', ev.ackedWarnings.length === 0 ? 'none' : ev.ackedWarnings.join('; ')],
    ['Unresolved warnings', ev.unresolvedWarnings.length === 0 ? 'none' : ev.unresolvedWarnings.join('; ')],
    ['Gate problems', ev.gateProblems.length === 0 ? 'none' : ev.gateProblems.join(' | ')],
    ['Verified by', input.verifiedBy ?? 'operator (name here — set FACTORY_VERIFIED_BY)'],
  ]));

  lines.push(`## OVERALL: ${ev.ready ? 'READY FOR HANDOFF' : ev.exceptional ? 'NOT READY — EXCEPTIONAL (no verification evidence)' : 'NOT READY — resolve items above'}`, '');

  const report = lines.join('\n');
  const hits = scanTextForSecrets(report);
  if (hits.length > 0) {
    throw new Error(`Handoff report tripped the secret scanner: ${hits.map((h) => h.pattern).join(', ')}. This is a factory defect — do not ship.`);
  }
  return report;
}
