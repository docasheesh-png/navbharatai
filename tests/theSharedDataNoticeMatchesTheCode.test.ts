// THE NOTICE ABOUT APP MART'S SHARED ENTRIES SAYS WHAT THE CODE DOES (admin 2026-10-21).
//
// Privacy Section 12 and Terms Section 5 used to say that an app's data lives only on the builder's own
// accounts, "never ours". `navStoreWebData.ts` (the admin-approved NavData exception of 2026-08-15) keeps small
// shared entries of App Mart instant apps on NavBharatAI's own Firestore, which made both sentences false for
// every visitor who signed a guestbook. They now describe the exception — and a notice that quotes numbers is
// only true while the numbers match, so this suite reads them FROM the code rather than trusting a person to
// keep two files in step.
//
// It also locks the one claim that is about what the code does NOT do: the notice says the entries are not
// deleted automatically when an app is removed or its creator deletes their account. That is true today because
// nothing deletes them. The day something does, the notice must change in the same commit — and this suite is
// what makes that unforgettable.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_ROWS_PER_APP, MAX_WRITES_PER_APP_PER_DAY, MAX_ROW_BYTES } from '../src/server/lib/navStoreWebData';
import { PRIVACY_POLICY } from '../src/content/legal/privacyPolicy';
import { TERMS_OF_SERVICE } from '../src/content/legal/termsOfService';
import { sourceCensusFiles } from './helpers/sourceCensus';

const ROOT = join(__dirname, '..');
const withCommas = (n: number) => n.toLocaleString('en-US');
const s12 = PRIVACY_POLICY.slice(PRIVACY_POLICY.indexOf('## 12.'), PRIVACY_POLICY.indexOf('## 13.'));
const t5 = TERMS_OF_SERVICE.slice(TERMS_OF_SERVICE.indexOf('## 5.'), TERMS_OF_SERVICE.indexOf('## 6.'));

describe('the numbers in the notice are the numbers in the code', () => {
  it('Privacy Section 12 quotes the per-entry size, the per-app total and the daily limit', () => {
    expect(s12).toContain(`at most **${MAX_ROW_BYTES / 1024} KB**`);
    expect(s12).toContain(`**${withCommas(MAX_ROWS_PER_APP)} entries per app**`);
    expect(s12).toContain(`**${withCommas(MAX_WRITES_PER_APP_PER_DAY)} new entries per app per day**`);
  });

  it('Terms Section 5 quotes the same three numbers', () => {
    expect(t5).toContain(`${MAX_ROW_BYTES / 1024} KB per entry`);
    expect(t5).toContain(`${withCommas(MAX_ROWS_PER_APP)} entries per app`);
    expect(t5).toContain(`${withCommas(MAX_WRITES_PER_APP_PER_DAY)} new entries per app per day`);
  });
});

describe('the notice makes the exception visible, in both documents', () => {
  it('no longer says user app data is "never ours" without the exception beside it', () => {
    expect(s12).toMatch(/The one exception: small shared entries/i);
    expect(t5).toMatch(/One exception: small shared entries/i);
    expect(s12).toMatch(/NavBharatAI's own servers/);
    // the sentence that was false on its own is still there, but no longer alone
    expect(s12).toMatch(/not ours/);
  });

  it('says who can read the entries and what is NOT attached to them', () => {
    expect(s12).toMatch(/anyone who can open that app can read its most recent entries/i);
    expect(s12).toMatch(/does \*\*not\*\* attach your name, account, phone number, IP address or device to an entry/i);
    expect(s12).toMatch(/type your name or other details, and if you do, they are stored with the entry/i);
  });

  it('Section 6 (retention) carries the same claim, so a reader of either section is told', () => {
    expect(PRIVACY_POLICY).toMatch(/Shared entries of App Mart instant apps\*\* \(Section 12\) stay for as long as the app is in App Mart and are not deleted automatically/);
  });
});

describe('🔒 the claim "not deleted automatically" is true — and stays true or forces a rewrite', () => {
  const SRC = sourceCensusFiles(join(ROOT, 'src'), (p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p), ['node_modules'])
    .map((p) => p.slice(ROOT.length + 1).replace(/\\/g, '/'));
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('nothing outside navStoreWebData.ts touches the data_ subcollections at all', () => {
    const users = SRC.filter((f) => f !== 'src/server/lib/navStoreWebData.ts' && /DATA_SUB_PREFIX|dataSub\(|data_meta/.test(read(f)));
    expect(users).toEqual([]);
  });

  it('navStoreWebData.ts itself never deletes: no delete(), no recursiveDelete, no listCollections', () => {
    const body = read('src/server/lib/navStoreWebData.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).not.toMatch(/\.delete\(|recursiveDelete|listCollections|batch\(\)/);
  });

  it('the removal and erasure paths do not sweep a listing\'s subcollections', () => {
    for (const f of ['src/server/lib/publishedListingErase.ts', 'src/server/lib/workspaceDataErase.ts']) {
      expect(read(f), f).not.toMatch(/recursiveDelete|listCollections/);
    }
  });
});
