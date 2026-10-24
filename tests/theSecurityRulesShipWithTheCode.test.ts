// Security rules must reach the server's project before traffic moves to dependent code.
// An unprovisioned optional Storage bucket must never suppress mandatory Firestore publication.
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';

type Step = { id?: string; name: string; args?: string[]; allowFailure?: boolean; allowExitCodes?: number[]; waitFor?: string[]; entrypoint?: string };
const steps = (load(readFileSync('cloudbuild.yaml', 'utf8')) as { steps: Step[] }).steps;
const rulesAt = steps.findIndex(s => s.id === 'deploy-security-rules');
const storageAt = steps.findIndex(s => s.id === 'deploy-storage-rules');
const rules = steps[rulesAt];
const storage = steps[storageAt];
const script = (step: Step): string => (step?.args ?? []).join('\n');
const deployAt = steps.findIndex(s => (s.args ?? []).slice(0, 2).join(' ') === 'run deploy');

function simulate(step: Step, exitCode: number) {
  const dir = mkdtempSync(join(tmpdir(), 'rules-release-'));
  try {
    writeFileSync(join(dir, 'npx'), '#!/bin/sh\nprintf "%s\\n" "$*"\nexit "$MOCK_EXIT"\n', { mode: 0o700 });
    return spawnSync('/bin/bash', step.args ?? [], {
      encoding: 'utf8', env: { PATH: dir, MOCK_EXIT: String(exitCode), COMMIT_SHA: 'fixture-commit' },
      // Use an absolute executable because PATH intentionally contains only the fake npx.
      shell: false,
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('security rules publish independently before traffic', () => {
  it('requires Firestore while isolating optional Storage', () => {
    expect(rulesAt).toBeGreaterThan(-1);
    expect(storageAt).toBeGreaterThan(rulesAt);
    expect(script(rules)).toMatch(/deploy --only firestore:rules /);
    expect(script(rules)).not.toMatch(/--only[^\n]*(storage|hosting|functions)/);
    expect(script(storage)).toMatch(/deploy --only storage /);
    expect(script(storage)).not.toMatch(/--only[^\n]*(firestore|hosting|functions)/);
    expect(rules.allowFailure).not.toBe(true);
    expect(rules.allowExitCodes ?? []).toEqual([]);
    expect(storage.allowFailure).toBe(true);
  });

  it('uses the server project and pinned CLI for both independent steps', () => {
    const pinned = JSON.parse(readFileSync('package.json', 'utf8'));
    const want = (pinned.devDependencies?.['firebase-tools'] ?? pinned.dependencies?.['firebase-tools'] ?? '').replace(/^[\^~]/, '');
    expect(want).not.toBe('');
    for (const step of [rules, storage]) {
      expect(script(step)).toContain('--project gen-lang-client-0866594388');
      expect(script(step)).not.toContain('navbharatai-3395f');
      expect(script(step)).toContain(`firebase-tools@${want} `);
      expect(script(step)).toContain('set -euo pipefail');
    }
  });

  it('keeps default sequential dependencies, with mandatory rules before optional storage and final traffic', () => {
    expect(deployAt).toBe(steps.length - 1);
    expect(storageAt).toBeLessThan(deployAt);
    // Cloud Build defaults to waiting for every prior step. No custom waitFor can bypass rules.
    for (const step of steps.slice(rulesAt)) expect(step.waitFor).toBeUndefined();
  });

  it.each([1, 7, 42])('preserves Firestore failure %i and never prints successful publication', code => {
    const result = simulate(rules, code);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(code);
    expect(result.stdout).toContain('--only firestore:rules');
    expect(result.stdout).not.toContain('Firestore rules deployed');
  });

  it('does not report optional Storage failure as a successful rule deployment', () => {
    const result = simulate(storage, 1);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('Storage rules deployed');
    expect(storage.allowFailure).toBe(true);
  });

  it('publishes Firestore independently even when the following Storage operation fails', () => {
    const first = simulate(rules, 0);
    const second = simulate(storage, 1);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('Firestore rules deployed');
    expect(second.status).toBe(1);
    expect(rules.allowFailure).not.toBe(true);
    expect(storage.allowFailure).toBe(true);
  });
});
