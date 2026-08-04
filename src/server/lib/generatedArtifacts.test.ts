// EVERY FILE WE HAND A USER MUST BE VALID IN ITS OWN LANGUAGE.
//
// WHY THIS SUITE EXISTS — the lesson of 2026-08-03/04, paid for in the admin's own time. The APK
// pipeline produced SEVEN fatal defects that all reached a live user and NONE of which any test caught:
// a workflow the server refused to dispatch, the wrong token header, a whitelist silently dropping the
// user's source files, a swallowed `cap add` failure, mismatched Capacitor majors, "[object Object]" on
// screen — and a bash syntax error in the generated workflow's final step that marked EVERY successful
// build as failed, after the .apk had already been built and uploaded.
//
// The common thread is not seven unrelated mistakes. It is one structural gap: **NavBharatAI generates
// files in YAML, bash, JSON and TypeScript, and nothing ever parsed them.** Every existing test asserted
// on those files as TEXT — `expect(wf).toContain('assembleDebug')` — which cannot tell a working
// workflow from one bash refuses to run. The moment a `bash -n` check was added it found a live bug
// immediately.
//
// So this suite parses every artifact the four ship/export kits produce, in the language it will
// actually be interpreted as. These files BYPASS the build engine's own syntax gate (they are pushed
// straight to the user's GitHub or handed over as a kit), so this is their only line of defence.
//
// It is deliberately generic: it walks whatever the generators emit rather than naming files, so a NEW
// generated file is covered the day it is added instead of the day it breaks.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { transform } from 'esbuild';
import { load } from 'js-yaml';
import { generateShipKit } from './mobileShipKit';
import { generateMobileExport } from './MobileExportGenerator';
import { generateExtensionExport } from './ExtensionExportGenerator';
import { assembleMobileProject } from './mobileProjectAssembler';

/** A realistic app: its own build script, real deps, and files in several languages. */
const APP_FILES: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'my-app',
    scripts: { build: 'vite build' },
    dependencies: { react: '^19.0.0' },
  }),
  'index.html': '<div id="root"></div>',
  'src/App.tsx': "export const App = () => 'hi';",
};

/** Every file the four user-facing kits produce, labelled by which kit produced it. */
function allGeneratedFiles(): Array<{ kit: string; path: string; content: string }> {
  const out: Array<{ kit: string; path: string; content: string }> = [];
  const add = (kit: string, files: Record<string, string>) => {
    for (const [path, content] of Object.entries(files)) out.push({ kit, path, content });
  };

  add('shipKit', generateShipKit({ appName: 'My App', ios: true }).files);
  add('mobileExport', generateMobileExport({ appName: 'My App' }).files);
  add('extensionExport', generateExtensionExport({ appName: 'My App' }).files);
  add('assembledProject', assembleMobileProject(
    APP_FILES,
    generateShipKit({ appName: 'My App', ios: true }).files,
    { appName: 'My App', appId: 'com.test.app' },
  ).files);
  return out;
}

const FILES = allGeneratedFiles();

describe('the generators actually produce something', () => {
  it('all four kits emit files', () => {
    for (const kit of ['shipKit', 'mobileExport', 'extensionExport', 'assembledProject']) {
      expect(FILES.filter((f) => f.kit === kit).length, `${kit} emitted nothing`).toBeGreaterThan(0);
    }
  });

  it('no generated file is empty or whitespace', () => {
    for (const f of FILES) {
      expect(f.content.trim().length, `${f.kit}: ${f.path} is empty`).toBeGreaterThan(0);
    }
  });
});

describe('YAML files parse, and every shell step inside them is valid bash', () => {
  const yamlFiles = FILES.filter((f) => /\.ya?ml$/.test(f.path));

  it('there are workflows to check', () => {
    expect(yamlFiles.length).toBeGreaterThan(0);
  });

  it.each(yamlFiles.map((f) => [`${f.kit}: ${f.path}`, f] as const))('%s parses as YAML', (_label, f) => {
    expect(() => load(f.content)).not.toThrow();
  });

  it('THE REGRESSION: every run: block is valid bash', () => {
    // The bug this encodes marked every SUCCESSFUL apk build as failed, because the step that broke
    // ran AFTER the artifact upload. A text assertion could never have seen it.
    for (const f of yamlFiles) {
      const doc = load(f.content) as { jobs?: Record<string, { steps?: Array<{ name?: string; run?: string }> }> };
      for (const job of Object.values(doc.jobs || {})) {
        for (const step of job.steps || []) {
          if (!step.run) continue;
          expect(
            () => execFileSync('bash', ['-n'], { input: step.run, stdio: 'pipe' }),
            `${f.kit}: ${f.path} → step "${step.name ?? '(unnamed)'}" is not valid shell`,
          ).not.toThrow();
        }
      }
    }
  });
});

