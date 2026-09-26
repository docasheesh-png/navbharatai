/**
 * EVERY FIRESTORE COLLECTION MUST BE CLASSIFIED, OR THIS FAILS.
 *
 * 🔴 THE CLASS THIS EXISTS FOR — a hand-maintained registry that a new store has to be added to by a
 * human, where the omission is invisible from every direction. It produced two real defects, both of
 * them breaking a promise the Privacy Policy had already published:
 *
 *   · `site_analytics` — the policy says visitor counts "are kept for 30 days". Nothing deleted them.
 *     It was in neither `RETENTION_POLICIES` nor `RETAINED_INDEFINITELY`, and it was not in
 *     `GROWING_COLLECTIONS` either — so the Load board's storage warning could not see it. That
 *     inventory's own comment reads "verified by reading each store on 2026-09-07"; the beacon shipped
 *     on 2026-09-10, three days later.
 *   · `user_vault_pin` and `agentv3_mcp_library` — both keyed by the uid, both personal data, both
 *     missing from `USER_SCOPED_COLLECTIONS`, so neither was erased when an account was deleted, while
 *     Section 9 promises erasure within 30 days.
 *
 * ⚠️ A COLLECTION IS GUILTY UNTIL LISTED, which is the point: the table below must name every exported
 * `*_COLLECTION` constant in the server, so a NEW store fails CI until somebody decides what it is.
 * That decision is cheap when the store is being written and nearly impossible to notice later.
 *
 * 🔒 The classification is not a label — each kind carries an obligation this test then enforces.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  RETENTION_POLICIES, RETAINED_INDEFINITELY, USER_SCOPED_COLLECTIONS,
} from '../src/server/lib/DataRetentionManager';

const root = resolve(__dirname, '..');

/**
 * What each collection IS, and therefore what must be true of it.
 *
 *  · `user`      — keyed by the uid. MUST be in `USER_SCOPED_COLLECTIONS` (account deletion erases it).
 *  · `workspace` — keyed by a workspaceId. Belongs to the user's app, not to a timer.
 *  · `platform`  — ours: a lease, a counter, a bucket, a day rollup. No user owns it.
 *  · `retained`  — grows and is purged on a clock. MUST have a `RETENTION_POLICIES` entry.
 */
const CLASSIFICATION: Record<string, { kind: 'user' | 'workspace' | 'platform' | 'retained'; why: string }> = {
  user_vault_pin:      { kind: 'user', why: "the user's App Lock PIN record — doc id IS the uid" },
  agentv3_mcp_library: { kind: 'user', why: "the user's saved MCP servers — doc id IS the uid" },

  site_configs:        { kind: 'workspace', why: "per-app config, doc id is the workspaceId" },
  agentv3_mcp_servers: { kind: 'workspace', why: "per-app MCP wiring, doc id is the workspaceId" },
  site_uptime:         { kind: 'workspace', why: 'one record per connected domain, not per user' },

  job_leases:          { kind: 'platform', why: 'one doc per job id; a lease that expires by its own clock' },
  metrics_timeline:    { kind: 'platform', why: 'one doc per time bucket — see the SCALE-PLAN entry' },
  monitor_alert_state: { kind: 'platform', why: 'a single document holding alert episodes' },
  web_risk_budget:     { kind: 'platform', why: 'one doc per calendar month, replaced in place' },
  agentv3_engine_use:  { kind: 'platform', why: 'one doc per day of engine use' },
  platform_settings:   { kind: 'platform', why: 'admin-set platform knobs (the build discount, buildDiscount.ts); one doc per setting, no person in it' },
  image_free_paid_daily: { kind: 'platform', why: 'one doc per UTC day — the platform-wide count of free-tier images a PAID engine served; no person in it' },
  fleet_mistakes_v3:   { kind: 'platform', why: 'cross-fleet learning, keyed by the mistake, not a person' },
  /**
   * 🔴 `gift_codes` IS DELIBERATELY NOT USER-SCOPED, for the same shape of reason `takedown_records`
   * is not: the thing it records does not belong solely to the person named in it. A purchased gift
   * code is value sitting in SOMEBODY ELSE's hands — bought with real money and given away — so
   * erasing it because the BUYER closed their account would destroy a stranger's property and take
   * the payment with it. It is also a payment record, which is the first of Privacy Policy §9's four
   * stated exceptions to erasure.
   */
  gift_codes:          { kind: 'platform', why: 'one doc per minted code; the doc id IS the code, and an unredeemed one is value in a third party\'s hands that must outlive the buyer\'s account' },
  promo_codes:         { kind: 'platform', why: "one doc per admin-made promo code (adminPromoStore.ts); the doc id IS the code and it belongs to the campaign, not to any one redeemer — each person's redemption is its own payment_transactions record" },
  gift_code_daily:     { kind: 'user', why: "one doc per buyer per UTC day bounding chargeback exposure; it is that person's own purchase tally and nothing needs it once the account is gone" },

  mobile_build_outcomes: { kind: 'retained', why: 'one doc per UTC day: how many .apk/.aab/.ipa builds finished and of what — counts only, no person in it, purged at 400 days' },
  mobile_build_counted:  { kind: 'retained', why: 'one marker per finished run so a POLLED status endpoint cannot count it twice; the id is a digest and the body names no owner' },
  site_analytics:      { kind: 'retained', why: 'visitor day-counts; the policy promises 30 days' },
  safety_flags:        { kind: 'retained', why: 'flagged messages; the policy promises 180 days' },
  takedown_records:    { kind: 'retained', why: 'removal records; IT Rules 2021 require 180 days' },
};

