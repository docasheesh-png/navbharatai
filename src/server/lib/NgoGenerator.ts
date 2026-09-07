// NGO / donation-management domain-vertical starter generator (ROADMAP #19 — more verticals).
//
// A distinct India-first domain: non-profits and fundraisers. Distinct real guarantees from the other
// verticals:
//   1. GAPLESS, UNIQUE RECEIPT NUMBERS per Indian financial year (Apr–Mar) — an 80G donation receipt
//      series must have no gaps and no duplicates, or the exemption is challengeable. The number is
//      minted from a per-FY counter, never reused, never set by hand.
//   2. CAMPAIGN "raised" is DERIVED — a campaign's raised amount is exactly the sum of its donations,
//      never a stored field that can drift; and a CLOSED campaign accepts no more donations (409).
//   3. APPEND-ONLY donation ledger.
// In-memory by default (swap the Maps for a real DB). No API key.
//
// The emitted code avoids backticks so it nests cleanly inside this module's template literals.

export const NGO_SERVICE_SOURCE = `// NGO / donation domain logic — dependency-free and framework-agnostic.
//
// THREE real guarantees (not a stub):
//  1) Donation receipt numbers are GAPLESS and UNIQUE per Indian financial year (Apr-Mar) — 80G needs that.
//  2) A campaign's raised amount is DERIVED (sum of its donations); a closed campaign takes no donations.
//  3) The donation ledger is append-only.
// In-memory by default — replace the Maps with your database, keeping the same method contracts.

export interface Donor { id: string; name: string; email?: string; pan?: string; }
export interface Campaign { id: string; title: string; goal: number; status: 'active' | 'closed'; createdAt: number; }
export interface Donation { id: string; donorId: string; campaignId?: string; amount: number; mode: string; receiptNo: string; at: number; }

let seq = 0;
function nextId(prefix: string): string { seq += 1; return prefix + '_' + Date.now().toString(36) + '_' + seq; }
function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

/**
 * The Indian financial year label for an instant: FY runs 1 April to 31 March, so April 2024 → "FY2024-25"
 * and February 2024 → "FY2023-24". Computed from the timestamp in UTC — pass a timezone-adjusted 'at' if
 * your donations near the 31-March boundary must follow IST exactly.
 */
export function financialYear(at: number): string {
  const d = new Date(at);
  const y = d.getUTCFullYear();
  const startYear = d.getUTCMonth() >= 3 ? y : y - 1; // month 3 = April (0-indexed)
  const endYY = String((startYear + 1) % 100).padStart(2, '0');
  return 'FY' + startYear + '-' + endYY;
}

export class NgoService {
  private donors = new Map<string, Donor>();
  private campaigns = new Map<string, Campaign>();
  private donations: Donation[] = [];
  private receiptCounters = new Map<string, number>(); // financial-year label -> last number used

  private now: () => number;
  constructor(now: () => number = () => Date.now()) { this.now = now; }

  // ── Donors ──
  addDonor(name: string, opts: { email?: string; pan?: string } = {}): Donor {
    if (!name) throw Object.assign(new Error('A donor needs a name.'), { status: 400 });
    const donor: Donor = { id: nextId('donor'), name, email: opts.email, pan: opts.pan };
    this.donors.set(donor.id, donor);
    return donor;
  }
  listDonors(): Donor[] { return Array.from(this.donors.values()); }
  private requireDonor(id: string): Donor {
    const d = this.donors.get(id);
    if (!d) throw Object.assign(new Error('No such donor: ' + id), { status: 404 });
    return d;
  }

  // ── Campaigns ──
  createCampaign(title: string, goal = 0): Campaign {
    if (!title) throw Object.assign(new Error('A campaign needs a title.'), { status: 400 });
    if (goal < 0) throw Object.assign(new Error('A campaign goal cannot be negative.'), { status: 400 });
    const c: Campaign = { id: nextId('camp'), title, goal: round2(goal), status: 'active', createdAt: this.now() };
    this.campaigns.set(c.id, c);
    return c;
  }
  closeCampaign(id: string): Campaign {
    const c = this.campaigns.get(id);
    if (!c) throw Object.assign(new Error('No such campaign: ' + id), { status: 404 });
    c.status = 'closed';
    return c;
  }
  listCampaigns(): Array<Campaign & { raised: number }> {
    return Array.from(this.campaigns.values()).map((c) => ({ ...c, raised: this.raisedFor(c.id) }));
  }
  /** A campaign's raised amount is the exact sum of its donations — never a stored, driftable field. */
  raisedFor(campaignId: string): number {
    return round2(this.donations.filter((d) => d.campaignId === campaignId).reduce((s, d) => s + d.amount, 0));
  }

  // ── Donations ──
  donate(donorId: string, amount: number, opts: { campaignId?: string; mode?: string; at?: number } = {}): Donation {
    this.requireDonor(donorId);
    if (!(amount > 0)) throw Object.assign(new Error('A donation amount must be greater than zero.'), { status: 400 });
    if (opts.campaignId) {
      const c = this.campaigns.get(opts.campaignId);
      if (!c) throw Object.assign(new Error('No such campaign: ' + opts.campaignId), { status: 404 });
      if (c.status === 'closed') throw Object.assign(new Error('Campaign "' + c.title + '" is closed and cannot take donations.'), { status: 409 });
    }
    const at = typeof opts.at === 'number' ? opts.at : this.now();
    const donation: Donation = {
      id: nextId('don'),
      donorId,
      campaignId: opts.campaignId,
      amount: round2(amount),
      mode: opts.mode || 'online',
      receiptNo: this.mintReceiptNo(at),
      at,
    };
    this.donations.push(donation);
    return donation;
  }
  /** Mint the next gapless receipt number for the donation's financial year. Never reused. */
  private mintReceiptNo(at: number): string {
    const fy = financialYear(at);
    const n = (this.receiptCounters.get(fy) || 0) + 1;
    this.receiptCounters.set(fy, n);
    return fy + '/' + String(n).padStart(4, '0');
  }
  donationsFor(filter: { donorId?: string; campaignId?: string } = {}): Donation[] {
    let out = this.donations.slice();
    if (filter.donorId) out = out.filter((d) => d.donorId === filter.donorId);
    if (filter.campaignId) out = out.filter((d) => d.campaignId === filter.campaignId);
    return out.sort((a, b) => a.at - b.at);
  }
  receiptFor(donationId: string): Donation | undefined {
    return this.donations.find((d) => d.id === donationId);
  }
  totalRaised(): number {
    return round2(this.donations.reduce((s, d) => s + d.amount, 0));
  }
}
`;

