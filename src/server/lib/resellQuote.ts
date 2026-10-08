// RESELL QUOTE — whether a server or a database may be started, and whether it would cost anything.
//
// PURE. No wallet write, no Cloud Run, no Supabase. The route asks this BEFORE it spends a build
// minute or creates a project, and again the charge itself refuses without proof. A "yes" here is
// permission to try, never a bill.
//
// Included servers (the ones a Starter or Growth plan already paid for) are not billed again.
// An extra server is ₹149 only after it is live. A private database is ₹1,499 only after it is
// ready. Hosting it yourself, and your own Supabase, are not in this quote — they stay free from us.

import { addonById } from '../../lib/hostingAddons';

export interface ResellAddonRow {
  ref: string;
  proof?: string;
}

export interface ResellOption {
  mode: 'included' | 'addon' | 'unavailable';
  priceInr: number;
  /** What the user should be told. Never implies money already moved. */
  reason: string;
  /** True only when the paid path may start. Included and unavailable never start it. */
  canStart: boolean;
  /** Status to use when canStart is false. 200 when it is already included. */
  status: number;
  /**
   * Set when THIS app already holds a paid add-on. Stopping is a separate action that tears the
   * resource down first and only then returns unused days. Null means there is nothing paid to stop
   * (a plan server is taken down with the normal Unpublish control, which does not refund a plan).
   */
  stopRef: string | null;
}

export function serverAddonProof(workspaceId: string, url: string): string | null {
  const id = String(workspaceId ?? '').trim();
  const u = String(url ?? '').trim();
  if (id.length < 8 || u.length < 8 || id.includes(':')) return null;
  return `ws:${id}:${u}`;
}

export function workspaceIdFromServerProof(proof: string | null | undefined): string | null {
  if (!proof || !proof.startsWith('ws:')) return null;
  const body = proof.slice(3);
  const sep = body.indexOf(':');
  if (sep < 8) return null;
  const id = body.slice(0, sep);
  return id.includes(':') ? null : id;
}

export function databaseAddonProof(workspaceId: string, projectRef: string): string | null {
  const id = String(workspaceId ?? '').trim();
  const ref = String(projectRef ?? '').trim();
  if (id.length < 8 || id.includes(':') || !/^[A-Za-z0-9_-]{8,64}$/.test(ref)) return null;
  return `db:${id}:${ref}`;
}

export function projectRefFromDatabaseProof(proof: string | null | undefined): string | null {
  if (!proof || !proof.startsWith('db:')) return null;
  const body = proof.slice(3);
  const sep = body.indexOf(':');
  if (sep < 8) return null;
  const ref = body.slice(sep + 1);
  return /^[A-Za-z0-9_-]{8,64}$/.test(ref) ? ref : null;
}

