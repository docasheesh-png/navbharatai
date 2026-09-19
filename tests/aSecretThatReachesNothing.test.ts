/**
 * A BUILD-TIME SECRET MUST REACH THE BUILD, OR IT IS A SETTING THAT CHANGES NOTHING.
 *
 * 🔴 Found 2026-09-18, while writing the admin's own switch-on guide for the referral rewards — and
 * before a Play release was cut on it. `android/app/build.gradle` reads
 * `System.getenv("PLAY_INTEGRITY_CLOUD_PROJECT")` and bakes it into `BuildConfig`. The workflow step
 * that runs gradle **did not pass it**. So the whole chain would have been:
 *
 *   admin sets the repo secret → CI runs → green → bundle ships → app installs →
 *   gradle read an EMPTY string → baked "0" → "not configured" →
 *   every integrity check `unavailable` → **every referral claim pays ₹0**
 *
 * …with nothing failing anywhere and no number looking wrong. That is the exact shape CLAUDE.md
 * records for `VITE_META_PIXEL_ID`: a value set in the right-sounding place that silently reaches
 * nothing. The cost would have been a wasted Play review cycle and users earning zero.
 *
 * ## Why a test rather than a careful commit
 *
 * The gap existed because the two halves live in different files, in different languages, and NOTHING
 * connected them: gradle names an env var, the workflow names a secret, and a name present in one and
 * absent from the other is invisible to `tsc`, to vitest and to CI. This test is that connection.
 *
 * It is deliberately DERIVED, not a hardcoded list: it reads every `System.getenv(...)` out of
 * build.gradle and asserts the workflow passes each one. So a future build-time variable is covered
 * the day it is added, without anyone remembering this file exists.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const gradle = readFileSync(resolve(root, 'android/app/build.gradle'), 'utf8');
const workflow = readFileSync(resolve(root, '.github/workflows/android-aab.yml'), 'utf8');

/**
 * Variables gradle reads from the environment.
 *
 * Comments are NOT stripped: a `System.getenv` inside a comment is not a read, and including one
 * would make this test demand a workflow line for a variable nothing uses. The regex matches the
 * call, so prose mentioning a name in passing cannot trip it either.
 */
function gradleEnvNames(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const names = new Set<string>();
  for (const m of code.matchAll(/System\.getenv\(\s*["']([A-Z0-9_]+)["']\s*\)/g)) names.add(m[1]);
  return [...names].sort();
}

/**
 * Variables the workflow's build step actually hands to gradle.
 *
 * The step is found by its `working-directory: android`, because that is what makes it the gradle
 * step regardless of how its name is later reworded.
 */
function workflowEnvNames(src: string): string[] {
  const at = src.indexOf('working-directory: android');
  expect(at, 'the gradle build step was not found in the workflow').toBeGreaterThan(-1);
  // From that step to the `run:` line that ends its env block.
  const step = src.slice(at, src.indexOf('run: ./gradlew', at));
  const names = new Set<string>();
  for (const m of step.matchAll(/^\s{10}([A-Z0-9_]+):/gm)) names.add(m[1]);
  return [...names].sort();
}

describe('every build-time variable gradle reads is passed by the workflow', () => {
  it('🔴 THE ONE THAT WAS MISSING: PLAY_INTEGRITY_CLOUD_PROJECT', () => {
    // Named on its own as well as covered by the sweep below, because this is the case that was
    // really broken — and a sweep that someone later loosens must still fail on this one.
    expect(gradleEnvNames(gradle)).toContain('PLAY_INTEGRITY_CLOUD_PROJECT');
    expect(workflow).toContain('PLAY_INTEGRITY_CLOUD_PROJECT: ${{ secrets.PLAY_INTEGRITY_CLOUD_PROJECT }}');
  });

  it('no variable gradle reads is left unpassed — derived, so a NEW one is covered on day one', () => {
    const passed = new Set(workflowEnvNames(workflow));
    const missing = gradleEnvNames(gradle).filter((n) => !passed.has(n));
    expect(
      missing,
      `build.gradle reads these but the workflow never passes them, so they bake as empty and the `
      + `build still goes green: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('the sweep actually sees the variables it claims to — a guard that finds nothing guards nothing', () => {
    // Without this, a regex that silently stopped matching would make the case above pass vacuously.
    const names = gradleEnvNames(gradle);
    expect(names.length).toBeGreaterThan(3);
    expect(names).toContain('ANDROID_VERSION_CODE');
    expect(names).toContain('FACEBOOK_APP_ID');
    expect(workflowEnvNames(workflow).length).toBeGreaterThan(3);
  });
});

describe('the value is the project NUMBER, and anything else is OFF rather than wrong', () => {
  it('gradle accepts digits only, and falls back to "0" — not-configured, the safe direction', () => {
    const code = gradle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toMatch(/playIntegrityProject ==~ \/\\d\+\/ \? playIntegrityProject : "0"/);
  });

  it('…and it is trimmed, so a pasted newline cannot make a real number unreadable', () => {
    const code = gradle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toMatch(/System\.getenv\("PLAY_INTEGRITY_CLOUD_PROJECT"\)\s*\?:\s*""\)\.trim\(\)/);
  });
});
