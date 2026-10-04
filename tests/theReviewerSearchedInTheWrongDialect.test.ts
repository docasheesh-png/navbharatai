// AUTOPSY 15151196 (2026-09-27) — a memory match card game. The app was green in 82 s. Then:
//   • the reviewer asked `grep` for `.badge|.alert|.muted|.primary` in src/index.css, got "(no
//     matches)" twice, and filed two CRITICALs that the classes were missing — they were at lines
//     64–137 (the tool ran a BASIC regex, where `|` is a literal bar);
//   • the repair agent checked, found them, said "false alarm", and changed NO file — and the user
//     was told "a final review found 2 real problems. They were fixed";
//   • the capture of the running app came back 30,001 bytes with 0 buttons, because our own 18 KB
//     preview bridge filled the budget before the body;
//   • the model read src/App.tsx four times in ONE turn, and every copy rode in every later turn.
// One test per defect, each against the report's own facts.

import { describe, it, expect } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  greenRepairOutcome, greenRepairUserLine, changedWorkspacePaths,
} from '../src/server/AgentV3/greenReviewPolicy';
import { grepCommand, readGrepOutput, grepModes, GREP_RESULT_MARK } from '../src/server/AgentV3/grepTool';
import { browsePageScript } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { PREVIEW_BRIDGE_MARKER } from '../src/server/AgentV3/previewBridge';
import { duplicateReadsInTurn } from '../src/server/AgentV3/AgentRunner';

const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

