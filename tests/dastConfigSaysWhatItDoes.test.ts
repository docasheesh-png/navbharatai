// THE DAST JOB DOES WHAT ITS COMMENT SAYS (Q-620, forensic audit 2026-10-04).
//
// `.github/workflows/dast.yml` promised "HIGH fails, MED warns" while passing `fail_action: true` without
// `-I`. zap-baseline exits 2 on WARN-only and the action turns exit 1 AND exit 2 into a red job, so every
// nightly run was red: the two read in full (2026-09-30, 2026-10-04) ended
//   FAIL-NEW: 0  WARN-NEW: 11  …  "The process '/usr/bin/docker' failed with exit code 2"
// and `security/zap-baseline.conf` had no FAIL rule at all. The comment and the behaviour disagreed, and a
// check that is always red is a check nobody reads.
//
// This file derives the job's REAL behaviour from its flags and compares it with the promise in the
// comment, and checks the rules file the way the two parsers that read it actually behave:
//   • zaproxy/action-baseline passes the file to ZAP (`-c`) ONLY when it has an IGNORE row
//     (actions-common `processLineByLine` collects IGNORE ids; `if (plugins.length !== 0)` adds `-c`);
//   • that reader does `line.split("\t")[1].trim()`, so a blank line throws and it stops reading there;
//   • ZAP's `load_config` splits each line into exactly three TAB-separated fields.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const ROOT = join(__dirname, '..');
const WORKFLOW = '.github/workflows/dast.yml';

export type ZapAction = 'FAIL' | 'WARN' | 'IGNORE';
export interface ZapRule { id: string; action: ZapAction; reason: string; line: number }

/** Parse a zap-baseline rules file; every problem either parser would trip on is returned, not thrown. */
export function parseZapConf(text: string): { rules: ZapRule[]; problems: string[] } {
  const rules: ZapRule[] = [];
  const problems: string[] = [];
  const lines = text.replace(/\n$/, '').split('\n');
  lines.forEach((raw, i) => {
    const n = i + 1;
    if (raw.startsWith('#')) return;
    if (raw.trim() === '') { problems.push(`line ${n}: blank line (the action's reader stops at it)`); return; }
    const parts = raw.split('\t');
    if (parts.length !== 3) { problems.push(`line ${n}: ${parts.length} TAB-separated fields, ZAP needs exactly 3`); return; }
    const [id, action, reason] = parts.map((p) => p.trim());
    if (!/^\d+$/.test(id)) problems.push(`line ${n}: rule id "${id}" is not numeric`);
    if (action !== 'FAIL' && action !== 'WARN' && action !== 'IGNORE') { problems.push(`line ${n}: action "${action}" is not FAIL, WARN or IGNORE`); return; }
    if (!/^\(.+\)$/.test(reason)) problems.push(`line ${n}: the reason must be a non-empty "(…)"`);
    rules.push({ id, action, reason: reason.replace(/^\(|\)$/g, '').trim(), line: n });
  });
  const seen = new Set<string>();
  for (const r of rules) {
    if (seen.has(r.id)) problems.push(`rule ${r.id} is listed twice (line ${r.line})`);
    seen.add(r.id);
  }
  for (const r of rules) if (r.action === 'IGNORE' && r.reason.length < 30) problems.push(`IGNORE ${r.id} has no real reason: "${r.reason}"`);
  if (!rules.some((r) => r.action === 'IGNORE')) problems.push('no IGNORE row: the action would not pass this file to ZAP at all, and every FAIL rule would be dropped');
  if (!rules.some((r) => r.action === 'FAIL')) problems.push('no FAIL row: nothing could ever fail the job');
  return { rules, problems };
}

/** What the job really does, from the action's own logic: exit 1 = a FAIL, exit 2 = WARN-only. */
export function jobBehaviour(with_: Record<string, unknown>): { failsOnFail: boolean; failsOnWarn: boolean } {
  const failAction = String(with_.fail_action).toLowerCase() === 'true';
  const flags = String(with_.cmd_options ?? '').split(/\s+/);
  const ignoreWarn = flags.includes('-I');
  return { failsOnFail: failAction, failsOnWarn: failAction && !ignoreWarn };
}

const PROMISE = /a FAIL rule in security\/zap-baseline\.conf fails the job; a WARN\s*\n\s*#\s*rule \(and any rule the file does not list\) is reported in the log and the artifact, and does not\./;

function zapStep() {
  const wf = parse(readFileSync(join(ROOT, WORKFLOW), 'utf8'));
  const jobs = Object.values(wf.jobs ?? {}) as { if?: unknown; steps?: { uses?: string; with?: Record<string, unknown>; 'continue-on-error'?: unknown; if?: unknown }[] }[];
  for (const job of jobs) for (const step of job.steps ?? []) if (String(step.uses ?? '').startsWith('zaproxy/action-baseline@')) return { wf, job, step };
  throw new Error('no zaproxy/action-baseline step in ' + WORKFLOW);
}

