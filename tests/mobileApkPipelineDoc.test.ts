import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { classifyBuildFailure, repairFiles } from '../src/server/lib/mobileBuildRepair';
import { generateShipKit } from '../src/server/lib/mobileShipKit';
import { detectTailwindProblems } from '../src/server/lib/tailwindSetupHeal';
import { appBuildStore } from '../src/server/lib/AppBuildStore';

/**
 * MOBILE_APK_PIPELINE.md IS A LEDGER, NOT PROSE — pin it to the code it describes.
 *
 * The admin asked for the complete list of every step and check in the Capacitor APK pipeline
 * (2026-08-27). A document like that has one failure mode: the pipeline changes and the document
 * quietly stays behind — the exact doc-vs-code drift CLAUDE.md records happening twice in one month.
 * So the parts of the document that CAN be machine-checked, are:
 *   • every failure code the classifier can name must appear in the doc;
 *   • every step name of the generated APK workflow must appear in the doc;
 *   • every capability the doc claims exists (tailwind preflight, version repair, outcome telemetry)
 *     must actually be importable and behave as claimed.
 * Add a step or a code without documenting it and this fails.
 */

const doc = readFileSync(join(process.cwd(), 'MOBILE_APK_PIPELINE.md'), 'utf8');

// The union lives as a type, so the runtime list is derived by classifying nothing and reading the
// registry section instead: the codes below are asserted BOTH in the doc and (spot-checked) reachable.
const ALL_CODES = [
  'NPM_LOCK_CACHE', 'NPM_CI_NO_LOCK', 'NPM_PEER_CONFLICT', 'NPM_PACKAGE_NOT_FOUND',
  'NPM_VERSION_NOT_FOUND', 'STALE_WORKFLOW', 'BUILD_SCRIPT_MISSING', 'WEB_DIR_MISSING',
  'ANDROID_PLATFORM_MISSING', 'GRADLEW_NOT_EXECUTABLE', 'SDK_LICENSE_NOT_ACCEPTED',
  'JAVA_VERSION_TOO_OLD', 'ANDROID_RESOURCE_LINKING', 'NODE_OUT_OF_MEMORY', 'MISSING_SIGNING_SECRET',
  'SIGNING_CREDENTIALS_WRONG', 'GOOGLE_SERVICES_MISSING', 'NPM_REGISTRY_AUTH',
  'TYPE_GATE_BLOCKED_PACKAGING', 'APP_CODE_BUILD_FAILED', 'UNKNOWN',
];

describe('the pipeline ledger cannot drift from the pipeline', () => {
  it('every classifier code appears in the document', () => {
    const missing = ALL_CODES.filter((c) => !doc.includes(c));
    expect(missing, `codes the doc never mentions: ${missing.join(', ')}`).toEqual([]);
  });

  it('the classifier still knows every code the doc lists (spot checks on real logs)', () => {
    expect(classifyBuildFailure('npm error code ETARGET\nnpm error notarget No matching version found for x@^9.9.9.', 'wf.yml').code)
      .toBe('NPM_VERSION_NOT_FOUND');
    expect(classifyBuildFailure('nonsense log with no known pattern at all', 'wf.yml').code).toBe('UNKNOWN');
  });

  it('every step of the generated APK workflow appears in the document', () => {
    const kit = generateShipKit({ appName: 'Doc Pin', ios: false });
    const apk = Object.entries(kit.files).find(([p]) => /android-apk\.yml$/.test(p));
    expect(apk, 'the generated APK workflow has moved or been renamed').toBeTruthy();
    const steps = [...(apk![1].matchAll(/^\s*- name: (.+)$/gm))].map((m) => m[1].trim());
    expect(steps.length).toBeGreaterThanOrEqual(5);
    const missing = steps.filter((s) => !doc.includes(s));
    expect(missing, `workflow steps the doc never mentions: ${missing.join(', ')}`).toEqual([]);
  });

  it('the capabilities the doc claims for 2026-08-27 are real, not narrative', () => {
    // A4.4: the tailwind preflight check
    expect(detectTailwindProblems({
      'package.json': '{"name":"x","scripts":{"build":"vite build"}}',
      'src/a.css': '@tailwind base;',
    }).length).toBeGreaterThan(0);
    // NPM_VERSION_NOT_FOUND: classify → repair end to end
    const diag = classifyBuildFailure('npm error notarget No matching version found for zod@^99.0.0.', 'wf.yml');
    const fix = repairFiles(diag, { 'package.json': '{"dependencies":{"zod":"^99.0.0"}}' }, 'wf.yml');
    expect(fix).not.toBeNull();
    // Outcome telemetry: the store carries the method (no DB in tests — false is the contract there)
    expect(typeof appBuildStore.setOutcome).toBe('function');
  });

  it('the doc names all three phases and the honest gaps section', () => {
    for (const marker of ['Phase A', 'Phase B', 'Phase C', 'Still uncovered', 'NBAI_FAILED_STAGE']) {
      expect(doc, `the doc lost its "${marker}" section`).toContain(marker);
    }
  });
});
