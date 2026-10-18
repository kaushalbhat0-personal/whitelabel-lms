#!/usr/bin/env tsx
/**
 * Deployment factory CLI (local operator tool).
 *
 *   pnpm factory validate <config.json> [--known-domains a,b]
 *   pnpm factory generate <config.json> --out <dir> --confirm <deploymentId> [--known-domains a,b]
 *   pnpm factory gen-secret            # prints a JWT_SECRET candidate to STDOUT ONLY (never to a file)
 *   pnpm factory first-admin --uid <UUID> --email <e> --name <n> [--no-must-change-password]
 *   pnpm factory preflight
 *   pnpm factory verify-db              # env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   pnpm factory verify-deploy --api <url> --frontend <url> --mode smoke|full [--config <json>] [--json out.json]
 *                                       # full-mode creds ONLY via env: LMS_ADMIN_EMAIL/PASSWORD, LMS_STUDENT_EMAIL/PASSWORD,
 *                                       # LMS_SUPABASE_URL/ANON_KEY, LMS_INVOICE_ID, LMS_RECEIPT_ID, LMS_CERTIFICATE_TOKEN
 *   pnpm factory secret-scan <dir>
 *   pnpm factory handoff --config <json> --verification <json> [--db <json>] [--out report.md]
 *                                       # env: FACTORY_REPO_HEAD (optional), FACTORY_BACKUP_ACK=1, FACTORY_VERIFIED_BY=name
 *
 * Exit codes: 0 = PASS (warnings allowed), 1 = FAIL/error.
 * Secrets are never written to files and never printed (except gen-secret to stdout by explicit request).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ClientConfig } from './types';
import { validateClientConfig, formatErrors } from './validate';
import { buildRenderEnvTemplate, buildVercelEnvTemplate } from './env-templates';
import { buildBusinessConfigPayload } from './business-config';
import { buildFirstAdminSql, buildFirstAdminTemplate } from './first-admin-sql';
import { buildDnsSheet } from './dns-sheet';
import { buildChecklist } from './checklist';
import { scanArtifacts, scanTextForSecrets } from './secret-scan';
import { runPreflight, findRepoRoot } from './preflight';
import { fetchDbFacts, evaluateDbFacts, buildDbEvidence } from './db-verify';
import { verifyDeployment } from './deploy-verify';
import { probeProviders } from './provider-probes';
import { buildHandoffReport, evaluateHandoff } from './handoff-report';
import { pushBusinessConfig } from './push-config';
import { buildIntakeSkeleton, buildIntakeNotes } from './intake';
import { collectKnownDomains, knownDomainsExcluding, formatKnownDomains } from './known-domains';

function usage(): string {
  return [
    'Usage:',
    '  pnpm factory init <deploymentId> --out <config.json>',
    '  pnpm factory validate <config.json> [--known-domains a,b] [--check-output <dir>]',
    '  pnpm factory generate <config.json> --out <dir> --confirm <deploymentId> [--check-output <dir> | --no-check-output]',
    '  pnpm factory gen-secret',
    '  pnpm factory first-admin --uid <UUID> --email <e> --name <n>',
    '  pnpm factory preflight',
    '  pnpm factory push-config --config <json> --api <url> [--json out.json]',
    '       (env: LMS_ADMIN_EMAIL + LMS_ADMIN_PASSWORD — never on the command line)',
    '  pnpm factory verify-db [--config <json>] [--json out.json]   (env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)',
    '  pnpm factory verify-deploy --api <url> --frontend <url> --mode smoke|full [--config <json>] [--json out.json]',
    '  pnpm factory known-domains [--dir deployment-output]',
    '  pnpm factory secret-scan <dir>',
    '  pnpm factory handoff --config <json> --verification <json> --db <json> [--out report.md]',
    '       [--ack-warn "<label substring>" ...] [--no-verification --reason "<reason>"]',
    '       (env: FACTORY_REPO_HEAD (optional), FACTORY_BACKUP_ACK=1, FACTORY_VERIFIED_BY=name)',
  ].join('\n');
}

function argValue(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

/** Collect repeatable flags: --ack-warn a --ack-warn b → [a, b]. */
function argValues(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === name) out.push(args[i + 1]);
  }
  return out;
}

