// P-SEC.6 — License compliance gate.
//
// Scans every installed dependency's declared license and FAILS CI (exit 1) on STRONG
// copyleft (GPL / AGPL) that is not dual-licensed with a permissive option and not in
// `.license-allowlist.json` — those create real legal risk for a commercial SaaS. Weak /
// file-level copyleft (MPL, EPL, LGPL with its linking exception) and dual licenses that
// offer a permissive choice (e.g. "MIT OR GPL-3.0") pass. Unknown/custom licenses are
// reported as warnings (not blocking) to avoid false-positive CI breaks.
//
// The classifier (`classifyLicense`) and evaluator (`evaluateLicenses`) are pure and
// unit-tested in tests/licenseGate.test.ts.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PERMISSIVE = /^(MIT|ISC|0BSD|BSD-2-CLAUSE|BSD-3-CLAUSE|BSD|APACHE-2\.0|APACHE|BLUEOAK-1\.0\.0|UNLICENSE|CC0-1\.0|PYTHON-2\.0|ZLIB|WTFPL|MIT-0|CC-BY-4\.0|PUBLIC DOMAIN)$/i;
const WEAK_COPYLEFT = /(MPL|MOZILLA|EPL|CDDL|MS-RL|OSL|EUPL|CPL)/i;

/**
 * Classify a single SPDX license token (no OR/AND). Order matters: AGPL and LGPL are
 * matched BEFORE plain GPL, so "LGPL-3.0" is correctly weak (linking exception) and a bare
 * "GPL-3.0" is strong.
 */
function classifyToken(token) {
  const t = token.trim().replace(/[()]/g, '').toUpperCase();
  if (!t || /^(UNKNOWN|SEE LICENSE|CUSTOM|UNLICENSED)/.test(t)) return 'unknown';
  if (PERMISSIVE.test(t)) return 'permissive';
  if (/AGPL/.test(t)) return 'strong-copyleft';
  if (/LGPL/.test(t)) return 'weak-copyleft';
  if (/GPL/.test(t)) return 'strong-copyleft';
  if (WEAK_COPYLEFT.test(t)) return 'weak-copyleft';
  return 'unknown';
}

const RANK = { permissive: 0, 'weak-copyleft': 1, unknown: 2, 'strong-copyleft': 3 };

/**
 * Classify an SPDX license expression. For an OR expression we take the MOST PERMISSIVE
 * operand (a permissive choice is always available → the package is usable permissively);
 * for AND we take the most restrictive. Returns one of permissive | weak-copyleft |
 * strong-copyleft | unknown. Pure.
 */
export function classifyLicense(expr) {
  if (!expr || typeof expr !== 'string') return 'unknown';
  const e = expr.trim();
  // Split ONLY on the whitespace-delimited SPDX operators " OR " / " AND " — never on the
  // hyphenated "-or-later" / "-and-later" version suffixes (e.g. "GPL-3.0-or-later").
  if (/\s+OR\s+/i.test(e)) {
    const parts = e.split(/\s+OR\s+/i).map(classifyLicense);
    return parts.reduce((best, c) => (RANK[c] < RANK[best] ? c : best), 'strong-copyleft');
  }
  if (/\s+AND\s+/i.test(e)) {
    const parts = e.split(/\s+AND\s+/i).map(classifyLicense);
    return parts.reduce((worst, c) => (RANK[c] > RANK[worst] ? c : worst), 'permissive');
  }
  return classifyToken(e);
}

/** Read a package's declared license from its package.json shape. */
export function readLicenseField(pkg) {
  if (!pkg) return 'unknown';
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license === 'object' && pkg.license.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses) && pkg.licenses[0]) return pkg.licenses[0].type || pkg.licenses[0];
  return 'unknown';
}

/**
 * Pure: given scanned packages [{name, version, license}] and the allowlist Set of package
 * names, return { ok, blocking[], weak[], unknown[] }. `blocking` = strong-copyleft not allowlisted.
 */
export function evaluateLicenses(packages, allowSet) {
  const blocking = [];
  const weak = [];
  const unknown = [];
  for (const p of packages) {
    const cls = classifyLicense(p.license);
    if (cls === 'strong-copyleft') {
      if (!allowSet.has(p.name)) blocking.push({ ...p, classification: cls });
    } else if (cls === 'weak-copyleft') {
      weak.push({ ...p, classification: cls });
    } else if (cls === 'unknown') {
      unknown.push({ ...p, classification: cls });
    }
  }
  return { ok: blocking.length === 0, blocking, weak, unknown };
}

/** Walk node_modules and collect {name, version, license} for every installed package. */
export function scanInstalledLicenses(root = 'node_modules') {
  const out = [];
  const seen = new Set();
  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === '.bin' || e.name === '.cache') continue;
      const full = join(dir, e.name);
      if (e.name.startsWith('@')) { walk(full); continue; }
      const pj = join(full, 'package.json');
      if (existsSync(pj)) {
        try {
          const p = JSON.parse(readFileSync(pj, 'utf-8'));
          const key = `${p.name}@${p.version}`;
          if (p.name && !seen.has(key)) {
            seen.add(key);
            out.push({ name: p.name, version: p.version || '?', license: readLicenseField(p) });
          }
        } catch { /* skip */ }
      }
      const nested = join(full, 'node_modules');
      if (existsSync(nested)) walk(nested);
    }
  }
  walk(root);
  return out;
}

export function loadLicenseAllowlist(path = '.license-allowlist.json') {
  if (!existsSync(path)) return new Set();
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    return new Set((Array.isArray(data?.allow) ? data.allow : []).map((e) => e.package).filter(Boolean));
  } catch { return new Set(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const pkgs = scanInstalledLicenses('node_modules');
  const allow = loadLicenseAllowlist();
  const { ok, blocking, weak, unknown } = evaluateLicenses(pkgs, allow);
  console.log(`License compliance — scanned ${pkgs.length} packages`);
  console.log(`  weak/file-level copyleft (allowed): ${weak.length}${weak.length ? ' — ' + weak.slice(0, 8).map((w) => w.name).join(', ') : ''}`);
  if (unknown.length) console.log(`  unknown/custom (warning, not blocking): ${unknown.length} — ${unknown.slice(0, 8).map((u) => u.name).join(', ')}`);
  if (!ok) {
    console.error('\n❌ Strong copyleft (GPL/AGPL) dependencies — legal risk:');
    for (const b of blocking) console.error(`   • ${b.name}@${b.version} : ${b.license}`);
    console.error('\nReplace the dependency, or — if intentionally accepted — add it to .license-allowlist.json with a reason.');
    process.exit(1);
  }
  console.log('\n✅ No un-allowlisted strong-copyleft (GPL/AGPL) dependencies.');
}