export const NGO_ROUTES_SOURCE = `// Express router for the NGO/donation backend. Mount with: app.use('/api/ngo', ngoRouter(service)).
import { Router, type Request, type Response } from 'express';
import { NgoService } from './ngoService';

export function ngoRouter(ngo: NgoService = new NgoService()): Router {
  const router = Router();
  const fail = (res: Response, err: any) => res.status(err?.status || 500).json({ error: err?.message || 'Error' });

  router.post('/donors', (req: Request, res: Response) => {
    try { res.status(201).json(ngo.addDonor(req.body?.name, { email: req.body?.email, pan: req.body?.pan })); }
    catch (err) { fail(res, err); }
  });
  router.get('/donors', (_req: Request, res: Response) => res.json(ngo.listDonors()));

  router.post('/campaigns', (req: Request, res: Response) => {
    try { res.status(201).json(ngo.createCampaign(req.body?.title, Number(req.body?.goal) || 0)); }
    catch (err) { fail(res, err); }
  });
  router.get('/campaigns', (_req: Request, res: Response) => res.json(ngo.listCampaigns()));
  router.patch('/campaigns/:id/close', (req: Request, res: Response) => {
    try { res.json(ngo.closeCampaign(req.params.id)); }
    catch (err) { fail(res, err); }
  });

  // A donation to a CLOSED campaign is rejected with 409. Every donation gets a gapless 80G receipt no.
  router.post('/donations', (req: Request, res: Response) => {
    try {
      res.status(201).json(ngo.donate(req.body?.donorId, Number(req.body?.amount), {
        campaignId: req.body?.campaignId, mode: req.body?.mode,
      }));
    } catch (err) { fail(res, err); }
  });
  router.get('/donations', (req: Request, res: Response) => {
    const donorId = typeof req.query.donorId === 'string' ? req.query.donorId : undefined;
    const campaignId = typeof req.query.campaignId === 'string' ? req.query.campaignId : undefined;
    res.json(ngo.donationsFor({ donorId, campaignId }));
  });
  router.get('/donations/:id/receipt', (req: Request, res: Response) => {
    const d = ngo.receiptFor(req.params.id);
    if (!d) { res.status(404).json({ error: 'No such donation.' }); return; }
    res.json({ receiptNo: d.receiptNo, amount: d.amount, at: d.at, donorId: d.donorId });
  });
  router.get('/total', (_req: Request, res: Response) => res.json({ totalRaised: ngo.totalRaised() }));

  return router;
}
`;

export const NGO_README = `# NGO / donation backend (server/ngo/)

A dependency-free backend for a non-profit or fundraiser.

## Real guarantees
- **Gapless, unique receipt numbers** per Indian financial year (Apr–Mar), e.g. \`FY2024-25/0001\` — an
  80G receipt series must have no gaps or duplicates.
- **Campaign "raised" is derived** (the exact sum of its donations, never a stored field); a **closed
  campaign takes no donations** (409).
- **Append-only donation ledger.**

## Wire it up

    import { ngoRouter } from './server/ngo/routes';
    app.use('/api/ngo', ngoRouter());

## Endpoints
- POST /donors, GET /donors
- POST /campaigns, GET /campaigns (each with derived \`raised\`), PATCH /campaigns/:id/close
- POST /donations (409 to a closed campaign), GET /donations?donorId=&campaignId=
- GET /donations/:id/receipt, GET /total

In-memory by default — swap the Maps for your database, keeping the same method contracts.
`;

const INSTRUCTIONS = [
  'Wired an NGO / donation-management backend under server/ngo/. It mints gapless, unique 80G-style',
  'receipt numbers per Indian financial year, derives the raised amount of each campaign from its donations',
  '(a closed campaign takes none), and keeps an append-only donation ledger. Mount the router (see',
  'server/ngo/README.md) and swap the in-memory store for your database when ready. No API key.',
].join(' ');

export interface NgoConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

/** Emit a real, dependency-free NGO/donation backend for the user's app. Pure. */
export function generateNgoIntegration(): NgoConfig {
  return {
    files: {
      'server/ngo/ngoService.ts': NGO_SERVICE_SOURCE,
      'server/ngo/routes.ts': NGO_ROUTES_SOURCE,
      'server/ngo/README.md': NGO_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
