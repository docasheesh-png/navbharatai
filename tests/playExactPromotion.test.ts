import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import yaml from 'js-yaml';
import { planPromotion, promote, offlinePlan } from '../scripts/playPromotion.mjs';

const internal = () => ({ track: 'internal', releases: [{ status: 'completed', versionCodes: ['158'], name: 'Reviewed release',
  releaseNotes: [{ language: 'en-US', text: 'Keep these exact notes.' }], inAppUpdatePriority: 2 }] });
const production = () => ({ track: 'production', releases: [{ status: 'completed', versionCodes: ['155', '157'] }] });
function fixture({ source = internal(), target = production(), failure = '', mismatch = false } = {}) {
  const calls: Array<{ method: string; url: string; data: unknown }> = [];
  const request = async (method: string, url: string, data?: unknown) => {
    calls.push({ method, url, data });
    if (failure && url.endsWith(failure)) throw Error('Do not echo upstream error content');
    if (method === 'GET') return structuredClone(url.endsWith('/internal') ? source : target);
    if (method === 'PUT') return mismatch ? {} : structuredClone(data);
    if (url.endsWith(':commit') || url.includes(':commit?')) return { id: 'edit-test' };
    if (method === 'POST' && url.endsWith('/edits')) return { id: 'edit-test' };
    return {};
  };
  return { calls, request };
}
const input = () => ({ mode: 'promote', versionCode: '158', expectedFingerprint: planPromotion('158', internal(), production()).fingerprint,
  consoleClear: true, dataSafetyReviewed: true });

