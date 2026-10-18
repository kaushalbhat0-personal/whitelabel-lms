/**
 * First-admin SQL template (operator-controlled convenience, NOT a new mechanism).
 *
 * Security boundaries (non-negotiable):
 *   - No public signup endpoint is created. No bootstrap endpoint is created.
 *   - No passwords or credentials appear anywhere in this output.
 *   - The `id` MUST equal the Supabase Auth user's UID (PK + FK to auth.users).
 *   - Columns are pinned to 001_initial_schema.sql: id, name, email, role,
 *     is_active, must_change_password. phone/zoom_user_id stay NULL.
 *   - Procedure unchanged: create Auth user in dashboard FIRST, then run this.
 */

export interface FirstAdminParams {
  /** Supabase Auth user UID (UUID) — copy from Authentication → Users. */
  authUid: string;
  adminEmail: string;
  adminName: string;
  /** true = force a password change on first login (recommended). */
  mustChangePassword?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function sqlQuote(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

export function buildFirstAdminSql(params: FirstAdminParams): string {
  const { authUid, adminEmail, adminName, mustChangePassword = true } = params;
  if (!UUID_RE.test(authUid)) {
    throw new Error(`authUid must be the Supabase Auth user UUID. Received: "${authUid}"`);
  }
  if (!EMAIL_RE.test(adminEmail)) {
    throw new Error(`adminEmail must be a valid email. Received: "${adminEmail}"`);
  }
  if (!adminName || adminName.trim().length === 0) {
    throw new Error('adminName is required.');
  }
  return [
    '-- ============================================================================',
    '-- FIRST ADMIN — run ONLY AFTER creating the Auth user in the Supabase dashboard',
    '-- (Authentication → Users → Add user → copy the UID into <AUTH_UID> below).',
    `-- Admin: ${adminName} <${adminEmail}>`,
    '-- No passwords here. Rotate to a client-chosen password immediately after login.',
    '-- ============================================================================',
    '',
    'INSERT INTO public.profiles (id, name, email, role, is_active, must_change_password)',
    'VALUES (',
    `  ${sqlQuote(authUid)},`,
    `  ${sqlQuote(adminName)},`,
    `  ${sqlQuote(adminEmail)},`,
    `  'admin',`,
    '  true,',
    `  ${mustChangePassword ? 'true' : 'false'}`,
    ');',
    '',
  ].join('\n');
}

/** Placeholder version written by `generate` (UID unknown until dashboard step). */
export function buildFirstAdminTemplate(adminEmail: string, adminName: string): string {
  return [
    '-- ============================================================================',
    '-- FIRST ADMIN TEMPLATE — RUN ONLY AFTER CREATING THE AUTH USER',
    '-- 1. Supabase dashboard → Authentication → Users → Add user (auto-confirm ON).',
    `-- 2. Replace <PASTE-AUTH-USER-UUID> with the new user's UID, then run.`,
    `-- 3. Or regenerate with real values: pnpm factory first-admin --uid <UID> --email ${adminEmail} --name "${adminName}"`,
    '-- ============================================================================',
    '',
    'INSERT INTO public.profiles (id, name, email, role, is_active, must_change_password)',
    'VALUES (',
    '  \'<PASTE-AUTH-USER-UUID>\',',
    `  '${adminName.replace(/'/g, "''")}',`,
    `  '${adminEmail}',`,
    `  'admin',`,
    '  true,',
    '  true',
    ');',
    '',
  ].join('\n');
}
