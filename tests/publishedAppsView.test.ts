import { describe, it, expect } from 'vitest';
import {
  isOpenableUrl, appLabel, statusWords, toPublishedAppRow, publishedAppRows, liveAppCount,
  type PublishedAppRow,
} from '../src/lib/publishedAppsView';

/**
 * THE PUBLISHED-APPS LIST — one shape for the owner's My Profile and the admin's account sheet.
 *
 * The two endpoints that feed it disagree: the owner's pre-filters to live apps and drops `status`,
 * the admin's returns every record with its status. These pin the normalisation, and in particular
 * the two rules a privileged screen depends on — that a stored URL is validated before it becomes
 * something an admin is invited to click, and that a count means what its label says.
 */

describe('isOpenableUrl — what we are willing to send somebody to', () => {
  it('http and https, and nothing else', () => {
    expect(isOpenableUrl('https://a-123.mitrify.in')).toBe(true);
    expect(isOpenableUrl('http://example.com/app')).toBe(true);
  });

  it('🔒 refuses a scheme that would execute rather than navigate', () => {
    // The admin sheet renders whatever is stored against a user's account. Nothing writes these
    // today — which is exactly the assumption a validator exists for.
    expect(isOpenableUrl('javascript:alert(1)')).toBe(false);
    expect(isOpenableUrl('data:text/html,<script>x</script>')).toBe(false);
    expect(isOpenableUrl('file:///etc/passwd')).toBe(false);
    expect(isOpenableUrl('vbscript:msgbox')).toBe(false);
  });

  it('refuses anything that is not a URL at all', () => {
    expect(isOpenableUrl('')).toBe(false);
    expect(isOpenableUrl('not a url')).toBe(false);
    expect(isOpenableUrl('/relative/path')).toBe(false);
    expect(isOpenableUrl(null)).toBe(false);
    expect(isOpenableUrl(undefined)).toBe(false);
    expect(isOpenableUrl(42)).toBe(false);
  });
});

describe('appLabel — the address as a person reads it', () => {
  it('drops the scheme and any trailing slash', () => {
    expect(appLabel('https://shop.mitrify.in/')).toBe('shop.mitrify.in');
    expect(appLabel('http://a.b/c')).toBe('a.b/c');
  });

  it('never returns an empty string', () => {
    expect(appLabel('')).toBe('Unknown address');
    expect(appLabel(null)).toBe('Unknown address');
    expect(appLabel('https://')).toBe('https://');
  });
});

describe('statusWords — an admin must be able to tell WHO did it', () => {
  it('a takedown and an owner’s own unpublish read differently', () => {
    // DeploymentStore keeps these apart because one is a punishment and the other is a choice.
    // "Removed" for both would leave an admin unable to tell whether we did it.
    expect(statusWords('taken_down')).toBe('Taken down');
    expect(statusWords('unpublished')).toBe('Unpublished by its owner');
  });

  it('and a plan lapse is neither', () => {
    expect(statusWords('plan_paused')).toBe('Offline — plan ended');
    expect(statusWords('active')).toBe('Live');
    expect(statusWords('held')).toBe('Held for review');
  });
});

