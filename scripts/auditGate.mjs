// P-TQA.7 — Dependency vulnerability scan that BLOCKS (not warns).
//
// CI previously ran `npm audit` with `continue-on-error: true` — it blocked nothing. This
// gate runs `npm audit --json` and FAILS the build (exit 1) on any HIGH or CRITICAL
// vulnerability whose package is not in `.audit-allowlist.json`. Pre-existing, triaged
// advisories are allowlisted (with a reason) so CI isn't broken by an unfixable transitive
// — but a NEW high/critical in a non-allowlisted package blocks the merge. Moderate/low are
// reported, never blocking.
//
// `evaluateAudit()` is pure and unit-tested (tests/auditGate.test.ts).

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BLOCKING = new Set(['high', 'critical']);

/**
 * The HIGH/CRITICAL advisory ids an audit entry carries ITSELF (`via` objects). An entry that is vulnerable
 * only THROUGH another package (`via` strings) carries none — that advisory is judged on its own package.
 */
export function blockingAdvisoryIds(info) {
  const ids = new Set();
  for (const v of (info && info.via) || []) {
    if (!v || typeof v !== 'object' || !BLOCKING.has(v.severity)) continue;
    const m = String(v.url || '').match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i);
    ids.add(m ? m[0] : `npm-${v.source}`);
  }
  return [...ids].sort();
}

/** A Set of package names (legacy callers, tests) or a Map of package → accepted advisory ids. */
function asAllowMap(allow) {
  if (allow instanceof Map) return allow;
  return new Map([...(allow || [])].map((name) => [name, new Set()]));
}

/**
 * Pure: given parsed `npm audit --json` output and the allowlist, return { ok, blocking[], allowed[], counts }.
 *
 * 🔒 AN ALLOWLIST ENTRY ACCEPTS THE ADVISORIES IT NAMES, NOT THE PACKAGE (forensic audit 2026-10-04, Q-619).
 * It used to accept the package name, so once `axios` was triaged for one advisory, every LATER high or
 * critical advisory in axios passed silently too — and seven had: axios 1.19.0 carried seven HIGH advisories
 * (ReDoS, prototype-pollution gadgets, a redirect limit not enforced) behind a reason written for one. Now
 * a high/critical advisory id the entry does not list blocks, even in an allowlisted package.
 */
export function evaluateAudit(audit, allowlist) {
  const allow = asAllowMap(allowlist);
  const vulns = (audit && audit.vulnerabilities) || {};
  const blocking = [];
  const allowed = [];
  for (const [name, info] of Object.entries(vulns)) {
    const severity = (info && info.severity) || 'unknown';
    if (!BLOCKING.has(severity)) continue;
    const accepted = allow.get(name);
    if (!accepted) { blocking.push({ name, severity }); continue; }
    const unlisted = blockingAdvisoryIds(info).filter((id) => !accepted.has(id));
    if (unlisted.length) blocking.push({ name, severity, advisories: unlisted });
    else allowed.push({ name, severity });
  }
  const counts = (audit && audit.metadata && audit.metadata.vulnerabilities) || {};
  return { ok: blocking.length === 0, blocking, allowed, counts };
}

/**
 * Pure: detect when `npm audit --json`'s stdout is NOT a real audit report but an npm-registry ERROR
 * response that happens to also be valid JSON (root cause, 2026-07-26: the legacy `/audits/quick`
 * endpoint is being retired and now returns a 400 "Invalid package tree" body — `npm audit` prints
 * that error object to stdout and exits 0, so the old code silently read it as "zero vulnerabilities"
 * and reported a false-clean gate). The registry error shape is distinctive: a numeric top-level
 * `statusCode` + an `error` object, and — critically — NO `vulnerabilities` key at all (a real report
 * always has one, even if empty: `{ vulnerabilities: {} }`). Checking for the ABSENCE of `vulnerabilities`
 * is what keeps this from ever flagging a genuine empty-audit report as an error.
 */
export function isAuditErrorResponse(audit) {
  if (!audit || typeof audit !== 'object') return false;
  if ('vulnerabilities' in audit) return false;
  return typeof audit.statusCode === 'number' && audit.statusCode >= 400 && !!audit.error;
}

/** Load the allowlist file → Map of package → accepted advisory ids. Missing file → empty map. */
export function loadAllowlist(path = '.audit-allowlist.json') {
  if (!existsSync(path)) return new Map();
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    const entries = Array.isArray(data?.allow) ? data.allow : [];
    return new Map(entries.filter((e) => e && e.package).map((e) => [e.package, new Set(Array.isArray(e.advisories) ? e.advisories : [])]));
  } catch {
    return new Map();
  }
}

/** Run `npm audit --json` and return the parsed object (audit exits non-zero when vulns exist — we read stdout regardless). */
function runNpmAudit() {
  let out = '';
  try {
    out = execFileSync('npm', ['audit', '--json'], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    out = err.stdout ? err.stdout.toString() : '';
  }
  if (!out.trim()) throw new Error('npm audit produced no output');
  return JSON.parse(out);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const audit = runNpmAudit();
    if (isAuditErrorResponse(audit)) {
      console.error(`audit-gate failed to run: npm's audit endpoint returned an error instead of a report (HTTP ${audit.statusCode}: ${audit.body?.message || audit.message || 'unknown error'}).`);
      console.error('This is NOT "zero vulnerabilities" — the scan itself never happened. Refusing to report a false-clean gate.');
      console.error('Try: npm install (to resync package-lock.json), then re-run. If npm\'s audit endpoint is down/retired, this blocks until it recovers or the gate is updated for the new endpoint.');
      process.exit(1);
    }
    const allow = loadAllowlist();
    const { ok, blocking, allowed, counts } = evaluateAudit(audit, allow);
    console.log(`Dependency audit — high/critical gate (allowlisted: ${allowed.length})`);
    console.log(`  totals: ${JSON.stringify(counts)}`);
    if (allowed.length) console.log(`  allowed (pre-triaged): ${allowed.map((a) => `${a.name}[${a.severity}]`).join(', ')}`);
    if (!ok) {
      console.error('\n❌ NEW high/critical vulnerabilities (not allowlisted):');
      for (const b of blocking) console.error(`   • ${b.name} [${b.severity}]${b.advisories ? ` — advisories not triaged: ${b.advisories.join(', ')}` : ''}`);
      console.error('\nFix it (npm audit fix / bump the dep), or — if accepted/unfixable — add it to');
      console.error('.audit-allowlist.json with a reason AND its advisory id. This gate only blocks high & critical.');
      process.exit(1);
    }
    console.log('\n✅ No new high/critical vulnerabilities.');
  } catch (err) {
    console.error('audit-gate failed to run:', err?.message || err);
    process.exit(1);
  }
}
