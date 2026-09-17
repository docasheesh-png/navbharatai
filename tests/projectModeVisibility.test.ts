// WHY DID SOFTWARE PROJECT MODE NOT RUN? — the gate now answers, on both branches.
//
// THE REAL INCIDENT THIS ENCODES (2026-09-17). The admin was asked to enable Software Project Mode
// for their own account first and set:
//
//     AGENTV3_PROJECT_MODE = doc.asheesh@iclod.com
//
// one character short of `icloud.com`. `projectModeEnabled` matches EXACTLY, so that value is `false`
// for ever — and the gate recorded nothing on either branch, so the only way to discover it was to
// send a mega-prompt and notice that nothing happened. That symptom is identical to the prompt being
// below the threshold, to the mega-app roadmap taking the build first, and to the feature being
// broken. Four causes, one silence.
//
// The fix changes no decision. It makes the decision say itself — the same shape as the E2B rate
// mismatch warning and the `[BRAVE] search rejected` line, both of which exist because a wrong
// configuration that fails silently is indistinguishable from a right one.
//
// Every guard below is proven by REVERSION: restoring the old behaviour fails the suite.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  detectMegaProject,
  megaProjectSignals,
  projectModeDiagnosis,
  MEGA_SCALE_MIN,
  MEGA_BULLETS_WITH_NOUN,
  MEGA_BULLETS_ALONE,
} from '../src/server/AgentV3/ProjectPlan';

const ACCOUNT = 'doc.asheesh@icloud.com';
const TYPO = 'doc.asheesh@iclod.com';

/** The prompt the admin was given to test project mode: a big-software noun plus 10 bullets. */
const SCHOOL_ERP = `Build a full-fledged school management system (ERP).
- Student admission and profiles
- Teacher and staff management
- Class and timetable scheduling
- Attendance tracking
- Exam and grading
- Fee collection and receipts
- Parent portal with notifications
- Library management
- Transport and bus routes
- Admin dashboard with reports`;

const base = {
  identity: { userId: 'uid-1', email: ACCOUNT },
  isNewBuild: true,
  isEditMode: false,
  prompt: SCHOOL_ERP,
};

describe('megaProjectSignals — the thresholds, and the verdict they produce', () => {
  it('the admin test prompt fires: a big-software noun with 10 enumerated lines', () => {
    const s = megaProjectSignals(SCHOOL_ERP);
    expect(s.bigNoun).toBe(true);
    expect(s.bullets).toBe(10);
    expect(s.fires).toBe(true);
  });

  it('a big noun with NO enumerated lines does NOT fire — the case the admin was warned about', () => {
    // "ek social media website banao": the noun is there, the spec is not.
    const s = megaProjectSignals('build a social network website');
    expect(s.bigNoun).toBe(true);
    expect(s.bullets).toBe(0);
    expect(s.fires).toBe(false);
  });

  it(`a big noun needs ${MEGA_BULLETS_WITH_NOUN} lines — ${MEGA_BULLETS_WITH_NOUN - 1} is below it`, () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `- feature ${i + 1}`).join('\n');
    expect(megaProjectSignals(`a CRM\n${lines(MEGA_BULLETS_WITH_NOUN - 1)}`).fires).toBe(false);
    expect(megaProjectSignals(`a CRM\n${lines(MEGA_BULLETS_WITH_NOUN)}`).fires).toBe(true);
  });

  it(`without a big noun it takes ${MEGA_BULLETS_ALONE} lines`, () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `${i + 1}. feature ${i + 1}`).join('\n');
    expect(megaProjectSignals(lines(MEGA_BULLETS_ALONE - 1)).fires).toBe(false);
    expect(megaProjectSignals(lines(MEGA_BULLETS_ALONE)).fires).toBe(true);
  });

  it(`an explicit scale of ${MEGA_SCALE_MIN}+ files fires on its own`, () => {
    expect(megaProjectSignals('a tool with 120 pages').fires).toBe(true);
    expect(megaProjectSignals('a tool with 12 pages').fires).toBe(false);
  });

  it('never throws on junk, and an empty prompt is not a mega-project', () => {
    for (const junk of ['', '   ', '\n\n', null as unknown as string, undefined as unknown as string]) {
      expect(() => megaProjectSignals(junk)).not.toThrow();
      expect(megaProjectSignals(junk).fires).toBe(false);
    }
  });

  // ⚠️ REVERSION GUARD. `detectMegaProject` is now literally this function's `fires` field. If a
  // later change re-implements the rules in either place, the two disagree and this fails — which
  // is the whole point of collapsing them: a report that RE-DERIVES a verdict is a second
  // implementation waiting to drift from the first.
  it('detectMegaProject IS megaProjectSignals().fires — one source of truth, no second copy', () => {
    const prompts = [
      SCHOOL_ERP,
      'build a social network website',
      'a marketplace\n- a\n- b\n- c\n- d\n- e\n- f\n- g\n- h',
      'plain todo app',
      'an app with 500 screens',
      '',
    ];
    for (const p of prompts) expect(detectMegaProject(p)).toBe(megaProjectSignals(p).fires);
  });
});