describe('toPublishedAppRow', () => {
  const raw = { workspaceId: 'w1', url: 'https://a.mitrify.in', updatedAt: 1000, sizeMb: 2.25 };

  it('normalises a live row and offers to open it', () => {
    expect(toPublishedAppRow(raw)).toEqual({
      workspaceId: 'w1', url: 'https://a.mitrify.in', label: 'a.mitrify.in',
      updatedAt: 1000, sizeMb: 2.25, status: 'active', orphaned: false, openable: true,
    });
  });

  it('a record with no status is ACTIVE — the store’s own default', () => {
    // Treating a legacy row as unknown would hide a genuinely live app from its owner.
    expect(toPublishedAppRow({ ...raw, status: undefined })!.status).toBe('active');
    expect(toPublishedAppRow({ ...raw, status: '' })!.status).toBe('active');
  });

  it('🔒 an UNRECOGNISED status is held, never silently treated as live', () => {
    const row = toPublishedAppRow({ ...raw, status: 'something_new' })!;
    expect(row.status).toBe('held');
    expect(row.openable).toBe(false);
  });

  it('🔒 an app that is not live is never openable — a button to a dead page is a fake button', () => {
    for (const status of ['taken_down', 'unpublished', 'plan_paused', 'held'] as const) {
      expect(toPublishedAppRow({ ...raw, status })!.openable, status).toBe(false);
    }
  });

  it('a live app with an unusable URL is not openable either', () => {
    expect(toPublishedAppRow({ ...raw, url: 'javascript:alert(1)' })!.openable).toBe(false);
    expect(toPublishedAppRow({ ...raw, url: '' })!.openable).toBe(false);
  });

  it('a missing size is UNKNOWN, never 0.0 MB', () => {
    // "0.0 MB" would be a measurement nobody took; legacy records genuinely have none.
    expect(toPublishedAppRow({ ...raw, sizeMb: undefined })!.sizeMb).toBeNull();
    expect(toPublishedAppRow({ ...raw, sizeMb: Number.NaN })!.sizeMb).toBeNull();
    expect(toPublishedAppRow({ ...raw, updatedAt: 'yesterday' })!.updatedAt).toBeNull();
  });

  it('carries the orphaned flag, so the screen can say why an app cannot be reopened', () => {
    expect(toPublishedAppRow({ ...raw, orphaned: true })!.orphaned).toBe(true);
    expect(toPublishedAppRow({ ...raw, orphaned: 'yes' })!.orphaned).toBe(false);
  });

  it('a row with neither an id nor an address is not a row', () => {
    expect(toPublishedAppRow({})).toBeNull();
    expect(toPublishedAppRow(null)).toBeNull();
    expect(toPublishedAppRow(undefined)).toBeNull();
  });

  it('falls back to the url as a key when the id is missing — the row can still be shown', () => {
    expect(toPublishedAppRow({ url: 'https://a.b' })!.workspaceId).toBe('https://a.b');
  });
});

describe('publishedAppRows', () => {
  it('newest first, with undated rows last rather than dropped', () => {
    const out = publishedAppRows([
      { workspaceId: 'a', url: 'https://a.b', updatedAt: 100 },
      { workspaceId: 'undated', url: 'https://c.d' },
      { workspaceId: 'b', url: 'https://e.f', updatedAt: 900 },
    ]);
    expect(out.map((r) => r.workspaceId)).toEqual(['b', 'a', 'undated']);
  });

  it('anything that is not a list is an empty list, never a crash', () => {
    expect(publishedAppRows(null)).toEqual([]);
    expect(publishedAppRows(undefined)).toEqual([]);
    expect(publishedAppRows('nope')).toEqual([]);
    expect(publishedAppRows({ rows: [] })).toEqual([]);
  });

  it('skips unusable entries without losing the usable ones', () => {
    expect(publishedAppRows([null, {}, { workspaceId: 'ok', url: 'https://a.b' }])).toHaveLength(1);
  });
});

describe('🔴 liveAppCount — the number the admin sheet was getting wrong', () => {
  const row = (status: string): PublishedAppRow =>
    toPublishedAppRow({ workspaceId: status, url: 'https://a.b', status })!;

  it('counts only what is actually live', () => {
    // The sheet printed every deployment RECORD under the words "published apps live", so an
    // account with four apps of which three were taken down read as four live apps — on the exact
    // panel used to decide whether to act on that account.
    expect(liveAppCount([row('active'), row('taken_down'), row('unpublished'), row('plan_paused')])).toBe(1);
    expect(liveAppCount([])).toBe(0);
  });

  it('agrees with the badge each row shows — one rule, both readers', () => {
    const rows = [row('active'), row('active'), row('held')];
    expect(liveAppCount(rows)).toBe(rows.filter((r) => statusWords(r.status) === 'Live').length);
  });
});
