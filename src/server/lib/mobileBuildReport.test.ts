// Tests for the downloadable APK/AAB/iOS build report (admin 2026-08-18).
//
// The two promises being locked: the report's WHY comes from the SAME classifier the self-healing loop
// uses (one story, never two), and every user-facing string stays white-label.

import { describe, it, expect } from 'vitest';
import {
  buildMobileBuildReport, buildingLabel, mapRunSteps, reportLogExcerpt, friendlyBuildStep,
} from './mobileBuildReport';
import { SHIP_WORKFLOWS } from '../../lib/shipWorkflows';

const NOW = Date.parse('2026-08-18T19:00:00Z');

const BASE = {
  owner: 'someone',
  repo: 'piano',
  workflow: SHIP_WORKFLOWS.androidApk,
  now: NOW,
};

// The REAL piano failure (run #3): the strict type check died in the web-build step.
const PIANO_LOG = [
  '2026-08-18T18:22:01.0000000Z ##[group]Run npm run build',
  '2026-08-18T18:22:02.0000000Z > piano@0.0.0 build',
  '2026-08-18T18:22:02.0000000Z > tsc -p tsconfig.build.json && vite build',
  "2026-08-18T18:22:04.0000000Z src/components/Key.tsx(14,23): error TS2345: Argument of type 'string' is not assignable.",
  '2026-08-18T18:22:04.0000000Z ##[error]Process completed with exit code 2.',
  '2026-08-18T18:22:04.0000000Z ##[endgroup]',
  '2026-08-18T18:22:05.0000000Z NBAI_FAILED_STAGE=webbuild',
].join('\n');

describe('buildMobileBuildReport', () => {
  it('a FAILED build carries the full written why, the stage, and the real log lines', () => {
    const r = buildMobileBuildReport({
      ...BASE,
      run: { id: 3, status: 'completed', conclusion: 'failure', startedAt: '2026-08-18T18:21:30Z', completedAt: '2026-08-18T18:22:10Z', htmlUrl: 'https://github.com/x/y/runs/3' },
      steps: [
        { label: "Installing your app's libraries", state: 'done' },
        { label: 'Building your app', state: 'failed' },
      ],
      log: PIANO_LOG,
    });
    expect(r.build.result).toBe('failed');
    expect(r.build.durationSeconds).toBe(40);
    expect(r.failure).not.toBeNull();
    expect(r.failure!.whatStopped).toBe('Building your app');
    expect(r.failure!.stage).toBe('webbuild');
    // The classifier's own words — a real sentence, not a code.
    expect(r.failure!.why.length).toBeGreaterThan(20);
    // This class IS self-healable (the type-gate workflow refresh), and the report says so.
    expect(r.failure!.navbharatCanFixItself).toBe(true);
    // The real log lines travelled, timestamps stripped, group markers dropped.
    expect(r.failure!.logExcerpt.join('\n')).toContain('error TS2345');
    expect(r.failure!.logExcerpt.join('\n')).not.toMatch(/^\d{4}-\d{2}-\d{2}T/m);
    expect(r.failure!.logExcerpt.join('\n')).not.toContain('##[group]');
  });

  it('WHITE-LABEL: no user-facing string in a failed report names an AI vendor or model', () => {
    const r = buildMobileBuildReport({
      ...BASE,
      run: { id: 3, status: 'completed', conclusion: 'failure' },
      steps: [{ label: 'Building your app', state: 'failed' }],
      log: PIANO_LOG,
    });
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/GLM|Kimi|Claude|Sonnet|Opus|Gemini|Grok|Anthropic|Moonshot/i);
  });

  it('a SUCCESSFUL build has failure: null and never needs a log', () => {
    const r = buildMobileBuildReport({
      ...BASE,
      run: { id: 4, status: 'completed', conclusion: 'success', startedAt: '2026-08-18T18:00:00Z', completedAt: '2026-08-18T18:05:00Z' },
      steps: [{ label: 'Building your app', state: 'done' }],
    });
    expect(r.build.result).toBe('success');
    expect(r.build.durationSeconds).toBe(300);
    expect(r.failure).toBeNull();
  });

  it('a failed run whose log could not be read says so honestly instead of inventing a cause', () => {
    const r = buildMobileBuildReport({
      ...BASE,
      run: { id: 5, status: 'completed', conclusion: 'failure' },
      steps: [],
      log: '',
    });
    expect(r.failure!.why).toContain('could not be determined');
    expect(r.failure!.navbharatCanFixItself).toBe(false);
    expect(r.failure!.logExcerpt).toEqual([]);
  });

  it('a user-stopped build reports "stopped", never "failed"', () => {
    const r = buildMobileBuildReport({
      ...BASE,
      run: { id: 6, status: 'completed', conclusion: 'cancelled' },
      steps: [],
    });
    expect(r.build.result).toBe('stopped');
    expect(r.failure).toBeNull();
  });

  it('a still-running build reports "running" with no duration', () => {
    const r = buildMobileBuildReport({
      ...BASE,
      run: { id: 7, status: 'in_progress', conclusion: null, startedAt: '2026-08-18T18:58:00Z' },
      steps: [{ label: 'Building your app', state: 'running' }],
    });
    expect(r.build.result).toBe('running');
    expect(r.build.durationSeconds).toBeNull();
  });

  it('names what each workflow builds, in the user’s terms', () => {
    expect(buildingLabel(SHIP_WORKFLOWS.androidApk)).toContain('.apk');
    expect(buildingLabel(SHIP_WORKFLOWS.androidAab)).toContain('.aab');
    expect(buildingLabel(SHIP_WORKFLOWS.iosIpa)).toContain('TestFlight');
  });
});

describe('mapRunSteps — ONE mapping shared with the live progress view', () => {
  it('hides housekeeping, maps to friendly labels, and marks the failed step', () => {
    const steps = mapRunSteps([
      { name: 'Set up job', status: 'completed', conclusion: 'success' },
      { name: 'Run actions/checkout@v4', status: 'completed', conclusion: 'success' },
      { name: "Install the app's libraries", status: 'completed', conclusion: 'success' },
      { name: 'Build the web app', status: 'completed', conclusion: 'failure' },
      { name: 'Build the installable APK', status: 'queued', conclusion: null },
    ]);
    expect(steps).toEqual([
      { label: "Installing your app's libraries", state: 'done' },
      { label: 'Building your app', state: 'failed' },
      { label: 'Compiling your Android app', state: 'pending' },
    ]);
  });

  it('collapses consecutive steps that share one friendly label', () => {
    const steps = mapRunSteps([
      { name: 'Set up Node.js', status: 'completed', conclusion: 'success' },
      { name: 'Set up Java', status: 'in_progress', conclusion: null },
    ]);
    expect(steps).toEqual([{ label: 'Getting the build machine ready', state: 'running' }]);
  });

  it('friendlyBuildStep is the same mapping the route re-exports (no drift)', () => {
    expect(friendlyBuildStep('Build the web app')).toBe('Building your app');
    expect(friendlyBuildStep('Set up job')).toBeNull();
  });
});

describe('reportLogExcerpt — bounded, cleaned, real', () => {
  it('is bounded so a runaway log cannot flood the report', () => {
    const huge = Array.from({ length: 5000 }, (_, i) => `##[error]line ${i} ${'x'.repeat(600)}`).join('\n');
    const out = reportLogExcerpt(huge);
    expect(out.length).toBeLessThanOrEqual(120);
    for (const l of out) expect(l.length).toBeLessThanOrEqual(401);
  });
});
