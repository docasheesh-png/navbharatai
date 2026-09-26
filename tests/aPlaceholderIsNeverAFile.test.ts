/**
 * A PLACEHOLDER IS NEVER A FILE, AND A REPAIR WRITES ONLY WHAT IT WAS ASKED TO FIX (autopsy eed79815,
 * 2026-09-26).
 *
 * A car game's post-build typecheck repair answered with the output-format example from its own prompt
 * (`<<<FILE relative/path.ext>>>` / `...content...`) followed by a skeleton of an unrelated app — a
 * login page, an auth context, a router, two stylesheets — every body a placeholder. The parser took all
 * of it. The JavaScript was refused later by the syntax gate; the stylesheets and `relative/path.ext`
 * were written, a stylesheet was wired into `main.tsx`, and the next turn's production build failed on
 * `...content...`. One stylesheet also ended in `<<<ENDFILE>>` (a `>` short), which the terminator did
 * not recognise, so the marker itself was written into the file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFileBlocks, isEchoedFormatExample } from '../src/server/AgentV3/OneShotBuilder';
import { limitRepairToScope, pathsNamedInErrors, offendingFiles } from '../src/server/AgentV3/SimpleBuilder';

/** The shape the report's repair produced, trimmed to four of its seventeen blocks plus one real fix. */
const REPORTED = [
  '<<<FILE relative/path.ext>>>',
  '...content...',
  '<<<ENDFILE>>>',
  '<<<FILE src/pages/LoginPage.jsx>>>',
  '...content...',
  '<<<ENDFILE>>>',
  '<<<FILE src/styles/globals.css>>>',
  '...content...',
  '<<<ENDFILE>>',
  '<<<FILE src/styles/theme.css>>>',
  '...the full corrected file content...',
  '<<<ENDFILE>>>',
  '<<<FILE src/ui/HUD.tsx>>>',
  "import * as THREE from 'three';",
  'export const up = new THREE.Vector3(0, 1, 0);',
  '<<<ENDFILE>>>',
].join('\n');

describe('the parser refuses the format example echoed back', () => {
  it('the report\'s own answer yields only the one real file', () => {
    const files = parseFileBlocks(REPORTED);
    expect(files.map((f) => f.path)).toEqual(['src/ui/HUD.tsx']);
    expect(files[0].content).toContain('new THREE.Vector3');
  });

  it('a `.ext` path is never a file, whatever its body', () => {
    expect(isEchoedFormatExample('relative/path.ext', 'body { color: red; }')).toBe(true);
    expect(isEchoedFormatExample('relative/path/from/project/root.ext', 'x')).toBe(true);
  });

  it('an all-ellipsis body is a placeholder, in any comment style', () => {
    for (const body of ['...content...', '… rest unchanged …', '// ... existing code ...', '/* ... */', '{/* ... */}', '...\n\n...']) {
      expect(isEchoedFormatExample('src/a.tsx', body), body).toBe(true);
    }
  });

  it('a real file that uses a spread is kept', () => {
    const body = 'export function merge(a, b) {\n  return {\n    ...a,\n    ...b,\n  };\n}';
    expect(isEchoedFormatExample('src/merge.ts', body)).toBe(false);
    expect(parseFileBlocks(`<<<FILE src/merge.ts>>>\n${body}\n<<<ENDFILE>>>`)).toHaveLength(1);
  });

  it('an empty file is still a file (a .gitkeep is legitimate)', () => {
    expect(isEchoedFormatExample('public/.gitkeep', '')).toBe(false);
  });
});

describe('a terminator one `>` short still ends the file', () => {
  it('`<<<ENDFILE>>` and `<<<ENDFILE>` are terminators — the marker never lands in the file', () => {
    for (const end of ['<<<ENDFILE>>>', '<<<ENDFILE>>', '<<<ENDFILE>']) {
      const [f] = parseFileBlocks(`<<<FILE src/app.css>>>\nbody { margin: 0; }\n${end}\n<<<FILE src/b.css>>>\na { color: red; }\n<<<ENDFILE>>>`);
      expect(f.content, end).toBe('body { margin: 0; }');
      expect(f.content).not.toContain('ENDFILE');
    }
  });
});

describe('a repair writes only what it was asked to fix', () => {
  const fixes = [
    { path: 'src/ui/HUD.tsx', content: 'a' },
    { path: './src/game/weather.ts', content: 'b' },
    { path: 'src/pages/LoginPage.jsx', content: 'c' },
    { path: 'src/contexts/AuthContext.jsx', content: 'd' },
  ];

  it('keeps files it was shown or the errors name, and says which it dropped', () => {
    const errors = "src/game/weather.ts(164,29): error TS2345: Argument of type 'Group' is not assignable";
    const r = limitRepairToScope(fixes, ['src/ui/HUD.tsx', ...pathsNamedInErrors(errors)]);
    expect(r.kept.map((f) => f.path)).toEqual(['src/ui/HUD.tsx', './src/game/weather.ts']);
    expect(r.dropped).toEqual(['src/pages/LoginPage.jsx', 'src/contexts/AuthContext.jsx']);
  });

  it('an empty scope writes nothing', () => {
    expect(limitRepairToScope(fixes, []).kept).toEqual([]);
  });

  it('pathsNamedInErrors reads both tsc and eslint shapes; offendingFiles is that list filtered to known', () => {
    const errors = 'src/a.ts(1,2): error TS1\n./src/b.tsx:3:4 error\nnot a path here';
    expect(pathsNamedInErrors(errors)).toEqual(['src/a.ts', 'src/b.tsx']);
    expect(offendingFiles(errors, ['src/b.tsx'])).toEqual(['src/b.tsx']);
  });
});

describe('🔒 the wiring — every post-build repair that writes without a re-verify is scoped', () => {
  // tsc and vitest cannot see that a caller wrote the model's answer unfiltered — that is how a car
  // game gained a login page.
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

  it('the typecheck, syntax and missing-export repairs each pass through limitRepairToScope', () => {
    expect(route).toMatch(/recordRepairOutOfScope\('typecheck', scoped\.dropped\)/);
    expect(route).toMatch(/recordRepairOutOfScope\('syntax', scopedSyntax\.dropped\)/);
    expect(route).toMatch(/recordRepairOutOfScope\('missing-export', scopedExport\.dropped\)/);
    expect(route).toMatch(/const guarded = protectBoilerplateInRepair\(scoped\.kept\);/);
  });

  it('a dropped file is reported, never discarded in silence', () => {
    expect(route).toContain("code: 'REPAIR_OUT_OF_SCOPE'");
  });
});