describe('exact-version Android promotion', () => {
  it('preserves selected release content and existing device versions without mutating source tracks', () => {
    const source = internal(), target = production(), before = JSON.stringify({ source, target });
    const plan = planPromotion('158', source, target);
    expect(plan.packageName).toBe('com.navbharat.ai');
    expect(plan.target.releases).toEqual([{ ...source.releases[0], versionCodes: ['155', '157', '158'] }]);
    expect(JSON.stringify({ source, target })).toBe(before);
    expect(plan.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each(['', 'latest', '0', '-1', '1e2', '158/other', '2100000001'])('rejects invalid version %s', code => {
    expect(() => planPromotion(code, internal(), production())).toThrow('INVALID_VERSION_CODE');
  });
  it('rejects the wrong source, missing version, multi-version release and first production publication', () => {
    expect(() => planPromotion('158', { ...internal(), track: 'beta' }, production())).toThrow('UNEXPECTED_TRACK');
    expect(() => planPromotion('159', internal(), production())).toThrow('EXACT_INTERNAL_VERSION_NOT_FOUND');
    const source = internal(); source.releases[0].versionCodes.push('159');
    expect(() => planPromotion('158', source, production())).toThrow('AMBIGUOUS_INTERNAL_RELEASE');
    expect(() => planPromotion('158', internal(), { track: 'production', releases: [] })).toThrow('PRODUCTION_REQUIRES_CONSOLE_REVIEW');
  });
  it.each([{ status: 'inProgress', userFraction: 0.1 }, { status: 'draft' }, { countryTargeting: { countries: ['IN'] } }, { unfamiliarPolicy: true }])('refuses protected or unfamiliar release state %j', fields => {
    const target = production(); Object.assign(target.releases[0], fields);
    expect(() => planPromotion('158', internal(), target)).toThrow('RELEASE_SETTINGS_REQUIRE_CONSOLE_REVIEW');
  });
  it('refuses already-promoted or older versions instead of replaying', () => {
    const target = production(); target.releases[0].versionCodes.push('158');
    expect(() => planPromotion('158', internal(), target)).toThrow('VERSION_ALREADY_IN_PRODUCTION');
    target.releases[0].versionCodes = ['159'];
    expect(() => planPromotion('158', internal(), target)).toThrow('VERSION_NOT_NEWER');
  });
  it('inspection reads only the expected tracks and deletes its uncommitted edit', async () => {
    const f = fixture(); const result = await promote({ ...input(), mode: 'inspect' }, f.request);
    expect(result.status).toBe('inspected-not-published');
    expect(f.calls.map(call => call.method)).toEqual(['POST', 'GET', 'GET', 'DELETE']);
    expect(f.calls.every(call => call.url.startsWith('https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.navbharat.ai/edits'))).toBe(true);
  });
  it.each(['consoleClear', 'dataSafetyReviewed'])('requires explicit %s before any edit', async flag => {
    const f = fixture(); await expect(promote({ ...input(), [flag]: false }, f.request)).rejects.toThrow();
    expect(f.calls).toEqual([]);
  });
  it('stops on changed production or notes before PUT and cleans up its edit', async () => {
    const source = internal(); source.releases[0].releaseNotes[0].text = 'Changed';
    const f = fixture({ source }); await expect(promote(input(), f.request)).rejects.toThrow('REVIEWED_STATE_CHANGED');
    expect(f.calls.map(call => call.method)).toEqual(['POST', 'GET', 'GET', 'DELETE']);
  });
  it('validates before one commit, preserves review deferral and never claims user availability', async () => {
    const f = fixture(); const result = await promote({ ...input(), changesNotSentForReview: true,
      expectedFingerprint: planPromotion('158', internal(), production(), true).fingerprint }, f.request);
    expect(f.calls.map(call => call.method)).toEqual(['POST', 'GET', 'GET', 'PUT', 'POST', 'POST']);
    expect(f.calls[4].url).toMatch(/:validate$/);
    expect(f.calls[5].url).toMatch(/:commit\?changesNotSentForReview=true$/);
    expect(result.status).toBe('committed-not-sent-for-review');
  });
  it('refuses to silently change the review-deferral setting after inspection', async () => {
    const f = fixture(); await expect(promote({ ...input(), changesNotSentForReview: true }, f.request)).rejects.toThrow('REVIEWED_STATE_CHANGED');
    expect(f.calls.some(call => call.method === 'PUT')).toBe(false);
  });
  it('aborts on unconfirmed updates or validation failures before commit', async () => {
    for (const f of [fixture({ mismatch: true }), fixture({ failure: ':validate' })]) {
      await expect(promote(input(), f.request)).rejects.toThrow();
      expect(f.calls.some(call => call.url.includes(':commit'))).toBe(false);
      expect(f.calls.at(-1).method).toBe('DELETE');
    }
  });
  it('never retries or deletes after an uncertain commit', async () => {
    const f = fixture({ failure: ':commit' });
    await expect(promote(input(), f.request)).rejects.toThrow('COMMIT_OUTCOME_UNKNOWN_CHECK_PLAY_CONSOLE_NO_REPLAY');
    expect(f.calls.filter(call => call.url.endsWith(':commit'))).toHaveLength(1);
    expect(f.calls.at(-1).url).toMatch(/:commit$/);
  });
  it('runs offline by default and does not print credential material on invalid live input', () => {
    const canary = randomUUID();
    const run = (mode: string) => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/playPromotion.mjs'], { encoding: 'utf8', env: {
      PATH: process.env.PATH, PLAY_PROMOTION_MODE: mode, GITHUB_REF: 'refs/heads/main', PLAY_SERVICE_ACCOUNT_JSON: canary,
    } });
    const offline = run('offline'); expect(offline.status).toBe(0); expect(offline.stdout).toContain('offline-fixture-no-network');
    expect(offlinePlan().versionCode).toBe('158');
    const invalid = run('inspect'); expect(invalid.status).toBe(1); expect(invalid.stderr).toContain('INVALID_PLAY_CREDENTIAL');
    expect(offline.stdout + offline.stderr + invalid.stdout + invalid.stderr).not.toContain(canary);
  });
  it('workflow defaults to offline and shares a non-cancelling Play edit lock with uploader', () => {
    const workflow = yaml.load(readFileSync('.github/workflows/android-promote.yml', 'utf8')) as any;
    const uploader = yaml.load(readFileSync('.github/workflows/android-aab.yml', 'utf8')) as any;
    expect(workflow.on.workflow_dispatch.inputs.mode.default).toBe('offline');
    expect(workflow.on.workflow_dispatch.inputs.data_safety_reviewed.default).toBe(false);
    expect(workflow.concurrency).toEqual({ group: 'google-play-com-navbharat-ai', 'cancel-in-progress': false });
    expect(uploader.concurrency.group).toContain('google-play-com-navbharat-ai');
    expect(uploader.concurrency['cancel-in-progress']).toBe(false);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs.promote.if).toBe("github.ref == 'refs/heads/main'");
  });
});
