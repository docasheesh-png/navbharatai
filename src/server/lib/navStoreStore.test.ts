import { describe, it, expect } from 'vitest';
import { findRepublishTarget, type StoreApp } from './navStoreStore';

const app = (o: Partial<StoreApp>): StoreApp => ({
  id: 'id1',
  status: 'pending',
  uid: 'u1',
  developer: { name: 'Dev', email: 'dev@example.com' },
  appName: 'App',
  packageName: '',
  versionName: '1.0.0',
  shortDescription: 'short',
  description: 'a description long enough',
  category: 'Tools',
  sha256: 'abc',
  sizeBytes: 100,
  permissions: [],
  highRisk: [],
  inspectionWarnings: [],
  scanVerdict: 'clean',
  scanMalicious: 0,
  scanEnginesTotal: 60,
  scanFlaggedBy: [],
  storagePath: 'nav-store/apk/abc.apk',
  downloads: 0,
  submittedAt: 1000,
  ...o,
});

describe('findRepublishTarget — the "one app id per repo" rule for the APK store', () => {
  it('🔴 THE EXACT REGRESSION: a repo that already has a pending submission is matched, not duplicated', () => {
    const existing = app({ id: 'first', provenance: { source: 'navbharatai-build', repo: 'user/my-app', artifactId: 'a1' } });
    expect(findRepublishTarget([existing], 'user/my-app')).toBe(existing);
  });

  it('matches an APPROVED submission too — a re-publish must replace a LIVE app, not sit beside it', () => {
    const existing = app({ id: 'first', status: 'approved', provenance: { source: 'navbharatai-build', repo: 'user/my-app', artifactId: 'a1' } });
    expect(findRepublishTarget([existing], 'user/my-app')).toEqual(existing);
  });

  it('matches a REJECTED submission — a fixed re-submission replaces it rather than piling up a second row', () => {
    const existing = app({ id: 'first', status: 'rejected', provenance: { source: 'navbharatai-build', repo: 'user/my-app', artifactId: 'a1' } });
    expect(findRepublishTarget([existing], 'user/my-app')).toEqual(existing);
  });

  it('a REMOVED submission is never matched — a real takedown starts a clean record, never a silent revival', () => {
    const removed = app({ id: 'gone', status: 'removed', provenance: { source: 'navbharatai-build', repo: 'user/my-app', artifactId: 'a1' } });
    expect(findRepublishTarget([removed], 'user/my-app')).toBeNull();
  });

  it('a different repo is never matched — two different apps by the same developer stay two apps', () => {
    const other = app({ id: 'other', provenance: { source: 'navbharatai-build', repo: 'user/other-app', artifactId: 'a1' } });
    expect(findRepublishTarget([other], 'user/my-app')).toBeNull();
  });

  it('a submission with no provenance at all is never matched', () => {
    const noProvenance = app({ id: 'legacy' });
    expect(findRepublishTarget([noProvenance], 'user/my-app')).toBeNull();
  });

  it('an empty repo string matches nothing, rather than matching every provenance-less row', () => {
    const existing = app({ id: 'first', provenance: { source: 'navbharatai-build', repo: 'user/my-app', artifactId: 'a1' } });
    expect(findRepublishTarget([existing], '')).toBeNull();
  });

  it('the FIRST matching submission wins when somehow more than one exists (newest-first input)', () => {
    const newer = app({ id: 'newer', submittedAt: 2000, provenance: { source: 'navbharatai-build', repo: 'user/my-app', artifactId: 'a2' } });
    const older = app({ id: 'older', submittedAt: 1000, provenance: { source: 'navbharatai-build', repo: 'user/my-app', artifactId: 'a1' } });
    expect(findRepublishTarget([newer, older], 'user/my-app')).toEqual(newer);
  });

  it('an empty existing list returns null, not a crash', () => {
    expect(findRepublishTarget([], 'user/my-app')).toBeNull();
  });
});
