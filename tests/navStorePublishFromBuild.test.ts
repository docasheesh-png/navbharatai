import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// "Publish to Nav App Store" from the build (admin 2026-08-04). The store carries only apps
// NavBharatAI built, and the user should never handle the file: /api/mobile-ship/download already
// pulls the finished artifact from GitHub Actions server-side, so the same bytes go straight in.
//
// These are SOURCE-CONTRACT assertions. The route needs Firestore, GitHub and a scanner, so it is not
// unit-instantiable; what MUST be guaranteed is structural — that this second entry point cannot skip
// any promise the store rests on. That is checkable from the source and is exactly the class of bug
// worth guarding: a new door into a safety-critical pipeline that quietly bypasses a check.
const SRC = readFileSync(fileURLToPath(new URL('../src/server/routes/navStore.ts', import.meta.url)), 'utf8');

describe('publish-from-build — a second door into the store, with none of the locks removed', () => {
  it('exists as its own route', () => {
    expect(SRC).toContain("app.post('/api/nav-store/publish-from-build'");
  });

  it('REUSES the one ingest pipeline instead of re-implementing it', () => {
    // The whole reason the pipeline was extracted. Two copies would mean two places to forget the
    // scan, and only one of them would be covered by the tests that exist.
    const calls = SRC.match(/await ingestApkSubmission\(/g) || [];
    expect(calls.length).toBe(2); // the manual upload and the build path
    // Exactly ONE definition — a second one would be the duplication this guards against.
    expect((SRC.match(/async function ingestApkSubmission\(/g) || []).length).toBe(1);
  });

  it('cannot publish without scanning configured — the rule the store rests on', () => {
    const route = SRC.slice(SRC.indexOf("app.post('/api/nav-store/publish-from-build'"));
    expect(route).toContain('isScanningConfigured()');
    expect(route).toContain('isStorageConfigured()');
  });

  it('requires a signed-in user and never takes the owner from the request body', () => {
    const route = SRC.slice(SRC.indexOf("app.post('/api/nav-store/publish-from-build'"));
    expect(route).toContain('verifyFirebaseIdentity(req)');
    expect(route).toContain('me.uid');
    // The uid handed to the pipeline is the VERIFIED one, not anything the caller sent.
    expect(route).not.toMatch(/uid:\s*body\./);
  });

  it('validates the store form exactly like the manual path', () => {
    const route = SRC.slice(SRC.indexOf("app.post('/api/nav-store/publish-from-build'"));
    expect(route).toContain('validateSubmission(');
  });

  it('reuses the SHARED artifact fetch rather than its own GitHub call', () => {
    const route = SRC.slice(SRC.indexOf("app.post('/api/nav-store/publish-from-build'"));
    expect(route).toContain('fetchBuildArtifact(');
    // No hand-rolled artifact URL here — that logic has exactly one home.
    expect(route).not.toContain('actions/artifacts/');
  });

  it('enforces the SAME size cap the upload path advertises', () => {
    const route = SRC.slice(SRC.indexOf("app.post('/api/nav-store/publish-from-build'"));
    expect(route).toContain('publishableApkLimitBytes(MAX_APK_BYTES, MAX_SCANNABLE_BYTES)');
  });

  it('maps an expired artifact to 404 with something the user can act on', () => {
    // GitHub deletes Actions artifacts after 14 days; "run the build again" is actionable, 502 is not.
    const route = SRC.slice(SRC.indexOf("app.post('/api/nav-store/publish-from-build'"));
    expect(route).toContain("got.failure === 'expired' ? 404");
  });

  it('records provenance — real evidence for the reviewer', () => {
    const route = SRC.slice(SRC.indexOf("app.post('/api/nav-store/publish-from-build'"));
    expect(route).toContain("source: 'navbharatai-build'");
    expect(route).toContain('artifactId');
  });

  it('states in the source that provenance is NOT proof, so nobody later treats it as one', () => {
    // The build runs in the USER's Actions with the USER's key. Someone reading this route later must
    // not conclude that a build-sourced APK has earned a shortcut past the scan or the review.
    const route = SRC.slice(SRC.indexOf('PUBLISH FROM THE BUILD'));
    expect(route).toContain('PROVENANCE, not proof');
    expect(route).toContain('mandatory');
  });
});

describe('the ingest pipeline keeps every store guarantee in ONE place', () => {
  it('inspects, scans, and lands as pending — none of it optional', () => {
    const fn = SRC.slice(SRC.indexOf('async function ingestApkSubmission('));
    expect(fn).toContain('await inspectApk(bytes)');
    expect(fn).toContain('await scanFile(');
    expect(fn).toContain("status: 'pending'");
  });

  it('refuses to publish when the scan gives no verdict', () => {
    const fn = SRC.slice(SRC.indexOf('async function ingestApkSubmission('));
    expect(fn).toContain("scan.verdict === 'unavailable'");
    expect(fn).toContain('httpStatus: 503');
  });

  it('keeps NO copy of something the engines call malware', () => {
    const fn = SRC.slice(SRC.indexOf('async function ingestApkSubmission('));
    const malicious = fn.slice(fn.indexOf("scan.verdict === 'malicious'"));
    const stored = malicious.indexOf('putApk(');
    const returned = malicious.indexOf('httpStatus: 422');
    expect(returned).toBeGreaterThan(-1);
    // The refusal returns BEFORE anything is stored.
    expect(stored === -1 || returned < stored).toBe(true);
  });
});

// The button that makes the route reachable. Source-contract again: the panel needs a live build and
// a GitHub token, so what is worth locking is the honesty of WHEN it is offered and WHAT it claims.
describe('the Publish button — offered only where it can actually work', () => {
  const PANEL = readFileSync(fileURLToPath(new URL('../src/components/ide/StoreBuildPanel.tsx', import.meta.url)), 'utf8');
  const FORM = readFileSync(fileURLToPath(new URL('../src/components/ide/PublishToNavStore.tsx', import.meta.url)), 'utf8');

  it('sits on the finished build, beside Download', () => {
    expect(PANEL).toContain('<PublishToNavStore');
    expect(PANEL).toContain('artifactId={a.id}');
  });

  it('is offered for the .apk ONLY — a .aab is a Play bundle no phone can install', () => {
    // Showing it for the .aab would promise a store install that cannot happen.
    expect(PANEL).toContain("artifacts.filter((a) => /apk/i.test(a.name))");
  });

  it('sends no file — the server takes the bytes from the build', () => {
    expect(FORM).toContain("'/api/nav-store/publish-from-build'");
    // No file input anywhere: the whole point is that the user never handles the APK.
    expect(FORM).not.toContain('type="file"');
    expect(FORM).not.toContain('FormData');
  });

  it('says PENDING REVIEW on success, never "published"', () => {
    // Nothing reaches the store without an admin approving it; claiming otherwise would break the one
    // rule the store rests on.
    expect(FORM).toContain('waiting for review');
    expect(FORM).not.toMatch(/is now live|published successfully/i);
  });

  it('shows the server\'s own refusal wording rather than a generic line', () => {
    expect(FORM).toContain('data?.error');
  });

  it('cannot be submitted with an empty form', () => {
    expect(FORM).toContain('disabled={busy || !ready}');
  });
});
