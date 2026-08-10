
import { envFlag } from '../lib/envFlag';
// AgentV3 — "App Health Culture", slice 3: RED-TEAM fuzz probe (Immune System Phase 3, GA-17).
//
// Culture (slice 1) asked "does the app DO what was asked?"; the Vaccine (slice 2) ran the app's own
// tests. The red-team goes further: it ADVERSARIALLY attacks the running app's inputs with edge-case
// values (empty, whitespace, enormous strings, unicode/emoji, injection-shaped text, out-of-range and
// malformed numbers) and watches whether the app CRASHES — an uncaught exception, a React render error,
// an unhandled rejection. A real app should degrade gracefully; a crash on a hostile input is a genuine
// robustness bug the happy-path build+preview check never sees.
//
// This module is PURE and dependency-free (fully unit-testable): it parses the rendered HTML to find the
// app's inputs, derives a best-effort selector + a catalog of adversarial values per input KIND, and
// interprets captured console errors into an honest crash verdict. The impure part — driving the real
// browser to type each value and capturing errors — lives in the build route (like PreviewVerify).

export type FuzzKind =
  | 'text' | 'number' | 'email' | 'password' | 'search' | 'tel' | 'url' | 'date' | 'textarea';

export interface FuzzInput {
  /** A best-effort CSS selector that targets this input in the live DOM. */
  selector: string;
  /** The input's semantic kind (from the type= attribute, or textarea). */
  kind: FuzzKind;
  /** Human label for the report (id / name / placeholder / aria-label). */
  label: string;
}

export interface FuzzCase {
  /** The adversarial value to type into the input. */
  value: string;
  /** Short reason this value is adversarial / what it probes. */
  probe: string;
}

export interface FuzzTarget {
  input: FuzzInput;
  cases: FuzzCase[];
}

/** Bound the attack so a build can never be slowed unboundedly: a few inputs, a few cases each. */
const MAX_INPUTS = 6;
const MAX_CASES_PER_INPUT = 4;

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1] : undefined;
}

/** CSS-escape a value used inside an attribute selector (quotes/backslashes only — enough for our use). */
function cssAttrValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Derive the most stable selector we can from an input/textarea tag's attributes. */
function selectorFor(tag: string, kind: FuzzKind, ordinalOfKind: number): string {
  const id = attr(tag, 'id');
  if (id && /^[A-Za-z][\w-]*$/.test(id)) return `#${id}`;
  const name = attr(tag, 'name');
  if (name) return `${kind === 'textarea' ? 'textarea' : 'input'}[name="${cssAttrValue(name)}"]`;
  const ph = attr(tag, 'placeholder');
  if (ph) return `${kind === 'textarea' ? 'textarea' : 'input'}[placeholder="${cssAttrValue(ph)}"]`;
  // Fall back to a positional selector scoped by kind (1-based nth-of-type is Playwright/CSS friendly).
  if (kind === 'textarea') return `textarea >> nth=${ordinalOfKind}`;
  return `input[type="${kind === 'text' ? 'text' : kind}"] >> nth=${ordinalOfKind}`;
}

function labelFor(tag: string): string {
  return (
    attr(tag, 'aria-label') ||
    attr(tag, 'placeholder') ||
    attr(tag, 'name') ||
    attr(tag, 'id') ||
    'input'
  ).slice(0, 60);
}

/** Map an <input type="…"> to a fuzz kind; unknown/absent types are treated as free text. */
function kindOfInputType(t: string | undefined): FuzzKind {
  switch ((t || 'text').toLowerCase()) {
    case 'number': return 'number';
    case 'email': return 'email';
    case 'password': return 'password';
    case 'search': return 'search';
    case 'tel': return 'tel';
    case 'url': return 'url';
    case 'date': return 'date';
    default: return 'text';
  }
}

const LONG = 'A'.repeat(5000);

/** Adversarial value catalog per input kind. Ordered most-likely-to-break first (we cap per input). */
function casesForKind(kind: FuzzKind): FuzzCase[] {
  // Ordered most-valuable-first so the per-input cap keeps the strongest probes (empty, oversized,
  // injection-shaped, unicode/markup) and drops only the lowest-value one (whitespace) when trimmed.
  const textish: FuzzCase[] = [
    { value: '', probe: 'empty submit (required-field / empty-state handling)' },
    { value: LONG, probe: 'very long input (5000 chars) — buffer/layout/limit handling' },
    { value: `"'; DROP TABLE users;--`, probe: 'injection-shaped text — must be treated as literal data' },
    { value: '🔥💥🙂 <b>café</b> Ω≈ç', probe: 'unicode/emoji/markup — encoding + XSS-escaping' },
    { value: '   ', probe: 'whitespace-only (should be treated as empty, not a real value)' },
  ];
  const numberish: FuzzCase[] = [
    { value: '', probe: 'empty number (NaN / required handling)' },
    { value: '-1', probe: 'negative value (range/validation handling)' },
    { value: '999999999999999999', probe: 'huge value (overflow / precision handling)' },
    { value: 'abc', probe: 'non-numeric text in a number field' },
    { value: '1e999', probe: 'Infinity via exponent' },
  ];
  switch (kind) {
    case 'number':
    case 'tel':
      return numberish;
    case 'email':
      return [
        { value: '', probe: 'empty email (required handling)' },
        { value: 'notanemail', probe: 'malformed email (validation handling)' },
        { value: 'a@b', probe: 'incomplete domain (validation handling)' },
        { value: `${LONG}@x.com`, probe: 'very long local-part' },
      ];
    case 'url':
      return [
        { value: '', probe: 'empty url' },
        { value: 'notaurl', probe: 'malformed url (validation handling)' },
        { value: 'javascript:alert(1)', probe: 'dangerous scheme — must not be executed' },
      ];
    case 'date':
      return [
        { value: '', probe: 'empty date' },
        { value: '9999-99-99', probe: 'out-of-range date parts' },
        { value: '0000-00-00', probe: 'zero date' },
      ];
    default:
      return textish;
  }
}

