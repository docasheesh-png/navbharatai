import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { braceBlock } from './helpers/sourceSlice';
import {
  classifyIntegrityProbe, classifyRelease, runReferralPreflight,
  FIRST_RELEASE_WITH_DEVICE_PLUGIN, MANUAL_STEPS, PROBE_TOKEN,
} from '../src/server/lib/referralPreflight';

/**
 * CAN THE REFERRAL GIFT ACTUALLY PAY? (admin 2026-09-19: "0 welcome credit ho rahe … referral code,
 * mail verification, mobile verification, github verification wala bhi on karwao")
 *
 * The flat welcome gift is retired (#3030, the admin's own ruling) and the four earned steps pay only
 * through a device check that FAILS CLOSED. Six things spread across Cloud Run, Google Cloud, Play
 * Console and a GitHub secret must all be right, and a wrong one is indistinguishable from a missing
 * one: ₹0, with nothing failing anywhere. This check asks Google the way a real claim would and names
 * the missing step.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

const FULL_ENV = {
  GOOGLE_PLAY_PACKAGE_NAME: 'com.navbharat.ai',
  GOOGLE_PLAY_SA_JSON: JSON.stringify({ client_email: 'sa@proj.iam.gserviceaccount.com', private_key: 'k' }),
  ANDROID_LATEST_VERSION_CODE: '120',
  REFERRAL_REWARDS: 'on',
} as NodeJS.ProcessEnv;

const answering = (status: number, body: unknown = null) =>
  (async () => ({ status, json: async () => body })) as unknown as typeof fetch;
const mintOk = async () => 'tok';

const byId = (r: { checks: Array<{ id: string }> }, id: string) => r.checks.find((c) => c.id === id)!;

describe('classifyIntegrityProbe — Google refusing our unreadable token is the GOOD answer', () => {
  it('400 is ok: the API is on, the credential accepted, the package known', () => {
    const c = classifyIntegrityProbe(400, { error: { message: 'Integrity token cannot be decoded.' } });
    expect(c.state).toBe('ok');
    expect(c.remedy).toBe('');
  });

  it('🔒 a 403 with SERVICE_DISABLED sends the admin to the API screen, not the IAM screen', () => {
    const c = classifyIntegrityProbe(403, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } });
    expect(c.state).toBe('failed');
    expect(c.remedy).toContain('Enable the Play Integrity API');
    expect(c.remedy).not.toContain('App integrity,');
  });

  it('a plain 403 is the account not being allowed to decode for this app', () => {
    const c = classifyIntegrityProbe(403, { error: { message: 'The caller does not have permission' } });
    expect(c.state).toBe('failed');
    expect(c.remedy).toContain('App integrity');
    expect(c.remedy).not.toContain('Enable the Play Integrity API');
  });

  it('404 names the package as the thing to check', () => {
    const c = classifyIntegrityProbe(404, null);
    expect(c.state).toBe('failed');
    expect(c.remedy).toContain('GOOGLE_PLAY_PACKAGE_NAME');
    expect(c.remedy).toContain('com.navbharat.ai');
  });

  it('401 is the credential', () => {
    expect(classifyIntegrityProbe(401, null).remedy).toContain('GOOGLE_PLAY_SA_JSON');
  });

  it('🔒 an unrecognised answer is UNKNOWN, never failed and never ok', () => {
    expect(classifyIntegrityProbe(500, null).state).toBe('unknown');
    expect(classifyIntegrityProbe(200, { tokenPayloadExternal: {} }).state).toBe('unknown');
  });
});

describe('classifyRelease — the one server-readable fact about the installed app', () => {
  it(`the plugin first shipped in build ${FIRST_RELEASE_WITH_DEVICE_PLUGIN} (run #117 built the #2953 merge)`, () => {
    expect(FIRST_RELEASE_WITH_DEVICE_PLUGIN).toBe(117);
  });

  it('release 91 — the first production release — cannot attest, and the remedy is a fresh bundle', () => {
    const c = classifyRelease('91');
    expect(c.state).toBe('failed');
    expect(c.detail).toContain('117');
    expect(c.remedy).toContain('PLAY_INTEGRITY_CLOUD_PROJECT');
  });

  it('a release at or past 117 is ok, and SAYS the build-time secret cannot be seen from here', () => {
    expect(classifyRelease('117').state).toBe('ok');
    const c = classifyRelease('120');
    expect(c.state).toBe('ok');
    expect(c.detail).toContain('cannot be seen from here');
  });

  it('🔒 unset is UNKNOWN, not ok and not failed — nobody set the number yet', () => {
    expect(classifyRelease(undefined).state).toBe('unknown');
    expect(classifyRelease('').state).toBe('unknown');
    expect(classifyRelease('latest').state).toBe('unknown');
  });
});

describe('runReferralPreflight — every missing step in one pass, in the switch-on order', () => {
  it('with nothing configured: package and account failed, remote checks SKIPPED (never ok), flag last', async () => {
    let asked = false;
    const r = await runReferralPreflight({ env: {} as NodeJS.ProcessEnv, mintToken: async () => { asked = true; return 'x'; } });
    expect(asked, 'no credential is minted before the account is known to parse').toBe(false);
    expect(byId(r, 'package').state).toBe('failed');
    expect(byId(r, 'serviceAccount').state).toBe('failed');
    expect(byId(r, 'credential').state).toBe('skipped');
    expect(byId(r, 'api').state).toBe('skipped');
    expect(byId(r, 'release').state).toBe('unknown');
    expect(byId(r, 'flag').state).toBe('failed');
    expect(r.verdict).toBe('blocked');
    // The first remedy is the EARLIEST step, so the admin never sets the flag first.
    expect(r.nextAction).toContain('GOOGLE_PLAY_PACKAGE_NAME');
    expect(r.checks[r.checks.length - 1].id).toBe('flag');
  });

  it('the flag check explains the ₹0 the admin saw — the flat gift is retired, so off means nothing at all', async () => {
    const r = await runReferralPreflight({ env: {} as NodeJS.ProcessEnv });
    const flag = byId(r, 'flag');
    expect(flag.detail).toContain('₹0');
    expect(flag.remedy).toContain('LAST');
  });

  it('a wrong package name is named against the real one', async () => {
    const r = await runReferralPreflight({ env: { ...FULL_ENV, GOOGLE_PLAY_PACKAGE_NAME: 'com.navbharatai.app' } });
    expect(byId(r, 'package').state).toBe('failed');
    expect(byId(r, 'package').detail).toContain('com.navbharat.ai');
    expect(byId(r, 'api').state).toBe('skipped');
  });

  it('an unparseable service-account JSON is a distinct failure from an unset one', async () => {
    const r = await runReferralPreflight({ env: { ...FULL_ENV, GOOGLE_PLAY_SA_JSON: '{"client_email":"x"}' } });
    expect(byId(r, 'serviceAccount').state).toBe('failed');
    expect(byId(r, 'serviceAccount').detail).toContain('does not parse');
  });

  it('everything right → every check ok, verdict READY', async () => {
    const r = await runReferralPreflight({ env: FULL_ENV, mintToken: mintOk, fetchImpl: answering(400) });
    expect(r.checks.map((c) => `${c.id}:${c.state}`)).toEqual([
      'package:ok', 'serviceAccount:ok', 'credential:ok', 'api:ok', 'release:ok', 'flag:ok',
    ]);
    expect(r.verdict).toBe('ready');
    expect(r.nextAction).toBe('');
    expect(r.manual).toEqual([...MANUAL_STEPS]);
  });

  it('the probe is the SAME call a real claim makes — decodeIntegrityToken for the configured package, with an unreadable token', async () => {
    let seen: { url: string; body: string } | null = null;
    const f = (async (url: string, init: { body: string }) => {
      seen = { url, body: init.body };
      return { status: 400, json: async () => null };
    }) as unknown as typeof fetch;
    await runReferralPreflight({ env: FULL_ENV, mintToken: mintOk, fetchImpl: f });
    expect(seen!.url).toBe('https://playintegrity.googleapis.com/v1/com.navbharat.ai:decodeIntegrityToken');
    expect(JSON.parse(seen!.body)).toEqual({ integrityToken: PROBE_TOKEN });
  });

  it('a refused key fails the credential and SKIPS the API check — never reports it ok', async () => {
    const r = await runReferralPreflight({ env: FULL_ENV, mintToken: async () => null, fetchImpl: answering(400) });
    expect(byId(r, 'credential').state).toBe('failed');
    expect(byId(r, 'api').state).toBe('skipped');
    expect(r.verdict).toBe('blocked');
  });

  it('a disabled API is reported with the API remedy, and the run still reaches the flag', async () => {
    const r = await runReferralPreflight({
      env: { ...FULL_ENV, REFERRAL_REWARDS: '' }, mintToken: mintOk,
      fetchImpl: answering(403, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } }),
    });
    expect(byId(r, 'api').remedy).toContain('Enable the Play Integrity API');
    expect(byId(r, 'flag').state).toBe('failed');
    expect(r.nextAction).toContain('Enable the Play Integrity API');
  });

  it('Google unreachable is UNKNOWN, and the verdict is incomplete rather than blocked', async () => {
    const f = (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch;
    const r = await runReferralPreflight({ env: FULL_ENV, mintToken: mintOk, fetchImpl: f });
    expect(byId(r, 'api').state).toBe('unknown');
    expect(r.verdict).toBe('incomplete');
  });

  it('🔒 only ALL-ok is ready: an old release with everything else right is blocked', async () => {
    const r = await runReferralPreflight({ env: { ...FULL_ENV, ANDROID_LATEST_VERSION_CODE: '91' }, mintToken: mintOk, fetchImpl: answering(400) });
    expect(r.verdict).toBe('blocked');
    expect(r.nextAction).toContain('fresh .aab');
  });

  it('the manual list names the two links no server can see, and the website rule', () => {
    expect(MANUAL_STEPS.some((m) => m.includes('PLAY_INTEGRITY_CLOUD_PROJECT'))).toBe(true);
    expect(MANUAL_STEPS.some((m) => m.includes('Data safety'))).toBe(true);
    expect(MANUAL_STEPS.some((m) => m.includes('₹0'))).toBe(true);
  });
});

describe('wiring — the check is reachable by the admin and by nobody else', () => {
  it('admin.ts registers GET /api/admin/referral/preflight behind verifyAdminToken and calls the runner', () => {
    const src = read('src/server/routes/admin.ts');
    const route = braceBlock(src, "app.get('/api/admin/referral/preflight'");
    expect(route).not.toBe('');
    expect(src).toContain("app.get('/api/admin/referral/preflight', verifyAdminToken,");
    expect(route).toContain('runReferralPreflight()');
  });

  it('the Referral cost card fetches it on a BUTTON, never on render', () => {
    const src = read('src/components/admin/ReferralCostCard.tsx');
    expect(src).toContain("fetch('/api/admin/referral/preflight'");
    const effect = braceBlock(src, 'useEffect(() =>');
    expect(effect).not.toContain('checkSetup');
    expect(src).toContain('Check referral setup');
  });

  it('the disabled banner tells the admin the flat gift is retired too — the ₹0 is explained where it is seen', () => {
    const src = read('src/components/admin/ReferralCostCard.tsx');
    expect(src).toContain('the flat welcome gift is');
    expect(src).toContain('retired too');
  });
});
