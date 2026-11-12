import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function inventory(mode = 'ok') {
  const dir = mkdtempSync(join(tmpdir(), 'cloud-cost-inventory-'));
  directories.push(dir);
  const log = join(dir, 'calls.log');
  // No cloud CLI is ever reached: PATH points first to this allowlisted fixture.
  writeFileSync(join(dir, 'gcloud'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$MOCK_LOG"
[ "$1" = --quiet ] || exit 90
shift
case "$*" in
  "projects describe "*|"beta billing projects describe "*|"run services list "*|"run services describe "*|"builds list "*|"artifacts repositories list "*|"compute disks list "*|"compute addresses list "*|"compute snapshots list "*|"storage buckets list "*|"storage buckets describe "*|"billing budgets list "*) ;;
  *) echo 'UNSAFE OR UNEXPECTED COMMAND' >&2; exit 91;;
esac
case "$*" in
  "run services list "*"value(metadata.name)"*)
    [ "$MOCK_MODE" = services-fail ] && { echo 'fixture permission denied' >&2; exit 7; }
    [ "$MOCK_MODE" = empty ] || printf 'fixture-service\\n';;
  "storage buckets list "*)
    [ "$MOCK_MODE" = buckets-fail ] && { echo 'fixture bucket error' >&2; exit 7; }
    [ "$MOCK_MODE" = empty ] || printf 'fixture-bucket\\n';;
  "run services describe "*) [ "$MOCK_MODE" = describe-fail ] && exit 7;;
  "beta billing projects describe "*"value(billingAccountName)"*)
    [ "$MOCK_MODE" = billing-fail ] && exit 7
    [ "$MOCK_MODE" = billing-missing ] || printf 'billingAccounts/fixture-account\\n';;
esac
exit 0
`, { mode: 0o700 });
  const result = spawnSync('bash', [resolve('scripts/auditNavBharatCloudCosts.sh')], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, MOCK_LOG: log, MOCK_MODE: mode, APPS_PROJECT: 'fixture-project', REGION: 'fixture-region' },
    encoding: 'utf8', timeout: 10_000,
  });
  return { ...result, calls: readFileSync(log, 'utf8').trim().split('\n') };
}
describe('Cloud cost inventory is read-only and reports incomplete reads', () => {
  it('uses only quiet read commands and the correct Cloud Run resource paths', () => {
    const r = inventory();
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('UNSAFE');
    expect(r.calls.every(call => call.startsWith('--quiet '))).toBe(true);
    const service = r.calls.find(call => call.includes('run services describe'))!;
    expect(service).toContain('spec.template.metadata.annotations');
    expect(service).toContain('spec.template.spec.containers[0].resources');
    expect(service).toContain('spec.template.spec.containerConcurrency');
    expect(service).toContain('spec.template.spec.timeoutSeconds');
    expect(service).toContain('spec.template.spec.serviceAccountName');
    expect(r.stdout).toContain('Billing-account-wide budget objects');
    expect(r.calls.find(call => call.includes('billing budgets list'))).toContain('budgetFilter');
  });
  it.each(['services-fail', 'buckets-fail', 'describe-fail'])('reports %s without treating failed reads as empty inventory', mode => {
    const r = inventory(mode);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Inventory incomplete');
    expect(r.stderr).toContain('WARNING:');
    expect(r.calls.some(call => call.includes('compute snapshots list'))).toBe(true);
  });
  it.each(['billing-fail', 'billing-missing'])('does not issue an empty or guessed budget request on %s', mode => {
    const r = inventory(mode);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('budget inventory skipped');
    expect(r.calls.some(call => call.includes('billing budgets list'))).toBe(false);
  });
  it('accepts a successful empty listing without claiming a read failure', () => {
    const r = inventory('empty');
    expect(r.status).toBe(0);
    expect(r.calls.some(call => call.includes('run services describe'))).toBe(false);
    expect(r.calls.some(call => call.includes('storage buckets describe'))).toBe(false);
  });
});
