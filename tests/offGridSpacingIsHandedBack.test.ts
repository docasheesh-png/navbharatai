/**
 * Q-037 / Q-022 (autopsies e49afa97, dfd24058): spacing off the 4px grid in a stylesheet THIS build wrote
 * shipped as a `DESIGN_CONSISTENCY` warning, because the write-time note was the only steer and nothing at
 * the end of the turn asked again. The end-of-turn style hand-back now carries those values.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { offGridHandBack } from '../src/server/AgentV3/buildQualityLint';
import { decideStyleResume, styleResumeNote } from '../src/server/AgentV3/stylePolishResume';
import { MAX_OFFGRID } from '../src/server/AppMakerLab/intelligence/DesignLinter';

// The shape of the e49afa97 stylesheet: several paddings and gaps a few pixels off the grid.
const SHEET = `
:root { --accent: #4f46e5; }
.card { padding: 10px 14px; margin-bottom: 6px; }
.row { gap: 10px; }
.btn { padding: 6px 18px; }
.list { margin: 16px 0; padding: 8px; }
/* padding: 3px — a comment is not a rule */
`;

describe('offGridHandBack — the values, only in files this build wrote', () => {
  it('lists the off-grid values of a stylesheet the build wrote', () => {
    const out = offGridHandBack({ 'src/index.css': SHEET }, ['src/index.css']);
    expect(out).toHaveLength(1);
    expect(out[0].file).toBe('src/index.css');
    expect(out[0].values).toEqual(['6px', '10px', '14px', '18px']);
    // The commented 3px is not counted; 16px and 8px are on the grid.
    expect(out[0].values).not.toContain('3px');
    expect(out[0].count).toBe(6);
  });

  it('never hands back a file the build did not write (Q-015)', () => {
    expect(offGridHandBack({ 'src/index.css': SHEET }, ['src/App.tsx'])).toEqual([]);
    expect(offGridHandBack({ 'src/index.css': SHEET }, [])).toEqual([]);
  });

  it('applies the finding\'s own threshold — a value or two is not worth a turn', () => {
    const few = '.a { padding: 10px; } .b { gap: 6px; }';
    expect(2).toBeLessThanOrEqual(MAX_OFFGRID);
    expect(offGridHandBack({ 'src/index.css': few }, ['src/index.css'])).toEqual([]);
  });

  it('ignores vendored and generated files even when written', () => {
    expect(offGridHandBack({ 'dist/app.css': SHEET, 'src/vendor.min.css': SHEET }, ['dist/app.css', 'src/vendor.min.css'])).toEqual([]);
  });

  it('accepts a leading ./ on a written path', () => {
    expect(offGridHandBack({ 'src/index.css': SHEET }, ['./src/index.css'])).toHaveLength(1);
  });
});

describe('decideStyleResume — off-grid spacing alone resumes the turn once', () => {
  const offGrid = offGridHandBack({ 'src/index.css': SHEET }, ['src/index.css']);

  it('resumes with the file and its values, and says to snap them', () => {
    const d = decideStyleResume({ text: 'The app is ready.', missing: [], offGrid, resumesUsed: 0, producedFiles: true });
    expect(d.resume).toBe(true);
    expect(d.message).toContain('src/index.css: 6px, 10px, 14px, 18px');
    expect(d.message).toContain('nearest multiple of 4px');
  });

  it('stands down with nothing to hand back, after the one resume, and on a refusal', () => {
    expect(decideStyleResume({ text: 'Done.', missing: [], offGrid: [], resumesUsed: 0 }).standDown).toBe('nothing-missing');
    expect(decideStyleResume({ text: 'Done.', missing: [], offGrid, resumesUsed: 1 }).standDown).toBe('limit');
    expect(decideStyleResume({ text: 'Done.', missing: [], offGrid, resumesUsed: 0, env: { AGENTV3_STYLE_RESUME: 'off' } }).standDown).toBe('disabled');
  });

  it('names the off-grid count in the admin note', () => {
    expect(styleResumeNote(0, 0, 1)).toContain('1 file(s) it wrote had spacing off the 4px grid');
  });
});

describe('wiring — the dispatcher supplies it from this agent\'s writes and the runner passes it', () => {
  const dispatcher = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
  const runner = readFileSync('src/server/AgentV3/AgentRunner.ts', 'utf8');

  it('undefinedClassesNow computes offGrid from _writtenPaths', () => {
    expect(dispatcher).toMatch(/offGridHandBack\(project, this\._writtenPaths\)/);
    expect(dispatcher).toMatch(/return \{ missing, sheet, pages, a11y, offGrid \}/);
  });

  it('AgentRunner hands it to decideStyleResume', () => {
    expect(runner).toMatch(/decideStyleResume\(\{[^}]*offGrid: style\.offGrid/);
  });
});
