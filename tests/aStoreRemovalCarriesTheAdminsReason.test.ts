// A STORE REVIEW THAT TAKES SOMETHING DOWN CARRIES THE ADMIN'S OWN REASON (Q-681, admin-approved (b) 2026-10-05).
//
// The gallery, App Mart APK and App Mart web reviews accepted a reject/remove with no note, and the App Mart
// Remove button filled one in for the admin ("Removed by an admin from the app page"), so the 180-day removal
// record could carry a sentence nobody wrote. Option (b): every current client sends the reason and says so
// (`reasonContract`); a phone build from before the rule keeps working and is recorded as giving no reason.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'glob';
import {
  readReviewReason, recordedReviewReason, NO_REASON_LEGACY, REVIEW_REASON_CONTRACT, LEGACY_REVIEW_CLIENTS_ACCEPTED,
} from '../src/lib/storeReviewReason';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('readReviewReason', () => {
  const modern = (note?: string) => ({ note, reasonContract: REVIEW_REASON_CONTRACT });

  it('a current client must send a real reason to reject or remove', () => {
    expect(readReviewReason(modern(''), true)).toMatchObject({ ok: false });
    expect(readReviewReason(modern('no'), true)).toMatchObject({ ok: false });
    expect(readReviewReason(modern('  Copies another creator\'s app  '), true)).toEqual({ ok: true, reason: "Copies another creator's app", legacy: false });
  });

  it('an older phone build without the marker still works, recorded honestly as no reason given', () => {
    expect(LEGACY_REVIEW_CLIENTS_ACCEPTED).toBe(true);
    const r = readReviewReason({}, true);
    expect(r).toEqual({ ok: true, reason: null, legacy: true });
    expect(recordedReviewReason(r as { reason: null; legacy: true })).toBe(NO_REASON_LEGACY);
  });

  it("the old client's fabricated note is never recorded as the admin's reason", () => {
    expect(readReviewReason({ note: 'Removed by an admin from the app page' }, true)).toEqual({ ok: true, reason: null, legacy: true });
  });

  it('an older build that DID send a real note keeps it', () => {
    expect(readReviewReason({ note: 'Malware found by the scan' }, true)).toEqual({ ok: true, reason: 'Malware found by the scan', legacy: false });
  });

  it('an approval needs no reason, and keeps a note given with it', () => {
    expect(readReviewReason(modern(), false)).toEqual({ ok: true, reason: null, legacy: false });
    expect(readReviewReason(modern('nice'), false)).toEqual({ ok: true, reason: 'nice', legacy: false });
  });
});

describe('the three review routes read the reason through the one rule', () => {
  it('gallery, App Mart APK and App Mart web each call readReviewReason before deciding', () => {
    const gallery = read('src/server/routes/gallery.ts');
    const store = read('src/server/routes/navStore.ts');
    expect(gallery).toMatch(/app\.post\('\/api\/gallery\/admin\/:id\/review'[\s\S]{0,700}readReviewReason\(req\.body, decision !== 'approved'\)/);
    expect(store).toMatch(/app\.post\('\/api\/nav-store\/admin\/review'[\s\S]{0,900}readReviewReason\(req\.body, decision !== 'approved'\)/);
    expect(store).toMatch(/app\.post\('\/api\/nav-store\/web\/admin\/review'[\s\S]{0,900}readReviewReason\(req\.body, decision === 'removed'\)/);
  });

  it('no route invents a removal reason any more', () => {
    for (const f of ['src/server/routes/gallery.ts', 'src/server/routes/navStore.ts']) {
      const s = read(f);
      expect(s, f).not.toContain("'removed by admin'");
      expect(s, f).not.toContain('`${status} by admin`');
    }
  });

  it('every client call to a review route sends the marker, and none fills in a reason', () => {
    const files = globSync('src/**/*.{ts,tsx}', { cwd: root }).filter((f) => !f.startsWith('src/server/') && !/\.test\./.test(f));
    const callers: string[] = [];
    for (const f of files) {
      const s = read(f);
      if (!/\/api\/(gallery\/admin\/\$\{[^}]+\}\/review|nav-store\/admin\/review|nav-store\/web\/admin\/review)/.test(s)) continue;
      callers.push(f);
      expect(s, f).toContain('reasonContract: REVIEW_REASON_CONTRACT');
      expect(s, f).not.toContain('Removed by an admin from the app page');
    }
    expect(callers.sort()).toEqual(['src/components/ide/NavAppStore.tsx', 'src/components/panels/GalleryReviewQueue.tsx']);
  });

  it('the App Mart Reject asks for the reason; the gallery keeps Reject / Remove disabled without one', () => {
    const ui = read('src/components/ide/NavAppStore.tsx');
    expect(ui).toMatch(/askReviewReason\(`Reject[\s\S]{0,200}if \(note !== null\) void decide\(a\.id, 'rejected', note\)/);
    const gallery = read('src/components/panels/GalleryReviewQueue.tsx');
    expect(gallery).toContain("disabled={busy || !reasonOk}>Reject</Button>");
    expect(gallery).toContain("disabled={busy || !reasonOk}>Remove</Button>");
  });
});
