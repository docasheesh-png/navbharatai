import { describe, it, expect } from 'vitest';
import { mapRunSteps, type BuildReportStep } from '../src/server/lib/mobileBuildReport';
import { classifyBuildFailure } from '../src/server/lib/mobileBuildRepair';
import { generateShipKit } from '../src/server/lib/mobileShipKit';

/**
 * THE REPORT THAT PROMPTED THIS (admin 2026-09-17, real run 34935149896, user jilikabegum454@gmail.com).
 *
 * A Play-bundle build died at its FIRST step — the signing pre-flight — after 13 seconds. The report
 * showed the other nine steps as `done`, including "Compiling your Android app" and "Packaging your
 * download". Nothing compiled and nothing was packaged. It also carried `detail: null` while its own
 * log excerpt named all four missing secrets.
 *
 * The keystore failure ITSELF was already fixed 22 hours later (the pre-flight block and one-press key
 * creation, 2026-09-16). What these lock is the part that was NOT fixed: the report telling the truth
 * about what ran.
 */
const APK = '.github/workflows/android-apk.yml';
const AAB = '.github/workflows/android-aab.yml';

/** GitHub's real shape for a step that never ran once the job stops. */
const skipped = (name: string) => ({ name, status: 'completed', conclusion: 'skipped' });
const ok = (name: string) => ({ name, status: 'completed', conclusion: 'success' });
const failed = (name: string) => ({ name, status: 'completed', conclusion: 'failure' });

describe('mapRunSteps — a step that never ran is never reported as done', () => {
  it('THE BUG: the nine steps after the failure are NOT done', () => {
    // Exactly the observed run: pre-flight fails, everything after it is skipped by GitHub.
    const steps = mapRunSteps([
      failed('Pre-flight — require signing secrets'),
      skipped('Set up Node'),
      skipped("Install the app's libraries"),
      skipped('Build the web app'),
      skipped('Build the signed bundle (.aab)'),
      skipped('Upload the .aab'),
    ]);
    expect(steps[0].state).toBe('failed');
    // The whole point: not one of these may claim to have happened.
    expect(steps.slice(1).every((s) => s.state === 'skipped')).toBe(true);
    expect(steps.some((s) => s.state === 'done')).toBe(false);
  });

  it('REVERSION GUARD: `status: completed` alone must not mean done', () => {
    // This is the exact input the old ternary got wrong — it consulted `conclusion` only for
    // 'failure', then fell through to `status === 'completed' ? 'done'`. If anyone restores that
    // shape, this fails.
    expect(mapRunSteps([skipped('Upload the .aab')])[0].state).toBe('skipped');
  });

  it('a CANCELLED step is not done either — Stop must not leave a row of ticks', () => {
    const steps = mapRunSteps([
      ok("Install the app's libraries"),
      { name: 'Build the web app', status: 'completed', conclusion: 'cancelled' },
    ]);
    expect(steps[0].state).toBe('done');
    expect(steps[1].state).toBe('skipped');
  });

  it('a step that really ran is still done, and a failure is still failed', () => {
    // The fix must not make the ordinary green build look unfinished.
    const steps = mapRunSteps([ok("Install the app's libraries"), failed('Build the web app')]);
    expect(steps.map((s) => s.state)).toEqual(['done', 'failed']);
  });

  it('live states survive — a running build still reports running and pending', () => {
    const steps = mapRunSteps([
      ok("Install the app's libraries"),
      { name: 'Build the web app', status: 'in_progress', conclusion: null },
      { name: 'Upload the .aab', status: 'queued', conclusion: null },
    ]);
    expect(steps.map((s) => s.state)).toEqual(['done', 'running', 'pending']);
  });

  it('collapsed duplicates keep the STRONGEST signal, so a failure is never masked', () => {
    // Two raw steps share one friendly label ("Getting the build machine ready"). If one failed, the
    // group failed — a sibling that merely ran must not paint over it.
    const both = mapRunSteps([failed('Set up Node'), { name: 'Set up Java', status: 'in_progress', conclusion: null }]);
    expect(both).toHaveLength(1);
    expect(both[0].state).toBe('failed');
    // And a real run beats a skipped sibling: something in that group did happen.
    const mixed = mapRunSteps([ok('Set up Node'), skipped('Set up Java')]);
    expect(mixed).toHaveLength(1);
    expect(mixed[0].state).toBe('done');
  });

  it('the progress bar cannot inflate: skipped steps are not counted as done', () => {
    // The live route computes percent as done/total over these same steps, so this is the sibling
    // the one-line fix also closes.
    const steps = mapRunSteps([failed('Pre-flight — require signing secrets'), skipped('Upload the .aab')]);
    const done = steps.filter((s: BuildReportStep) => s.state === 'done').length;
    expect(done).toBe(0);
  });
});

