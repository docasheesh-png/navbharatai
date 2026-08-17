import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { apkChargeInr, isChargeableApk, apkChargeRef, chargeDescription } from '../src/server/lib/apkCharge';

/**
 * ₹1-per-APK (admin 2026-08-06: "1₹ per apk — jitni baar apk bana utne ₹"). The contract under
 * test: delivery-time charge, idempotent per artifact, .apk only, free-list/anon never charged,
 * price env-tunable, and — the honesty half — the price is DISCLOSED to the user before they build.
 */

afterEach(() => { delete process.env.APK_CHARGE_INR; });

describe('apkChargeInr', () => {
  it('defaults to ₹1; env-tunable; 0/off = free; junk falls back to 1', () => {
    expect(apkChargeInr()).toBe(1);
    process.env.APK_CHARGE_INR = '2';
    expect(apkChargeInr()).toBe(2);
    process.env.APK_CHARGE_INR = '0';
    expect(apkChargeInr()).toBe(0);
    process.env.APK_CHARGE_INR = 'off';
    expect(apkChargeInr()).toBe(0);
    process.env.APK_CHARGE_INR = 'banana';
    expect(apkChargeInr()).toBe(1);
  });
});

describe('isChargeableApk', () => {
  it('charges EVERY built mobile file — .apk, .aab, .ipa (admin: "sabhi kuch 1₹ par file")', () => {
    expect(isChargeableApk('app-release.apk')).toBe(true);
    expect(isChargeableApk('APP.APK')).toBe(true);
    expect(isChargeableApk('app-release.aab')).toBe(true);
    expect(isChargeableApk('NavBharat.ipa')).toBe(true);
    expect(isChargeableApk('archive.zip')).toBe(false); // never a non-binary
    expect(isChargeableApk(null)).toBe(false);
  });

  it('price 0 ⇒ nothing is chargeable (instant kill switch)', () => {
    process.env.APK_CHARGE_INR = '0';
    expect(isChargeableApk('app-release.apk')).toBe(false);
    expect(isChargeableApk('app-release.aab')).toBe(false);
  });
});

describe('chargeDescription', () => {
  it('names the file kind for the ledger — never a vendor', () => {
    expect(chargeDescription('app-release.apk')).toBe('App build (.apk)');
    expect(chargeDescription('app-release.aab')).toBe('App build (.aab)');
    expect(chargeDescription('My.IPA')).toBe('App build (.ipa)');
    expect(chargeDescription(null)).toBe('App build');
  });
});

describe('apkChargeRef', () => {
  it('is the artifact identity — one charge per BUILD, however often downloaded', () => {
    expect(apkChargeRef('me', 'shop', '123')).toBe('apk_me/shop#123');
    expect(apkChargeRef('me', 'shop', '123')).toBe(apkChargeRef('me', 'shop', '123'));
    expect(apkChargeRef('me', 'shop', '124')).not.toBe(apkChargeRef('me', 'shop', '123')); // new build = new ₹1
  });
});

// ---------- wiring invariants ----------

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const route = readFileSync(join(__dirname, '..', 'src/server/routes/mobileShip.ts'), 'utf8');

describe('download-route wiring', () => {
  it('charges when the BUILD SUCCEEDS, with the same guarantees the delivery charge had', () => {
    // MOVED 2026-08-17 (admin: "user apk banwayega aur github se ja kar download kar lega"). The charge
    // used to sit on the download, which could never be enforced: the artifact lives in the user's OWN
    // GitHub repo for 14 days, so anyone could build here for nothing and collect it there. It now fires
    // where the server first SEES a successful artifact — a point nobody can skip, and one that still
    // never bills a failure, because GitHub publishes no artifact for a failed run.
    const code = stripComments(route);
    const at = code.indexOf("'/api/mobile-ship/artifacts'");
    const end = code.indexOf('res.json({ artifacts })', at);
    expect(at).toBeGreaterThan(-1);
    const seg = code.slice(at, end);
    expect(seg).toContain('isChargeableApk(String(a.name))');                 // only a real built app file
    expect(seg).toContain('verifyFirebaseIdentity(req)');                     // only a real signed-in wallet
    expect(seg).toContain('isAgentV3FreeUser(identity.uid, identity.email)'); // admin/tester exempt
    expect(seg).toContain('apkChargeRef(owner, repo, String(a.id))');         // idempotent per artifact
    expect(seg).toContain('description: chargeDescription(String(a.name))');  // white-label ledger line
    expect(seg).toContain('void debitWalletForBuild');                        // never blocks the response
    expect(seg).toContain('break;');                                          // one charge per build, not per file
  });

  it('the DOWNLOAD takes nothing — that is the whole point of the move', () => {
    // If a charge ever returns here it is charged twice for one build, and the bypass comes back with it.
    const code = stripComments(route);
    const dl = code.indexOf("'/api/mobile-ship/download'");
    const send = code.indexOf('res.send(got.bytes)', dl);
    const seg = code.slice(dl, send);
    expect(seg).not.toContain('debitWalletForBuild');
    expect(seg).toContain(`${'CHARGE_APPLIED_HEADER'}, 'false'`); // and it reports that honestly
  });

  it('the price is DISCLOSED before the user builds (no surprise charges — the bill they pay is real)', () => {
    const panel = readFileSync(join(__dirname, '..', 'src/components/ide/StoreBuildPanel.tsx'), 'utf8');
    expect(panel).toContain('₹1 per built app file');
    const kb = readFileSync(join(__dirname, '..', 'src/server/AppContext/AppKnowledgeBase.ts'), 'utf8');
    expect(kb).toContain('costs ₹1');
  });
});
