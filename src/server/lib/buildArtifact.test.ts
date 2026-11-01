import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  fetchBuildArtifact, pickBinaryName, isValidArtifactId, isValidRepoRef,
  type ArtifactFetcher,
} from './buildArtifact';

const zipOf = (files: Record<string, string>) => async () => ({
  files: Object.fromEntries(
    Object.entries(files).map(([n, c]) => [n, { async: async () => Buffer.from(c) }]),
  ),
});

const okFetcher = (): ArtifactFetcher => async () => ({ status: 200, data: new ArrayBuffer(8) });
const appBytes = 'PK\x03\x04APP_BYTES';

describe('pickBinaryName — hand back the app, not the archive', () => {
  it('prefers .aab (what a Play submission wants) over .apk', () => {
    expect(pickBinaryName(['app-release.apk', 'app-release.aab'])).toBe('app-release.aab');
  });

  it('falls through .aab → .apk → .ipa', () => {
    expect(pickBinaryName(['app.apk'])).toBe('app.apk');
    expect(pickBinaryName(['MyApp.ipa'])).toBe('MyApp.ipa');
  });

  it('ignores __MACOSX resource-fork junk that a macOS runner adds', () => {
    // These carry the matching extension and would otherwise be picked INSTEAD of the real file.
    expect(pickBinaryName(['__MACOSX/app-release.aab', 'app-release.aab'])).toBe('app-release.aab');
    expect(pickBinaryName(['__MACOSX/app-release.aab'])).toBeNull();
  });

  it('is case-insensitive about the extension', () => {
    expect(pickBinaryName(['App-Release.APK'])).toBe('App-Release.APK');
  });

  it('skips nested resource forks and names unsafe for download headers', () => {
    expect(pickBinaryName(['out/__MACOSX/fake.apk', 'out/._fake.apk', 'bad\r\n.apk', 'bad".apk', 'out/app.apk'])).toBe('out/app.apk');
  });

  it('returns null when nothing is installable, so the caller can fail honestly', () => {
    expect(pickBinaryName(['build.log', 'mapping.txt'])).toBeNull();
    expect(pickBinaryName([])).toBeNull();
  });
});

describe('input validation — these values land inside a GitHub API URL path', () => {
  it('accepts only numeric artifact ids', () => {
    expect(isValidArtifactId('12345')).toBe(true);
    expect(isValidArtifactId(12345)).toBe(true);
    expect(isValidArtifactId('12/../secrets')).toBe(false);
    expect(isValidArtifactId('')).toBe(false);
    expect(isValidArtifactId(null)).toBe(false);
  });

  it('rejects an owner/repo that could escape the path', () => {
    expect(isValidRepoRef('docasheesh-png', 'navbharatai')).toBe(true);
    expect(isValidRepoRef('a/../b', 'repo')).toBe(false);
    expect(isValidRepoRef('owner', 'repo?x=1')).toBe(false);
    expect(isValidRepoRef('', 'repo')).toBe(false);
  });
});

