import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/qubaxReadiness.check.mjs', import.meta.url));
const endpoint = '127.0.0.1:18781', project = 'demo-navbharatai-phase2';
const args = ['--emulator', endpoint, '--project', project];

describe('Qubax real-transaction drill fails closed before any application import', () => {
  it.each([
    { args: [], env: {}, message: 'Explicit loopback emulator required' },
    { args: ['--emulator', 'firestore.googleapis.com:443', '--project', project], env: {}, message: 'Explicit loopback emulator required' },
    { args: ['--emulator', '127.0.0.1:443', '--project', project], env: {}, message: 'Invalid emulator port' },
    { args: ['--emulator', endpoint, '--project', 'non-demo-project'], env: {}, message: 'Explicit isolated demo project required' },
    { args, env: {}, message: 'No production database fallback' },
    { args, env: { FIRESTORE_EMULATOR_HOST: endpoint, GOOGLE_CLOUD_PROJECT: 'non-demo-project' }, message: 'Conflicting project environment' },
    { args, env: { FIRESTORE_EMULATOR_HOST: endpoint, QUBAX_API_KEY: 'synthetic-never-transmitted' }, message: 'Run this drill in a credential-empty environment' },
    { args, env: { FIRESTORE_EMULATOR_HOST: endpoint, GOOGLE_APPLICATION_CREDENTIALS: '/synthetic-never-read.json' }, message: 'Run this drill in a credential-empty environment' },
  ])('rejects unsafe invocation %#', input => {
    const result = spawnSync(process.execPath, [script, ...input.args], { env: input.env, encoding: 'utf8', timeout: 5000 });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(input.message);
    expect(result.stdout).not.toContain('PASS');
    expect(result.stderr).not.toContain('synthetic-never-transmitted');
    expect(result.stderr).not.toContain('/synthetic-never-read.json');
  });

  it('keeps the real emulator regression in the existing mandatory CI job', () => {
    const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const job = workflow.split('  build-and-test:')[0];
    expect(job).toContain('npm run test:qubax-readiness:emulator -- --emulator 127.0.0.1:18781 --project demo-navbharatai-phase2');
    expect(job).toContain('phase2-firestore-drills.mjs');
    expect(job).toContain('session-revocation-rules.check.mjs');
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.scripts['test:qubax-readiness:emulator']).toBe('node --import ./node_modules/tsx/dist/loader.mjs scripts/qubaxReadiness.check.mjs');
  });
});
