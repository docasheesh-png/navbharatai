import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { verifiedNoChangeSummary } from '../src/server/routes/agentv3';
import { buildFindingSuggestions } from '../src/server/AgentV3/buildFindingSuggestions';

/**
 * "REPAIR SOME PARTS." — AND WE HELD THE LIST (report a48d0f9e, 2026-09-19).
 *
 * The user asked to fix things. The turn ran a typecheck and a lint, both clean, changed no file, and
 * answered *"Nothing needed changing … it works"* plus *"tell me exactly what's not working"*. The same
 * build had already recorded `ACCESSIBILITY — 34 form field(s) with no label across 21 files`, thirty-five
 * seconds earlier, and a YELLOW release gate. We asked the user to name a defect while holding
 * thirty-four of them.
 *
 * The findings reach the 💡 bulb through `buildFindingSuggestions` — a separate surface, fed by the
 * PREVIOUS build's saved report. What was missing is that they never reached the sentence answering the
 * question they were an answer to.
 */
const base = {
  expectsArtifacts: true,
  filesWritten: 0,
  sandboxUnavailable: false,
  isEditMode: true,
  existingProjectFiles: 31,
  userAskedToBuildAnApp: false,
  appRendered: true,
};

describe('a check-and-finish turn names what it already measured', () => {
  it('🔴 with open findings, the reply names them instead of asking the user to', () => {
    const s = verifiedNoChangeSummary({ ...base, openFindings: ['Make it usable for everyone'] })!;
    expect(s).toContain('Make it usable for everyone');
    expect(s).toMatch(/1 thing worth fixing/);
    expect(s).toContain("Say the word and I'll fix them");
    // The old sentence's central claim must not survive beside a list of things to fix.
    expect(s).not.toContain('Nothing needed changing');
  });

  it('several findings read as a sentence, not a dump', () => {
    const s = verifiedNoChangeSummary({
      ...base, openFindings: ['Make it usable for everyone', 'Fix the failing tests', 'Untangle the circular imports'],
    })!;
    expect(s).toContain('Make it usable for everyone, Fix the failing tests and Untangle the circular imports');
    expect(s).toMatch(/3 things worth fixing/);
  });

  it('🔒 WITH NO FINDINGS IT IS BYTE-IDENTICAL to what it has always said', () => {
    const before = 'Nothing needed changing — I checked your app from end to end and it works. '
      + 'It compiles, the production build succeeds, the server starts, and I opened it in a real browser '
      + 'and watched it render. No file was modified, because none had to be.';
    expect(verifiedNoChangeSummary({ ...base, openFindings: [] })).toBe(before);
    expect(verifiedNoChangeSummary(base)).toBe(before);           // absent behaves as empty
    expect(verifiedNoChangeSummary({ ...base, openFindings: ['', '   '] })).toBe(before); // blanks are not findings
  });

  it('🔒 every refusal that guarded this sentence still guards it — findings do not buy a pass', () => {
    const f = ['Make it usable for everyone'];
    expect(verifiedNoChangeSummary({ ...base, openFindings: f, appRendered: false })).toBeNull();
    expect(verifiedNoChangeSummary({ ...base, openFindings: f, userAskedToBuildAnApp: true })).toBeNull();
    expect(verifiedNoChangeSummary({ ...base, openFindings: f, sandboxUnavailable: true })).toBeNull();
    expect(verifiedNoChangeSummary({ ...base, openFindings: f, isEditMode: false })).toBeNull();
    expect(verifiedNoChangeSummary({ ...base, openFindings: f, filesWritten: 2 })).toBeNull();
    expect(verifiedNoChangeSummary({ ...base, openFindings: f, existingProjectFiles: 0 })).toBeNull();
  });
});

describe('the findings it names are exactly the ones the 💡 bulb would offer', () => {
  it('the real report a48d0f9e recorded ACCESSIBILITY as offerable, and it becomes the reply', () => {
    // The two unresolved findings from that build, verbatim in shape.
    const issues = [
      { code: 'ACCESSIBILITY', autoResolved: false },
      { code: 'RELEASE_GATE', autoResolved: false },
    ];
    const titles = buildFindingSuggestions(issues, 3).map((x) => x.title);
    expect(titles).toContain('Make it usable for everyone');

    const s = verifiedNoChangeSummary({ ...base, openFindings: titles })!;
    expect(s).toContain('Make it usable for everyone');
  });

  it('🔒 a finding the build already FIXED is never offered as a thing to fix', () => {
    // ⚠️ The first draft of this file asserted that RELEASE_GATE stays out. That assertion could not
    // fail: RELEASE_GATE is in `NEVER_SUGGEST` **and** absent from the suggestion table, so deleting it
    // from the exclusion list changed nothing — proven by reverting it and watching all six cases pass.
    // The `autoResolved` filter is the one that CAN break, so that is what is asserted instead.
    expect(buildFindingSuggestions([{ code: 'ACCESSIBILITY', autoResolved: true }], 3)).toEqual([]);
    expect(buildFindingSuggestions([{ code: 'ACCESSIBILITY', autoResolved: false, observation: true }], 3)).toEqual([]);
  });

  it('🔒 the call site asks the SAME table the bulb asks — never a second vocabulary', () => {
    const route = readFileSync(join(__dirname, '..', 'src', 'server', 'routes', 'agentv3.ts'), 'utf8');
    expect(route).toMatch(/openFindings = buildFindingSuggestions\(buildDiag\.report\(\)\?\.issues, 3\)\.map/);
    // Best-effort by construction: the user's answer may never depend on a diagnostics read.
    const idx = route.indexOf('openFindings = buildFindingSuggestions');
    expect(route.slice(Math.max(0, idx - 200), idx)).toContain('try {');

    // 🔴 AND IT MUST ACTUALLY BE HANDED OVER. Computing the list and then not passing it IS the
    // original bug, and the first draft of this guard did not notice: reverting only the argument left
    // all six cases green, because the line that COMPUTES it was still there. Assert the options object.
    const call = route.slice(route.indexOf('const verifiedNoChange = verifiedNoChangeSummary({'));
    expect(call.slice(0, call.indexOf('});') + 3)).toContain('openFindings,');
  });
});
