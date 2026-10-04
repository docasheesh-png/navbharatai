/**
 * QUEUE Q-237 (iOS run 36792748246, SHANKU-AI/instamony, 2026-10-04): "XCODE N IS TOO OLD" HAD NO CLASS.
 *
 * The iOS pre-flight has two sentences. #3467 taught the classifier the first ("Missing Apple signing
 * secret(s)"); the second — the runner's newest Xcode is older than the one Apple accepts uploads from —
 * still read as UNKNOWN. It is neither the user's code (no repair to the app helps), nor our workflow (the
 * current kit selects the newest Xcode already), nor the user's key. It is the build machine. Treating it
 * as anything else spends a model call and a five-minute run on a certainty, or tells the user something
 * false about their app.
 *
 * The class: "a failure whose cause is the machine the run was given". It gets its own cure family, the
 * autofix route stops on it before a model is called, and the admin card counts it apart.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMachineTooOld, classifyBuildFailure } from '../src/server/lib/mobileBuildRepair';
import { cureFamily } from '../src/server/lib/mobileBuildOutcomeStore';
import { generateShipKit } from '../src/server/lib/mobileShipKit';

const ROOT = join(__dirname, '..');
const IOS = '.github/workflows/ios-ipa.yml';

/** The Xcode step of the workflow we really generate, as GitHub prints it before running it. */
function printedXcodeStep(): string {
  const kit = generateShipKit({ appName: 'Machine', ios: true });
  const wf = kit.files[IOS];
  const step = wf.split(/\n\s*- name: /).find((s) => /^Select the newest Xcode/.test(s));
  if (!step) throw new Error('the iOS workflow has no Xcode step');
  const run = step.slice(step.indexOf('run: |') + 'run: |'.length);
  return run.split('\n').map((l) => `\u001b[36;1m${l.trim()}\u001b[0m`).join('\n');
}

describe('the report\'s other sentence', () => {
  it('names the build machine, not the app, and is never handed to a repair', () => {
    const log = [
      '##[group]Run LATEST="$(ls -d /Applications/Xcode_*.app 2>/dev/null | sort -V | tail -1)"',
      printedXcodeStep(),
      '##[endgroup]',
      'Xcode 16.4',
      'Build version 16F6',
      '##[error]Xcode 16 is too old — Apple requires Xcode 26+ (iOS 26 SDK) to upload.',
      '##[error]Process completed with exit code 1.',
      'NBAI_FAILED_STAGE=preflight',
    ].join('\n');
    const d = classifyBuildFailure(log, IOS);
    expect(d.code).toBe('BUILD_MACHINE_TOO_OLD');
    expect(d.autoFixable).toBe(false);
    expect(d.detail).toEqual({ xcode: '16' });
    expect(d.summary).toMatch(/Xcode 16/);
    expect(d.summary).toMatch(/Your app is fine/);
    expect(d.summary).not.toMatch(/install|GitHub|Anthropic|Claude/i);
    expect(cureFamily(d.code)).toBe('build-machine');
  });

  it('a runner with no Xcode at all is the same class', () => {
    const d = classifyBuildFailure('##[error]No Xcode on this runner.\n##[error]Process completed with exit code 1.', IOS);
    expect(d.code).toBe('BUILD_MACHINE_TOO_OLD');
    expect(d.detail).toBeUndefined();
  });
});

describe('🔒 the printed script is never the answer', () => {
  it('the step\'s own echo lines, printed by GitHub on every run, name nothing', () => {
    expect(buildMachineTooOld(printedXcodeStep())).toBeNull();
  });

  it('a build that got past the pre-flight and failed elsewhere keeps its own class', () => {
    const log = [printedXcodeStep(), 'Xcode 26.0', '##[error]Missing Apple signing secret(s): IOS_TEAM_ID — see SHIPPING.md.'].join('\n');
    expect(classifyBuildFailure(log, IOS).code).toBe('MISSING_SIGNING_SECRET');
  });
});

describe('🔒 census: every sentence the Xcode step can print is understood', () => {
  const step = printedXcodeStep();
  const sentences = [...step.matchAll(/echo "::error::([^"]+)"/g)].map((m) => m[1].replace('$MAJOR', '16'));

  it('finds both sentences (so the census is not empty)', () => {
    expect(sentences).toHaveLength(2);
  });

  it('classifies each as the build machine', () => {
    for (const s of sentences) expect(classifyBuildFailure(`##[error]${s}`, IOS).code, s).toBe('BUILD_MACHINE_TOO_OLD');
  });
});

describe('the autofix route stops before a model is spent', () => {
  it('returns on the build-machine family before the AI pass is built', () => {
    const route = readFileSync(join(ROOT, 'src/server/routes/mobileShip.ts'), 'utf8');
    const stop = route.indexOf("cureFamily(diag.code) === 'build-machine'");
    expect(stop).toBeGreaterThan(0);
    expect(stop).toBeLessThan(route.indexOf('const tryAiRepair = async'));
  });
});