describe('🔴 a repair that changed nothing is not a repair', () => {
  const base = { kept: true, reverted: false, timedOut: false, finished: true, count: 2, budgetMs: 60_000 };
  it('zero files changed ⇒ NO_CHANGE, and the user is told nothing was fixed', () => {
    const o = greenRepairOutcome({ ...base, changed: 0 });
    expect(o.code).toBe('REVIEW_FUNCTIONAL_NO_CHANGE');
    expect(o.message).toMatch(/changed no file/);
    expect(greenRepairUserLine(2, 0)).toBe('');
  });
  it('a real change is still reported as a repair', () => {
    expect(greenRepairOutcome({ ...base, changed: 1 }).code).toBe('REVIEW_FUNCTIONAL_REPAIRED');
    expect(greenRepairUserLine(2, 1)).toMatch(/They were fixed/);
  });
  it('a caller that could not count keeps the old reading', () => {
    expect(greenRepairOutcome(base).code).toBe('REVIEW_FUNCTIONAL_REPAIRED');
    expect(greenRepairUserLine(2)).toMatch(/fixed/);
  });
  it('changed paths are measured: edits, additions and removals', () => {
    expect(changedWorkspacePaths({ a: '1', b: '2' }, { a: '1', b: '2' })).toEqual([]);
    expect(changedWorkspacePaths({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' })).toEqual(['b', 'c']);
    expect(changedWorkspacePaths({ a: '1', b: '2' }, { a: '1' })).toEqual(['b']);
  });
  it('the route measures the pass against its own snapshot and gates the user line on it', () => {
    expect(route).toContain('repairChanged = changedWorkspacePaths(greenSnap, (await collectWorkspaceFiles(actuator, workspaceId)).files).length;');
    expect(route).toContain('if (vr.kept && repairOk && repairChanged !== 0) {');
    expect(route).toContain('greenRepairUserLine(greenRepaired.length, repairChanged)');
    // Autopsy 972acde5 added `refuted` after it; the count still reaches the outcome.
    expect(route).toContain('changed: repairChanged, refuted: repairRefutedAll() && repairChanged !== 0 }');
    // The narration no longer calls a reviewer's claim "real" before anyone has checked it.
    expect(route).not.toContain('fixing ${greenRepairable.length} real problem(s)');
  });
});

describe('🔴 grep answers what the model meant, and never calls a failure "no matches"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nbai-grep-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/index.css'), 'button.primary { a: 1 }\nsmall, .muted { b: 2 }\n.badge { c: 3 }\n.alert { d: 4 }\nuseState(1)\n');
  const run = (pattern: string, path = 'src/index.css') =>
    readGrepOutput(execSync(grepCommand(pattern, path, ['node_modules']), { cwd: dir, shell: '/bin/sh' }).toString(), pattern);

  it('the report’s own alternation finds all four classes', () => {
    const r = run('\\.badge|\\.alert|\\.muted|\\.primary');
    expect(r.matchedAs).toBe('extended regex');
    for (const c of ['.badge', '.alert', '.muted', '.primary']) expect(r.text).toContain(c);
  });
  it('the basic-regex spelling still works', () => expect(run('\\.badge\\|\\.alert').matchedAs).toBe('basic regex'));
  it('an unbalanced paren is found as the text the model typed', () => expect(run('useState(').text).toContain('useState(1)'));
  it('plain text is searched literally, and a real miss says so', () => {
    expect(grepModes('badge')).toEqual(['F']);
    expect(run('badge').matchedAs).toBe('literal text');
    expect(run('nothing-here').text).toBe('(no matches)');
  });
  it('a search that could not run is NOT reported as "no matches"', () => {
    const r = run('\\.badge|\\.alert', 'missing.css');
    expect(r.failed).toBe(true);
    expect(r.text).not.toBe('(no matches)');
    expect(r.text).toMatch(/No such file/);
  });
  it('output with no status is "unknown", never an absence', () => {
    expect(readGrepOutput('', 'x').failed).toBe(true);
    expect(readGrepOutput(`${GREP_RESULT_MARK}F:1\n`, 'x').text).toBe('(no matches)');
  });
  it('the dispatcher uses it — the bare BRE walk is gone', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    expect(src).toContain('grepCommand(pattern, path, EXCLUDED_DIRS)');
    expect(src).not.toMatch(/`grep -rn \$\{excludes\}/);
  });
});

describe('🔴 our bridge no longer eats the app’s DOM budget', () => {
  const script = browsePageScript('https://5173-x.e2b.app');
  it('the bridge node is removed, by its own marker, before the page is read', () => {
    const dropAt = script.indexOf(JSON.stringify(PREVIEW_BRIDGE_MARKER));
    expect(dropAt).toBeGreaterThan(-1);
    expect(dropAt).toBeLessThan(script.indexOf('(await p.content()).slice(0,30000)'));
    expect(script.indexOf('NBAI_PAINTED')).toBeLessThan(dropAt); // the paint wait already ran
  });
  it('the generated script still parses, in both console modes', () => {
    for (const s of [script, browsePageScript('https://5173-x.e2b.app', { recordConsole: false })]) {
      const d = mkdtempSync(join(tmpdir(), 'nbai-browse-'));
      writeFileSync(join(d, 'b.cjs'), s);
      expect(() => execFileSync(process.execPath, ['--check', join(d, 'b.cjs')], { stdio: 'pipe' })).not.toThrow();
    }
  });
});

describe('🔴 one turn, one read per file', () => {
  const tu = (id: string, name: string, input: Record<string, unknown>) => ({ id, name, input });
  it('the report’s turn: App.tsx ×4 is read once, the rest point at it', () => {
    const uses = [0, 1, 2, 3].map((i) => tu(`r${i}`, 'read_file', { path: 'src/App.tsx' }));
    const d = duplicateReadsInTurn(uses, [0, 1, 2, 3]);
    expect([...d.entries()]).toEqual([[1, 0], [2, 0], [3, 0]]);
  });
  it('key order does not make a different call; a different range does', () => {
    const uses = [
      tu('a', 'read_file', { path: 'x.ts', offset: 1 }), tu('b', 'read_file', { offset: 1, path: 'x.ts' }),
      tu('c', 'read_file', { path: 'x.ts', offset: 200 }),
    ];
    expect([...duplicateReadsInTurn(uses, [0, 1, 2]).keys()]).toEqual([1]);
  });
  it('LLM-backed tools and sub-agents are never collapsed', () => {
    const uses = [tu('a', 'second_opinion', { q: 'x' }), tu('b', 'second_opinion', { q: 'x' }), tu('c', 'task', { role: 'explorer' }), tu('d', 'task', { role: 'explorer' })];
    expect(duplicateReadsInTurn(uses, [0, 1, 2, 3]).size).toBe(0);
  });
});

// ── The three follow-ups the admin accepted the same day ("apki sabhi salah accepted") ──────────────
import { scaffoldedComplexityDecision } from '../src/server/AgentV3/complexityRouting';
import { missingClassClaim, classIsDefined, refuteReviewByEvidence } from '../src/server/AgentV3/reviewEvidence';

describe('🧩 a tested template opens on the first rung', () => {
  it('the scaffolded decision is simple, keeps the score for the report, and names why', () => {
    const d = scaffoldedComplexityDecision(63);
    expect(d).toMatchObject({ verdict: 'simple', score: 63, source: 'scaffold' });
    expect(d.reason).toMatch(/tested template/);
    expect(scaffoldedComplexityDecision(Number.NaN).score).toBe(0);
  });
  it('the route asks the same questions the seeding asks, and buys no model call for it', () => {
    expect(route).toContain("const scaffoldWillSeed = process.env.AGENTV3_GOLDEN_SCAFFOLD !== 'off' && intent === 'new_build' && !isImportTurn && !!goldenScaffoldForPrompt(prompt);");
    expect(route).toContain('const promptComplexityDecision = scaffoldWillSeed ? scaffoldedComplexityDecision(analysis?.complexityScore ?? 0) : await decideComplexity(');
  });
});

describe('🔎 a reviewer claim a file can answer is checked before a repair is spent', () => {
  // Verbatim from the report.
  const FIRST = '[CRITICAL] (confidence: high) `className="badge"`, `className="alert alert-success"`, `className="muted"`, and `className="primary"` are used in `src/App.tsx`, but none of these classes are defined in `src/index.css`. The shipped CSS defines only the `.nb-*` recipe namespace.';
  const SECOND = '[CRITICAL] (confidence: medium) The card grid buttons rely on inline `style` props for layout and color, so they will render, but the missing classes still leave the rest of the UI visually broken compared to the intended design.';
  const CSS = { 'src/index.css': 'button[type="submit"], .btn-primary, .primary, button.primary { x: 1 }\nsmall, .muted { y: 2 }\n.badge { z: 3 }\n.alert { a: 4 }\n.alert-success { b: 5 }\n' };
  const review = (issues: Array<{ severity: 'critical' | 'warning'; message: string }>) =>
    ({ passed: false, score: 65, summary: issues[0]?.message ?? '', issues } as never);

  it('reads the class names out of the report’s own sentence', () => {
    expect(missingClassClaim(FIRST)).toEqual(['badge', 'alert', 'alert-success', 'muted', 'primary']);
    expect(missingClassClaim(SECOND)).toBeNull(); // names nothing — it rides on the first
    expect(missingClassClaim('[WARNING] The badge colour is too faint on dark mode.')).toBeNull();
  });
  it('a selector counts; a longer class that merely starts with the name does not', () => {
    expect(classIsDefined('primary', CSS)).toBe(true);
    expect(classIsDefined('alert', { a: '.alert-success { }' })).toBe(false);
  });
  it('both findings fall when every named class is defined — no repair, no suggestion, no failed verdict', () => {
    const r = refuteReviewByEvidence(review([{ severity: 'critical', message: FIRST }, { severity: 'critical', message: SECOND }]), { stylesheets: CSS });
    expect(r.refuted).toHaveLength(2);
    expect(r.review.issues).toHaveLength(0);
    expect(r.review.passed).toBe(true);
  });
  it('one class really missing ⇒ the finding stands, whole, and so does the one resting on it', () => {
    const css = { 'src/index.css': CSS['src/index.css'].replace('.muted', '.quiet') };
    const r = refuteReviewByEvidence(review([{ severity: 'critical', message: FIRST }, { severity: 'critical', message: SECOND }]), { stylesheets: css });
    expect(r.refuted).toHaveLength(0);
  });
  it('no stylesheets read ⇒ nothing is refuted', () => {
    expect(refuteReviewByEvidence(review([{ severity: 'critical', message: FIRST }]), {}).refuted).toHaveLength(0);
  });
  it('the route reads the stylesheets only when a finding makes the claim, and passes them in', () => {
    expect(route).toContain('if (review.issues.some((i) => missingClassClaim(i.message))) {');
    expect(route).toContain('refuteReviewByEvidence(review, { typecheck: gateEvidence.typecheck, stylesheets })');
  });
});

describe('⚖️ Vite dev CSS is dropped from the capture only when the page would not fit', () => {
  const script = browsePageScript('https://5173-x.e2b.app');
  it('guarded by the same 30,000 budget, and the style tag is kept with a note', () => {
    expect(script).toContain("if(document.documentElement.outerHTML.length>30000)for(const st of Array.from(document.querySelectorAll('style[data-vite-dev-id]')))");
    expect(script).toContain('bytes of dev CSS omitted from this capture');
    expect(script.indexOf('style[data-vite-dev-id]')).toBeLessThan(script.indexOf('(await p.content()).slice(0,30000)'));
  });
});
