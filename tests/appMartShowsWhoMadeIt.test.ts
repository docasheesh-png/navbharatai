import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  publicCreatorId, creatorDisplayName, resolveCreators, _resetCreatorCache, ANONYMOUS_CREATOR_NAME,
} from '../src/server/lib/storeCreator';
import { toPublicWebApp, type WebStoreApp } from '../src/server/lib/navStoreWeb';
import { creatorLine, formatShortDate } from '../src/components/ide/storeCreatorLine';

/**
 * Admin 2026-09-27, with a screenshot of App Mart's Browse grid: every "Play instantly" card must say
 * who made the app — name, an id, and the publish date — in the empty corner beside the icon.
 * The id is a PUBLIC creator code, never the account uid (see storeCreator.ts).
 */

const ROOT = join(__dirname, '..');
const UID = 'Xy7kQ2pL9mN4vB8cR1tZ5wH3jD6f';

const APP: WebStoreApp = {
  id: 'app1', status: 'listed', uid: UID, name: 'car racing game', description: '', visibility: 'public',
  workspaceId: 'ws1', fileCount: 3, sizeBytes: 100, runs: 54, remixes: 0, publishedAt: Date.UTC(2024, 8, 22, 6), version: 1,
};

describe('the public creator code', () => {
  it('is stable, short, letters and digits only', () => {
    const a = publicCreatorId(UID);
    expect(a).toBe(publicCreatorId(UID));
    expect(a).toMatch(/^[a-z0-9]{10}$/);
  });
  it('differs between creators and never contains the uid', () => {
    expect(publicCreatorId(UID)).not.toBe(publicCreatorId(`${UID}x`));
    expect(UID.toLowerCase()).not.toContain(publicCreatorId(UID));
  });
});

describe('the creator name', () => {
  it('prefers the profile name, then the sign-in name', () => {
    expect(creatorDisplayName('Dr Asheesh', 'Google Name')).toBe('Dr Asheesh');
    expect(creatorDisplayName('  ', 'Google Name')).toBe('Google Name');
  });
  it('never prints an email, and falls back to an honest generic name', () => {
    expect(creatorDisplayName('someone@gmail.com', null)).toBe(ANONYMOUS_CREATOR_NAME);
    expect(creatorDisplayName(null, undefined)).toBe(ANONYMOUS_CREATOR_NAME);
  });
  it('caps a very long name', () => {
    expect(creatorDisplayName('A'.repeat(90), null).length).toBeLessThanOrEqual(40);
  });
});

describe('resolveCreators', () => {
  beforeEach(() => _resetCreatorCache());

  it('looks each creator up once, and a failed lookup still yields the code', async () => {
    let calls = 0;
    const map = await resolveCreators([UID, UID, 'other-uid'], {
      profileName: async (uid) => { calls++; if (uid === 'other-uid') throw new Error('down'); return 'Dr Asheesh'; },
      authName: async () => { throw new Error('down'); },
    });
    expect(calls).toBe(2);
    expect(map.get(UID)).toEqual({ name: 'Dr Asheesh', id: publicCreatorId(UID) });
    expect(map.get('other-uid')).toEqual({ name: ANONYMOUS_CREATOR_NAME, id: publicCreatorId('other-uid') });
  });
});

describe('what a viewer receives', () => {
  it('carries the name and code, and still never the uid', () => {
    const pub = toPublicWebApp(APP, { name: 'Dr Asheesh', id: publicCreatorId(UID) });
    expect(pub.creatorName).toBe('Dr Asheesh');
    expect(pub.creatorId).toBe(publicCreatorId(UID));
    expect(JSON.stringify(pub)).not.toContain(UID);
  });
  it('without a creator, the projection is unchanged', () => {
    const pub = toPublicWebApp(APP);
    expect('creatorName' in pub).toBe(false);
  });
});

describe('the card corner', () => {
  it('formats the publish date as dd/mm/yy', () => {
    const d = new Date(2024, 8, 22, 12).getTime();
    expect(formatShortDate(d)).toBe('22/09/24');
    expect(formatShortDate(undefined)).toBeNull();
    expect(formatShortDate(Number.NaN)).toBeNull();
  });
  it('draws only what the server sent, and refuses a malformed code', () => {
    expect(creatorLine({ creatorName: 'Dr Asheesh', creatorId: 'xghsjsnsbd', publishedAt: new Date(2024, 8, 22, 12).getTime() }))
      .toEqual({ name: 'Dr Asheesh', id: 'xghsjsnsbd', date: '22/09/24' });
    expect(creatorLine({ creatorId: 'Has Spaces' }).id).toBeNull();
  });
  it('the browse card renders the corner, and every store route passes the creator (source guard)', () => {
    // Blue, from the accent token (admin 2026-09-27).
    expect(readFileSync(join(ROOT, "src/components/ide/NavAppStore.tsx"), "utf8")).toMatch(/text-right text-\[10px\] leading-tight text-accent-text/);
    const ui = readFileSync(join(ROOT, 'src/components/ide/NavAppStore.tsx'), 'utf8');
    expect(ui).toMatch(/<CreatorCorner app=\{a\} \/>/);
    const routes = readFileSync(join(ROOT, 'src/server/routes/navStore.ts'), 'utf8');
    expect(routes).not.toMatch(/\.map\(toPublicWebApp\)/);
    expect((routes.match(/resolveCreators\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it('the privacy policy discloses it', () => {
    const policy = readFileSync(join(ROOT, 'src/content/legal/privacyPolicy.ts'), 'utf8');
    expect(policy).toMatch(/public creator code/);
  });
});
