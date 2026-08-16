/**
 * PRUNE IN THE SANDBOX, NOT ON THE WIRE.
 *
 * Mitrify report a876b7bb (2026-08-15) carried 226 SECONDS of main-thread silence between
 * "import SUCCEEDED" and the build's first model call — while the background boot's `npm install`
 * filled `node_modules` and `listFiles` walked it with `files.list(root, { depth: 10 })`, only to
 * throw every one of those paths away in a client-side `.filter`.
 *
 * 🔒 FOURTH INSTANCE OF ONE BUG CLASS — per-file work over a network for files we do not want (after
 * the 648s sandbox landing, the Firestore merge, and the 790s serial reads in WorkspaceFiles.ts).
 * Each was fixed by moving the work OFF the wire, not by making it faster. These tests pin that the
 * prune list can never drift from the filter it mirrors, and that the fast path is never trusted when
 * it cannot prove it worked.
 */

import { describe, it, expect } from 'vitest';
import {
  buildListFilesCommand,
  parseListFilesOutput,
  isIgnoredListPath,
} from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';

const ROOT = '/home/user/workspace';

describe('🔒 the command prunes exactly what the filter would drop', () => {
  const cmd = buildListFilesCommand(ROOT);

  it('prunes every directory the client-side filter ignores — no drift', () => {
    // The one that mattered: node_modules is why a turn cost four minutes.
    for (const dir of ['node_modules', '.git', 'dist', '.next', 'build', '__pycache__', '.venv', '.cache', 'coverage', 'out', '.e-checkpoints']) {
      expect(cmd, dir).toContain(`-name '${dir}'`);
      // …and the filter agrees, which is the invariant that must hold for the two to stay in step.
      expect(isIgnoredListPath(`${dir}/x.js`), dir).toBe(true);
    }
  });

  it('is a real prune, and asks only for files', () => {
    expect(cmd).toContain('-prune');
    expect(cmd).toContain('-type f');
    expect(cmd).toContain(`find '${ROOT}'`);
  });

  it('keeps the depth bound the original listing used', () => {
    expect(buildListFilesCommand(ROOT)).toContain('-maxdepth 10');
    expect(buildListFilesCommand(ROOT, 3)).toContain('-maxdepth 3');
  });

  it('a real source path is NOT pruned', () => {
    expect(isIgnoredListPath('client/src/pages/Home.tsx')).toBe(false);
    expect(isIgnoredListPath('server/index.ts')).toBe(false);
  });
});

describe('parsing find output', () => {
  it('returns workspace-relative paths', () => {
    const out = [
      `${ROOT}/package.json`,
      `${ROOT}/client/src/App.tsx`,
      `${ROOT}/server/index.ts`,
    ].join('\n');
    expect(parseListFilesOutput(out, ROOT)).toEqual(['package.json', 'client/src/App.tsx', 'server/index.ts']);
  });

  it('tolerates blank lines and a trailing newline', () => {
    expect(parseListFilesOutput(`${ROOT}/a.ts\n\n${ROOT}/b.ts\n`, ROOT)).toEqual(['a.ts', 'b.ts']);
  });

  it('accepts a root given with a trailing slash', () => {
    expect(parseListFilesOutput(`${ROOT}/a.ts`, `${ROOT}/`)).toEqual(['a.ts']);
  });

  it('🔒 drops anything outside the workspace root — this feeds the map the agent edits', () => {
    const out = [`${ROOT}/ok.ts`, '/etc/passwd', '/home/user/.npm/x', 'relative/path.ts'].join('\n');
    expect(parseListFilesOutput(out, ROOT)).toEqual(['ok.ts']);
  });

  it('survives junk without throwing', () => {
    for (const junk of ['', '   ', null, undefined]) {
      expect(parseListFilesOutput(junk as never, ROOT)).toEqual([]);
    }
  });

  it('🔒 an empty result is empty — the caller must not treat it as "no files"', () => {
    // The actuator deliberately falls through to the slow listing when this is empty, because a
    // genuinely empty workspace and a silently-failed `find` are indistinguishable here, and
    // reporting "no files" would make the File Guardian believe the project vanished.
    expect(parseListFilesOutput('', ROOT)).toEqual([]);
  });
});

describe('🔒 the fallback stays wired', () => {
  it('listFiles still keeps the original enumeration as its safety net', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'),
      'utf8',
    ) as string;
    const at = src.indexOf('async listFiles(');
    const body = src.slice(at, at + 2000);
    expect(body).toContain('buildListFilesCommand');       // fast path present
    expect(body).toContain("sb.files.list(WORKSPACE_ROOT"); // slow path still there
    expect(body).toContain('isIgnoredListPath');            // filter still applied to both
  });
});
