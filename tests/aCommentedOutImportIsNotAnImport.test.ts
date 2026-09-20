// A commented-out import is not an import (autopsy `31dc61fd`, 2026-09-20).
//
// 🔴 THE DEFECT. `WorkspaceMemory.extractFacts` ran its import, symbol, route and reference regexes
// over RAW source, so anything that merely LOOKED like code entered the project graph as a real
// fact. That graph is not a side channel:
//
//   • `analyzeArchitecture(graph)` turns `graph.imports` into `unresolvedImports`, which
//     `releaseGate.ts` counts as a HARD BLOCKER ("Hard blockers — an unresolved import, a missing
//     dependency"), and
//   • `collectDependencyIssues()` turns the same field into "missing dependency", which
//     `BuildConfidence` then charges against the build.
//
// ⚠️ AND THE TRIGGER WAS OUR OWN SCAFFOLD, so it fired on EVERY vite-react build. The generated
// `vite.config.ts` carries a comment mentioning `import { useStore } from 'stores/useStore'`; the
// package root `stores` is in no package.json. In the report that found this, an app that was
// complete, typechecking, tested and rendering was scored "Build confidence: 35% (Low)" with
// "1 missing dependency(ies) not in package.json", and the architect and reviewer between them
// spent three greps, a shell grep and a repeated `evaluate` proving it was a phantom — the
// reviewer's own verdict being *"`stores` dependency warning is a false positive."*
//
// 🔑 THE RULE ALREADY EXISTED IN THIS REPO, TWICE, AND NOT WHERE IT MATTERED. `SpaFallbackAnalysis`
// and `ProjectIntegrityChecks` each carry a private `stripComments`, and the second one's doc
// comment states this exact rule. They have already drifted from each other. That is the class: the
// rule was written twice and still missing from the one extractor that feeds the whole graph.

import { describe, it, expect } from 'vitest';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';
import { extractFacts } from '../src/server/AgentV3/WorkspaceMemory';

/** The line our vite-react scaffold writes into every generated vite.config.ts. */
const SCAFFOLD_COMMENT =
  "// `import { useStore } from 'stores/useStore'` resolves at BUILD & RUNTIME too — not just in";

describe('🔴 the phantom that fired on every vite-react build', () => {
  it('our own scaffold comment no longer invents a package called "stores"', () => {
    const facts = extractFacts(
      'vite.config.ts',
      `import { defineConfig } from 'vite';\n${SCAFFOLD_COMMENT}\nexport default defineConfig({});`,
    );
    expect(facts.dependencies).toEqual(['vite']);
    expect(facts.dependencies).not.toContain('stores');
    expect(facts.imports).not.toContain('stores/useStore');
  });

  it('a commented-out RELATIVE import cannot become a release-gate hard blocker', () => {
    // This is the sharper half: a bare specifier is only a "missing dependency", but an unresolved
    // RELATIVE one is counted as a hard blocker by the release gate.
    const facts = extractFacts(
      'src/App.tsx',
      "import React from 'react';\n// import Old from './legacy/OldThing';\nexport default function App(){return null;}",
    );
    expect(facts.imports).toEqual(['react']);
    expect(facts.imports).not.toContain('./legacy/OldThing');
  });

  it('every comment shape is covered, not just the one that was reported', () => {
    const shapes: Array<[string, string]> = [
      ['block comment', "/*\n import legacy from 'left-pad';\n*/\nimport ok from 'react';"],
      ['docblock example', "/** Usage: `import { z } from 'some-package'` */\nimport real from 'zustand';"],
      ['commented require', "// require('lodash')\nconst r = require('react');"],
      ['trailing comment on a real line', "import x from 'react'; // import y from 'vue'"],
    ];
    for (const [, src] of shapes) {
      const facts = extractFacts('src/f.ts', src);
      for (const ghost of ['left-pad', 'some-package', 'lodash', 'vue']) {
        expect(facts.dependencies).not.toContain(ghost);
      }
    }
  });

  it('a commented-out export is not a symbol, and a commented route is not a route', () => {
    const facts = extractFacts(
      'src/api.ts',
      "// export function ghostHandler() {}\n// app.get('/ghost', h)\nexport function realHandler() {}\napp.get('/real', h);",
    );
    expect(facts.symbols.map((s) => s.name)).toEqual(['realHandler']);
    expect(facts.routes).toEqual(['/real']);
  });
});

describe('🔒 what it must NOT do — the controls', () => {
  it('a real import is untouched', () => {
    const facts = extractFacts(
      'src/ok.tsx',
      "import React from 'react';\nimport { useStore } from './store/useStore';\nexport default function Ok(){return null;}",
    );
    expect(facts.imports).toEqual(['react', './store/useStore']);
    expect(facts.dependencies).toEqual(['react']);
  });

  it('🔒 a URL import survives — the `[^:]` guard, without which this fix would DELETE real imports', () => {
    // Stripping from `//` unconditionally would eat `https://esm.sh/react` and turn a
    // false-positive bug into a false-negative one, which is strictly worse.
    expect(extractFacts('src/u.ts', "import x from 'https://esm.sh/react';").imports)
      .toEqual(['https://esm.sh/react']);
  });

  it('🔒 A SECRET IN A COMMENT IS STILL A LEAKED SECRET — security reads RAW source', () => {
    // The one carve-out, and it is load-bearing. Every other extractor reads the stripped copy
    // because a commented-out import is not an import; this one must not, because a key pasted
    // into a comment is a key that leaked.
    // Fixture borrowed from SecurityAnalysis.test.ts — a real trigger for `hardcoded-secret` that is
    // not shaped like any vendor's key, so it cannot trip GitHub's push protection (this test's first
    // draft used a Stripe-shaped string and the push was correctly refused).
    const withSecret = extractFacts('src/cfg.ts', '// const password = "Hunter2Pass99";\n');
    const withoutSecret = extractFacts('src/cfg.ts', "const x = 1;\n");
    expect(withSecret.security.length).toBeGreaterThan(withoutSecret.security.length);
  });

  it('empty, null-ish and non-code input are safe', () => {
    expect(stripCodeComments('')).toBe('');
    expect(stripCodeComments(undefined as unknown as string)).toBe('');
    expect(stripCodeComments(null as unknown as string)).toBe('');
    expect(() => extractFacts('README.md', '# hi\n// import x from "react"')).not.toThrow();
  });
});

describe('the stripper itself', () => {
  it('🔒 PRESERVES LENGTH — deleting a comment can JOIN the tokens either side of it', () => {
    // `foo/*c*/.bar()` deleted becomes `foo.bar()` — inventing code nobody wrote, which is the same
    // class of false fact this module exists to remove.
    const src = "foo/*c*/.bar()";
    const out = stripCodeComments(src);
    expect(out).toHaveLength(src.length);
    // The claim, stated exactly: the two tokens survive, SEPARATED — never fused into `foo.bar`.
    expect(out).not.toContain('foo.bar');
    expect(out).toBe('foo     .bar()'); // /*c*/ is 5 chars, blanked to 5 spaces
  });

  it('preserves line structure, so line-based readers still line up', () => {
    const src = "a\n// gone\nb\n/* also\ngone */\nc";
    const out = stripCodeComments(src);
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
    expect(out).toContain('a');
    expect(out).toContain('b');
    expect(out).toContain('c');
    expect(out).not.toContain('gone');
  });

  it('leaves code with no comments byte-identical', () => {
    const src = "import x from 'react';\nexport const y = 1;\n";
    expect(stripCodeComments(src)).toBe(src);
  });
});
