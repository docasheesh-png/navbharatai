/**
 * THE GATE READ BULLETS; USERS WRITE COMMAS (2026-09-18).
 *
 * The admin set `AGENTV3_PROJECT_MODE=on` — the switch that routes a genuinely big request through
 * module decomposition instead of one 30-minute pass. Measured on `main` the same hour, **not one of
 * fourteen realistic prompts opened that door**, because both gates that judge "is this a project?"
 * counted only `^- ` / `^1. ` LINES:
 *
 *   - `megaProjectSignals` (AgentV3/ProjectPlan.ts) → Software Project Mode
 *   - `featureCount`       (lib/appScopeAnalyzer.ts) → the mega-app roadmap, on by default
 *
 * `ProjectPlan.test.ts`'s own passing case is a hospital system written as a bulleted spec — a
 * DEVELOPER'S spec. A real user writes one line with commas, and both gates scored that ZERO.
 *
 * This suite pins the BUG AS MEASURED (both corpora, real prompts) and the two properties that make
 * the fix safe to ship: every ordinary app prompt still counts 0-2 and never opens either gate, and
 * the bulleted form that already worked is never regressed.
 */
import { describe, it, expect } from 'vitest';
import {
  countEnumeratedFeatures,
  MAX_ITEM_WORDS,
  MAX_COUNTED,
  MIN_RUN_ITEMS,
} from '../src/server/AgentV3/enumeratedFeatures';
import {
  megaProjectSignals,
  detectMegaProject,
  MEGA_BULLETS_WITH_NOUN,
  MEGA_BULLETS_ALONE,
  MEGA_SCALE_MIN,
} from '../src/server/AgentV3/ProjectPlan';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';

/** Real project requests, in the words a user actually types. Each names its parts. */
const PROJECT_PROMPTS = [
  'ek hospital management system banao jisme OPD, IPD, pharmacy, billing, lab reports, doctor schedule, patient history sab ho',
  'school ERP with students, teachers, attendance, fees, exams, timetable, library, transport',
  'banao ek full fledged ERP for my factory with production, inventory, purchase, sales, accounts, payroll, quality, dispatch',
  'Build a hospital management system:\n- patients\n- doctors\n- appointments\n- billing\n- pharmacy\n- labs\n- wards\n- reports',
];

/**
 * Ordinary app requests. NONE of these may open either gate — a false positive costs a planner call
 * and a decomposition on an app that needed neither, on a tier NavBharatAI often pays for itself.
 */
const ORDINARY_PROMPTS = [
  'todo app',
  'ek calculator banao',
  'restaurant billing app',
  'notes app with dark mode',
  'a todo app for my restaurant',
  'landing page for a hospital',
  'make me a simple expense tracker, nothing fancy',
  'I want an app for my clinic, it should be fast, and the design should be modern',
  'ek dukaan ka billing app banao jisme item add kar saku',
  'portfolio website for a doctor',
  'fix the login error in my hospital app',
  'a quiz app with 10 questions',
  'blog banao',
  'weather app with search and favourites',
  'a landing page with 5 pages',
];