describe('the rules-file checker (fixtures)', () => {
  it('a well-formed file passes', () => {
    expect(parseZapConf('# c\n10038\tFAIL\t(CSP missing)\n10027\tWARN\t(comments)\n90005\tIGNORE\t(inspects the requests ZAP itself sends)\n').problems).toEqual([]);
  });
  it('🔴 a blank line is caught (the action reader stops there)', () => {
    expect(parseZapConf('10038\tFAIL\t(x)\n\n90005\tIGNORE\t(inspects the requests ZAP itself sends)\n').problems.join()).toMatch(/blank line/);
  });
  it('🔴 a file with no IGNORE row is caught (it would never reach ZAP)', () => {
    expect(parseZapConf('10038\tFAIL\t(x)\n').problems.join()).toMatch(/no IGNORE row/);
  });
  it('🔴 an IGNORE without a reason is caught', () => {
    expect(parseZapConf('10038\tFAIL\t(x)\n90005\tIGNORE\t(noise)\n').problems.join()).toMatch(/IGNORE 90005 has no real reason/);
  });
  it('spaces instead of TABs, a duplicate id and an unknown action are caught', () => {
    const p = parseZapConf('10038 FAIL (x)\n1\tFAIL\t(a)\n1\tWARN\t(b)\n2\tMAYBE\t(c)\n3\tIGNORE\t(inspects the requests ZAP itself sends)\n').problems.join('\n');
    expect(p).toMatch(/1 TAB-separated fields/);
    expect(p).toMatch(/rule 1 is listed twice/);
    expect(p).toMatch(/"MAYBE" is not FAIL/);
  });
  it('the behaviour model matches the action: fail_action without -I fails on WARN', () => {
    expect(jobBehaviour({ fail_action: true, cmd_options: '-a' })).toEqual({ failsOnFail: true, failsOnWarn: true });
    expect(jobBehaviour({ fail_action: true, cmd_options: '-a -I' })).toEqual({ failsOnFail: true, failsOnWarn: false });
    expect(jobBehaviour({ fail_action: false, cmd_options: '-a' })).toEqual({ failsOnFail: false, failsOnWarn: false });
  });
});

describe('🔒 dast.yml and security/zap-baseline.conf', () => {
  it('ZAP stays ON: scheduled, not skipped, not allowed to fail silently', () => {
    const { wf, job, step } = zapStep();
    expect(wf.on?.schedule?.length ?? 0).toBeGreaterThan(0);
    expect(job.if).toBeUndefined();
    expect(step.if).toBeUndefined();
    expect(step['continue-on-error']).toBeUndefined();
  });

  it('the comment promises "FAIL fails, WARN does not", and the flags do exactly that', () => {
    const text = readFileSync(join(ROOT, WORKFLOW), 'utf8');
    expect(text, 'the promise comment above cmd_options is gone or reworded').toMatch(PROMISE);
    expect(jobBehaviour(zapStep().step.with ?? {})).toEqual({ failsOnFail: true, failsOnWarn: false });
  });

  it('the rules file the step names exists and both parsers can read all of it', () => {
    const file = String(zapStep().step.with?.rules_file_name ?? '');
    expect(file).toBe('security/zap-baseline.conf');
    expect(existsSync(join(ROOT, file))).toBe(true);
    const { problems } = parseZapConf(readFileSync(join(ROOT, file), 'utf8'));
    expect(problems).toEqual([]);
  });

  it('the rules file says the same thing about -I as the workflow', () => {
    const conf = readFileSync(join(ROOT, 'security/zap-baseline.conf'), 'utf8');
    expect(conf).toMatch(/the workflow passes -I, so a WARN never fails the job/);
    expect(String(zapStep().step.with?.cmd_options)).toMatch(/(^|\s)-I(\s|$)/);
  });

  it('every rule the real nightly scan ran is classified (the 70 ids of the 2026-09-30 run)', () => {
    // From the job log of 2026-09-30 (job 109818211803): 59 PASS + 11 WARN-NEW lines, ids in brackets. The
    // 2026-10-04 run printed the same totals (PASS: 59, WARN-NEW: 11).
    const RAN = ['10003', '10009', '10010', '10011', '10015', '10017', '10019', '10020', '10021', '10023', '10024', '10025',
      '10026', '10027', '10028', '10029', '10030', '10031', '10032', '10033', '10034', '10035', '10036', '10037', '10038',
      '10039', '10040', '10041', '10042', '10043', '10044', '10049', '10050', '10052', '10054', '10055', '10056', '10057',
      '10061', '10062', '10063', '10094', '10096', '10097', '10098', '10099', '10105', '10108', '10109', '10110', '10111',
      '10112', '10113', '10115', '10116', '10202', '110009', '2', '3', '50001', '50003', '90001', '90002', '90003', '90004',
      '90005', '90011', '90022', '90030', '90033'];
    expect(RAN.length).toBe(70);
    const listed = new Set(parseZapConf(readFileSync(join(ROOT, 'security/zap-baseline.conf'), 'utf8')).rules.map((r) => r.id));
    expect(RAN.filter((id) => !listed.has(id))).toEqual([]);
  });

  it('no rule that fired on the real runs is FAIL (red must mean a regression, not the known WARNs)', () => {
    // The 11 WARN-NEW ids of the 2026-09-30 and 2026-10-04 runs. FAILing any of them would make the job red
    // every night again — the exact state this item fixed.
    const FIRED = ['10027', '10049', '10055', '10063', '10094', '10096', '10109', '10110', '90003', '90004', '90005'];
    const rules = parseZapConf(readFileSync(join(ROOT, 'security/zap-baseline.conf'), 'utf8')).rules;
    expect(rules.filter((r) => FIRED.includes(r.id) && r.action === 'FAIL').map((r) => r.id)).toEqual([]);
  });
});