/**
 * Build a bounded fuzz plan from the rendered preview HTML: find the app's inputs, derive a selector +
 * kind + adversarial cases for each. Pure; never throws. Returns [] when there is nothing to fuzz.
 */
export function generateFuzzPlan(html: string): FuzzTarget[] {
  if (typeof html !== 'string' || !html.trim()) return [];
  const targets: FuzzTarget[] = [];
  const kindOrdinals: Record<string, number> = {};

  const nextOrdinal = (k: FuzzKind): number => {
    const key = k === 'textarea' ? 'textarea' : k;
    const cur = kindOrdinals[key] ?? 0;
    kindOrdinals[key] = cur + 1;
    return cur; // 0-based, matches Playwright nth=
  };

  // <input> tags (skip hidden / checkbox / radio / submit / button / file — not free-value fields).
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    if (targets.length >= MAX_INPUTS) break;
    const tag = m[0];
    const rawType = (attr(tag, 'type') || 'text').toLowerCase();
    if (['hidden', 'checkbox', 'radio', 'submit', 'button', 'file', 'range', 'color', 'image'].includes(rawType)) continue;
    const kind = kindOfInputType(rawType);
    const ordinal = nextOrdinal(kind);
    targets.push({
      input: { selector: selectorFor(tag, kind, ordinal), kind, label: labelFor(tag) },
      cases: casesForKind(kind).slice(0, MAX_CASES_PER_INPUT),
    });
  }

  // <textarea> tags.
  for (const m of html.matchAll(/<textarea\b[^>]*>/gi)) {
    if (targets.length >= MAX_INPUTS) break;
    const tag = m[0];
    const ordinal = nextOrdinal('textarea');
    targets.push({
      input: { selector: selectorFor(tag, 'textarea', ordinal), kind: 'textarea', label: labelFor(tag) },
      cases: casesForKind('textarea').slice(0, MAX_CASES_PER_INPUT),
    });
  }

  return targets;
}

// Console-error signatures that indicate the INPUT crashed the app (vs. benign warnings/network noise).
const CRASH_SIGNATURES = [
  /uncaught/i,
  /\bTypeError\b/,
  /\bReferenceError\b/,
  /\bRangeError\b/,
  /cannot read (?:property|properties)/i,
  /is not a function/i,
  /is not defined/i,
  /unhandled (?:promise )?rejection/i,
  /minified react error/i,
  /the above error occurred/i,
  /maximum update depth exceeded/i,
];

export interface FuzzVerdict {
  /** True when a captured error looks like an input-triggered crash. */
  crashed: boolean;
  /** The specific error lines that evidence the crash (deduped, capped). */
  evidence: string[];
}

/**
 * Decide whether the console errors captured right after typing an adversarial value represent a real
 * crash. Pure. Conservative: only known crash signatures count — a plain warning or a 404 fetch does not.
 */
export function interpretFuzzErrors(errors: string[]): FuzzVerdict {
  const evidence: string[] = [];
  for (const e of errors || []) {
    if (typeof e !== 'string') continue;
    if (CRASH_SIGNATURES.some((re) => re.test(e))) {
      const line = e.trim().slice(0, 200);
      if (!evidence.includes(line)) evidence.push(line);
    }
    if (evidence.length >= 5) break;
  }
  return { crashed: evidence.length > 0, evidence };
}

/** A one-line human/agent summary of a fuzz run. */
export function fuzzSummary(findings: { input: FuzzInput; case: FuzzCase; verdict: FuzzVerdict }[]): string {
  if (findings.length === 0) return '';
  const parts = findings.slice(0, 6).map(
    (f) => `"${f.input.label}" crashed on ${f.case.probe} (${f.verdict.evidence[0] ?? 'runtime error'})`,
  );
  return `Red-team: ${findings.length} input(s) crashed on hostile input — ${parts.join('; ')}.`;
}

/** An agent-facing repair instruction for the crashing inputs (used only when a heal pass runs). */
export function fuzzRepairPrompt(findings: { input: FuzzInput; case: FuzzCase; verdict: FuzzVerdict }[]): string {
  if (findings.length === 0) return '';
  return [
    'Red-team testing crashed the running app by typing hostile values into its inputs. Each input below',
    'threw a runtime error instead of degrading gracefully:',
    ...findings.slice(0, 8).map(
      (f) => `  - "${f.input.label}" (${f.input.kind}) on ${f.case.probe} → ${f.verdict.evidence[0] ?? 'runtime error'}`,
    ),
    '',
    'Harden the SOURCE so these inputs are validated/sanitized and can never crash the app: guard against',
    'empty/whitespace/oversized/malformed values, coerce numbers safely, and escape user text. Make the',
    'smallest correct edits; do not remove the inputs or the features they belong to.',
  ].join('\n');
}

/** Opt-in flag — the red-team runs an extra browser-drive pass, so it stays off until explicitly enabled. */
export function redTeamEnabled(): boolean {
  return envFlag('AGENTV3_REDTEAM');
}
