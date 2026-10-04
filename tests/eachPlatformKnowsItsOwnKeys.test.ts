/**
 * EACH PLATFORM KNOWS ITS OWN SIGNING KEYS (report SHANKU-AI/instamony, run 36792748246, 2026-10-01).
 *
 * An iPhone build with none of its four Apple keys died in 20 seconds at the workflow's own pre-flight,
 * whose log said exactly that: `Missing Apple signing secret(s): IOS_ASC_KEY_ID IOS_ASC_ISSUER_ID
 * IOS_ASC_KEY_BASE64 IOS_TEAM_ID`. The report then told the user three false things: the failure was
 * STALE_WORKFLOW, the build "stopped while installing your app's libraries", and NavBharatAI could fix
 * it itself.
 *
 * THE CLASS: every reader of "is the signing key there?" knew only the ANDROID list and the ANDROID
 * sentence. Four readers, all fixed here:
 *  1. the failure classifier matched `Missing signing secret(s)` and not `Missing Apple signing secret(s)`;
 *  2. the dispatch guard checked Android builds only, so an iPhone build was sent to GitHub unchecked;
 *  3. the pre-build status route answered only about Android's names;
 *  4. the panel's one-press "Create my signing key" (an ANDROID keystore) would have been offered for
 *     an iPhone build the moment (1) was fixed alone.
 *
 * The census below takes the error sentence of EVERY workflow the ship kit really generates and feeds
 * it to the classifier, so a third wording cannot slip past again.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyBuildFailure } from '../src/server/lib/mobileBuildRepair';
import { generateShipKit } from '../src/server/lib/mobileShipKit';
import {
  ANDROID_SIGNING_SECRETS, IOS_SIGNING_SECRETS, signingSecretsFor, signingPlatformOf,
  missingSigningSecrets, signingVerdict, appleSigningNotReadyMessage, signingNotReadyMessageFor,
  isSigningSecretFailure,
} from '../src/lib/signingReadiness';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** The real log lines from the report, verbatim (ANSI colour codes included). */
const REAL_LOG = [
  'Run missing=""',
  '\u001b[36;1mmissing=""\u001b[0m',
  '\u001b[36;1m[ -z "$IOS_ASC_KEY_ID" ] && missing="$missing IOS_ASC_KEY_ID"\u001b[0m',
  '\u001b[36;1m[ -z "$IOS_ASC_ISSUER_ID" ] && missing="$missing IOS_ASC_ISSUER_ID"\u001b[0m',
  '\u001b[36;1m[ -z "$IOS_ASC_KEY_BASE64" ] && missing="$missing IOS_ASC_KEY_BASE64"\u001b[0m',
  '\u001b[36;1m[ -z "$IOS_TEAM_ID" ] && missing="$missing IOS_TEAM_ID"\u001b[0m',
  '\u001b[36;1mif [ -n "$missing" ]; then\u001b[0m',
  '\u001b[36;1m  echo "::error::Missing Apple signing secret(s):$missing — see SHIPPING.md."\u001b[0m',
  '\u001b[36;1m  exit 1\u001b[0m',
  '\u001b[36;1mfi\u001b[0m',
  'shell: /bin/bash -e {0}',
  'env:',
  '  IOS_ASC_KEY_ID: ',
  '  IOS_ASC_ISSUER_ID: ',
  '  IOS_ASC_KEY_BASE64: ',
  '  IOS_TEAM_ID: ',
  '##[error]Missing Apple signing secret(s): IOS_ASC_KEY_ID IOS_ASC_ISSUER_ID IOS_ASC_KEY_BASE64 IOS_TEAM_ID — see SHIPPING.md.',
  '##[error]Process completed with exit code 1.',
  // What the workflow's own "Explain what stopped the build" step prints afterwards: node_modules was
  // never installed, so it says `install` — which is why the stage fallback must never be reached here.
  'NBAI_FAILED_STAGE=install',
].join('\n');

