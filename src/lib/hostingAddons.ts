// HOSTING ADD-ONS — the à-la-carte menu beside the hosting plans.
//
// A plan is a bundle. An add-on is one thing, bought on its own, removed on its own. The prices
// here are the ONLY prices: the purchase screen, the agreement and the debit all read this list.
//
// 🔒 TWO KINDS OF ROW, AND THE DIFFERENCE IS WHETHER WE CAN ACTUALLY HAND THE THING OVER.
//   • sellable — the purchase IS the delivery. An extra website slot raises the publish cap in the
//     same wallet transaction that takes the money. An extra domain slot raises the domain cap the
//     same way. Nothing is charged if that write does not happen.
//   • not sellable — a server, a database, or a traffic pack. Each of those is only real once a
//     separate system has proved it is running (a live server, a database we actually created, a
//     meter that can count the bytes). Until then the row is shown as not for sale and the purchase
//     function refuses it. A button that took money for one of these would be the exact failure
//     this menu exists to make impossible.
//
// PURE. No env, no clock, no I/O — the browser and the server read the same catalogue.

export type HostingAddonId =
  | 'extra_site'
  | 'extra_domain'
  | 'server'
  | 'shared_db'
  | 'dedicated_db'
  | 'traffic_gb';

export interface HostingAddon {
  id: HostingAddonId;
  /** What the user sees. */
  name: string;
  /** ₹ per period, taken from the wallet. 0 is not sold. */
  priceInr: number;
  /** Days the slot lasts. */
  days: number;
  /** How many of this add-on one account may hold at once. */
  max: number;
  /**
   * False ⇒ the server refuses a purchase and the screen shows no buy button.
   * Changing this to true without a real delivery proof is how a user pays for nothing.
   */
  sellable: boolean;
  /** Shown when `sellable` is false. Never a sales pitch. */
  unavailableReason: string | null;
  /** One line under the name. */
  summary: string;
}

export const HOSTING_ADDONS: readonly HostingAddon[] = [
  {
    id: 'extra_site',
    name: 'Extra website',
    priceInr: 49,
    days: 30,
    max: 10,
    sellable: true,
    unavailableReason: null,
    summary: 'Publish one more website on NavBharatAI, on top of what your plan (or the free limit) already allows.',
  },
  {
    id: 'extra_domain',
    name: 'Extra domain',
    priceInr: 49,
    days: 30,
    max: 10,
    sellable: true,
    unavailableReason: null,
    summary: 'Connect one more domain of your own. You still buy the domain name from a registrar — this only attaches it.',
  },
  {
    id: 'server',
    name: 'Server',
    priceInr: 149,
    days: 30,
    max: 5,
    sellable: false,
    unavailableReason: 'Not sold from this list. On Publish, choose “NavBharatAI runs the server” — ₹149 is taken only after the server is live. Or host it yourself, which stays free from us.',
    summary: 'A real server for login, payments or an API.',
  },
  {
    id: 'shared_db',
    name: 'Small database',
    priceInr: 49,
    days: 30,
    max: 5,
    sellable: false,
    unavailableReason: 'Not sold from this list. On Publish, start the NavBharatAI database and API — ₹49 is taken only after both exist. Or connect your own Supabase, which stays free from us.',
    summary: 'A small database and the API your app calls, on the servers NavBharatAI already runs. 20,000 operations included. Not a separate machine.',
  },
  {
    id: 'dedicated_db',
    name: 'Your own database',
    priceInr: 1499,
    days: 30,
    max: 3,
    sellable: false,
    unavailableReason: 'Not sold from this list. On Publish, choose NavBharatAI’s database — ₹1,499 is taken only after the database is ready. Or connect your own Supabase, which stays free from us.',
    summary: 'A private database for one app.',
  },
  {
    id: 'traffic_gb',
    name: 'Extra traffic',
    priceInr: 20,
    days: 30,
    max: 0,
    sellable: false,
    unavailableReason: 'Extra traffic is not sold as a pack. Visitor traffic is not fully measured yet, and we will not charge for gigabytes we cannot count.',
    summary: 'Not a pack. Measured traffic, when it is measured, is billed per GB from the wallet.',
  },
];

export function addonById(id: string | null | undefined): HostingAddon | null {
  return HOSTING_ADDONS.find((a) => a.id === String(id ?? '')) ?? null;
}

/** The sentences the user ticks before a sellable add-on is bought. Generated from the row. */
export function addonAgreementTerms(addon: HostingAddon): readonly string[] {
  return [
    `₹${addon.priceInr} is taken from the money you added to your wallet, for ${addon.days} days. Your welcome gift is not used.`,
    addon.summary,
    'If this purchase does not go through, nothing is charged.',
    'You can remove it whenever you want. Unused days come back to your wallet. If you are still using it — the extra website is still published, or the extra domain is still connected — remove that first. We do not keep charging for something you have removed, and we do not stop charging while you are still using it.',
  ];
}

export interface HostingAddonRecord {
  /** The client's own id for this purchase. Replaying it can never buy a second one. */
  ref: string;
  addonId: HostingAddonId;
  purchasedAt: string;
  expiresAt: string;
  agreedAt: string;
  /** Set only when this row was written after a real server URL or database id came back. */
  proof?: string;
}

const REF_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function validAddonRef(ref: unknown): ref is string {
  return typeof ref === 'string' && REF_RE.test(ref);
}

/** How many of this add-on are paid up right now. Expired rows do not count. Junk does not count. */
export function activeAddonCount(
  wallet: { hostingAddons?: unknown } | null | undefined,
  addonId: HostingAddonId,
  nowMs: number = Date.now(),
): number {
  const rows = Array.isArray(wallet?.hostingAddons) ? wallet.hostingAddons : [];
  let n = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Partial<HostingAddonRecord>;
    if (r.addonId !== addonId || typeof r.expiresAt !== 'string') continue;
    const exp = Date.parse(r.expiresAt);
    if (Number.isFinite(exp) && exp > nowMs) n++;
  }
  return n;
}

export function activeAddonRows(
  wallet: { hostingAddons?: unknown } | null | undefined,
  nowMs: number = Date.now(),
): HostingAddonRecord[] {
  const rows = Array.isArray(wallet?.hostingAddons) ? wallet.hostingAddons : [];
  const out: HostingAddonRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Partial<HostingAddonRecord>;
    if (!validAddonRef(r.ref) || !addonById(r.addonId) || typeof r.expiresAt !== 'string') continue;
    const exp = Date.parse(r.expiresAt);
    if (!Number.isFinite(exp) || exp <= nowMs) continue;
    out.push(r as HostingAddonRecord);
  }
  return out;
}
