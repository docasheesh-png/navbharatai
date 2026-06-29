/**
 * P-BRE.10 — SBOM generator + license validator for the USER's GENERATED apps.
 *
 * Distinct from P-SEC.6 (which produces an SBOM for NavBharatAI itself, in CI): this generates a
 * CycloneDX Software Bill of Materials for an app a user BUILT on the platform, from that app's
 * `package-lock.json`, and flags copyleft (GPL/AGPL) dependencies the generated app may have pulled
 * in — so enterprise users get supply-chain visibility + a license-risk warning.
 *
 * The CycloneDX + license-classification logic is the proven, unit-tested core from P-SEC.6's
 * `scripts/genSbom.mjs` + `scripts/licenseGate.mjs`, ported to TypeScript so the server can call it
 * directly (the scripts are CLI .mjs and not importable into the bundled server). Pure + tested.
 */

export interface SbomComponent {
  type: 'library';
  name: string;
  version: string;
  purl: string;
  licenses?: Array<{ license: { id: string } }>;
}

export interface CycloneDxSbom {
  bomFormat: 'CycloneDX';
  specVersion: '1.5';
  version: number;
  metadata: { timestamp: string; component: { type: 'application'; name: string; version: string } };
  components: SbomComponent[];
}

type LicenseClass = 'permissive' | 'weak-copyleft' | 'strong-copyleft' | 'unknown';

const PERMISSIVE = /^(MIT|ISC|0BSD|BSD-2-CLAUSE|BSD-3-CLAUSE|BSD|APACHE-2\.0|APACHE|BLUEOAK-1\.0\.0|UNLICENSE|CC0-1\.0|PYTHON-2\.0|ZLIB|WTFPL|MIT-0|CC-BY-4\.0|PUBLIC DOMAIN)$/i;
const WEAK_COPYLEFT = /(MPL|MOZILLA|EPL|CDDL|MS-RL|OSL|EUPL|CPL)/i;
const RANK: Record<LicenseClass, number> = { permissive: 0, 'weak-copyleft': 1, unknown: 2, 'strong-copyleft': 3 };

/** Classify a single SPDX token (AGPL/LGPL matched before plain GPL so LGPL stays weak). Pure. */
function classifyToken(token: string): LicenseClass {
  const t = token.trim().replace(/[()]/g, '').toUpperCase();
  if (!t || /^(UNKNOWN|SEE LICENSE|CUSTOM|UNLICENSED)/.test(t)) return 'unknown';
  if (PERMISSIVE.test(t)) return 'permissive';
  if (/AGPL/.test(t)) return 'strong-copyleft';
  if (/LGPL/.test(t)) return 'weak-copyleft';
  if (/GPL/.test(t)) return 'strong-copyleft';
  if (WEAK_COPYLEFT.test(t)) return 'weak-copyleft';
  return 'unknown';
}

/**
 * Classify an SPDX expression. "A OR B" → most permissive operand (a permissive choice is
 * available); "A AND B" → most restrictive. Splits only on the SPDX operators, never on the
 * hyphenated "-or-later" suffix. Pure.
 */
export function classifyLicense(expr: string | null | undefined): LicenseClass {
  if (!expr || typeof expr !== 'string') return 'unknown';
  const e = expr.trim();
  if (/\s+OR\s+/i.test(e)) {
    const parts = e.split(/\s+OR\s+/i).map(classifyLicense);
    return parts.reduce<LicenseClass>((best, c) => (RANK[c] < RANK[best] ? c : best), 'strong-copyleft');
  }
  if (/\s+AND\s+/i.test(e)) {
    const parts = e.split(/\s+AND\s+/i).map(classifyLicense);
    return parts.reduce<LicenseClass>((worst, c) => (RANK[c] > RANK[worst] ? c : worst), 'permissive');
  }
  return classifyToken(e);
}

/** Build a CycloneDX 1.5 SBOM from a parsed package-lock.json object. Pure. */
export function buildSbom(lock: any, generatedAt = '1970-01-01T00:00:00.000Z'): CycloneDxSbom {
  const components: SbomComponent[] = [];
  const seen = new Set<string>();
  const packages = (lock && lock.packages) || {};
  for (const [path, info] of Object.entries<any>(packages)) {
    if (!path || path === '') continue; // '' is the root project itself
    const name = info.name || path.split('node_modules/').pop();
    const version = info.version || '0.0.0';
    if (!name) continue;
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const comp: SbomComponent = {
      type: 'library',
      name,
      version,
      purl: `pkg:npm/${String(name).replace('@', '%40')}@${version}`,
    };
    if (info.license) comp.licenses = [{ license: { id: String(info.license) } }];
    components.push(comp);
  }
  components.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      timestamp: generatedAt,
      component: { type: 'application', name: (lock && lock.name) || 'app', version: (lock && lock.version) || '0.0.0' },
    },
    components,
  };
}

export interface CopyleftFinding { name: string; version: string; license: string; class: 'strong-copyleft' | 'weak-copyleft' }

/**
 * Scan an SBOM's components and flag copyleft dependencies. `strong` (GPL/AGPL) is the real
 * risk an app owner must know about; `weak` (LGPL/MPL/EPL …) is informational. Pure.
 */
export function detectCopyleft(sbom: CycloneDxSbom): { strong: CopyleftFinding[]; weak: CopyleftFinding[] } {
  const strong: CopyleftFinding[] = [];
  const weak: CopyleftFinding[] = [];
  for (const c of sbom.components) {
    const license = c.licenses?.[0]?.license?.id || '';
    if (!license) continue;
    const cls = classifyLicense(license);
    if (cls === 'strong-copyleft') strong.push({ name: c.name, version: c.version, license, class: cls });
    else if (cls === 'weak-copyleft') weak.push({ name: c.name, version: c.version, license, class: cls });
  }
  return { strong, weak };
}

export interface AppSbomResult {
  sbom: CycloneDxSbom;
  copyleft: { strong: CopyleftFinding[]; weak: CopyleftFinding[] };
  componentCount: number;
  /** True when the app pulls in a strong-copyleft (GPL/AGPL) dependency — a license-compliance risk. */
  hasCopyleftRisk: boolean;
}

/** One-shot: parsed lockfile → SBOM + copyleft findings + risk flag. Pure. */
export function analyzeAppDependencies(lock: any, generatedAt = '1970-01-01T00:00:00.000Z'): AppSbomResult {
  const sbom = buildSbom(lock, generatedAt);
  const copyleft = detectCopyleft(sbom);
  return {
    sbom,
    copyleft,
    componentCount: sbom.components.length,
    hasCopyleftRisk: copyleft.strong.length > 0,
  };
}
