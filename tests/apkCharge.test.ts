import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { apkChargeInr, isChargeableApk, apkChargeRef } from '../src/server/lib/apkCharge';

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
  it('charges .apk only — .aab/.ipa stay unmetered until the admin prices them', () => {
    expect(isChargeableApk('app-release.apk')).toBe(true);
    expect(isChargeableApk('APP.APK')).toBe(true);
    expect(isChargeableApk('app-release.aab')).toBe(false);
    expect(isChargeableApk('NavBharat.ipa')).toBe(false);
    expect(isChargeableApk(null)).toBe(false);
  });

  it('price 0 ⇒ nothing is chargeable (instant kill switch)', () => {
    process.env.APK_CHARGE_INR = '0';
    expect(isChargeableApk('app-release.apk')).toBe(false);
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
  it('charges at DELIVERY (after the artifact fetch succeeded), idempotent ref, verified identity, free-list exempt', () => {
    const code = stripComments(route);
    const dl = code.indexOf("'/api/mobile-ship/download'");
    const fetchOk = code.indexOf('fetchBuildArtifact', dl);
    const charge = code.indexOf('isChargeableApk(got.fileName)', dl);
    const send = code.indexOf('res.send(got.bytes)', dl);
    expect(charge).toBeGreaterThan(fetchOk); // a failed build never reaches the charge
    expect(charge).toBeLessThan(send);       // decided beside the stream, not after the response ends
    const seg = code.slice(dl, send);
    expect(seg).toContain('verifyFirebaseIdentity(req)');            // only a real signed-in wallet
    expect(seg).toContain('isAgentV3FreeUser(identity.uid, identity.email)'); // admin/tester exempt
    expect(seg).toContain('apkChargeRef(owner, repo, artifactId)');  // idempotent per artifact
    expect(seg).toContain("description: 'APK build'");               // white-label ledger line
    expect(seg).toContain('void debitWalletForBuild');               // never blocks/delays the bytes
  });

  it('the price is DISCLOSED before the user builds (no surprise charges — the bill they pay is real)', () => {
    const panel = readFileSync(join(__dirname, '..', 'src/components/ide/StoreBuildPanel.tsx'), 'utf8');
    expect(panel).toContain('₹1 per built APK');
    const kb = readFileSync(join(__dirname, '..', 'src/server/AppContext/AppKnowledgeBase.ts'), 'utf8');
    expect(kb).toContain('each built .apk costs ₹1');
  });
});