/** Every exported `*_COLLECTION` constant in the server, read out of the source. */
function declaredCollections(): { name: string; file: string }[] {
  const out: { name: string; file: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.ts$/.test(p) || /\.test\.ts$/.test(p)) continue;
      const src = readFileSync(p, 'utf8');
      for (const m of src.matchAll(/export const [A-Z0-9_]*COLLECTION\b\s*=\s*'([^']+)'/g)) {
        out.push({ name: m[1], file: p.replace(root + '/', '') });
      }
    }
  };
  walk(join(root, 'src/server'));
  return out;
}

describe('every declared collection is classified', () => {
  const declared = declaredCollections();

  it('the scan really finds the constants — an empty scan would pass vacuously', () => {
    expect(declared.length).toBeGreaterThan(10);
    expect(declared.map((d) => d.name)).toContain('site_analytics');
    expect(declared.map((d) => d.name)).toContain('user_vault_pin');
  });

  it('🔒 no collection is unclassified — a NEW store fails here until someone decides what it is', () => {
    const unknown = declared.filter((d) => !CLASSIFICATION[d.name]).map((d) => `${d.name} (${d.file})`);
    expect(unknown, 'add each of these to CLASSIFICATION with what it is and why:\n' + unknown.join('\n'))
      .toEqual([]);
  });

  it('🔒 every `user`-kind collection is erased on account deletion', () => {
    // Section 9 of the Privacy Policy: personal data is deleted or anonymised within 30 days, with four
    // exceptions — none of which is a PIN record or a saved server list.
    const erased = new Set(USER_SCOPED_COLLECTIONS.map((c) => c.collection));
    const missing = Object.entries(CLASSIFICATION)
      .filter(([, v]) => v.kind === 'user')
      .map(([name]) => name)
      .filter((name) => !erased.has(name));
    expect(missing, `user-keyed but never erased: ${missing.join(', ')}`).toEqual([]);
  });

  it('🔒 every `retained`-kind collection has a real retention policy', () => {
    const policied = new Set(RETENTION_POLICIES.map((p) => p.collection));
    const missing = Object.entries(CLASSIFICATION)
      .filter(([, v]) => v.kind === 'retained')
      .map(([name]) => name)
      .filter((name) => !policied.has(name));
    expect(missing, `promised a retention window but nothing deletes them: ${missing.join(', ')}`).toEqual([]);
  });

  it('a classification is a reason, not a label — every entry says why', () => {
    for (const [name, v] of Object.entries(CLASSIFICATION)) {
      expect(v.why.length, `${name} has no reason recorded`).toBeGreaterThan(20);
    }
  });

  it('the three registries do not contradict each other', () => {
    // A collection cannot be both purged on a clock and kept for ever — that would make the report of
    // what we do with somebody's data depend on which list a reader happened to open.
    const policied = RETENTION_POLICIES.map((p) => p.collection);
    const forever = RETAINED_INDEFINITELY.map((r) => r.collection);
    expect(policied.filter((c) => forever.includes(c))).toEqual([]);
  });
});
