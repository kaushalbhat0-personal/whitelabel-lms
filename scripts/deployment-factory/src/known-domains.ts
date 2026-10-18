/**
 * Cross-client domain safety without a registry (P1-2).
 *
 * Why this file exists:
 *   - The factory is stateless by design (no central client database), so
 *     Client B can silently reuse Client A's domains unless the operator
 *     passes --known-domains by hand — which is easy to forget.
 *   - deployment-output/ already contains every previously generated
 *     client-config.validated.json. Scanning it is a deterministic local
 *     mechanism: no registry file, no manifest, no telemetry, no writes.
 *   - The scan EXCLUDES the config's own deploymentId, so regenerating the
 *     same client into a fresh dir never false-positives.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ClientConfig } from './types';

export interface KnownDomainEntry {
  deploymentId: string;
  frontend: string;
  api: string;
  source: string;
}

function hostOf(v: unknown): string | null {
  try {
    if (typeof v !== 'string') return null;
    return new URL(v).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Scan each child dir of outputDir for client-config.validated.json files. */
export function collectKnownDomains(outputDir: string): KnownDomainEntry[] {
  const out: KnownDomainEntry[] = [];
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(outputDir);
  } catch {
    return out;
  }
  for (const d of dirs) {
    const f = path.join(outputDir, d, 'client-config.validated.json');
    try {
      if (!fs.statSync(f).isFile()) continue;
      const raw = JSON.parse(fs.readFileSync(f, 'utf-8')) as Partial<ClientConfig>;
      const frontend = raw.deployment?.frontendDomain;
      const api = raw.deployment?.apiDomain;
      if (typeof frontend !== 'string' || typeof api !== 'string') continue;
      out.push({
        deploymentId: raw.client?.deploymentId ?? d,
        frontend,
        api,
        source: f,
      });
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Domains (as --known-domains entries) from prior outputs, excluding the
 * config's own deploymentId so regeneration never self-flags.
 */
export function knownDomainsExcluding(entries: KnownDomainEntry[], selfDeploymentId: string): string[] {
  const domains: string[] = [];
  for (const e of entries) {
    if (e.deploymentId === selfDeploymentId) continue;
    const fh = hostOf(e.frontend);
    const ah = hostOf(e.api);
    if (fh) domains.push(fh);
    if (ah) domains.push(ah);
  }
  return [...new Set(domains)];
}

/** Human-readable summary for operator output. */
export function formatKnownDomains(entries: KnownDomainEntry[], selfDeploymentId: string): string {
  const others = entries.filter((e) => e.deploymentId !== selfDeploymentId);
  if (others.length === 0) return 'No prior client domains found in local output.';
  return others.map((e) => `- ${e.deploymentId}: ${e.frontend} · ${e.api}`).join('\n');
}