describe('the real report', () => {
  it('is a missing APPLE key, not a stale workflow, and not something NavBharatAI can fix', () => {
    const d = classifyBuildFailure(REAL_LOG, '.github/workflows/ios-ipa.yml');
    expect(d.code).toBe('MISSING_SIGNING_SECRET');
    expect(d.autoFixable).toBe(false);
    expect(d.detail?.missing).toEqual([...IOS_SIGNING_SECRETS]);
    expect(d.detail?.platform).toBe('ios');
    expect(d.summary).toMatch(/Apple signing keys/);
    expect(d.summary).not.toMatch(/Play Store|install/i);
    // …and so the failure report now carries the gate's own account of whether it could look.
    expect(isSigningSecretFailure(d.detail)).toBe(true);
  });
});

describe('🔒 census: every generated workflow\'s missing-key sentence is understood', () => {
  const kit = generateShipKit({ appName: 'Census', ios: true });
  const workflows = Object.entries(kit.files).filter(([p]) => p.startsWith('.github/workflows/'));

  /** Each `echo "::error::Missing …secret(s):$missing …"` line, with the names its own step checks. */
  const sentences = workflows.flatMap(([path, text]) => {
    const out: Array<{ path: string; log: string; names: string[] }> = [];
    const steps = text.split(/\n\s*- name: /);
    for (const step of steps) {
      const echo = step.match(/echo "(::error::Missing [^"]*secret\(s\):\$missing[^"]*)"/);
      if (!echo) continue;
      const names = [...step.matchAll(/missing="\$missing ([A-Z0-9_]+)"/g)].map((m) => m[1]);
      out.push({ path, log: `##[error]${echo[1].replace('::error::', '').replace('$missing', ` ${names.join(' ')}`)}`, names });
    }
    return out;
  });

  it('finds the sentence in both signed workflows (so the census is not empty)', () => {
    expect(sentences.map((s) => s.path).sort()).toEqual([
      '.github/workflows/android-aab.yml',
      '.github/workflows/ios-ipa.yml',
    ]);
  });

  it('classifies each one as a missing key, naming every secret and the right platform', () => {
    for (const s of sentences) {
      const d = classifyBuildFailure(s.log + '\nNBAI_FAILED_STAGE=install', s.path);
      expect(d.code, s.path).toBe('MISSING_SIGNING_SECRET');
      expect(d.detail?.missing, s.path).toEqual(s.names);
      const platform = s.path.includes('ios') ? 'ios' : 'android';
      expect(d.detail?.platform, s.path).toBe(platform);
      expect(d.summary, s.path).toMatch(platform === 'ios' ? /Apple/ : /Play Store/);
    }
  });

  it('each platform\'s list is exactly what its workflow checks', () => {
    const byPath = Object.fromEntries(sentences.map((s) => [s.path, s.names]));
    expect(byPath['.github/workflows/ios-ipa.yml']).toEqual([...signingSecretsFor('ios')]);
    expect(byPath['.github/workflows/android-aab.yml']).toEqual([...signingSecretsFor('android')]);
    expect(kit.requiredSecrets.ios.map((r) => r.name)).toEqual([...IOS_SIGNING_SECRETS]);
    expect(kit.requiredSecrets.android.map((r) => r.name)).toEqual([...ANDROID_SIGNING_SECRETS]);
  });
});

describe('the readiness helpers answer per platform', () => {
  it('reads the platform from the names', () => {
    expect(signingPlatformOf([...IOS_SIGNING_SECRETS])).toBe('ios');
    expect(signingPlatformOf(['ios_team_id'])).toBe('ios');
    expect(signingPlatformOf([...ANDROID_SIGNING_SECRETS])).toBe('android');
    expect(signingPlatformOf([])).toBe('android');
    expect(signingPlatformOf(null)).toBe('android');
  });

  it('checks the Apple list when asked, and the Android list by default (old callers unchanged)', () => {
    expect(signingVerdict([...ANDROID_SIGNING_SECRETS])).toBe('ready');
    expect(signingVerdict([...ANDROID_SIGNING_SECRETS], IOS_SIGNING_SECRETS)).toBe('missing');
    expect(signingVerdict([...IOS_SIGNING_SECRETS], IOS_SIGNING_SECRETS)).toBe('ready');
    expect(signingVerdict(null, IOS_SIGNING_SECRETS)).toBe('unknown');
    expect(missingSigningSecrets(['IOS_TEAM_ID'], IOS_SIGNING_SECRETS)).toEqual(['IOS_ASC_KEY_ID', 'IOS_ASC_ISSUER_ID', 'IOS_ASC_KEY_BASE64']);
  });

  it('the Apple sentence never offers to create the key, and says where it comes from', () => {
    const all = appleSigningNotReadyMessage([...IOS_SIGNING_SECRETS]);
    expect(all).toMatch(/cannot create them for you/);
    expect(all).toMatch(/App Store Connect/);
    expect(all).not.toMatch(/Create my signing key|\.apk/);
    const none = appleSigningNotReadyMessage([]);
    expect(none).toBe(all); // a log that named nothing is treated as "all of them", never "partly"
    const one = appleSigningNotReadyMessage(['IOS_TEAM_ID']);
    expect(one).toMatch(/IOS_TEAM_ID is still missing/);
    expect(signingNotReadyMessageFor('android', ['ANDROID_KEY_ALIAS'])).toMatch(/ANDROID_KEY_ALIAS/);
  });
});

