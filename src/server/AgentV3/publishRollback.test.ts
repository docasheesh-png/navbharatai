import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  pickRollbackTarget,
  rollbackAvailability,
  rollbackSummary,
  type HostingRelease,
} from './publishRollback';

const rel = (version: string, time: string, status = 'FINALIZED'): HostingRelease => ({
  name: `sites/s/channels/c/releases/r-${time}`,
  version: { name: `sites/s/versions/${version}`, status },
  releaseTime: time,
});

describe('pickRollbackTarget', () => {
  it('goes back to the version before the one that is live', () => {
    const t = pickRollbackTarget([rel('v3', '2026-09-03T10:00:00Z'), rel('v2', '2026-09-02T10:00:00Z')]);
    expect(t?.versionName).toBe('sites/s/versions/v2');
    expect(t?.releaseTime).toBe('2026-09-02T10:00:00Z');
  });

  it('sorts by release time rather than trusting the order the API returned', () => {
    // The Hosting API does not contractually promise newest-first, and building a rollback on an
    // assumed order would silently pick the wrong version.
    const t = pickRollbackTarget([rel('v2', '2026-09-02T10:00:00Z'), rel('v3', '2026-09-03T10:00:00Z')]);
    expect(t?.versionName).toBe('sites/s/versions/v2');
  });

  it('🔒 skips releases pointing at the SAME version as the live one', () => {
    // Re-publishing identical files, or a previous rollback, leaves several releases on one version.
    // Taking "index 1" would roll back to what is already live and appear to do nothing at all.
    const t = pickRollbackTarget([
      rel('v3', '2026-09-03T12:00:00Z'),
      rel('v3', '2026-09-03T10:00:00Z'),
      rel('v1', '2026-09-01T10:00:00Z'),
    ]);
    expect(t?.versionName).toBe('sites/s/versions/v1');
  });

  it('🔒 keeps going back after a previous rollback, instead of bouncing between two versions', () => {
    // A rollback appends a release pointing at an OLDER version. Index-based logic would then flip
    // between the same pair forever; identity-based logic walks further back, which is what the user
    // pressing "undo" a second time means.
    const releases = [
      rel('v1', '2026-09-04T10:00:00Z'),   // the rollback we just did — v1 is live again
      rel('v3', '2026-09-03T10:00:00Z'),
      rel('v2', '2026-09-02T10:00:00Z'),
      rel('v1', '2026-09-01T10:00:00Z'),
    ];
    expect(pickRollbackTarget(releases)?.versionName).toBe('sites/s/versions/v3');
  });

  it('🔒 skips a version Firebase has expired — it cannot be re-released', () => {
    // A release can outlive the version it points at. Choosing one would turn the rollback into an
    // API error at the exact moment the user is trying to rescue a broken live app.
    const t = pickRollbackTarget([
      rel('v3', '2026-09-03T10:00:00Z'),
      rel('v2', '2026-09-02T10:00:00Z', 'DELETED'),
      rel('v1', '2026-09-01T10:00:00Z'),
    ]);
    expect(t?.versionName).toBe('sites/s/versions/v1');
  });

  it('returns null when there is nothing earlier to go to', () => {
    expect(pickRollbackTarget([])).toBeNull();
    expect(pickRollbackTarget([rel('v1', '2026-09-01T10:00:00Z')])).toBeNull();
    // Two releases, one version — still nothing genuinely different to return to.
    expect(pickRollbackTarget([rel('v1', '2026-09-02T10:00:00Z'), rel('v1', '2026-09-01T10:00:00Z')])).toBeNull();
  });

  it('ignores malformed entries rather than throwing', () => {
    const junk = [{}, { version: {} }, { version: { name: '' } }] as HostingRelease[];
    expect(pickRollbackTarget(junk)).toBeNull();
    expect(pickRollbackTarget([...junk, rel('v2', '2026-09-02T10:00:00Z'), rel('v1', '2026-09-01T10:00:00Z')])?.versionName)
      .toBe('sites/s/versions/v1');
  });

  it('survives a null/undefined list', () => {
    expect(pickRollbackTarget(null as never)).toBeNull();
    expect(pickRollbackTarget(undefined as never)).toBeNull();
  });
});

