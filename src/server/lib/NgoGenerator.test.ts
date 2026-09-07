import { describe, it, expect, afterAll } from 'vitest';

import { generateNgoIntegration, NGO_SERVICE_SOURCE } from './NgoGenerator';
import { emitModule } from '../../../tests/helpers/emitModule';

describe('generateNgoIntegration (wiring)', () => {
  it('emits the service, routes and README + express dep', () => {
    const out = generateNgoIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/ngo/ngoService.ts');
    expect(paths).toContain('server/ngo/routes.ts');
    expect(paths).toContain('server/ngo/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/ngo/routes.ts']).toContain('409');
    expect(out.files['server/ngo/routes.ts']).toContain('export function ngoRouter');
  });
});

describe('emitted NgoService — gapless 80G receipts + derived campaign totals', () => {
  const emitted = emitModule('ngo', NGO_SERVICE_SOURCE);
  afterAll(emitted.cleanup);

  const APR_2024 = Date.UTC(2024, 3, 1);   // FY2024-25
  const MAY_2024 = Date.UTC(2024, 4, 1);   // FY2024-25
  const FEB_2025 = Date.UTC(2025, 1, 1);   // still FY2024-25
  const APR_2025 = Date.UTC(2025, 3, 1);   // FY2025-26

  interface Donation { id: string; receiptNo: string; amount: number; campaignId?: string }
  interface Campaign { id: string; status: string; raised?: number }
  interface Service {
    addDonor(name: string, opts?: { email?: string; pan?: string }): { id: string };
    createCampaign(title: string, goal?: number): Campaign;
    closeCampaign(id: string): Campaign;
    listCampaigns(): Array<Campaign & { raised: number }>;
    raisedFor(id: string): number;
    donate(donorId: string, amount: number, opts?: { campaignId?: string; mode?: string; at?: number }): Donation;
    donationsFor(f?: { donorId?: string; campaignId?: string }): Donation[];
    totalRaised(): number;
  }
  interface Emitted { NgoService: new (now?: () => number) => Service; financialYear(at: number): string }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ emitted.href)) as unknown as Emitted;
  }

  it('financialYear follows the Indian Apr–Mar boundary', async () => {
    const { financialYear } = await load();
    expect(financialYear(APR_2024)).toBe('FY2024-25');
    expect(financialYear(FEB_2025)).toBe('FY2024-25'); // Feb is still the same FY
    expect(financialYear(APR_2025)).toBe('FY2025-26');
    expect(financialYear(Date.UTC(2024, 2, 31))).toBe('FY2023-24'); // 31 Mar = previous FY
  });

  it('mints GAPLESS, UNIQUE receipt numbers per financial year', async () => {
    const { NgoService } = await load();
    const svc = new NgoService(() => APR_2024);
    const d = svc.addDonor('Asha');
    expect(svc.donate(d.id, 500, { at: APR_2024 }).receiptNo).toBe('FY2024-25/0001');
    expect(svc.donate(d.id, 100, { at: MAY_2024 }).receiptNo).toBe('FY2024-25/0002');
    expect(svc.donate(d.id, 100, { at: FEB_2025 }).receiptNo).toBe('FY2024-25/0003'); // same FY
    expect(svc.donate(d.id, 100, { at: APR_2025 }).receiptNo).toBe('FY2025-26/0001'); // new FY resets
    // uniqueness across the whole ledger
    const nums = svc.donationsFor().map((x) => x.receiptNo);
    expect(new Set(nums).size).toBe(nums.length);
  });

  it('campaign raised is DERIVED from donations, and a closed campaign is 409', async () => {
    const { NgoService } = await load();
    const svc = new NgoService(() => APR_2024);
    const d = svc.addDonor('Bá');
    const c = svc.createCampaign('School kits', 10000);
    svc.donate(d.id, 3000, { campaignId: c.id, at: APR_2024 });
    svc.donate(d.id, 2000, { campaignId: c.id, at: MAY_2024 });
    expect(svc.raisedFor(c.id)).toBe(5000);
    expect(svc.listCampaigns().find((x) => x.id === c.id)!.raised).toBe(5000);
    svc.closeCampaign(c.id);
    expect(() => svc.donate(d.id, 1000, { campaignId: c.id, at: MAY_2024 })).toThrow(/closed/);
    expect(svc.raisedFor(c.id)).toBe(5000); // unchanged
  });

  it('rejects a non-positive donation and an unknown donor/campaign', async () => {
    const { NgoService } = await load();
    const svc = new NgoService(() => APR_2024);
    const d = svc.addDonor('C');
    expect(() => svc.donate(d.id, 0)).toThrow(/greater than zero/);
    expect(() => svc.donate('nope', 100)).toThrow(/No such donor/);
    expect(() => svc.donate(d.id, 100, { campaignId: 'nope' })).toThrow(/No such campaign/);
  });

  it('totalRaised sums every donation; the ledger is append-only', async () => {
    const { NgoService } = await load();
    const svc = new NgoService(() => APR_2024);
    const d = svc.addDonor('D');
    svc.donate(d.id, 100, { at: APR_2024 });
    svc.donate(d.id, 250, { at: MAY_2024 });
    expect(svc.totalRaised()).toBe(350);
    expect(svc.donationsFor({ donorId: d.id }).length).toBe(2);
  });
});
