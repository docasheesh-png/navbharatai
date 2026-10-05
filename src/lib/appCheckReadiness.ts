// WOULD SWITCHING APP CHECK TO "ENFORCE" LOCK ANYBODY OUT? (admin panel audit, PR 3, 2026-10-05)
//
// `GET /api/admin/app-check` has counted, per web and per phone app, how many guarded requests carried a
// valid App Check token since 2026-09-26 — and the rule recorded with it says to read those counts before
// setting APP_CHECK_MODE=enforce. No screen showed them, so that decision could only be made by guessing.
//
// This turns the raw counts into the one sentence the decision needs. PURE: no fetch, no React.

export type AppCheckOutcome = 'valid' | 'missing' | 'invalid' | 'unverifiable';
export type Counts = Record<AppCheckOutcome, number>;

export interface AppCheckStats {
  mode: 'off' | 'monitor' | 'enforce';
  siteKeyConfigured: boolean;
  since: string;
  scope: string;
  web: Counts;
  native: Counts;
  refused: number;
}

/** Read a server body as stats, or null when it is not that shape (a 403 body, an old server, junk). */
export function readAppCheckStats(body: unknown): AppCheckStats | null {
  const b = body as Partial<AppCheckStats> | null;
  const counts = (c: unknown): Counts | null => {
    const o = c as Partial<Counts> | null;
    if (!o || typeof o !== 'object') return null;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
    const valid = n(o.valid); const missing = n(o.missing); const invalid = n(o.invalid); const unverifiable = n(o.unverifiable);
    return valid === null || missing === null || invalid === null || unverifiable === null ? null : { valid, missing, invalid, unverifiable };
  };
  if (!b || typeof b !== 'object') return null;
  if (b.mode !== 'off' && b.mode !== 'monitor' && b.mode !== 'enforce') return null;
  const web = counts(b.web);
  const native = counts(b.native);
  if (!web || !native) return null;
  return {
    mode: b.mode,
    siteKeyConfigured: b.siteKeyConfigured === true,
    since: typeof b.since === 'string' ? b.since : '',
    scope: typeof b.scope === 'string' ? b.scope : '',
    web,
    native,
    refused: typeof b.refused === 'number' && b.refused >= 0 ? b.refused : 0,
  };
}

export interface ClientReadiness {
  seen: number;
  /** Requests enforce would refuse: no token, or a bad one. `unverifiable` (our verifier down) is never refused. */
  wouldRefuse: number;
  /** Share of seen requests carrying a valid token, 0–100, or null when nothing was seen. */
  validPct: number | null;
}

export function clientReadiness(c: Counts): ClientReadiness {
  const seen = c.valid + c.missing + c.invalid + c.unverifiable;
  return {
    seen,
    wouldRefuse: c.missing + c.invalid,
    validPct: seen > 0 ? Math.round((c.valid / seen) * 100) : null,
  };
}

export type ReadinessTone = 'ok' | 'warn' | 'danger' | 'unknown';

/** The verdict the admin reads before touching APP_CHECK_MODE. */
export function enforceVerdict(s: AppCheckStats): { tone: ReadinessTone; sentence: string } {
  const web = clientReadiness(s.web);
  const native = clientReadiness(s.native);
  const seen = web.seen + native.seen;
  const wouldRefuse = web.wouldRefuse + native.wouldRefuse;
  if (s.mode === 'enforce') {
    return s.refused > 0
      ? { tone: 'danger', sentence: `Enforcing now: ${s.refused} request(s) refused on this server since it started.` }
      : { tone: 'ok', sentence: 'Enforcing now, and nothing has been refused on this server since it started.' };
  }
  if (s.mode === 'off') return { tone: 'unknown', sentence: 'App Check is switched off, so nothing is checked or counted.' };
  if (!s.siteKeyConfigured) {
    return { tone: 'warn', sentence: 'The website has no App Check site key, so website requests cannot carry a token. Enforcing now would refuse every website request.' };
  }
  if (seen === 0) return { tone: 'unknown', sentence: 'No guarded request has reached this server since it started, so there is nothing to judge yet.' };
  if (wouldRefuse === 0) return { tone: 'ok', sentence: `Every one of the ${seen} guarded request(s) seen carried a valid token. Enforcing would have refused none of them.` };
  return {
    tone: 'danger',
    sentence: `Enforcing now would refuse ${wouldRefuse} of the ${seen} guarded request(s) seen on this server — those people would be locked out of the guarded actions.`,
  };
}