/** One stable purchase id per app per 30-day window, so a double-click cannot buy two. */
export function stableResellRef(kind: 'server' | 'database', workspaceId: string, nowMs: number): string {
  const bucket = Math.floor(nowMs / (30 * 24 * 60 * 60 * 1000));
  // FNV-1a, 32-bit, hex — no node:crypto, so the browser can show the same id if it ever needs to.
  const raw = `${kind}:${workspaceId}:${bucket}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0');
  const prefix = kind === 'server' ? 'srv' : 'dbs';
  return `${prefix}${hex}${bucket.toString(36)}`.slice(0, 64);
}

function paidRowFor(rows: readonly ResellAddonRow[], covers: (proof: string) => boolean): ResellAddonRow | null {
  for (const row of rows) {
    if (row && typeof row.proof === 'string' && covers(row.proof) && typeof row.ref === 'string') return row;
  }
  return null;
}

function unavailable(priceInr: number, reason: string, status = 409): ResellOption {
  return { mode: 'unavailable', priceInr, reason, canStart: false, stopRef: null, status };
}

export function quoteServerResell(input: {
  plansOn: boolean;
  cloudAvailable: boolean;
  cloudMessage: string;
  isAdmin: boolean;
  planBackendApps: number;
  /** null = the registry could not be read. Fail closed for a NEW paid server. */
  liveWorkspaceIds: readonly string[] | null;
  workspaceId: string;
  /** null = the wallet could not be read. */
  active: readonly ResellAddonRow[] | null;
  /** null = the wallet could not be read. false = paid balance cannot cover the price. */
  canPay: boolean | null;
}): ResellOption {
  const spec = addonById('server');
  const price = spec?.priceInr ?? 0;
  const max = spec?.max ?? 0;
  const own = ' You can still host it yourself — that stays free from us.';
  if (!input.plansOn) return unavailable(price, 'Server add-ons are not available right now. Nothing was charged.' + own);
  if (!input.cloudAvailable && !input.isAdmin) {
    const why = input.cloudMessage.trim() || 'App hosting on NavBharatAI is not open yet.';
    return unavailable(price, `${why} Nothing was charged.${own}`);
  }
  if (input.liveWorkspaceIds === null || input.active === null || input.canPay === null) {
    return unavailable(price, 'We could not check your account just now, so an extra server was not started. Nothing was charged. Publish can still use a server your plan already includes. Or host it yourself.', 503);
  }
  const paid = paidRowFor(input.active, (p) => workspaceIdFromServerProof(p) === input.workspaceId);
  if (paid) {
    return {
      mode: 'included',
      priceInr: price,
      canStart: false,
      stopRef: paid.ref,
      status: 200,
      reason: 'This app already has a server you paid for. Updating it from Publish does not charge again. Stop it here to take the server down first — unused days come back only after it is down.',
    };
  }
  const live = [...new Set(input.liveWorkspaceIds.map((id) => String(id)))];
  const already = live.some((id) => id === input.workspaceId);
  if (already || input.isAdmin) {
    return {
      mode: 'included',
      priceInr: 0,
      canStart: false,
      stopRef: null,
      status: 200,
      reason: already
        ? 'This app already runs a server. Updating it does not cost extra. Nothing was charged.'
        : 'Nothing extra is charged on an admin account.',
    };
  }
  const cap = Number(input.planBackendApps);
  const planCap = Number.isFinite(cap) && cap > 0 ? cap : 0;
  if (live.length < planCap) {
    return {
      mode: 'included',
      priceInr: 0,
      canStart: false,
      stopRef: null,
      status: 200,
      reason: `This server is included in your plan (${live.length} of ${planCap} in use). Use Publish — ₹0 extra. Or host it yourself, which stays free from us.`,
    };
  }
  if (input.active.length >= max || max <= 0) {
    return unavailable(price, `You already have the maximum of ${max} extra server${max === 1 ? '' : 's'}. Stop one you no longer need, or host this one yourself. Nothing was charged.`);
  }
  if (!input.canPay) {
    return unavailable(price, `An extra server is ₹${price} for 30 days, taken from the money you added — and only after it is live. Your balance is not enough, so nothing was started. Your welcome gift cannot buy it.${own}`, 402);
  }
  return {
    mode: 'addon',
    priceInr: price,
    canStart: true,
    stopRef: null,
    status: 200,
    reason: `Your plan's servers are all in use. This extra one is ₹${price} for 30 days, taken only after it is live. If it does not come up, it is taken down and nothing is charged.${own}`,
  };
}

export function quoteDatabaseResell(input: {
  plansOn: boolean;
  configured: boolean;
  workspaceId: string;
  active: readonly ResellAddonRow[] | null;
  canPay: boolean | null;
}): ResellOption {
  const spec = addonById('dedicated_db');
  const price = spec?.priceInr ?? 0;
  const max = spec?.max ?? 0;
  const own = ' Connecting your own Supabase stays free from us.';
  if (!input.plansOn) return unavailable(price, 'Database add-ons are not available right now. Nothing was charged.' + own);
  if (!input.configured) {
    return unavailable(price, 'A database from NavBharatAI is not switched on yet. Nothing was charged.' + own);
  }
  if (input.active === null || input.canPay === null) {
    return unavailable(price, 'We could not check your account just now, so a database was not created. Nothing was charged.' + own, 503);
  }
  const paid = paidRowFor(input.active, (p) => {
    const ref = projectRefFromDatabaseProof(p);
    return !!ref && p.startsWith(`db:${input.workspaceId}:`);
  });
  if (paid) {
    return {
      mode: 'included',
      priceInr: price,
      canStart: false,
      stopRef: paid.ref,
      status: 200,
      reason: 'This app already has a NavBharatAI database. Nothing extra is charged. Remove it here to delete the database first — unused days come back only after it is gone.' + own,
    };
  }
  if (input.active.length >= max || max <= 0) {
    return unavailable(price, `You already have the maximum of ${max} database${max === 1 ? '' : 's'} from us. Remove one, or connect your own. Nothing was charged.`);
  }
  if (!input.canPay) {
    return unavailable(price, `A private database is ₹${price} for 30 days, taken only after it is ready. Your balance is not enough, so nothing was created. Your welcome gift cannot buy it.${own}`, 402);
  }
  return {
    mode: 'addon',
    priceInr: price,
    canStart: true,
    stopRef: null,
    status: 200,
    reason: `₹${price} is taken only after the database is ready and its keys are saved into this app. If that does not happen, the database is deleted and nothing is charged.${own}`,
  };
}
