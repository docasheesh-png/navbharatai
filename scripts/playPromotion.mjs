#!/usr/bin/env node
/** Exact-version Play promotion. Defaults to an offline fixture; never prints API errors/credentials. */
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { envFlag, parseEnvFlag } from '../src/server/lib/envFlag.ts';

export const packageName = 'com.navbharat.ai';
const apiRoot = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/edits`;
const allowedReleaseKeys = ['name', 'versionCodes', 'releaseNotes', 'status', 'inAppUpdatePriority'];
class PromotionError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new PromotionError(code); };
const version = value => typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) && Number(value) <= 2100000000;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

export function planPromotion(versionCode, internal, production, changesNotSentForReview = false) {
  if (!version(versionCode)) fail('INVALID_VERSION_CODE');
  if (typeof changesNotSentForReview !== 'boolean') fail('INVALID_REVIEW_SETTING');
  if (internal?.track !== 'internal' || production?.track !== 'production') fail('UNEXPECTED_TRACK');
  if ([internal, production].some(track => Object.keys(track).some(key => !['track', 'releases'].includes(key)))) fail('TRACK_SETTINGS_REQUIRE_CONSOLE_REVIEW');
  if (!Array.isArray(internal.releases) || !Array.isArray(production.releases)) fail('INVALID_TRACK');
  const matches = internal.releases.filter(release => release.versionCodes?.includes(versionCode));
  if (matches.length !== 1) fail('EXACT_INTERNAL_VERSION_NOT_FOUND');
  const selected = matches[0];
  if (selected.status !== 'completed' || selected.versionCodes.length !== 1) fail('AMBIGUOUS_INTERNAL_RELEASE');
  // Do not alter or bypass an existing rollout, country targeting or unknown release setting.
  if (production.releases.length !== 1) fail('PRODUCTION_REQUIRES_CONSOLE_REVIEW');
  const current = production.releases[0];
  for (const release of [selected, current]) {
    if (release.status !== 'completed' || Object.keys(release).some(key => !allowedReleaseKeys.includes(key))) fail('RELEASE_SETTINGS_REQUIRE_CONSOLE_REVIEW');
    if (!Array.isArray(release.versionCodes) || !release.versionCodes.length || !release.versionCodes.every(version)) fail('INVALID_RELEASE_VERSIONS');
  }
  if (current.versionCodes.includes(versionCode)) fail('VERSION_ALREADY_IN_PRODUCTION');
  if (current.versionCodes.some(code => Number(code) >= Number(versionCode))) fail('VERSION_NOT_NEWER');
  // Retain prior APK versions for devices not supported by the new bundle. Never rebuild/upload.
  const release = { ...structuredClone(selected), versionCodes: [...current.versionCodes, versionCode] };
  const target = { track: 'production', releases: [release] };
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical({ packageName, versionCode, internal, production, target, changesNotSentForReview }))).digest('hex');
  return { packageName, versionCode, sourceTrack: 'internal', destinationTrack: 'production',
    retainedVersionCodes: [...current.versionCodes], changesNotSentForReview, fingerprint, target };
}

export async function promote({ mode, versionCode, expectedFingerprint = '', consoleClear = false, dataSafetyReviewed = false,
  changesNotSentForReview = false }, request) {
  if (!['inspect', 'promote'].includes(mode) || !version(versionCode)) fail('INVALID_INPUT');
  if (consoleClear !== true) fail('CONSOLE_REVIEW_REQUIRED');
  if (mode === 'promote' && dataSafetyReviewed !== true) fail('DATA_SAFETY_REVIEW_REQUIRED');
  if (mode === 'promote' && !/^[a-f0-9]{64}$/.test(expectedFingerprint)) fail('REVIEWED_FINGERPRINT_REQUIRED');
  let editId, commitAttempted = false;
  try {
    const edit = await request('POST', apiRoot, {});
    if (typeof edit?.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(edit.id)) fail('INVALID_EDIT');
    editId = edit.id;
    const root = `${apiRoot}/${editId}`;
    const internal = await request('GET', `${root}/tracks/internal`);
    const production = await request('GET', `${root}/tracks/production`);
    const plan = planPromotion(versionCode, internal, production, changesNotSentForReview);
    if (mode === 'inspect') return { status: 'inspected-not-published', ...plan };
    if (plan.fingerprint !== expectedFingerprint) fail('REVIEWED_STATE_CHANGED');
    const updated = await request('PUT', `${root}/tracks/production`, plan.target);
    if (JSON.stringify(canonical(updated)) !== JSON.stringify(canonical(plan.target))) fail('TRACK_UPDATE_UNCONFIRMED');
    await request('POST', `${root}:validate`);
    commitAttempted = true;
    const committed = await request('POST', `${root}:commit${changesNotSentForReview ? '?changesNotSentForReview=true' : ''}`);
    if (committed?.id !== editId) fail('COMMIT_OUTCOME_UNKNOWN');
    return { status: changesNotSentForReview ? 'committed-not-sent-for-review' : 'committed-review-and-availability-unverified', ...plan };
  } catch (error) {
    // A lost commit response cannot be retried or reported as rejection/success.
    if (commitAttempted) fail('COMMIT_OUTCOME_UNKNOWN_CHECK_PLAY_CONSOLE_NO_REPLAY');
    throw error;
  } finally {
    // Only abandon edits that we know were never submitted for commit.
    if (editId && !commitAttempted) {
      try { await request('DELETE', `${apiRoot}/${editId}`); }
      catch { fail('EDIT_CLEANUP_UNCONFIRMED_CHECK_PLAY_CONSOLE'); }
    }
  }
}

export function offlinePlan() {
  return planPromotion('158', { track: 'internal', releases: [{ status: 'completed', versionCodes: ['158'], name: 'Fixture release', releaseNotes: [{ language: 'en-US', text: 'Synthetic release notes' }] }] },
    { track: 'production', releases: [{ status: 'completed', versionCodes: ['157'] }] });
}

async function main() {
  const mode = process.env.PLAY_PROMOTION_MODE || 'offline';
  if (mode === 'offline') { console.log(JSON.stringify({ status: 'offline-fixture-no-network', ...offlinePlan() })); return; }
  if (process.env.GITHUB_REF !== 'refs/heads/main') fail('MAIN_BRANCH_REQUIRED');
  const raw = process.env.PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) fail('PLAY_CREDENTIAL_NOT_CONFIGURED');
  let credentials;
  try { credentials = JSON.parse(raw); } catch { fail('INVALID_PLAY_CREDENTIAL'); }
  if (credentials?.type !== 'service_account' || typeof credentials.client_email !== 'string' ||
      typeof credentials.private_key !== 'string' || !credentials.private_key ||
      credentials.token_uri !== 'https://oauth2.googleapis.com/token') fail('INVALID_PLAY_CREDENTIAL');
  const { GoogleAuth } = await import('google-auth-library');
  const client = await new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/androidpublisher'] }).getClient();
  const request = async (method, url, data) => {
    try { return (await client.request({ method, url, data, retry: false, timeout: 30_000 })).data; }
    catch (error) {
      const status = Number(error?.response?.status);
      fail(Number.isInteger(status) && status >= 400 && status <= 599 ? `PLAY_HTTP_${status}_CHECK_CONSOLE` : 'PLAY_REQUEST_UNCONFIRMED');
    }
  };
  const reviewDeferred = parseEnvFlag(process.env.PLAY_REVIEW_DEFERRED);
  if (process.env.PLAY_REVIEW_DEFERRED && reviewDeferred === null) fail('INVALID_REVIEW_SETTING');
  const result = await promote({ mode, versionCode: process.env.PLAY_VERSION_CODE,
    expectedFingerprint: process.env.PLAY_EXPECTED_FINGERPRINT,
    consoleClear: envFlag('PLAY_CONSOLE_CLEAR'), dataSafetyReviewed: envFlag('PLAY_DATA_SAFETY_REVIEWED'),
    changesNotSentForReview: reviewDeferred ?? false }, request);
  // Release notes are kept intact in the API update, but never echoed into CI command/summary markup.
  const summary = { status: result.status, packageName, versionCode: result.versionCode,
    retainedVersionCodes: result.retainedVersionCodes, changesNotSentForReview: result.changesNotSentForReview, fingerprint: result.fingerprint };
  console.log(JSON.stringify(summary));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\nPlay promotion result: ${JSON.stringify(summary)}\n\nCommit is not proof of review approval or user availability.\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`${error instanceof PromotionError ? error.code : 'PLAY_AUTH_OR_RUNTIME_UNCONFIRMED'}: inspect Play Console and workflow inputs; do not automatically replay.`); process.exitCode = 1; });
}
