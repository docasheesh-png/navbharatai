/**
 * THE 46-SECOND DEATH: a CommonJS config inside an ESM project.
 *
 * ## The report this encodes (APK build, 12thmentors/app-50-files-2026-09-19, 2026-09-19)
 *
 * A real user's app failed on the GitHub runner before one module was transformed:
 *
 *   [Failed to load PostCSS config: [ReferenceError] module is not defined in ES module scope
 *    This file is being treated as an ES module because it has a '.js' file extension and
 *    package.json contains "type": "module".]
 *
 * `postcss.config.js` said `module.exports = …`; `package.json` said `"type": "module"`. Each half is
 * ordinary. The PAIR is fatal, and nothing was looking at pairs.
 *
 * ## Why this needed a new check rather than a wider old one
 *
 * `mobileShipPreflight`'s three checks are esbuild SYNTAX, unresolved local imports and missing npm
 * packages — and the offending file passes all three. It is valid JavaScript, it imports nothing, it
 * declares no package. **The fault is in the relationship between an extension, a file's contents and
 * one field in package.json**, and a checker that looks at one file at a time cannot see a
 * relationship. It also only fails at LOAD time, which is why it survives every test we run and dies
 * on the one machine that actually builds.
 *
 * ## The two halves, and the upstream one is the cause
 *
 * `tailwindSetupHeal` — the module whose entire job is to stop a Tailwind-shaped runner death — wrote
 * both configs with a hardcoded `module.exports`, while `Scaffold.ts` creates every project with
 * `"type": "module"` and `export default`. The heal's own output was the incompatible pair, on every
 * ESM project it ever fired for. That is fixed at the source; the detector is the net under it, for
 * the configs a model writes.
 */
import { describe, it, expect } from 'vitest';
import {
  projectModuleType, fileDialect, detectDialectMismatches, applyDialectFix,
  configDialectFor, configModuleSource,
} from '../src/server/lib/configModuleDialect';
import { applyTailwindSetup } from '../src/server/lib/tailwindSetupHeal';

/** The exact pair from the report. */
const ESM_PKG = JSON.stringify({ name: 'app', type: 'module', scripts: { build: 'vite build' } }, null, 2);
const CJS_POSTCSS = 'module.exports = {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n';

describe('the project’s declared module system', () => {
  it('reads "type": "module"', () => {
    expect(projectModuleType({ 'package.json': ESM_PKG })).toBe('module');
  });

  it('an ABSENT type is commonjs, not unknown — that is Node’s own default and a real answer', () => {
    expect(projectModuleType({ 'package.json': '{"name":"app"}' })).toBe('commonjs');
  });

  it('an unreadable package.json is unknown, and nothing is concluded from it', () => {
    expect(projectModuleType({ 'package.json': '{ broken' })).toBe('unknown');
    expect(projectModuleType({})).toBe('unknown');
    // The whole detector stands down rather than guessing a dialect from a file it could not read.
    expect(detectDialectMismatches({ 'package.json': '{ broken', 'postcss.config.js': CJS_POSTCSS })).toEqual([]);
  });
});

describe('which dialect a file is written in', () => {
  it('module.exports / require are CommonJS', () => {
    expect(fileDialect(CJS_POSTCSS)).toBe('cjs');
    expect(fileDialect("const x = require('x');\n")).toBe('cjs');
    expect(fileDialect('exports.foo = 1;\n')).toBe('cjs');
  });

  it('import / export are ESM', () => {
    expect(fileDialect('export default {};\n')).toBe('esm');
    expect(fileDialect("import x from 'x';\nexport default x;\n")).toBe('esm');
  });

  it('a file carrying BOTH, or neither, is left alone rather than guessed at', () => {
    expect(fileDialect("import x from 'x';\nmodule.exports = x;\n")).toBeNull();
    expect(fileDialect('const a = 1;\n')).toBeNull();
  });
});

describe('🔴 THE REPORTED FAILURE', () => {
  const app = { 'package.json': ESM_PKG, 'postcss.config.js': CJS_POSTCSS };

  it('is detected', () => {
    const found = detectDialectMismatches(app);
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe('postcss.config.js');
    expect(found[0].dialect).toBe('cjs');
    expect(found[0].fixable).toBe(true);
    // The message must name the real cause, because it reaches the user and the repair pass.
    expect(found[0].message).toContain('"type": "module"');
    expect(found[0].message).toContain('export default');
  });

  it('is fixed in place — same filename, same object, working export form', () => {
    const out = applyDialectFix(app);
    expect(out.files['postcss.config.js']).toBe(
      'export default {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n',
    );
    expect(out.changed['postcss.config.js']).toBeDefined();
    // And the app is clean afterwards — the check that found it agrees it is gone.
    expect(detectDialectMismatches(out.files)).toEqual([]);
  });

  it('🔒 the file is NOT renamed, and that is deliberate', () => {
    // mergeWorkspaceFiles is additive — it cannot delete. A rename would leave the broken
    // postcss.config.js beside a new postcss.config.cjs in the user's own app, and
    // postcss-load-config prefers `.js`, so the GitHub build would pass while their preview stayed
    // broken. Fixing one problem by creating another is what the fourth absolute rule forbids.
    const out = applyDialectFix(app);
    expect(Object.keys(out.files).sort()).toEqual(['package.json', 'postcss.config.js']);
    expect(out.files['postcss.config.cjs']).toBeUndefined();
  });
});

