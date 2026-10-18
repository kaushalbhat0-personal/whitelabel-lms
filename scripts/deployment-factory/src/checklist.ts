/**
 * Per-client operator checklist generator.
 *
 * Follows docs/deployment.md (the canonical runbook) phase by phase.
 * Each step names the action + expected result + where the detail lives.
 * The checklist is a pointer, not a duplicate — deep instructions stay in the
 * runbook so the two can never contradict each other.
 */

import type { ClientConfig } from './types';

interface Step {
  phase: string;
  action: string;
  expected: string;
  ref: string;
  warn?: string;
}

const STEPS: Step[] = [
  { phase: '0. Pre-flight', action: 'Run `pnpm factory preflight` on the operator machine', expected: 'Node 20+, pnpm 8+, clean git state, 001→040 contiguous, generated SQL hash matches', ref: 'docs/deployment.md §0', warn: 'Dirty git state is a WARN, not a fail — reconcile with the repo owner before proceeding.' },
  { phase: '1. Client configuration', action: 'Run `pnpm factory validate <config>`; fix every error', expected: 'VALID (dem/demo/localhost guards included)', ref: 'factory README' },
  { phase: '2. Artifact generation', action: 'Run `pnpm factory generate <config> --out deployment-output/<id> --confirm <id>`', expected: 'ENV templates, BusinessConfig payload, first-admin SQL, DNS sheet, checklist — secret scan passes', ref: 'factory README' },
  { phase: '3. Supabase project', action: 'Create client-owned Supabase project; confirm public schema is empty', expected: 'ACTIVE_HEALTHY, no LMS tables yet', ref: 'docs/deployment.md §1 steps 1–2' },
  { phase: '4. Database init', action: '`pnpm db:generate`, paste complete fresh-supabase-init.sql (001→040) into SQL Editor, run', expected: 'Success, no errors', ref: 'docs/deployment.md §1 steps 3–4', warn: 'If the editor rejects the ~129 KB paste, split strictly on -- Migration: NNN_ headers.' },
  { phase: '5. Database verification', action: 'Run `pnpm factory verify-db` (SUPABASE_URL + SERVICE_ROLE_KEY from operator env)', expected: 'All checks PASS; RLS item may be WARN (needs SQL-Editor query)', ref: 'docs/deployment.md §1 verification queries' },
  { phase: '6. Redis', action: 'Provision client-owned Redis (managed host or Upstash); record host/port/password', expected: 'Credentials in client secret store; connectivity proven by later login check', ref: 'docs/deployment.md §2', warn: 'Health stays green without Redis by design — login is the real Redis test.' },
  { phase: '7. Render API', action: 'Create service (root apps/api, build/start commands, PUPPETEER_CACHE_DIR, health /health); paste Render ENV template values', expected: 'GET /health → 200', ref: 'docs/deployment.md §3 + §5' },
  { phase: '8. Vercel web', action: 'Create project (Root Directory apps/web); set 3 NEXT_PUBLIC_* vars; deploy', expected: 'Site renders; any env change → redeploy', ref: 'docs/deployment.md §4 + §5' },
  { phase: '9. DNS', action: 'Follow the generated DNS sheet; client approves each record', expected: 'Frontend + API resolve with valid certs; exact-origin match with ENV', ref: 'generated dns-sheet.md' },
  { phase: '10. First admin', action: 'Create Auth user in dashboard → run generated first-admin.sql → login → rotate password', expected: 'Admin login works; invalid credentials → 401 (not 500)', ref: 'docs/deployment.md §12' },
  { phase: '11. BusinessConfig', action: 'PUT generated business-config.payload.json as the admin (UI or API)', expected: 'GET /business-config/public returns client brand; logged-out pages render brand', ref: 'docs/deployment.md §7' },
  { phase: '12. Providers', action: 'Configure per providers.* selection (or confirm deferred/stub)', expected: 'Enabled providers work; disabled ones fail loudly, never silently', ref: 'docs/deployment.md §8 + provider matrix' },
  { phase: '13. Verification', action: 'Run `pnpm factory verify-deploy --api <url> --frontend <url> --mode smoke` (then full with creds)', expected: 'PASS overall; evidence bundle archived', ref: 'docs/deployment.md §9' },
  { phase: '14. Handoff', action: 'Run `pnpm factory handoff`; transfer secrets via client-owned storage; collect sign-off', expected: 'Report READY FOR HANDOFF; backup acknowledged; no MicroNest credentials at runtime', ref: 'docs/deployment.md §10 + §13 + §15' },
];

export function buildChecklist(config: ClientConfig): string {
  const lines = [
    `# Deployment checklist — ${config.client.name} (${config.client.deploymentId})`,
    '',
    `Frontend: \`${config.deployment.frontendDomain}\` · API: \`${config.deployment.apiDomain}\``,
    '',
  ];
  for (const s of STEPS) {
    lines.push(`- [ ] **${s.phase}** — ${s.action}`);
    lines.push(`      Expected: ${s.expected} · Ref: ${s.ref}`);
    if (s.warn) lines.push(`      ⚠️ ${s.warn}`);
  }
  lines.push('');
  return lines.join('\n');
}