describe('JSON files parse', () => {
  const jsonFiles = FILES.filter((f) => f.path.endsWith('.json'));

  it('there are JSON artifacts to check', () => {
    expect(jsonFiles.length).toBeGreaterThan(0);
  });

  it.each(jsonFiles.map((f) => [`${f.kit}: ${f.path}`, f] as const))('%s is valid JSON', (_label, f) => {
    expect(() => JSON.parse(f.content)).not.toThrow();
  });

  it('a generated package.json is a usable object, not an array or a literal', () => {
    for (const f of jsonFiles.filter((x) => x.path.endsWith('package.json'))) {
      const pkg = JSON.parse(f.content);
      expect(pkg && typeof pkg === 'object' && !Array.isArray(pkg), `${f.kit}: ${f.path}`).toBe(true);
      expect(typeof pkg.name).toBe('string');
    }
  });
});

describe('TypeScript / JavaScript artifacts parse', () => {
  const codeFiles = FILES.filter((f) => /\.(tsx?|jsx?|mjs|cjs)$/.test(f.path) && !/\.d\.ts$/.test(f.path));

  it('there is generated code to check', () => {
    expect(codeFiles.length).toBeGreaterThan(0);
  });

  it.each(codeFiles.map((f) => [`${f.kit}: ${f.path}`, f] as const))('%s parses', async (_label, f) => {
    const loader = /\.tsx$/.test(f.path) ? 'tsx' : /\.ts$/.test(f.path) ? 'ts' : /\.jsx$/.test(f.path) ? 'jsx' : 'js';
    // capacitor.config.ts is READ BY the Capacitor CLI — if it does not parse, `cap add android` fails,
    // which is the exact failure class that cost this project a full day.
    await expect(transform(f.content, { loader, logLevel: 'silent', sourcefile: f.path })).resolves.toBeTruthy();
  });
});

describe('no unsubstituted template values reach a user', () => {
  // "[object Object]" is not hypothetical: the panel really did tell users to add their signing key as
  // "4 secrets: [object Object], [object Object], …" because a type said string[] and join() obeyed it.
  // These three markers are unambiguous — none of them can legitimately appear in a generated artifact.
  const POISON: Array<[string, RegExp]> = [
    ['[object Object]', /\[object Object\]/],
    ['a literal "undefined"', /\bundefined\b/],
    ['a literal "NaN"', /\bNaN\b/],
  ];

  it.each(POISON)('no generated file contains %s', (_label, pattern) => {
    const hits = FILES.filter((f) => pattern.test(f.content)).map((f) => `${f.kit}: ${f.path}`);
    expect(hits, `unsubstituted value leaked into: ${hits.join(', ')}`).toEqual([]);
  });
});

describe('the app name flows through every kit intact', () => {
  // A name with characters that break naive string building — quotes, an apostrophe, a slash — must
  // either be carried safely or escaped, never emitted raw into code that then fails to parse.
  const TRICKY = `Ravi's "Chai" & Co <Test>`;

  it('every artifact still parses when the app name is hostile', async () => {
    const kit = generateShipKit({ appName: TRICKY, ios: true });
    const project = assembleMobileProject(APP_FILES, kit.files, { appName: TRICKY, appId: 'com.test.app' });

    for (const [path, content] of Object.entries(project.files)) {
      if (/\.ya?ml$/.test(path)) {
        expect(() => load(content), path).not.toThrow();
      } else if (path.endsWith('.json')) {
        expect(() => JSON.parse(content), path).not.toThrow();
      } else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(path) && !/\.d\.ts$/.test(path)) {
        const loader = /\.tsx$/.test(path) ? 'tsx' : /\.ts$/.test(path) ? 'ts' : 'js';
        await expect(transform(content, { loader, logLevel: 'silent', sourcefile: path })).resolves.toBeTruthy();
      }
    }
  });

  it('and every shell step still parses with that name', () => {
    const kit = generateShipKit({ appName: TRICKY, ios: true });
    for (const [path, content] of Object.entries(kit.files)) {
      if (!/\.ya?ml$/.test(path)) continue;
      const doc = load(content) as { jobs?: Record<string, { steps?: Array<{ name?: string; run?: string }> }> };
      for (const job of Object.values(doc.jobs || {})) {
        for (const step of job.steps || []) {
          if (!step.run) continue;
          expect(
            () => execFileSync('bash', ['-n'], { input: step.run, stdio: 'pipe' }),
            `${path} → "${step.name}" broke on a hostile app name`,
          ).not.toThrow();
        }
      }
    }
  });
});