describe('the opposite direction fails just as hard, so it is handled too', () => {
  it('ESM config in a CommonJS project', () => {
    const app = { 'package.json': '{"name":"app"}', 'tailwind.config.js': 'export default { content: [] };\n' };
    const found = detectDialectMismatches(app);
    expect(found).toHaveLength(1);
    expect(found[0].dialect).toBe('esm');
    expect(applyDialectFix(app).files['tailwind.config.js']).toBe('module.exports = { content: [] };\n');
  });
});

describe('what it refuses to touch — the honest half', () => {
  it('a config that calls require() is reported, never rewritten', () => {
    const app = {
      'package.json': ESM_PKG,
      'postcss.config.js': "const tw = require('tailwindcss');\nmodule.exports = { plugins: [tw] };\n",
    };
    const found = detectDialectMismatches(app);
    expect(found).toHaveLength(1);
    expect(found[0].fixable).toBe(false);
    expect(found[0].message).toContain('too involved to convert automatically');
    // Left byte-identical: converting it would drop a binding this module cannot see.
    expect(applyDialectFix(app).files['postcss.config.js']).toBe(app['postcss.config.js']);
    expect(applyDialectFix(app).changed).toEqual({});
  });

  it('a named-property export is reported, never rewritten', () => {
    const app = { 'package.json': ESM_PKG, 'jest.config.js': 'module.exports.preset = "ts-jest";\n' };
    expect(detectDialectMismatches(app)[0].fixable).toBe(false);
    expect(applyDialectFix(app).changed).toEqual({});
  });

  it('a file already carrying an unambiguous extension is not a mismatch at all', () => {
    // `.cjs` is CommonJS and `.mjs` is ESM whatever "type" says — neither can fail this way.
    const app = { 'package.json': ESM_PKG, 'postcss.config.cjs': CJS_POSTCSS };
    expect(detectDialectMismatches(app)).toEqual([]);
  });

  it('a .js file under src/ is never touched — the bundler loads it, not Node', () => {
    const app = { 'package.json': ESM_PKG, 'src/legacy.js': 'module.exports = { a: 1 };\n' };
    expect(detectDialectMismatches(app)).toEqual([]);
  });
});

describe('the JSDoc header survives the conversion', () => {
  it('keeps the @type line that gives tailwind.config.js its editor autocompletion', () => {
    const header = "/** @type {import('tailwindcss').Config} */\n";
    const app = { 'package.json': ESM_PKG, 'tailwind.config.js': header + 'module.exports = { content: [] };\n' };
    const out = applyDialectFix(app);
    expect(out.files['tailwind.config.js']).toBe(header + 'export default { content: [] };\n');
  });
});

describe('🔴 THE UPSTREAM CAUSE — the heal that wrote the broken pair', () => {
  /** A Tailwind-styled ESM app with the packages undeclared: exactly what makes the heal fire. */
  const brokenTailwindApp = () => ({
    'package.json': ESM_PKG,
    'src/index.css': '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n',
  });

  it('now writes ESM configs for an ESM project', () => {
    const out = applyTailwindSetup(brokenTailwindApp());
    expect(out.files['postcss.config.js']).toContain('export default');
    expect(out.files['postcss.config.js']).not.toContain('module.exports');
    expect(out.files['tailwind.config.js']).toContain('export default');
    expect(out.files['tailwind.config.js']).not.toContain('module.exports');
  });

  it('🔒 and the heal’s OWN OUTPUT no longer trips the detector — the loop is closed', () => {
    // This is the assertion that would have caught the report. Before the fix, the module whose job
    // is preventing a runner death produced the exact file that caused one.
    const out = applyTailwindSetup(brokenTailwindApp());
    expect(detectDialectMismatches(out.files)).toEqual([]);
  });

  it('a CommonJS project still gets module.exports — nothing regresses for one', () => {
    const cjsApp = {
      'package.json': '{"name":"app","scripts":{"build":"vite build"}}',
      'src/index.css': '@tailwind base;\n',
    };
    const out = applyTailwindSetup(cjsApp);
    expect(out.files['postcss.config.js']).toContain('module.exports');
    expect(detectDialectMismatches(out.files)).toEqual([]);
  });

  it('the tailwind config keeps its @type header in both dialects', () => {
    expect(applyTailwindSetup(brokenTailwindApp()).files['tailwind.config.js'])
      .toContain("@type {import('tailwindcss').Config}");
  });
});

describe('the shared spelling', () => {
  it('configDialectFor follows package.json, and defaults to cjs exactly as Node does', () => {
    expect(configDialectFor({ 'package.json': ESM_PKG })).toBe('esm');
    expect(configDialectFor({ 'package.json': '{"name":"a"}' })).toBe('cjs');
    expect(configDialectFor({})).toBe('cjs');
  });

  it('configModuleSource is the one place each form is written', () => {
    expect(configModuleSource('esm', '{ a: 1 }')).toBe('export default { a: 1 };\n');
    expect(configModuleSource('cjs', '{ a: 1 }')).toBe('module.exports = { a: 1 };\n');
  });
});
