import { describe, it, expect, afterEach } from 'vitest';
import {
  generateFuzzPlan,
  interpretFuzzErrors,
  fuzzSummary,
  fuzzRepairPrompt,
  redTeamEnabled,
  type FuzzInput,
  type FuzzCase,
  type FuzzVerdict,
} from './FuzzProbe';

describe('generateFuzzPlan — finds the app inputs and builds adversarial cases', () => {
  it('returns [] for blank / non-string html', () => {
    expect(generateFuzzPlan('')).toEqual([]);
    // @ts-expect-error — defensive against a non-string at runtime
    expect(generateFuzzPlan(null)).toEqual([]);
  });

  it('prefers #id, then [name], then [placeholder] as the selector', () => {
    const html =
      '<input id="taskInput" type="text"/>' +
      '<input name="qty" type="number"/>' +
      '<input placeholder="Search…" type="search"/>';
    const plan = generateFuzzPlan(html);
    expect(plan[0].input.selector).toBe('#taskInput');
    expect(plan[1].input.selector).toBe('input[name="qty"]');
    expect(plan[2].input.selector).toBe('input[placeholder="Search…"]');
  });

  it('maps the input type to the right kind and adversarial cases', () => {
    const num = generateFuzzPlan('<input type="number" name="age"/>')[0];
    expect(num.input.kind).toBe('number');
    expect(num.cases.some((c) => c.value === '-1')).toBe(true);
    expect(num.cases.some((c) => c.value === 'abc')).toBe(true);

    const email = generateFuzzPlan('<input type="email" name="e"/>')[0];
    expect(email.input.kind).toBe('email');
    expect(email.cases.some((c) => c.value === 'notanemail')).toBe(true);
  });

  it('treats a bare/unknown input as free text with the text catalog (empty + injection cases)', () => {
    const t = generateFuzzPlan('<input name="title"/>')[0];
    expect(t.input.kind).toBe('text');
    expect(t.cases.some((c) => c.value === '')).toBe(true);
    expect(t.cases.some((c) => /DROP TABLE/.test(c.value))).toBe(true);
  });

  it('SKIPS non-value inputs (hidden/checkbox/radio/submit/button/file)', () => {
    const html =
      '<input type="hidden" name="csrf"/>' +
      '<input type="checkbox"/>' +
      '<input type="radio"/>' +
      '<input type="submit"/>' +
      '<input type="button"/>' +
      '<input type="file"/>' +
      '<input type="text" name="real"/>';
    const plan = generateFuzzPlan(html);
    expect(plan).toHaveLength(1);
    expect(plan[0].input.selector).toBe('input[name="real"]');
  });

  it('includes <textarea> and gives positional nth selectors when no id/name/placeholder', () => {
    const html = '<textarea></textarea><textarea></textarea>';
    const plan = generateFuzzPlan(html);
    expect(plan).toHaveLength(2);
    expect(plan[0].input.kind).toBe('textarea');
    expect(plan[0].input.selector).toBe('textarea >> nth=0');
    expect(plan[1].input.selector).toBe('textarea >> nth=1');
  });

  it('caps the number of inputs so a huge form cannot slow the build unboundedly', () => {
    const html = Array.from({ length: 20 }, (_, i) => `<input type="text" name="f${i}"/>`).join('');
    const plan = generateFuzzPlan(html);
    expect(plan.length).toBeLessThanOrEqual(6);
    // Each input carries a bounded set of cases too.
    for (const t of plan) expect(t.cases.length).toBeLessThanOrEqual(4);
  });
});

describe('interpretFuzzErrors — only real crashes count', () => {
  it('flags an uncaught TypeError as a crash', () => {
    const v = interpretFuzzErrors(['Uncaught TypeError: Cannot read properties of undefined (reading "map")']);
    expect(v.crashed).toBe(true);
    expect(v.evidence).toHaveLength(1);
  });

  it('flags a minified React error / unhandled rejection', () => {
    expect(interpretFuzzErrors(['Minified React error #310']).crashed).toBe(true);
    expect(interpretFuzzErrors(['Unhandled promise rejection: boom']).crashed).toBe(true);
    expect(interpretFuzzErrors(['Maximum update depth exceeded']).crashed).toBe(true);
  });

  it('does NOT flag benign warnings / network noise', () => {
    const v = interpretFuzzErrors([
      'Warning: each child in a list should have a unique key',
      'Failed to load resource: 404',
      'Download the React DevTools',
    ]);
    expect(v.crashed).toBe(false);
    expect(v.evidence).toHaveLength(0);
  });

  it('dedupes and caps evidence, tolerates non-string entries', () => {
    const dupes = Array.from({ length: 10 }, () => 'Uncaught ReferenceError: x is not defined');
    // @ts-expect-error — defensive against a non-string entry at runtime
    const v = interpretFuzzErrors([...dupes, 42, null]);
    expect(v.crashed).toBe(true);
    expect(v.evidence).toHaveLength(1); // all identical → deduped
  });
});

describe('summary + repair prompt', () => {
  const input: FuzzInput = { selector: '#age', kind: 'number', label: 'Age' };
  const fcase: FuzzCase = { value: '-1', probe: 'negative value (range/validation handling)' };
  const verdict: FuzzVerdict = { crashed: true, evidence: ['Uncaught TypeError: bad'] };
  const findings = [{ input, case: fcase, verdict }];

  it('summary names the crashing input, empty when none', () => {
    expect(fuzzSummary([])).toBe('');
    const s = fuzzSummary(findings);
    expect(s).toMatch(/Red-team/);
    expect(s).toMatch(/Age/);
  });

  it('repair prompt asks to harden the source, empty when none', () => {
    expect(fuzzRepairPrompt([])).toBe('');
    const p = fuzzRepairPrompt(findings);
    expect(p).toMatch(/Harden the SOURCE/);
    expect(p).toMatch(/Age/);
  });
});

describe('redTeamEnabled — opt-in flag', () => {
  const prev = process.env.AGENTV3_REDTEAM;
  afterEach(() => {
    if (prev === undefined) delete process.env.AGENTV3_REDTEAM;
    else process.env.AGENTV3_REDTEAM = prev;
  });
  it('is OFF by default (unset)', () => {
    delete process.env.AGENTV3_REDTEAM;
    expect(redTeamEnabled()).toBe(false);
  });
  it('is ON for any explicit yes, OFF otherwise', () => {
    // CONTRACT CHANGED DELIBERATELY (audit finding #1, 2026-08-09): the old strictness was the
    // DEFECT, not a safeguard — rejecting `true`/`1` bought no safety (an admin typing them plainly
    // means ON) while `on` vs `true` silently disagreed across the codebase. One shared parser now
    // accepts every spelling of yes/no; an opt-in still requires an EXPLICIT yes, which is the part
    // that actually mattered.
    for (const v of ['on', 'true', '1']) {
      process.env.AGENTV3_REDTEAM = v;
      expect(redTeamEnabled(), v).toBe(true);
    }
    for (const v of ['off', 'false', '0', '']) {
      process.env.AGENTV3_REDTEAM = v;
      expect(redTeamEnabled(), v).toBe(false);
    }
  });
});
