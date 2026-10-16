// Q-1015 — A VUE OR SVELTE APP GETS DESIGN FEEDBACK AGAIN, AND AN INDENTED STYLESHEET IS NOT CORRUPTED.
//
// 🔴 THE REGRESSION. The `evaluate` tool used to design-lint `.vue`, `.svelte`, `.less` and `.sass` with a
// file selection of its own. Autopsy 9c612cdb replaced that private copy with the shared one in
// `buildQualityLint` — the right call (one selection, so the lint and the spacing snap can never disagree
// about scope; four drifted copies of a helper is a cost this repo has already paid). But the shared set was
// the NARROWER of the two, so **a Vue or Svelte app silently stopped getting any design feedback at all**:
// its components and its styles live in no `.tsx` or `.css` file, so `lintBuiltApp` selected nothing and
// returned null — which the report reads as "not checked". Centralising was right; centralising on the
// smaller set was the regression.
//
// 🔴 AND THE OBVIOUS WIDENING WOULD HAVE CORRUPTED A USER'S STYLESHEET. Measured before the fix, not
// reasoned: `SPACING_DECL_RE_SOURCE` captures a declaration's value as `[^;"'}]+`, which does not stop at a
// newline. Sass's ORIGINAL indented syntax has no `;`, so in
//
//     .card
//       padding: 6px
//       font-size: 15px
//       border-radius: 13px
//
// the `padding` declaration swallows the next two lines and the extractor returns `[6, 15, 13]`. The app
// would be told its FONT SIZE is off-grid spacing — and `spacingSnap`, which rewrites exactly what that
// extractor counts, would have written `font-size: 16px` and `width: 332px` into the user's stylesheet. An
// advisory check that quietly edits values it misread is worse than no check.
//
// THE FIX: for an indented syntax only, the line break IS the terminator, so `shippedDesignText` turns it
// into one — `\n` → `;`, ONE character for ONE, which is what keeps that function length-preserving (the
// property the snap's offsets depend on) and keeps the spacing regex a single definition with one reader.

import { describe, it, expect } from 'vitest';
import {
  lintBuiltApp, shippedDesignText, designLintSummary,
  LINTABLE_DESIGN_FILE, INDENTED_STYLE_FILE,
} from '../src/server/AgentV3/buildQualityLint';
import { spacingSnapPatches } from '../src/server/AgentV3/spacingSnap';
import { extractSpacingPx, offGridSpacing, SPACING_GRID } from '../src/server/AppMakerLab/intelligence/DesignLinter';

const SNAP_ON = {} as NodeJS.ProcessEnv;

/** A Vue app with real one-off colours and off-grid spacing, in the files a Vue app actually has. */
const VUE_APP: Record<string, string> = {
  'src/App.vue': [
    '<template><div class="page"><h1>Dues</h1><CardList /></div></template>',
    '<script setup lang="ts">import CardList from "./CardList.vue";</script>',
    '<style scoped>',
    '.page { padding: 6px; gap: 10px; color: #3a7bd5; font-family: Inter, sans-serif; }',
    '</style>',
  ].join('\n'),
  'src/CardList.vue': [
    '<template><ul class="list"><li v-for="d in dues" :key="d.id">{{ d.name }}</li></ul></template>',
    '<style scoped>',
    '.list { margin: 14px; row-gap: 6px; color: #e94f37; font-family: Georgia, serif; }',
    '</style>',
  ].join('\n'),
};

/** The same app in Svelte. */
const SVELTE_APP: Record<string, string> = {
  'src/App.svelte': [
    '<h1>Dues</h1><div class="page"><slot /></div>',
    '<style>',
    '.page { padding: 6px; gap: 10px; color: #3a7bd5; font-family: Inter, sans-serif; }',
    '</style>',
  ].join('\n'),
  'src/Card.svelte': [
    '<div class="card"><slot /></div>',
    '<style>',
    '.card { margin: 14px; row-gap: 6px; color: #e94f37; font-family: Georgia, serif; }',
    '</style>',
  ].join('\n'),
};

describe('🔴 the frameworks that had gone unlinted', () => {
  it('a Vue app is judged — it used to return null, which the report reads as "not checked"', () => {
    const lint = lintBuiltApp(VUE_APP);
    expect(lint, 'a Vue app must be lintable at all').not.toBeNull();
    expect(lint!.fileCount).toBe(2);
    expect(designLintSummary(lint!)).toBeTruthy();
  });

  it('a Svelte app is judged', () => {
    const lint = lintBuiltApp(SVELTE_APP);
    expect(lint).not.toBeNull();
    expect(lint!.fileCount).toBe(2);
  });

  it('…and its real violations are found and ATTRIBUTED to the file that carries them', () => {
    const lint = lintBuiltApp(VUE_APP)!;
    const offenders = Object.values(lint.offenders).flat().map((o) => o.path);
    expect(offenders.length, 'a finding that names no file cannot be acted on (autopsy e706e068)').toBeGreaterThan(0);
    for (const p of offenders) expect(['src/App.vue', 'src/CardList.vue']).toContain(p);
  });

  it('every extension the evaluate tool used to cover is back, and the old ones never left', () => {
    for (const p of [
      'src/App.vue', 'src/App.svelte', 'src/pages/index.astro', 'src/theme.less', 'src/theme.sass', 'src/theme.styl',
      'src/App.tsx', 'src/App.jsx', 'src/app.ts', 'src/index.css', 'src/index.scss', 'index.html',
    ]) {
      expect(LINTABLE_DESIGN_FILE.test(p), p).toBe(true);
    }
  });

  it('🔒 and nothing else was swept in — a bundle, a lockfile, a doc, an image stay out', () => {
    for (const p of ['README.md', 'package-lock.json', 'src/logo.svg', 'src/data.json', 'tsconfig.json', 'notes.txt']) {
      expect(LINTABLE_DESIGN_FILE.test(p), p).toBe(false);
    }
  });
});

