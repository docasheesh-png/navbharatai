import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A TEMPLATE MUST NOT PROMISE A CAPABILITY THE PLATFORM DOES NOT HAVE.
 *
 * `ROADMAP.md` already forbids this for FRAMEWORKS — "registering these would create build options the
 * sandbox CANNOT run (a 'Rust' build that 403s = a fake feature, rule 2)" — and the framework registry
 * is guarded accordingly. The template list is a second, unguarded door into the same builder, and a
 * "React Native App" template was sitting behind it (found 2026-08-08).
 *
 * Picking it sent "Build a React Native (Expo) mobile app" straight to a builder that has no Expo
 * framework, no analyser rule and no sandbox tooling for it: it would scaffold vite-react, write React
 * Native files into it, and hand back an app whose preview can never run.
 *
 * This test is the guard the framework registry already had and the template list did not.
 */
const panel = readFileSync(join(__dirname, '../src/components/panels/TemplatesPanel.tsx'), 'utf8');
const frameworkOptions = readFileSync(join(__dirname, '../src/components/agentv3/frameworkOptions.ts'), 'utf8');

/** Runtimes the sandbox genuinely cannot run today. Remove one ONLY when the E2B image really ships it. */
const UNSUPPORTED_RUNTIMES = [
  'react native', 'react-native', 'expo',
  'flutter', 'swiftui', 'jetpack compose',
  'rust', 'cargo', 'ruby on rails', 'laravel',
];

describe('no template asks the builder for a runtime the sandbox cannot run', () => {
  it('the template prompts name none of them', () => {
    const prompts = [...panel.matchAll(/prompt:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].toLowerCase());
    expect(prompts.length).toBeGreaterThan(5); // the extractor still works

    const offenders: string[] = [];
    for (const p of prompts) {
      for (const runtime of UNSUPPORTED_RUNTIMES) {
        if (p.includes(runtime)) offenders.push(runtime);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('and neither do the template NAMES — the label is the promise the user reads', () => {
    const names = [...panel.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1].toLowerCase());
    for (const name of names) {
      for (const runtime of UNSUPPORTED_RUNTIMES) {
        expect(name).not.toContain(runtime);
      }
    }
  });

  it('the framework registry stays clean too — the two doors must agree', () => {
    // If a runtime ever becomes real it is added HERE first; until then neither door may offer it.
    for (const runtime of UNSUPPORTED_RUNTIMES) {
      expect(frameworkOptions.toLowerCase()).not.toContain(`'${runtime}'`);
    }
  });
});

describe('the mobile template routes to the path that really works', () => {
  it('asks for a mobile-first app rather than a native one', () => {
    expect(panel).toContain("name: 'Mobile App (installable)'");
    expect(panel).toContain('Build a MOBILE-FIRST app');
  });

  it('tells the user where the REAL installable app comes from', () => {
    // NavBharatAI genuinely ships signed .apk/.aab through the APK Builder (Capacitor). Pointing at it
    // is what turns "we cannot do React Native" into "here is the thing you actually wanted".
    expect(panel).toContain('Download APK');
  });

  it('asks for the things that make a wrapped web app feel native', () => {
    // Without these the packaged .apk is a desktop site in a phone frame — technically an app, and
    // not what the user meant.
    for (const requirement of ['Bottom tab navigation', '44x44', 'safe-area', 'offline']) {
      expect(panel).toContain(requirement);
    }
  });
});
