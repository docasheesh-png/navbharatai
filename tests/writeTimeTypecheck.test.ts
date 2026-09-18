/**
 * WRITE → TYPECHECK → NEXT (admin 2026-09-17: "incremental typecheck wala PR bana do", autopsy e706e068).
 *
 * The School ERP build wrote 20 files before its first `tsc`, then spent seven minutes grinding the 21
 * errors that run found. This suite pins the module that ends that: the compiler answers after every
 * TypeScript write, its verdict on THAT file rides the tool result, runs coalesce, and a check that
 * could not run says nothing rather than "clean".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  writeTypecheckEnabled, shouldTypecheckWrite, writeTypecheckCommand, splitByWrittenFiles, writeTypecheckNote,
  WriteTypecheckQueue, emptyWriteTypecheckStats, writeTypecheckSummary, WRITE_TYPECHECK_TSBUILDINFO,
  MAX_OWN_ERRORS_QUOTED, MAX_OTHER_ERRORS_NAMED,
} from '../src/server/AgentV3/writeTimeTypecheck';
import { parseTscErrors } from '../src/server/AgentV3/EndgameRepair';

// Byte-shape from the School ERP report's first tsc run.
const ERP_TSC = [
  "src/pages/AdminPanel.tsx(34,3): error TS2304: Cannot find name 'useEffect'.",
  "src/pages/Calendar.tsx(4,10): error TS2440: Import declaration conflicts with local declaration of 'Calendar'.",
  "src/pages/Dashboard.tsx(61,50): error TS2339: Property 'status' does not exist on type '{ amount: any; }'.",
  "src/pages/Dashboard.tsx(64,9): error TS18004: No value exists in scope for the shorthand property 'totalStudents'. Either declare one or provide an initializer.",
].join('\n');

describe('the switch and the scope', () => {
  it('is ON unless explicitly off', () => {
    expect(writeTypecheckEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(writeTypecheckEnabled({ AGENTV3_WRITE_TYPECHECK: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(writeTypecheckEnabled({ AGENTV3_WRITE_TYPECHECK: 'OFF ' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('checks TypeScript source only — not declarations, not JS, not assets', () => {
    expect(shouldTypecheckWrite('src/pages/AdminPanel.tsx')).toBe(true);
    expect(shouldTypecheckWrite('src/lib/db.ts')).toBe(true);
    expect(shouldTypecheckWrite('src/vite-env.d.ts')).toBe(false);
    expect(shouldTypecheckWrite('src/App.jsx')).toBe(false);
    expect(shouldTypecheckWrite('index.html')).toBe(false);
    expect(shouldTypecheckWrite('package.json')).toBe(false);
  });

  it('🔒 runs the robust LOCAL binary on the ONE shared incremental cache — never npx, never a second cache', () => {
    const cmd = writeTypecheckCommand();
    expect(cmd).toContain('node_modules/.bin/tsc --noEmit --incremental');
    expect(cmd).toContain(`--tsBuildInfoFile ${WRITE_TYPECHECK_TSBUILDINFO}`);
    expect(cmd).not.toMatch(/npx\s+tsc/);
    // The endgame and the `typecheck` tool use this exact cache path; a different one would make every
    // write-time run a cold compile.
    const dispatcher = readFileSync(resolve(__dirname, '../src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(dispatcher).toContain("--tsBuildInfoFile /tmp/agentv3.tsbuildinfo");
    expect(WRITE_TYPECHECK_TSBUILDINFO).toBe('/tmp/agentv3.tsbuildinfo');
  });
});

describe('the note the model reads', () => {
  const errors = parseTscErrors(ERP_TSC);

  it('parses the real ERP output into four errors', () => {
    expect(errors).toHaveLength(4);
  });

  it('quotes the WRITTEN file\'s own errors in full and only counts the rest', () => {
    const note = writeTypecheckNote(errors, ['src/pages/Dashboard.tsx']);
    expect(note).toContain('2 error(s) in src/pages/Dashboard.tsx');
    expect(note).toContain("Dashboard.tsx(61,50): TS2339 Property 'status' does not exist");
    expect(note).toContain('fix them NOW, in this turn, before writing the next file');
    // Elsewhere: named briefly, never dumped.
    expect(note).toContain('Also 2 error(s) elsewhere');
    expect(note).toContain('src/pages/AdminPanel.tsx:34 TS2304');
    expect(note).not.toContain("Cannot find name 'useEffect'");
  });

  it('a clean written file with errors elsewhere is told so, without being blamed', () => {
    const note = writeTypecheckNote(errors, ['src/pages/Students.tsx']);
    expect(note).toContain('src/pages/Students.tsx is clean, but 4 error(s) remain elsewhere');
    expect(note).not.toContain('⛔');
  });

  it('a clean tree yields NO note — nothing to act on, nothing appended', () => {
    expect(writeTypecheckNote([], ['src/pages/Students.tsx'])).toBe('');
  });

  it('path spelling does not hide an error: ./src/x.ts and src/x.ts are the same file', () => {
    const { own } = splitByWrittenFiles(errors, ['./src/pages/Calendar.tsx']);
    expect(own).toHaveLength(1);
  });

  it('caps the quote so one broken file cannot flood the tool result', () => {
    const many = Array.from({ length: MAX_OWN_ERRORS_QUOTED + 5 }, (_, i) => `src/a.ts(${i + 1},1): error TS2304: Cannot find name 'x${i}'.`).join('\n');
    const note = writeTypecheckNote(parseTscErrors(many), ['src/a.ts']);
    expect(note.split('\n').filter((l) => /^src\/a\.ts\(/.test(l))).toHaveLength(MAX_OWN_ERRORS_QUOTED);
    expect(note).toContain('…and 5 more in the same file(s)');
    const others = Array.from({ length: MAX_OTHER_ERRORS_NAMED + 4 }, (_, i) => `src/b${i}.ts(1,1): error TS2304: Cannot find name 'y'.`).join('\n');
    expect(writeTypecheckNote(parseTscErrors(others), ['src/a.ts'])).toContain(`…and 4 more`);
  });

  it('🔒 names no vendor', () => {
    expect(writeTypecheckNote(errors, ['src/pages/Dashboard.tsx'])).not.toMatch(/\b(GLM|Kimi|Claude|Gemini|Grok)\b/);
  });
});

describe('the queue — a burst of parallel writes costs at most two compiles', () => {
  it('coalesces everyone who arrives during a run into ONE following run', async () => {
    const q = new WriteTypecheckQueue<number>();
    let execs = 0;
    let release: (() => void) | null = null;
    const first = q.run(() => { execs += 1; return new Promise<number>((r) => { release = () => r(execs); }); });
    // Five writers arrive while the first compile is running.
    const waiters = [1, 2, 3, 4, 5].map(() => q.run(async () => { execs += 1; return execs; }));
    release!();
    expect(await first).toBe(1);
    const results = await Promise.all(waiters);
    // One compile for all five, and it ran AFTER the first finished (it saw a fresher tree).
    expect(execs).toBe(2);
    expect(new Set(results)).toEqual(new Set([2]));
  });

  it('a failed run does not wedge the queue', async () => {
    const q = new WriteTypecheckQueue<number>();
    await expect(q.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await q.run(async () => 7)).toBe(7);
  });
});

describe('the report line', () => {
  it('says OFF when switched off, and never-ran when it never ran', () => {
    expect(writeTypecheckSummary(emptyWriteTypecheckStats(), false)).toContain('OFF');
    expect(writeTypecheckSummary({ ...emptyWriteTypecheckStats(), skipped: 3 }, true)).toContain('no TypeScript source was written');
    expect(writeTypecheckSummary({ ...emptyWriteTypecheckStats(), disabledReason: 'x' }, true)).toContain('never ran — x');
  });

  it('reports runs, clean runs, errors quoted back and the time spent', () => {
    const line = writeTypecheckSummary({ runs: 20, cleanRuns: 14, ownErrorsSurfaced: 9, elapsedMs: 16_000, timeouts: 0, skipped: 2, disabledReason: null }, true);
    expect(line).toContain('20 run(s), 14 clean, 9 error(s) quoted back');
    expect(line).toContain('16s total (~0.8s each)');
  });
});

describe('🔒 the dispatcher asks after EVERY write path, and the route reports it', () => {
  const dispatcher = readFileSync(resolve(__dirname, '../src/server/AgentV3/ToolDispatcher.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

  // ⚠️ These four spellings changed on 2026-09-17 (autopsy baa0b3c7): each call site now passes the
  // CONTENT it just wrote, not only the path. That content is the sole thing able to tell the two causes
  // of "Property 'props' does not exist on type 'X'" apart — does X extend React.Component? — and every
  // call site already held it. Asserted as `{ … }` rather than `[path]` precisely so a future edit that
  // drops back to paths fails here instead of silently downgrading the advice to the hedged form.
  it('write_file, write_files_batch, edit_file and replace_symbol all append the note, WITH the content', () => {
    expect(dispatcher).toContain('const typecheckNote = await this.writeTypecheckNote({ [path]: content });');
    expect(dispatcher).toContain('const batchTypecheckNote = await this.writeTypecheckNote(writtenRecord);');
    expect(dispatcher).toContain('const editTypecheckNote = await this.writeTypecheckNote({ [path]: updated });');
    expect(dispatcher).toContain('const symbolTypecheckNote = await this.writeTypecheckNote({ [path]: result.content });');
    for (const v of ['typecheckNote', 'batchTypecheckNote', 'editTypecheckNote', 'symbolTypecheckNote']) {
      // Each note variable is used in a return, not only computed.
      expect(dispatcher).toMatch(new RegExp(`return [^;]*\\b${v}\\b`));
    }
  });

  it('the helper hands that content to the analysis — otherwise the advice can only ever hedge', () => {
    const helper = dispatcher.slice(dispatcher.indexOf('private async writeTypecheckNote('), dispatcher.indexOf('async dispatch(call: ToolUse'));
    expect(helper).toContain('private async writeTypecheckNote(sources: Record<string, string>)');
    expect(helper).toContain('return writeTypecheckNote(errors, tsPaths, sources);');
  });

  it('every run reaches the evidence bridge the typecheck tool uses, and a JS project is never compiled', () => {
    const helper = dispatcher.slice(dispatcher.indexOf('private async writeTypecheckNote('), dispatcher.indexOf('async dispatch(call: ToolUse'));
    expect(helper).toContain("this.onCommand?.({ command, exitCode: null");
    expect(helper).toContain("this.actuator.readFile(this.workspaceId, 'tsconfig.json')");
    expect(helper).toContain('if (!this._isTsProject)');
    // A check that could not run says nothing.
    expect(helper).toContain('if (errors === null) return \'\';');
  });

  it('the route records WRITE_TIME_TYPECHECK beside REPEATED_READS', () => {
    const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain("code: 'WRITE_TIME_TYPECHECK'");
    expect(route).toContain('dispatcher.writeTypecheckStats()');
    expect(route.indexOf("code: 'WRITE_TIME_TYPECHECK'")).toBeGreaterThan(route.indexOf("code: 'REPEATED_READS'"));
  });
});