describe('the wiring', () => {
  const ship = read('src/server/routes/mobileShip.ts');
  const panel = read('src/components/ide/StoreBuildPanel.tsx');

  it('the server refuses an iPhone build with missing Apple keys BEFORE it is dispatched', () => {
    const guard = ship.slice(ship.indexOf('if (workflow === SHIP_WORKFLOWS.iosIpa) {'));
    expect(guard).toContain('missingSigningSecrets(appleNames, IOS_SIGNING_SECRETS)');
    expect(guard).toContain('canCreateKey: false');
    expect(ship.indexOf('if (workflow === SHIP_WORKFLOWS.iosIpa) {'))
      .toBeLessThan(ship.indexOf('/actions/workflows/${workflow}/dispatches'));
  });

  it('the status route answers about the platform it is asked about', () => {
    expect(ship).toContain("signingSecretsFor(platform === 'ios' ? 'ios' : 'android')");
    expect(ship).toContain('signingVerdict(names, required)');
  });

  it('the panel asks about Apple keys for an iPhone build and never raises the Android key button there', () => {
    expect(panel).toContain("platform === 'ios' ? '&platform=ios' : ''");
    expect(panel).toContain("if (platform === 'android') setSigningGap(missing);");
    expect(panel).toContain('if (signingFailure && !appleKeys) setSigningGap(missingSecrets);');
  });
});

describe('the workflow\'s own explanation no longer says "installing" about a pre-flight', () => {
  const kit = generateShipKit({ appName: 'Census', ios: true });
  const diagnostic = (wf: string): string => {
    const step = wf.split(/\n\s*- name: /).find((s) => s.startsWith('Explain what stopped the build'));
    if (!step) throw new Error('no diagnostic step');
    return step.slice(step.indexOf('run: |') + 'run: |'.length).split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
  };

  it('every pre-flight step carries the id the diagnostic step reads', () => {
    for (const [path, wf] of Object.entries(kit.files).filter(([p]) => p.startsWith('.github/workflows/'))) {
      for (const step of wf.split(/\n\s*- name: /)) {
        if (/^Pre-flight/.test(step)) expect(step, path).toMatch(/\n\s+id: nbai-preflight-secrets\n/);
        if (/^Select the newest Xcode/.test(step)) expect(step, path).toMatch(/\n\s+id: nbai-preflight-xcode\n/);
      }
    }
  });

  it('a failed pre-flight is reported as preflight, and everything else exactly as before', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const script = diagnostic(kit.files['.github/workflows/ios-ipa.yml']);
    const run = (secrets: string, xcode: string): string => {
      const dir = mkdtempSync(join(tmpdir(), 'nbai-diag-'));
      const body = script
        .replace('${{ steps.nbai-preflight-secrets.outcome }}', secrets)
        .replace('${{ steps.nbai-preflight-xcode.outcome }}', xcode);
      return execFileSync('bash', ['-e', '-c', body], { cwd: dir, env: { ...process.env, GITHUB_STEP_SUMMARY: join(dir, 's.md') } }).toString();
    };
    expect(run('failure', 'success')).toContain('NBAI_FAILED_STAGE=preflight');
    expect(run('skipped', 'failure')).toContain('NBAI_FAILED_STAGE=preflight');
    // A workflow without the step (GitHub expands the missing id to empty) behaves as it always did.
    expect(run('', '')).toContain('NBAI_FAILED_STAGE=install');
    expect(run('success', 'success')).toContain('NBAI_FAILED_STAGE=install');
  });
});