describe('countEnumeratedFeatures — it reads both syntaxes, and only those', () => {
  it('counts a bulleted spec, the signal that already worked', () => {
    expect(countEnumeratedFeatures('App:\n- login\n- profile\n- search\n- chat')).toBe(4);
    expect(countEnumeratedFeatures('1. login\n2) profile\n3. search')).toBe(3);
  });

  it('counts an inline comma run — the case that scored zero before', () => {
    expect(countEnumeratedFeatures('with students, teachers, attendance, fees')).toBe(4);
    expect(countEnumeratedFeatures('cart, checkout, payments, orders and admin')).toBe(5);
  });

  it('reads the Hinglish a real user types', () => {
    expect(countEnumeratedFeatures('jisme OPD, IPD, pharmacy aur billing ho')).toBe(4);
  });

  it('drops the REQUEST that precedes a list opener, keeping the list', () => {
    // "ek hospital management system banao jisme" is the ask; "OPD" onwards is the list.
    expect(countEnumeratedFeatures('ek hospital management system banao jisme OPD, IPD, pharmacy, billing')).toBe(4);
  });

  it('a single separator is a pause, not an enumeration', () => {
    expect(MIN_RUN_ITEMS).toBe(3);
    expect(countEnumeratedFeatures('make me a simple expense tracker, nothing fancy')).toBe(0);
    expect(countEnumeratedFeatures('a notes app, please')).toBe(0);
  });

  it('a comma-joined SENTENCE enumerates nothing — clauses are too long to be parts', () => {
    expect(MAX_ITEM_WORDS).toBe(5);
    const prose = 'I have been thinking about this for a while, my shop needs something simple to use, '
      + 'and honestly the other apps are far too complicated for me';
    expect(countEnumeratedFeatures(prose)).toBeLessThanOrEqual(2);
  });

  it('de-duplicates, so a repeated word cannot inflate a gate', () => {
    expect(countEnumeratedFeatures('with billing, billing, Billing, reports')).toBe(2);
  });

  it('is bounded, so a runaway prompt cannot produce a runaway number', () => {
    const many = 'with ' + Array.from({ length: 200 }, (_, i) => `part${i}`).join(', ');
    expect(countEnumeratedFeatures(many)).toBe(MAX_COUNTED);
  });

  it('is total on junk', () => {
    for (const junk of ['', '   ', '\n\n', ',,,,,,', '???']) {
      expect(countEnumeratedFeatures(junk)).toBe(0);
    }
  });
});

describe('megaProjectSignals — the door the admin switched on', () => {
  it('🔴 THE BUG, PINNED: every real project prompt now opens it', () => {
    for (const p of PROJECT_PROMPTS) {
      expect(detectMegaProject(p), `should fire: ${p.slice(0, 50)}`).toBe(true);
    }
  });

  it('🔒 PRECISION: no ordinary app prompt opens it', () => {
    for (const p of ORDINARY_PROMPTS) {
      expect(detectMegaProject(p), `must NOT fire: ${p.slice(0, 50)}`).toBe(false);
    }
  });

  it('a big-software noun with nothing enumerated is not a project — there is nothing to decompose', () => {
    for (const p of ['hospital management system', 'CRM banao', 'make a marketplace like olx']) {
      const s = megaProjectSignals(p);
      expect(s.bigNoun).toBe(true);
      expect(s.fires).toBe(false);
    }
  });

  it('the explicit-scale road is untouched', () => {
    expect(MEGA_SCALE_MIN).toBe(100);
    expect(detectMegaProject('banao ek software with 1000 files, complete ERP')).toBe(true);
    expect(detectMegaProject('an app with 200+ screens for logistics')).toBe(true);
    expect(detectMegaProject('a landing page with 5 pages')).toBe(false);
  });

  it('a long spec with no category noun still fires on its own', () => {
    const parts = Array.from({ length: MEGA_BULLETS_ALONE }, (_, i) => `- feature ${i}`).join('\n');
    const s = megaProjectSignals(`I need an app that does:\n${parts}`);
    expect(s.bigNoun).toBe(false);
    expect(s.fires).toBe(true);
  });

  it('the thresholds sit in the measured GAP, not on an edge', () => {
    const projectCounts = PROJECT_PROMPTS.map((p) => megaProjectSignals(p).features);
    const ordinaryCounts = ORDINARY_PROMPTS.map((p) => megaProjectSignals(p).features);
    // Every ordinary prompt is strictly below the threshold; every project prompt reaches it.
    expect(Math.max(...ordinaryCounts)).toBeLessThan(MEGA_BULLETS_WITH_NOUN);
    expect(Math.min(...projectCounts)).toBeGreaterThanOrEqual(MEGA_BULLETS_WITH_NOUN);
  });
});

describe('appScopeAnalyzer — the sibling gate, hunted in the same change (rule 3)', () => {
  it('a comma-listed ERP now reads as large', () => {
    expect(analyzeAppScope(PROJECT_PROMPTS[1]!).decision).toBe('analyze');
    expect(analyzeAppScope(PROJECT_PROMPTS[2]!).decision).toBe('analyze');
  });

  it('🔒 and no ordinary prompt was dragged in with it — this gate spends a planner call on every build', () => {
    for (const p of ORDINARY_PROMPTS) {
      expect(analyzeAppScope(p).decision, `must stay direct: ${p.slice(0, 50)}`).toBe('direct');
    }
  });
});
