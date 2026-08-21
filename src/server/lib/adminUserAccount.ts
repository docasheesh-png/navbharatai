// One person's whole account, as an admin needs to read it before acting on a report.
//
// ADMIN 2026-08-21: "admin jab kisi user ki profile open kare to use user ka pura khata dekh sake —
// kitne apps banaye hai, kitne token hai, per app kitne token kharch houe hai, kitni bar real ₹
// recharge kiya hai, admin kisi suspecius activity dekhe to block kar sake."
//
// 🔒 THE RULE THIS FILE IS BUILT AROUND: A NUMBER WE COULD NOT READ IS NOT ZERO.
//
// This screen ends in a decision to suspend somebody's account. If a query fails and the page shows
// "0 recharges", an admin looking at a complaint sees a person who never paid us a rupee — and acts
// accordingly. The same failure showing "1 app built" instead of eleven makes a heavy user look like a
// throwaway account. So every section carries whether it was actually READ, and an unread section says
// so on the screen instead of rendering a confident zero. This is the difference between a dashboard
// and a dashboard you can act on.
//
// Everything here is pure: it takes rows and returns totals, so the arithmetic that an admin will
// trust is testable without a database.

export interface BuildRow {
  sessionId?: string;
  title?: string;
  costInr?: number;
  status?: string;
  tier?: string;
  createdAt?: number;
  fileCount?: number;
}

export interface PaymentRow {
  amountPaid?: number;
  paymentStatus?: string;
  createdAt?: string;
}

/** One app (a v5 session), with everything the user spent on it across all its builds. */
export interface AppSpend {
  sessionId: string;
  /** The first build's title — what the user called it. Never invented. */
  title: string;
  builds: number;
  failed: number;
  /** ₹ actually charged for this app, across every build of it. */
  spentInr: number;
  lastAt: number;
}

export interface BuildsSummary {
  totalBuilds: number;
  completed: number;
  failed: number;
  cancelled: number;
  spentInr: number;
  /** Per APP, not per build — one app is many builds, and "per app kitna kharch" is the real question. */
  apps: AppSpend[];
}

/**
 * Group a user's builds into apps.
 *
 * ⚠️ THE HONEST UNIT IS ₹, NOT TOKENS. The build history records what the user was CHARGED (costInr);
 * it does not store a token count per build. Rupees are also the number that matters here — it is what
 * left their wallet. Presenting a token figure would mean deriving one from a rate that changes, and
 * an invented number on a screen that ends in a ban is exactly what this codebase forbids.
 */
export function summariseBuilds(rows: BuildRow[]): BuildsSummary {
  const apps = new Map<string, AppSpend>();
  let completed = 0, failed = 0, cancelled = 0, spentInr = 0;

  for (const r of rows) {
    const cost = Number.isFinite(r.costInr) ? Number(r.costInr) : 0;
    spentInr += cost;
    if (r.status === 'completed') completed++;
    else if (r.status === 'failed') failed++;
    else if (r.status === 'cancelled') cancelled++;

    // A build with no session id still belongs to the person, so it is counted in the totals — it
    // simply cannot be attributed to one app. Dropping it would make the app rows disagree with the
    // total, which is worse than an "unknown" row.
    const key = String(r.sessionId || '').trim() || '(unattributed)';
    const at = Number.isFinite(r.createdAt) ? Number(r.createdAt) : 0;
    const existing = apps.get(key);
    if (existing) {
      existing.builds++;
      if (r.status === 'failed') existing.failed++;
      existing.spentInr += cost;
      if (at > existing.lastAt) existing.lastAt = at;
    } else {
      apps.set(key, {
        sessionId: key,
        title: String(r.title || '').trim() || 'Untitled app',
        builds: 1,
        failed: r.status === 'failed' ? 1 : 0,
        spentInr: cost,
        lastAt: at,
      });
    }
  }

  return {
    totalBuilds: rows.length,
    completed,
    failed,
    cancelled,
    spentInr: round2(spentInr),
    apps: [...apps.values()]
      .map((a) => ({ ...a, spentInr: round2(a.spentInr) }))
      .sort((a, b) => b.lastAt - a.lastAt),
  };
}

export interface PaymentsSummary {
  /** How many times real money actually arrived. Pending and failed orders are NOT recharges. */
  successful: number;
  /** Orders that were started and never completed — useful context, never counted as money. */
  unfinished: number;
  totalInr: number;
  lastAt: number | null;
}

/**
 * Count real recharges.
 *
 * Only `SUCCESS` counts. A created order is not a payment — treating one as money would overstate what
 * a user has paid us, and this figure is read while deciding whether someone is worth trusting.
 */
export function summarisePayments(rows: PaymentRow[]): PaymentsSummary {
  let successful = 0, unfinished = 0, totalInr = 0, lastAt: number | null = null;
  for (const r of rows) {
    const paid = Number.isFinite(r.amountPaid) ? Number(r.amountPaid) : 0;
    if (String(r.paymentStatus || '').toUpperCase() === 'SUCCESS') {
      successful++;
      totalInr += paid;
      const t = Date.parse(String(r.createdAt || ''));
      if (Number.isFinite(t) && (lastAt === null || t > lastAt)) lastAt = t;
    } else {
      unfinished++;
    }
  }
  return { successful, unfinished, totalInr: round2(totalInr), lastAt };
}

/**
 * Things worth a second look before an admin decides. NOT accusations, and deliberately few.
 *
 * A long list of amber flags trains an admin to ignore all of them. These three are the ones that
 * actually change a judgement: someone spending with no payment history at all, an unusual rate of
 * failed builds, and an account that has been reported by several different people.
 */
export function accountFlags(input: {
  builds: BuildsSummary;
  payments: PaymentsSummary;
  reportsAgainst: number;
}): string[] {
  const flags: string[] = [];
  if (input.builds.spentInr > 500 && input.payments.successful === 0) {
    flags.push('Has spent ₹500+ without ever completing a payment — check how the balance was obtained.');
  }
  if (input.builds.totalBuilds >= 10 && input.builds.failed / input.builds.totalBuilds > 0.6) {
    flags.push('More than 60% of builds failed — either a stuck account or automated use.');
  }
  if (input.reportsAgainst >= 3) {
    flags.push(`${input.reportsAgainst} separate reports name this account.`);
  }
  return flags;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