/**
 * Local domain-reuse discovery (no registry): merge explicitly passed
 * --known-domains with hosts found under a local output dir, excluding the
 * config's own deploymentId so regeneration never self-flags.
 */
function resolveKnownDomains(args: string[], raw: unknown, defaultDir: string | null): string[] {
  const explicit = (argValue(args, '--known-domains') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (args.includes('--no-check-output')) return explicit;
  const dir = argValue(args, '--check-output') ?? defaultDir;
  if (!dir || !fs.existsSync(dir)) return explicit;
  const selfId = (raw as Partial<ClientConfig>)?.client?.deploymentId ?? '';
  const discovered = knownDomainsExcluding(collectKnownDomains(dir), String(selfId ?? ''));
  return [...new Set([...explicit, ...discovered])];
}

/** Count <PLACEHOLDER> tokens in a template (operator paste workload). */
function placeholderCount(text: string): number {
  const m = text.match(/<[^<>\n]+>/g);
  return m ? m.length : 0;
}

function loadConfig(file: string): { config: ClientConfig; raw: unknown } {
  const text = fs.readFileSync(file, 'utf-8');
  const raw: unknown = JSON.parse(text);
  return { config: raw as ClientConfig, raw };
}

function main(): number | Promise<number> {
  const [, , cmd, ...args] = process.argv;
  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.log(usage());
    return 0;
  }

  if (cmd === 'gen-secret') {
    // Operator copies this into the Render dashboard + handover record. Never persisted.
    console.log(crypto.randomBytes(48).toString('base64'));
    return 0;
  }

  if (cmd === 'init') {
    const deploymentId = args[0];
    const out = argValue(args, '--out');
    if (!deploymentId || !out) {
      console.error(usage());
      return 1;
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(deploymentId)) {
      console.error(`INVALID: deploymentId must be kebab-case (e.g. "northstar-2026-01"). Received: "${deploymentId}"`);
      return 1;
    }
    if (fs.existsSync(out) && !args.includes('--force')) {
      console.error(`Refusing to overwrite existing "${out}" (pass --force to override).`);
      return 1;
    }
    fs.mkdirSync(path.dirname(out) === '' ? '.' : path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buildIntakeSkeleton(deploymentId), 'utf-8');
    // Companion intake notes next to the skeleton (same basename).
    const notesFile = out.replace(/\.json$/i, '') + '.INTAKE-NOTES.md';
    try {
      fs.writeFileSync(notesFile, buildIntakeNotes(deploymentId), 'utf-8');
    } catch {
      /* skeleton is the contract; notes are best-effort */
    }
    console.log(`Wrote intake skeleton → ${out}`);
    console.log(`Wrote intake notes    → ${notesFile}`);
    console.log('Placeholders deliberately FAIL validation (.invalid domains, TODO names) —');
    console.log('fill every TODO, then run: pnpm factory validate <config>');
    return 0;
  }

  if (cmd === 'validate') {
    const file = args[0];
    if (!file) {
      console.error(usage());
      return 1;
    }
    const { raw } = loadConfig(file);
    const known = resolveKnownDomains(args, raw, null);
    const errors = validateClientConfig(raw, { knownDomains: known });
    if (errors.length > 0) {
      console.error(formatErrors(errors));
      return 1;
    }
    console.log(`VALID — ${(raw as ClientConfig).client.name} (${(raw as ClientConfig).client.deploymentId})`);
    return 0;
  }

  if (cmd === 'generate') {
    const file = args[0];
    const out = argValue(args, '--out');
    const confirm = argValue(args, '--confirm');
    if (!file || !out) {
      console.error(usage());
      return 1;
    }
    const { config, raw } = loadConfig(file);
    const known = resolveKnownDomains(args, raw, 'deployment-output');
    const errors = validateClientConfig(raw, { knownDomains: known });
    if (errors.length > 0) {
      console.error(formatErrors(errors));
      return 1;
    }
    if (confirm !== config.client.deploymentId) {
      console.error(
        `Refusing to generate: pass --confirm ${config.client.deploymentId} to prove you are provisioning the intended client.\n` +
          `Client: ${config.client.name} (${config.client.deploymentId})`,
      );
      return 1;
    }
    if (fs.existsSync(out) && fs.readdirSync(out).length > 0 && !args.includes('--force')) {
      console.error(`Refusing to write into non-empty --out dir "${out}" (pass --force to override).`);
      return 1;
    }

    // Explicit admin identity wins; otherwise fall back to support contact.
    // The template NEVER silently prefers supportEmail when admin.* exists.
    const adminEmail = config.admin?.email ?? config.identity.supportEmail;
    const adminName = config.admin?.name ?? config.identity.businessName;

    const renderEnv = buildRenderEnvTemplate(config);
    const vercelEnv = buildVercelEnvTemplate(config);
    const artifacts: Record<string, string> = {
      'client-config.validated.json': JSON.stringify(raw, null, 2) + '\n',
      'render.env.template': renderEnv,
      'vercel.env.template': vercelEnv,
      'business-config.payload.json': JSON.stringify(buildBusinessConfigPayload(config), null, 2) + '\n',
      'first-admin.template.sql': buildFirstAdminTemplate(adminEmail, adminName),
      'dns-sheet.md': buildDnsSheet(config),
      'checklist.md': buildChecklist(config),
    };
    const scan = scanArtifacts(artifacts);
    const hits = scan.filter((s) => s.findings.length > 0);
    if (hits.length > 0) {
      console.error(`REFUSING TO WRITE — secret scanner tripped (factory defect): ${hits.map((h) => `${h.artifact}:${h.findings.map((f) => f.pattern).join(',')}`).join('; ')}`);
      return 1;
    }
    fs.mkdirSync(out, { recursive: true });
    for (const [name, text] of Object.entries(artifacts)) {
      fs.writeFileSync(path.join(out, name), text, 'utf-8');
    }
    console.log(`Generated ${Object.keys(artifacts).length} artifacts for ${config.client.name} → ${out}`);
    console.log('Secret scan: CLEAN. Next: follow checklist.md (dashboards stay manual).');
    // Bulk-paste assist: per-file placeholder workload (derived values need no edits).
    console.log('Paste workload (<...> tokens to replace per file):');
    for (const [name, text] of Object.entries(artifacts)) {
      if (name.endsWith('.template') || name.endsWith('.env.template')) {
        console.log(`  ${name}: ${placeholderCount(text)} placeholders — paste the whole block, replace every <...>.`);
      }
    }
    console.log('Derived values (no placeholder) are already correct — paste as-is.');
    return 0;
  }

  if (cmd === 'first-admin') {
    const uid = argValue(args, '--uid');
    const email = argValue(args, '--email');
    const name = argValue(args, '--name');
    if (!uid || !email || !name) {
      console.error(usage());
      return 1;
    }
    try {
      const sql = buildFirstAdminSql({ authUid: uid, adminEmail: email, adminName: name, mustChangePassword: !args.includes('--no-must-change-password') });
      process.stdout.write(sql);
      return 0;
    } catch (e) {
      console.error(`INVALID: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  }

  if (cmd === 'preflight') {
    const { checks, overall } = runPreflight(findRepoRoot(process.cwd()));
    for (const c of checks) console.log(`[${c.status}] ${c.label} — ${c.detail}`);
    console.log(`OVERALL: ${overall}`);
    return overall === 'FAIL' ? 1 : 0;
  }

  if (cmd === 'push-config') {
    const configFile = argValue(args, '--config');
    const api = argValue(args, '--api');
    const jsonOut = argValue(args, '--json');
    if (!configFile || !api) {
      console.error(usage());
      return 1;
    }
    // Credential safety: no credential flags exist. Anything resembling one is rejected loudly.
    for (const banned of ['--password', '--token', '--jwt', '--secret', '--api-key', '--apikey']) {
      if (args.includes(banned)) {
        console.error(`REFUSED: ${banned} is not a factory flag. Credentials come ONLY from LMS_ADMIN_EMAIL + LMS_ADMIN_PASSWORD env.`);
        return 1;
      }
    }
    const { config, raw } = loadConfig(configFile);
    const errors = validateClientConfig(raw);
    if (errors.length > 0) {
      console.error(formatErrors(errors));
      return 1;
    }
    return (async () => {
      let result;
      try {
        result = await pushBusinessConfig({
          apiUrl: api,
          config,
          adminEmail: process.env.LMS_ADMIN_EMAIL,
          adminPassword: process.env.LMS_ADMIN_PASSWORD,
        });
      } catch (e) {
        console.error(`INVALID: ${e instanceof Error ? e.message : String(e)}`);
        return 1;
      }
      // Secret-safety: evidence carries keys/counts/status only — scan before emit.
      const hits = scanTextForSecrets(JSON.stringify(result));
      if (hits.length > 0) {
        console.error(`REFUSING TO EMIT — push evidence tripped the secret scanner: ${hits.map((h) => h.pattern).join(',')}`);
        return 1;
      }
      console.log(`${result.ok ? 'PUSHED' : 'FAILED'} — ${result.detail}`);
      if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2));
      return result.ok ? 0 : 1;
    })();
  }

  if (cmd === 'known-domains') {
    const dir = argValue(args, '--dir') ?? 'deployment-output';
    const entries = collectKnownDomains(dir);
    if (entries.length === 0) {
      console.log(`No prior client configs found under "${dir}".`);
      return 0;
    }
    console.log(`Known client domains under "${dir}" (pass to validate/generate via --known-domains, or rely on auto-discovery):`);
    console.log(formatKnownDomains(entries, ''));
    return 0;
  }

  if (cmd === 'verify-db') {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error('Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the operator environment (never on the command line).');
      return 1;
    }
    const jsonOut = argValue(args, '--json');
    const configFile = argValue(args, '--config');
    let evidenceClient: { name: string; deploymentId: string } | undefined;
    if (configFile) {
      const { raw } = loadConfig(configFile);
      const errors = validateClientConfig(raw);
      if (errors.length > 0) {
        console.error(formatErrors(errors));
        return 1;
      }
      const cfg = raw as ClientConfig;
      evidenceClient = { name: cfg.identity.businessName, deploymentId: cfg.client.deploymentId };
    }
    return (async () => {
      const facts = await fetchDbFacts(url, key);
      const checks = evaluateDbFacts(facts);
      const evidence = buildDbEvidence(url, evidenceClient, checks);
      for (const c of checks) {
        console.log(`[${c.status}] ${c.label} — ${c.detail.split('\n')[0]}`);
        if (c.detail.includes('\n')) console.log(c.detail.split('\n').slice(1).join('\n'));
      }
      console.log(`Target: ${evidence.target.supabaseHost}${evidenceClient ? ` · Client: ${evidenceClient.name} (${evidenceClient.deploymentId})` : ' · (no --config: evidence carries no client identity — handoff will refuse it)'}`);
      console.log(`OVERALL: ${evidence.overall}`);
      if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(evidence, null, 2));
      return evidence.overall === 'FAIL' ? 1 : 0;
    })();
  }

  if (cmd === 'verify-deploy') {
    const api = argValue(args, '--api');
    const frontend = argValue(args, '--frontend');
    const mode = argValue(args, '--mode');
    const configFile = argValue(args, '--config');
    const jsonOut = argValue(args, '--json');
    if (!api || !frontend || (mode !== 'smoke' && mode !== 'full')) {
      console.error(usage());
      return 1;
    }
    let config: ClientConfig | undefined;
    if (configFile) {
      const { raw } = loadConfig(configFile);
      const errors = validateClientConfig(raw);
      if (errors.length > 0) {
        console.error(formatErrors(errors));
        return 1;
      }
      config = raw as ClientConfig;
    }
    return (async () => {
      const report = await verifyDeployment({
        apiUrl: api, frontendUrl: frontend, mode, config,
        adminEmail: process.env.LMS_ADMIN_EMAIL, adminPassword: process.env.LMS_ADMIN_PASSWORD,
        studentEmail: process.env.LMS_STUDENT_EMAIL, studentPassword: process.env.LMS_STUDENT_PASSWORD,
        supabaseUrl: process.env.LMS_SUPABASE_URL, supabaseAnonKey: process.env.LMS_SUPABASE_ANON_KEY,
        invoiceId: process.env.LMS_INVOICE_ID, receiptId: process.env.LMS_RECEIPT_ID,
        certificateToken: process.env.LMS_CERTIFICATE_TOKEN,
      });
      // Secret-safety: verification output must never carry credentials.
      const outText = JSON.stringify(report);
      const hits = scanTextForSecrets(outText);
      if (hits.length > 0) {
        console.error(`REFUSING TO EMIT — verification output tripped the secret scanner: ${hits.map((h) => h.pattern).join(',')}`);
        return 1;
      }
      for (const c of report.checks) console.log(`[${c.status}] ${c.label} — ${c.detail.split('\n')[0]}`);
      console.log(`OVERALL: ${report.overall} (${report.mode}, ${report.checks.length} checks)`);
      if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
      return report.overall === 'FAIL' ? 1 : 0;
    })();
  }

  if (cmd === 'secret-scan') {
    const dir = args[0];
    if (!dir) {
      console.error(usage());
      return 1;
    }
    const artifacts: Record<string, string> = {};
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isFile()) artifacts[f] = fs.readFileSync(p, 'utf-8');
    }
    const scan = scanArtifacts(artifacts);
    let bad = 0;
    for (const s of scan) {
      if (s.findings.length > 0) {
        bad++;
        console.log(`[!] ${s.artifact}: ${s.findings.map((f) => `${f.pattern}@L${f.line}`).join(', ')}`);
      }
    }
    console.log(bad === 0 ? `CLEAN — ${scan.length} files scanned.` : `FAILED — ${bad} files flagged.`);
    return bad === 0 ? 0 : 1;
  }

  if (cmd === 'handoff') {
    const configFile = argValue(args, '--config');
    const verificationFile = argValue(args, '--verification');
    const dbFile = argValue(args, '--db');
    const outFile = argValue(args, '--out');
    const noVerification = args.includes('--no-verification');
    const reason = argValue(args, '--reason');
    const ackedWarns = argValues(args, '--ack-warn');
    if (!configFile) {
      console.error(usage());
      return 1;
    }
    if (noVerification && (!reason || reason.trim().length === 0)) {
      console.error('REFUSED: --no-verification requires --reason "<non-empty reason>". It is recorded in the report, which stays NOT READY.');
      return 1;
    }
    const { raw } = loadConfig(configFile);
    const errors = validateClientConfig(raw);
    if (errors.length > 0) {
      console.error(formatErrors(errors));
      return 1;
    }
    const config = raw as ClientConfig;
    const verification = verificationFile ? JSON.parse(fs.readFileSync(verificationFile, 'utf-8')) : undefined;
    const db = dbFile ? JSON.parse(fs.readFileSync(dbFile, 'utf-8')) : undefined;
    const report = buildHandoffReport({
      config,
      repoHead: process.env.FACTORY_REPO_HEAD ?? 'unknown (set FACTORY_REPO_HEAD)',
      verification,
      db,
      noVerificationReason: noVerification ? String(reason) : undefined,
      ackedWarns,
      providers: probeProviders(config),
      backupAcknowledged: process.env.FACTORY_BACKUP_ACK === '1',
      verifiedBy: process.env.FACTORY_VERIFIED_BY,
    });
    const ev = evaluateHandoff({
      config,
      repoHead: process.env.FACTORY_REPO_HEAD ?? 'unknown',
      verification,
      db,
      noVerificationReason: noVerification ? String(reason) : undefined,
      ackedWarns,
      backupAcknowledged: process.env.FACTORY_BACKUP_ACK === '1',
      verifiedBy: process.env.FACTORY_VERIFIED_BY,
    });
    if (outFile) fs.writeFileSync(outFile, report, 'utf-8');
    else process.stdout.write(report);
    console.error(ev.ready ? 'HANDOFF: READY FOR HANDOFF' : `HANDOFF: NOT READY (${ev.gateProblems.length} gate problem(s))`);
    return 0;
  }

  console.error(`Unknown command: ${cmd}\n${usage()}`);
  return 1;
}

const result = main();
if (typeof result === 'number') {
  process.exit(result);
} else {
  result.then(
    (code) => process.exit(code),
    (e) => {
      console.error(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