describe('🔴 THE INDENTED SYNTAX — measured, because the naive widening corrupts a stylesheet', () => {
  const SASS = [
    '.card',
    '  padding: 6px',
    '  font-size: 15px',
    '  border-radius: 13px',
    '',
    '.hero',
    '  margin: 10px',
    '  width: 333px',
    '',
  ].join('\n');

  it('only the two real spacing values are counted — not the font size, the radius or the width', () => {
    expect(extractSpacingPx(shippedDesignText('src/theme.sass', SASS))).toEqual([6, 10]);
  });

  it('🔒 REVERSION PROOF, stated as a fact about the old behaviour: read RAW, it swallows the next lines', () => {
    // This is exactly what the selection would have fed the extractor without the terminator.
    expect(extractSpacingPx(SASS)).toEqual([6, 15, 13, 10, 333]);
  });

  it('🔒 the terminator is LENGTH-PRESERVING — the snap splices at these offsets into the original', () => {
    const shipped = shippedDesignText('src/theme.sass', SASS);
    expect(shipped.length).toBe(SASS.length);
    expect(shipped).not.toContain('\n');
  });

  it('🔒 THE CORRUPTION THAT IS NOW IMPOSSIBLE: the snap never rewrites a font size or a width', () => {
    const files = { 'src/theme.sass': SASS };
    const patches = spacingSnapPatches(files, ['src/theme.sass'], SNAP_ON);
    for (const patch of patches) {
      expect(patch.content, 'a font size is not spacing').toContain('font-size: 15px');
      expect(patch.content, 'a width is not spacing').toContain('width: 333px');
      expect(patch.content, 'a radius is not spacing').toContain('border-radius: 13px');
    }
  });

  it('a braced stylesheet is untouched by the terminator — its newlines are still newlines', () => {
    const scss = '.card { padding: 6px;\n  font-size: 15px; }\n';
    expect(shippedDesignText('src/theme.scss', scss)).toContain('\n');
    expect(extractSpacingPx(shippedDesignText('src/theme.scss', scss))).toEqual([6]);
    // …and a braced file's multi-line value still yields every number, which is what the terminator
    // would have cost if it had been applied everywhere. This is why it is applied by syntax.
    expect(extractSpacingPx(shippedDesignText('a.css', '.c {\n  padding:\n    10px\n    20px;\n}'))).toEqual([10, 20]);
  });

  it('INDENTED_STYLE_FILE names exactly the two syntaxes without a declaration terminator', () => {
    expect(INDENTED_STYLE_FILE.test('src/theme.sass')).toBe(true);
    expect(INDENTED_STYLE_FILE.test('src/theme.styl')).toBe(true);
    for (const p of ['src/theme.scss', 'src/theme.css', 'src/theme.less', 'src/App.vue', 'src/App.tsx']) {
      expect(INDENTED_STYLE_FILE.test(p), p).toBe(false);
    }
  });
});

describe('🔒 the snap still reaches the frameworks it may safely rewrite', () => {
  it('a Vue app\'s off-grid spacing is snapped, and only the spacing', () => {
    const files = {
      // Six off-grid values, because the snap honours the FINDING's own threshold (`MAX_OFFGRID`) —
      // below it the report says nothing, so neither does the snap.
      'src/App.vue': '<style>\n.page { padding: 6px 18px; gap: 10px; margin: 14px; row-gap: 6px; column-gap: 22px; font-size: 15px; }\n</style>',
    };
    const before = offGridSpacing(extractSpacingPx(shippedDesignText('src/App.vue', files['src/App.vue'])), SPACING_GRID);
    expect(before.length, 'the fixture must really be off-grid, or the test proves nothing').toBeGreaterThan(5);
    const patches = spacingSnapPatches(files, ['src/App.vue'], SNAP_ON);
    expect(patches.map((p) => p.path)).toEqual(['src/App.vue']);
    expect(patches[0]!.content).toContain('font-size: 15px');
    expect(offGridSpacing(extractSpacingPx(shippedDesignText('src/App.vue', patches[0]!.content)), SPACING_GRID)).toEqual([]);
  });
});
