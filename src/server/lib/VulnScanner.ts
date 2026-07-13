// GA-13 — Supply-chain vulnerability scanner (OSV.dev).
//
// Real CVE/OSV scanning of the app's declared dependencies against the OSV.dev database (the same source
// GitHub/npm advisories feed into). Honest by construction: if the OSV API is unreachable (offline sandbox,
// network policy), it reports "scan unavailable" — it NEVER fakes a clean "0 vulnerabilities" (a fake all-
// clear on a vulnerable app is worse than an honest "couldn't scan"). The parse/query/format logic is pure
// and fully unit-tested with an injected fetch; the live HTTP call runs in the real build sandbox.

export interface DepRef { name: string; version: string; /** true when the version was inferred from a range, not a lockfile */ approx?: boolean; }
export interface VulnFinding { package: string; version: string; ids: string[]; approx?: boolean; }
export type VulnScanResult =
  | { ok: true; scanned: number; findings: VulnFinding[] }
  | { ok: false; reason: string };

const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';

/** Strip a semver range prefix to a concrete-ish base version (`^1.2.3` → `1.2.3`). */
function baseVersion(range: string): string | null {
  const m = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(String(range || ''));
  return m ? m[1] : null;
}

/**
 * Resolve the dependencies to scan: exact versions from package-lock.json when present, else the base
 * version parsed from each range in package.json (flagged `approx`). Dev + prod + optional deps. Pure.
 */
export function resolveDependencies(packageJson: string, lockJson?: string): DepRef[] {
  let pkg: Record<string, unknown>;
  try { const p = JSON.parse(packageJson); if (!p || typeof p !== 'object') return []; pkg = p as Record<string, unknown>; }
  catch { return []; }
  const ranges: Record<string, string> = {};
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const s = pkg[section];
    if (s && typeof s === 'object' && !Array.isArray(s)) {
      for (const [name, range] of Object.entries(s as Record<string, unknown>)) {
        if (typeof range === 'string') ranges[name] = range;
      }
    }
  }
  // Exact versions from the lockfile (npm v2/v3 `packages` map: "node_modules/<name>" → { version }).
  const exact: Record<string, string> = {};
  if (lockJson) {
    try {
      const lock = JSON.parse(lockJson);
      const packages = lock?.packages && typeof lock.packages === 'object' ? lock.packages : null;
      if (packages) {
        for (const [key, meta] of Object.entries(packages as Record<string, { version?: string }>)) {
          const name = key.startsWith('node_modules/') ? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length) : '';
          if (name && meta && typeof meta.version === 'string') exact[name] = meta.version;
        }
      }
      // npm v1 lockfile: top-level `dependencies` map.
      const deps = lock?.dependencies && typeof lock.dependencies === 'object' ? lock.dependencies : null;
      if (deps) for (const [name, meta] of Object.entries(deps as Record<string, { version?: string }>)) {
        if (meta && typeof meta.version === 'string' && !exact[name]) exact[name] = meta.version;
      }
    } catch { /* unparseable lock → fall back to ranges */ }
  }
  const out: DepRef[] = [];
  for (const name of Object.keys(ranges).sort()) {
    if (exact[name]) out.push({ name, version: exact[name] });
    else { const bv = baseVersion(ranges[name]); if (bv) out.push({ name, version: bv, approx: true }); }
  }
  return out;
}

/** The OSV querybatch request body for a set of npm dependencies. Pure. */
export function buildOsvQuery(deps: ReadonlyArray<DepRef>): { queries: Array<{ package: { name: string; ecosystem: 'npm' }; version: string }> } {
  return { queries: deps.map((d) => ({ package: { name: d.name, ecosystem: 'npm' }, version: d.version })) };
}

/** Map an OSV querybatch response (results aligned to the query order) to findings. Pure. */
export function parseOsvResponse(body: unknown, deps: ReadonlyArray<DepRef>): VulnFinding[] {
  const results = (body as { results?: Array<{ vulns?: Array<{ id?: string }> }> })?.results;
  if (!Array.isArray(results)) return [];
  const findings: VulnFinding[] = [];
  for (let i = 0; i < deps.length && i < results.length; i++) {
    const vulns = results[i]?.vulns;
    if (Array.isArray(vulns) && vulns.length) {
      const ids = vulns.map((v) => v?.id).filter((x): x is string => typeof x === 'string');
      if (ids.length) findings.push({ package: deps[i].name, version: deps[i].version, ids, approx: deps[i].approx });
    }
  }
  return findings;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Scan the dependencies against OSV.dev. Returns findings, or an HONEST failure (never a fake all-clear)
 * when the API is unreachable or errors. `fetchFn` is injected for testing; defaults to global fetch.
 */
export async function scanVulnerabilities(deps: ReadonlyArray<DepRef>, fetchFn?: FetchLike): Promise<VulnScanResult> {
  if (!deps.length) return { ok: true, scanned: 0, findings: [] };
  const doFetch = (fetchFn || (globalThis as unknown as { fetch?: FetchLike }).fetch) as FetchLike | undefined;
  if (!doFetch) return { ok: false, reason: 'no fetch available in this runtime — vulnerability scan skipped' };
  try {
    const res = await doFetch(OSV_BATCH_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(buildOsvQuery(deps)) });
    if (!res.ok) return { ok: false, reason: `OSV API returned HTTP ${res.status} — vulnerability scan unavailable` };
    const body = await res.json();
    return { ok: true, scanned: deps.length, findings: parseOsvResponse(body, deps) };
  } catch (e) {
    return { ok: false, reason: `could not reach the OSV vulnerability database (${e instanceof Error ? e.message : 'network error'}) — scan unavailable` };
  }
}

/** Honest human-readable report — an all-clear ONLY when a scan actually ran clean. Pure. */
export function vulnScanSummary(result: VulnScanResult): string {
  if (!result.ok) return `⚠️ Vulnerability scan could NOT run: ${result.reason}. (Not a clean bill of health — re-run where OSV.dev is reachable.)`;
  if (result.findings.length === 0) return `✓ No known vulnerabilities in ${result.scanned} dependency(ies) (OSV.dev).`;
  const lines = result.findings.map((f) =>
    `  ✗ ${f.package}@${f.version}${f.approx ? ' (approx — no lockfile)' : ''}: ${f.ids.length} advisory(ies) — ${f.ids.slice(0, 5).join(', ')}${f.ids.length > 5 ? ', …' : ''} (details: https://osv.dev/vulnerability/${f.ids[0]})`);
  return `⚠️ ${result.findings.length} vulnerable dependency(ies) found (of ${result.scanned} scanned, via OSV.dev):\n${lines.join('\n')}\nUpgrade each to a patched version.`;
}