describe('fetchBuildArtifact', () => {
  const base = { owner: 'o', repo: 'r', artifactId: '99', token: 't' };

  it('returns the unwrapped binary and the plain file name', async () => {
    const r = await fetchBuildArtifact(base, okFetcher(), zipOf({ 'out/app-release.aab': appBytes }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bytes.toString()).toBe(appBytes);
      // The user asked for their app, not a nested path.
      expect(r.fileName).toBe('app-release.aab');
    }
  });

  it('calls the artifact ZIP endpoint with the caller-supplied repo', async () => {
    let seen = '';
    const spy: ArtifactFetcher = async (url) => { seen = url; return { status: 200, data: new ArrayBuffer(8) }; };
    await fetchBuildArtifact(base, spy, zipOf({ 'a.apk': 'x' }));
    expect(seen).toBe('https://api.github.com/repos/o/r/actions/artifacts/99/zip');
  });

  it('reports a 404 as EXPIRED with what to do — the most common real case', async () => {
    // GitHub deletes Actions artifacts after 14 days, so a user returning to an older build hits this
    // constantly. "Run the build again" is actionable; "404" is not.
    const r = await fetchBuildArtifact(base, async () => ({ status: 404, data: new ArrayBuffer(0) }), zipOf({}));
    expect(r).toMatchObject({ ok: false, failure: 'expired' });
    if (!r.ok) expect(r.message).toContain('Run the build again');
  });

  it('also recovers EXPIRED from a THROWN 404 — axios rejects instead of returning it', async () => {
    const throwing: ArtifactFetcher = async () => { throw Object.assign(new Error('x'), { response: { status: 404 } }); };
    expect(await fetchBuildArtifact(base, throwing, zipOf({}))).toMatchObject({ failure: 'expired' });
  });

  it('a zip with no app file fails honestly instead of handing back an archive', async () => {
    const r = await fetchBuildArtifact(base, okFetcher(), zipOf({ 'build.log': 'noise' }));
    expect(r).toMatchObject({ ok: false, failure: 'not-app' });
  });

  it('refuses unusable input before any network call is made', async () => {
    let called = false;
    const spy: ArtifactFetcher = async () => { called = true; return { status: 200, data: new ArrayBuffer(0) }; };
    expect(await fetchBuildArtifact({ ...base, artifactId: 'x' }, spy, zipOf({}))).toMatchObject({ failure: 'bad-request' });
    expect(await fetchBuildArtifact({ ...base, owner: '../x' }, spy, zipOf({}))).toMatchObject({ failure: 'bad-request' });
    expect(await fetchBuildArtifact({ ...base, token: '' }, spy, zipOf({}))).toMatchObject({ failure: 'bad-request' });
    expect(called).toBe(false);
  });

  it('a corrupt zip is a clean failure, never a throw into the route', async () => {
    const bad = async () => { throw new Error('not a zip'); };
    expect(await fetchBuildArtifact(base, okFetcher(), bad as never)).toMatchObject({ failure: 'fetch-failed' });
  });

  it('a non-2xx that is not 404 is a generic fetch failure', async () => {
    const r = await fetchBuildArtifact(base, async () => ({ status: 500, data: new ArrayBuffer(0) }), zipOf({}));
    expect(r).toMatchObject({ ok: false, failure: 'fetch-failed' });
  });

  it.each(['', '<html>upstream error</html>', 'not an APK'])('refuses an empty or invalid mobile binary (%j)', async (payload) => {
    expect(await fetchBuildArtifact(base, okFetcher(), zipOf({ 'app.apk': payload }))).toMatchObject({ ok: false, failure: 'not-app' });
  });

  it('recognizes GitHub Gone as an expired build', async () => {
    expect(await fetchBuildArtifact(base, async () => ({ status: 410, data: new ArrayBuffer(0) }))).toMatchObject({ ok: false, failure: 'expired' });
  });

  it('the real shared loader extracts complete app bytes without changing them', async () => {
    const inner = await new JSZip().file('AndroidManifest.xml', 'manifest').generateAsync({ type: 'nodebuffer' });
    const outer = await new JSZip().file('app.apk', inner).generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    const result = await fetchBuildArtifact(base, async () => ({ status: 200, data: outer.buffer.slice(outer.byteOffset, outer.byteOffset + outer.byteLength) as ArrayBuffer }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bytes.equals(inner)).toBe(true);
  });

  it('rejects silent byte corruption detected by the transport archive CRC', async () => {
    const payload = Buffer.from(appBytes);
    const outer = await new JSZip().file('app.apk', payload).generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    const offset = outer.indexOf(payload);
    expect(offset).toBeGreaterThan(-1);
    outer[offset + payload.length - 1] ^= 1;
    const result = await fetchBuildArtifact(base, async () => ({ status: 200, data: outer.buffer.slice(outer.byteOffset, outer.byteOffset + outer.byteLength) as ArrayBuffer }));
    expect(result).toMatchObject({ ok: false, failure: 'fetch-failed' });
  });
});