describe('rollbackAvailability — every refusal explains itself', () => {
  const two = [rel('v2', '2026-09-02T10:00:00Z'), rel('v1', '2026-09-01T10:00:00Z')];

  it('is available with a real target when an earlier version exists', () => {
    const a = rollbackAvailability({ releases: two, bucketOnly: false });
    expect(a.available).toBe(true);
    if (a.available) expect(a.target.versionName).toBe('sites/s/versions/v1');
  });

  it('🔒 refuses honestly for a bucket-only app, which keeps no earlier version', () => {
    // The channel-ceiling fix serves straight from storage and each publish overwrites the last.
    // Offering a rollback button there would be a control that cannot do what it says.
    const a = rollbackAvailability({ releases: two, bucketOnly: true });
    expect(a.available).toBe(false);
    if (!a.available) {
      expect(a.reason).toBe('bucket-only');
      expect(a.message).toContain('History');   // points at the route that DOES work
    }
  });

  it('🔒 an UNREADABLE history is "unknown", never "nothing to roll back to"', () => {
    // Same rule the channel inventory already holds: a failed read is not evidence of absence.
    const a = rollbackAvailability({ releases: null, bucketOnly: false });
    expect(a.available).toBe(false);
    if (!a.available) expect(a.reason).toBe('unreadable');
  });

  it('separates "never published" from "only one version"', () => {
    const never = rollbackAvailability({ releases: [], bucketOnly: false });
    const one = rollbackAvailability({ releases: [rel('v1', '2026-09-01T10:00:00Z')], bucketOnly: false });
    expect(never.available).toBe(false);
    expect(one.available).toBe(false);
    if (!never.available) expect(never.reason).toBe('never-published');
    if (!one.available) expect(one.reason).toBe('only-one-version');
  });

  it('every refusal carries a message a person can act on', () => {
    for (const opts of [
      { releases: two, bucketOnly: true },
      { releases: null, bucketOnly: false },
      { releases: [] as HostingRelease[], bucketOnly: false },
      { releases: [rel('v1', '2026-09-01T10:00:00Z')], bucketOnly: false },
    ]) {
      const a = rollbackAvailability(opts);
      expect(a.available).toBe(false);
      if (!a.available) expect(a.message.length).toBeGreaterThan(30);
    }
  });

  it('🔒 names no vendor — the white-label law applies to this surface too', () => {
    const forbidden = /firebase|google|hosting api|cloud storage|gcs|bucket-only/i;
    for (const opts of [
      { releases: two, bucketOnly: true },
      { releases: null, bucketOnly: false },
      { releases: [] as HostingRelease[], bucketOnly: false },
    ]) {
      const a = rollbackAvailability(opts);
      if (!a.available) expect(a.message).not.toMatch(forbidden);
    }
  });
});

describe('rollbackSummary', () => {
  it('names when the restored version was published', () => {
    const s = rollbackSummary({ versionName: 'v', releaseTime: '2026-09-02T10:00:00Z' });
    expect(s).toContain('2026');
    expect(s).toContain('back to');
  });

  it('degrades honestly when the time is missing or unparseable', () => {
    expect(rollbackSummary({ versionName: 'v', releaseTime: null }))
      .toBe('Your live app is back to the previous published version.');
    expect(rollbackSummary({ versionName: 'v', releaseTime: 'not-a-date' }))
      .toBe('Your live app is back to the previous published version.');
  });
});

describe('the routes stay safe (locked against the real source)', () => {
  const routes = readFileSync(resolve(__dirname, '../routes/agentv3.ts'), 'utf8');
  const block = (name: string) => {
    const start = routes.indexOf(`app.post('/api/agentv3/${name}'`);
    expect(start).toBeGreaterThan(-1);
    return routes.slice(start, start + 3500);
  };

  it('🔒 both routes verify workspace OWNERSHIP, like publish and unpublish', () => {
    // Rolling back changes what the public sees, and the status route discloses an app's publish
    // history. Neither may act on a workspace id the caller merely claims.
    for (const r of ['rollback-status', 'rollback']) {
      expect(block(r)).toContain('assertVerifiedWorkspaceOwner(req, workspaceId)');
    }
  });

  it('🔒 the rollback target is re-derived on the SERVER, never taken from the request', () => {
    // A version name accepted from the browser is an instruction to serve arbitrary content at the
    // user's published URL. The check that it is genuinely this app's previous version has to happen
    // where it cannot be edited.
    const b = block('rollback');
    expect(b).toContain('rollbackAvailability({ releases, bucketOnly })');
    expect(b).toContain('availability.target');
    expect(b).not.toMatch(/req\.body\?*\.versionName/);
  });

  it('🔒 "nothing to roll back to" is 409, not 500 — nothing failed', () => {
    expect(block('rollback')).toContain("status(409)");
  });

  it('a failed rollback says the app is UNCHANGED rather than leaving it ambiguous', () => {
    // The user is pressing undo on an app they think is broken. "It did not work" without "and
    // nothing was removed" invites them to panic further.
    expect(block('rollback')).toContain('unchanged');
  });

  it('a bucket-only app is never asked for a channel history it cannot have', () => {
    for (const r of ['rollback-status', 'rollback']) {
      expect(block(r)).toContain('bucketOnly ? [] :');
    }
  });
});