describe('classifyBuildFailure — it must read the sentence the workflow really prints', () => {
  // VERBATIM from the real report's logExcerpt.
  const REAL = '##[error]Missing signing secret(s): ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD '
    + 'ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD — add them in Settings → Secrets and variables → Actions '
    + '(see SHIPPING.md).';

  it('THE BUG: the real sentence now yields the names, not a null detail', () => {
    const d = classifyBuildFailure(REAL, AAB);
    expect(d.code).toBe('MISSING_SIGNING_SECRET');
    expect(d.detail?.missing).toEqual([
      'ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD',
    ]);
    // Every name, not just the first — a user who fixes one of four and builds again fails on the next.
    for (const n of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEY_PASSWORD']) expect(d.summary).toContain(n);
  });

  it('the em-dash tail is not swallowed into the secret list', () => {
    const d = classifyBuildFailure(REAL, AAB);
    expect(d.detail?.missing).not.toContain('SHIPPING');
    expect((d.detail?.missing as string[]).every((n) => n.startsWith('ANDROID_'))).toBe(true);
  });

  it('a HALF-configured key names only what is actually absent', () => {
    const d = classifyBuildFailure('##[error]Missing signing secret(s): ANDROID_KEY_ALIAS — add them.', AAB);
    expect(d.detail?.missing).toEqual(['ANDROID_KEY_ALIAS']);
  });

  it('the older singular form still works — we do not control every user repository', () => {
    const d = classifyBuildFailure('##[error]Missing required secret: ANDROID_KEYSTORE_BASE64', APK);
    expect(d.code).toBe('MISSING_SIGNING_SECRET');
    expect(d.detail?.secret).toBe('ANDROID_KEYSTORE_BASE64');
  });

  it('it stays NOT auto-fixable — a signing key is not a file with a mistake in it', () => {
    // NavBharatAI can now CREATE the key, but only when the user asks. `autoFixable` means "repair
    // files and rebuild unattended", and minting an app's permanent identity is not that.
    expect(classifyBuildFailure(REAL, AAB).autoFixable).toBe(false);
  });

  /**
   * 🔒 THE DRIFT GUARD — the one that would have caught this years earlier.
   *
   * The old matcher looked for `Missing required secret:`. Grepping the repo showed that phrase in
   * exactly two places: the regex, and its own tests. No workflow has ever printed it. A matcher
   * written against an invented string and tested against that same invented string passes for ever
   * while reading nothing. So this asserts the classifier against the sentence `mobileShipKit`
   * REALLY generates — a reword of the workflow now fails CI.
   */
  it('understands the sentence the SHIP KIT actually generates', () => {
    const kit = generateShipKit({ appName: 'Test App', appId: 'com.test.app' });
    const aab = Object.entries(kit.files).find(([p]) => p.includes('android-aab'))?.[1] || '';
    expect(aab, 'the kit should generate an .aab workflow').toBeTruthy();

    const echo = aab.split('\n').find((l) => l.includes('::error::Missing'));
    expect(echo, 'the workflow should still announce missing secrets').toBeTruthy();

    // Rebuild the runtime line from the template and prove the classifier reads it.
    const printed = (echo as string).replace(/^\s*echo\s*"/, '').replace(/"\s*$/, '')
      .replace('$missing', ' ANDROID_KEYSTORE_BASE64 ANDROID_KEY_ALIAS');
    const d = classifyBuildFailure(`##[error]${printed}`, AAB);
    expect(d.code).toBe('MISSING_SIGNING_SECRET');
    expect(d.detail?.missing).toEqual(['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEY_ALIAS']);
  });
});

describe('the stale sentence is gone from the build panel', () => {
  const panel = () => require('fs').readFileSync(
    require('path').join(process.cwd(), 'src/components/ide/StoreBuildPanel.tsx'), 'utf8',
  ) as string;

  it('no longer tells the user NavBharatAI cannot add their key — it can, since 2026-09-16', () => {
    const code = panel().replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('NavBharatAI cannot add it for you');
  });

  it('a signing failure raises the one-press offer, so the message and the button agree', () => {
    const code = panel();
    expect(code).toContain('if (signingFailure) setSigningGap(missingSecrets)');
    expect(code).toContain('Create my signing key');
  });
});
