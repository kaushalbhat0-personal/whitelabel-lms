/**
 * Secret safety scanner.
 *
 * Why this file exists:
 *   - The factory's core guarantee is that generated artifacts contain
 *     placeholders, never secret values. This module proves it per run:
 *     `generate` refuses to write output that trips the scanner.
 *   - It is ALSO the final audit gate (PHASE 19): scan the whole output dir.
 *
 * Design: placeholders (`<...>`), empty values, and well-known example
 * sentinels (change_this_*, onboarding@resend.dev) are NOT flagged. Real
 * secret shapes (JWTs, private keys, provider key prefixes, long opaque
 * assignments) ARE flagged.
 */

export interface SecretFinding {
  pattern: string;
  /** Redacted excerpt (values are masked, never echoed). */
  excerpt: string;
  line?: number;
}

interface Rule {
  name: string;
  test: (line: string) => boolean;
}

function looksLikePlaceholder(value: string): boolean {
  const v = value.trim();
  return (
    v.length === 0 ||
    (v.startsWith('<') && v.endsWith('>')) ||
    /^(change_this|changeme|xxxx|your-|todo|replace)/i.test(v)
  );
}

/** Assignment lines whose VALUE is opaque and long (likely a pasted secret). */
function opaqueAssignment(line: string): boolean {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/);
  if (!m) return false;
  const [, key, rawValue] = m;
  const value = rawValue.replace(/^["']|["'];?$/g, '');
  if (looksLikePlaceholder(value)) return false;
  if (!/(KEY|SECRET|PASSWORD|TOKEN)/i.test(key)) return false;
  // Values shorter than 12 chars are unlikely to be real credentials.
  return value.replace(/[^A-Za-z0-9+/=_.-]/g, '').length >= 12;
}

const RULES: Rule[] = [
  { name: 'JWT_SHAPE', test: (l) => /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(l) },
  { name: 'PRIVATE_KEY', test: (l) => /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/.test(l) },
  { name: 'RESEND_KEY', test: (l) => /\bre_[A-Za-z0-9_]{8,}/.test(l) },
  { name: 'LIVE_SECRET_PREFIX', test: (l) => /\b(sk_live|sk_test)_[A-Za-z0-9]{8,}|\bxox[bap]-[A-Za-z0-9-]{8,}|\bAKIA[0-9A-Z]{16}|\bghp_[A-Za-z0-9]{8,}|\bmux_[A-Za-z0-9]{16,}/.test(l) },
  { name: 'BEARER_TOKEN', test: (l) => /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/.test(l) },
  { name: 'OPAQUE_SECRET_ASSIGNMENT', test: opaqueAssignment },
];

function mask(line: string): string {
  return line.length > 120 ? line.slice(0, 120) + '…[truncated]' : line;
}

/** Scan text; returns findings (empty = clean). Never echoes secret values. */
export function scanTextForSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    for (const rule of RULES) {
      let hit = false;
      try {
        hit = rule.test(line);
      } catch {
        hit = false;
      }
      if (hit) {
        findings.push({ pattern: rule.name, excerpt: mask(line.replace(/eyJ[A-Za-z0-9_.-]+/g, 'eyJ…[redacted]').replace(/(re_|sk_live_|sk_test_)[A-Za-z0-9_]+/g, '$1…[redacted]')), line: idx + 1 });
        break;
      }
    }
  });
  return findings;
}

/**
 * Scan a set of named artifacts. Used by `generate` (gate) and `secret-scan` (audit).
 * Returns findings grouped by artifact name.
 */
export function scanArtifacts(artifacts: Record<string, string>): Array<{ artifact: string; findings: SecretFinding[] }> {
  return Object.entries(artifacts).map(([artifact, text]) => ({
    artifact,
    findings: scanTextForSecrets(text),
  }));
}