describe('projectModeDiagnosis — the four causes of the same silence, now distinguishable', () => {
  it('unset: says it is OFF for everyone and how to turn it on', () => {
    const d = projectModeDiagnosis({ ...base, flagRaw: undefined });
    expect(d.skipReason).toBe('not-configured');
    expect(d.message).toMatch(/NOT configured/i);
    expect(d.detail).toMatch(/AGENTV3_PROJECT_MODE/);
  });

  // 🔴 THE INCIDENT ITSELF.
  it('the mistyped domain is reported as an allowlist MISS, not as silence', () => {
    const d = projectModeDiagnosis({ ...base, flagRaw: TYPO });
    expect(d.skipReason).toBe('account-not-on-allowlist');
    expect(d.message).toMatch(/allowlist of 1 entry/);
    expect(d.detail).toMatch(/EXACT/);
    // The remedy has to be in the text, or the line only restates the symptom.
    expect(d.detail).toMatch(/signs in with/i);
  });

  it('the identity is MASKED — `detail` survives userFacingReport verbatim', () => {
    const d = projectModeDiagnosis({ ...base, flagRaw: TYPO });
    expect(d.detail).not.toContain(ACCOUNT);
    expect(d.detail).not.toContain('uid-1');
    // Enough must survive to spot a wrong domain — that is why it is printed at all.
    expect(d.detail).toContain('@icloud.com');
    expect(d.detail).toContain('doc***');
  });

  it('a comma list containing the account enables it — the recommended fix works', () => {
    const d = projectModeDiagnosis({ ...base, flagRaw: `${TYPO}, ${ACCOUNT}, someone@else.com` });
    expect(d.skipReason).toBeNull();
    expect(d.message).toMatch(/IS a mega-project/);
  });

  it('a plain "on" enables it for an account that is on no list', () => {
    const d = projectModeDiagnosis({ ...base, flagRaw: 'on', identity: { email: 'anyone@example.com' } });
    expect(d.skipReason).toBeNull();
  });

  it('"off" reads as an OFF switch, never as a one-entry allowlist', () => {
    const d = projectModeDiagnosis({ ...base, flagRaw: 'off' });
    expect(d.skipReason).toBe('account-not-on-allowlist');
    expect(d.skipReason).not.toBeNull();
  });

  it('pre-empted: names the mega-app roadmap instead of looking like a failure', () => {
    const d = projectModeDiagnosis({ ...base, flagRaw: 'on', preEmptedBy: 'mega-roadmap' });
    expect(d.skipReason).toBe('pre-empted');
    expect(d.message).toMatch(/mega-app roadmap/);
    expect(d.detail).toMatch(/default-ON|needs no key/);
  });

  it('an edit turn is reported as an edit, not as a threshold miss', () => {
    const d = projectModeDiagnosis({ ...base, flagRaw: 'on', isEditMode: true });
    expect(d.skipReason).toBe('not-a-new-build');
  });

  // The most useful line of the whole change: it tells the admin how to write a prompt that fires.
  it('below threshold: quotes the REAL counts and the exact numbers needed', () => {
    const d = projectModeDiagnosis({ ...base, flagRaw: 'on', prompt: 'build a social network website' });
    expect(d.skipReason).toBe('below-threshold');
    expect(d.detail).toMatch(/0 enumerated feature lines/);
    expect(d.detail).toMatch(/big-software noun: yes/);
    expect(d.detail).toContain(String(MEGA_BULLETS_WITH_NOUN));
    expect(d.detail).toContain(String(MEGA_BULLETS_ALONE));
  });

  it('the counts it prints are the ones the gate decided on, never a second derivation', () => {
    const d = projectModeDiagnosis({ ...base, flagRaw: 'on' });
    expect(d.detail).toContain(`${megaProjectSignals(SCHOOL_ERP).bullets} enumerated feature lines`);
  });

  it('is advisory and total: every branch returns a string, and nothing throws', () => {
    const cases = [
      { flagRaw: null }, { flagRaw: '  ' }, { flagRaw: ',,,' }, { flagRaw: 'on', identity: {} },
      { flagRaw: ACCOUNT, identity: { email: null, userId: null } }, { flagRaw: 'on', prompt: undefined },
    ];
    for (const c of cases) {
      expect(() => projectModeDiagnosis(c)).not.toThrow();
      const d = projectModeDiagnosis(c);
      expect(d.code).toBe('PROJECT_MODE');
      expect(typeof d.message).toBe('string');
      expect(d.message.length).toBeGreaterThan(0);
      expect(typeof d.detail).toBe('string');
    }
  });

  it('a value of only separators is an empty allowlist, not an enable', () => {
    expect(projectModeDiagnosis({ ...base, flagRaw: ' , , ' }).skipReason).toBe('account-not-on-allowlist');
  });
});

describe('wiring — the route records it on BOTH branches', () => {
  // Comments are STRIPPED before matching: the first draft of a guard like this in this repo passed
  // against the very comment that documented the bug.
  const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('imports and calls projectModeDiagnosis', () => {
    expect(route).toMatch(/import\s*\{[^}]*projectModeDiagnosis[^}]*\}\s*from\s*'\.\.\/AgentV3\/ProjectPlan'/);
    expect(route).toMatch(/projectModeDiagnosis\(\{/);
  });

  // ⚠️ REVERSION GUARD: recording it INSIDE the `if` would only ever explain the branch that ran —
  // i.e. it would say nothing in exactly the case the admin needs explained.
  it('records the line BEFORE the gate branches, so a SKIP is explained too', () => {
    const call = route.indexOf('projectModeDiagnosis({');
    const gate = route.indexOf('if (projectModeEnabled(process.env');
    expect(call).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(-1);
    expect(call).toBeLessThan(gate);
  });

  it('the record cannot break a build — it is wrapped in a swallowing try/catch', () => {
    const at = route.indexOf('projectModeDiagnosis({');
    const around = route.slice(Math.max(0, at - 400), at + 900);
    expect(around).toMatch(/try\s*\{/);
    expect(around).toMatch(/\}\s*catch\s*\{/);
  });
});
