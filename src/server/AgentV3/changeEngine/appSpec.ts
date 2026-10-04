// CHANGE ENGINE — the app's REQUIREMENT LEDGER: what this app has been asked to do, across every edit.
//
// WHY THIS EXISTS (Change Intelligence Engine, slice 1, 2026-10-04). Every check this engine runs
// against "what the user asked for" reads the CURRENT prompt only — `requestedFeatureLabels(prompt)`,
// `checkFeaturePresence(milestoneRequest ?? prompt, …)`, and `currentRequestForCoverage` returns the
// LAST request on purpose (report 1682cd03: re-grading the whole original spec on a micro-edit produced
// false findings). That was the right fix for a false-positive and it left a hole the size of the app:
// once the first build is over, nothing remembers that it had a Delete button. An edit that removes it
// is graded against "make the header blue", passes, and the user discovers the loss themselves.
//
// The ledger is the missing memory, and it is built from evidence this engine already produces rather
// than from a model's opinion:
//   • an item is CREATED from the user's own words (the same negation-aware feature table the build is
//     already told to build and graded on — FeaturePresence's probe ids);
//   • an item becomes VERIFIED only when a real browser saw its control in the running app
//     (`FeatureProbeResult.present === true` with `via: 'control'` — prose never verifies anything);
//   • a VERIFIED item probed ABSENT on a later build is REGRESSED — the one finding a micro-edit can
//     honestly raise about the whole app, because it is not "you never built this", it is "this was
//     here, we saw it, and now it is gone".
//
// Stable ids (REQ-001, REQ-002, …) are never reused or renumbered, so a change record, an issue and a
// requirement can point at each other across months of edits.
//
// PURE. Every function takes a ledger and returns a new one; nothing here touches I/O.

/**
 * `built` (slice 3) is weaker than `verified` and is named so: a requirement the platform cannot probe in a
 * browser (a coupon box, an order-history page) is `built` once the build that asked for it passed its
 * release gate. It is never claimed as seen working, and it can never be called regressed.
 */
export type SpecStatus = 'requested' | 'built' | 'verified' | 'regressed' | 'dropped';

export interface SpecItem {
  /** Stable id, never reused: REQ-001. */
  id: string;
  /** The FeaturePresence probe id (e.g. 'delete'). The key that makes runtime verification possible. */
  feature: string;
  /** Human label, platform-authored (never the user's raw text — see the security note in store). */
  label: string;
  status: SpecStatus;
  /** The change (CHG id) that first asked for it. */
  firstChange: string;
  /** The change that last touched its status. */
  lastChange: string;
  /** ms epoch of the last time a real browser saw its control. */
  verifiedAt?: number;
  /** False for a requirement no browser probe can judge (slice 3). Absent = probe-able. */
  probeable?: false;
}

/** Ledger key for a requirement that is a platform feature-table LABEL rather than a probe id. */
export function labelKey(label: string): string {
  return `label:${String(label || '').replace(/\s+/g, ' ').trim().slice(0, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}`;
}

export interface AppSpec {
  items: SpecItem[];
  /** Monotonic counter behind REQ ids — survives deletions so an id is never reused. */
  nextReq: number;
}

export const EMPTY_SPEC: AppSpec = Object.freeze({ items: [], nextReq: 1 }) as AppSpec;

/** Bound so a ledger can never grow a Firestore document past its limit. */
export const MAX_SPEC_ITEMS = 120;

export function reqId(n: number): string {
  return `REQ-${String(n).padStart(3, '0')}`;
}

/** Defensive parse of a stored ledger — corrupt storage becomes an empty ledger, never a half one. */
export function parseAppSpec(raw: unknown): AppSpec {
  if (!raw || typeof raw !== 'object') return { items: [], nextReq: 1 };
  const r = raw as { items?: unknown; nextReq?: unknown };
  const items: SpecItem[] = [];
  const statuses = new Set<SpecStatus>(['requested', 'built', 'verified', 'regressed', 'dropped']);
  for (const it of Array.isArray(r.items) ? r.items : []) {
    if (!it || typeof it !== 'object') continue;
    const i = it as Record<string, unknown>;
    if (typeof i.id !== 'string' || typeof i.feature !== 'string' || typeof i.label !== 'string') continue;
    if (!statuses.has(i.status as SpecStatus)) continue;
    items.push({
      id: i.id, feature: i.feature, label: i.label, status: i.status as SpecStatus,
      firstChange: typeof i.firstChange === 'string' ? i.firstChange : '',
      lastChange: typeof i.lastChange === 'string' ? i.lastChange : '',
      ...(typeof i.verifiedAt === 'number' ? { verifiedAt: i.verifiedAt } : {}),
      ...(i.probeable === false ? { probeable: false as const } : {}),
    });
  }
  const maxSeen = items.reduce((m, it) => Math.max(m, Number(it.id.replace(/^REQ-/, '')) || 0), 0);
  const nextReq = typeof r.nextReq === 'number' && r.nextReq > maxSeen ? Math.floor(r.nextReq) : maxSeen + 1;
  return { items: items.slice(0, MAX_SPEC_ITEMS), nextReq };
}

/**
 * Fold the features THIS request asked for into the ledger. A feature already in the ledger is not
 * duplicated; a DROPPED one asked for again comes back as requested (same id). Declined features (the
 * user unticked them on the feature card) are marked dropped, never deleted — the id stays meaningful.
 */
export function foldRequestedFeatures(
  spec: AppSpec,
  requested: ReadonlyArray<{ feature: string; label: string }>,
  changeId: string,
  declined: ReadonlySet<string> = new Set(),
): AppSpec {
  const items = spec.items.map((i) => ({ ...i }));
  let nextReq = spec.nextReq;
  for (const r of requested) {
    if (!r || typeof r.feature !== 'string' || !r.feature) continue;
    const existing = items.find((i) => i.feature === r.feature);
    if (declined.has(r.feature)) {
      if (existing && existing.status !== 'dropped') { existing.status = 'dropped'; existing.lastChange = changeId; }
      continue;
    }
    if (existing) {
      if (existing.status === 'dropped') { existing.status = 'requested'; existing.lastChange = changeId; }
      continue;
    }
    if (items.length >= MAX_SPEC_ITEMS) break;
    items.push({ id: reqId(nextReq++), feature: r.feature, label: r.label, status: 'requested', firstChange: changeId, lastChange: changeId });
  }
  return { items, nextReq };
}

export interface ProbeOutcome {
  feature: string;
  present: boolean;
  via?: 'control' | 'text';
}

export interface ProbeFold {
  spec: AppSpec;
  /** Items that moved to verified on this pass. */
  verified: SpecItem[];
  /** Items that were verified before and are now gone. */
  regressed: SpecItem[];
  /** Regressed items that came back. */
  restored: SpecItem[];
}

/**
 * Fold a browser probe into the ledger. Only CONTROL evidence verifies — a word in a paragraph is not a
 * feature. A missing probe regresses an item only if that item was VERIFIED before; a requested item
 * that was never seen stays requested (that is "not built yet", which the existing coverage check
 * already reports — this module must not say it twice).
 */
export function foldProbeResults(
  spec: AppSpec,
  probes: ReadonlyArray<ProbeOutcome>,
  changeId: string,
  now: number,
): ProbeFold {
  const items = spec.items.map((i) => ({ ...i }));
  const verified: SpecItem[] = [];
  const regressed: SpecItem[] = [];
  const restored: SpecItem[] = [];
  for (const p of probes) {
    const it = items.find((i) => i.feature === p.feature);
    if (!it || it.status === 'dropped' || it.probeable === false) continue;
    if (p.present && p.via === 'control') {
      if (it.status === 'regressed') restored.push(it);
      else if (it.status === 'requested') verified.push(it);
      it.status = 'verified';
      it.verifiedAt = now;
      it.lastChange = changeId;
    } else if (!p.present && it.status === 'verified') {
      it.status = 'regressed';
      it.lastChange = changeId;
      regressed.push(it);
    }
  }
  return { spec: { items, nextReq: spec.nextReq }, verified, regressed, restored };
}

/**
 * Fold the feature LABELS this request asked for (the contract the builder is handed — the user's named
 * features and the suggestions they ticked) into the ledger as non-probe-able requirements. A label the
 * probe table already covers is skipped, so one requirement is never recorded twice.
 * `alreadyProbed(label)` returns true when the label maps to probe ids that are already items.
 */
export function foldRequestedLabels(
  spec: AppSpec,
  labels: ReadonlyArray<string>,
  changeId: string,
  alreadyProbed: (label: string) => boolean = () => false,
): AppSpec {
  const items = spec.items.map((i) => ({ ...i }));
  let nextReq = spec.nextReq;
  for (const raw of labels) {
    const label = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!label || alreadyProbed(label)) continue;
    const key = labelKey(label);
    const existing = items.find((i) => i.feature === key);
    if (existing) {
      if (existing.status === 'dropped') { existing.status = 'requested'; existing.lastChange = changeId; }
      continue;
    }
    if (items.length >= MAX_SPEC_ITEMS) break;
    items.push({ id: reqId(nextReq++), feature: key, label, status: 'requested', firstChange: changeId, lastChange: changeId, probeable: false });
  }
  return { items, nextReq };
}

/** Mark the given non-probe-able requirements BUILT — only ever called for a build that passed its gate. */
export function markLabelsBuilt(spec: AppSpec, keys: ReadonlyArray<string>, changeId: string): { spec: AppSpec; built: SpecItem[] } {
  const want = new Set(keys);
  const built: SpecItem[] = [];
  const items = spec.items.map((i) => {
    if (i.probeable === false && want.has(i.feature) && i.status === 'requested') {
      const n = { ...i, status: 'built' as const, lastChange: changeId };
      built.push(n);
      return n;
    }
    return i;
  });
  return { spec: { items, nextReq: spec.nextReq }, built };
}

/** Mark ledger items DROPPED on purpose (the user asked to remove them). Ids are kept. Pure. */
export function dropItems(spec: AppSpec, ids: ReadonlyArray<string>, changeId: string): AppSpec {
  const want = new Set(ids);
  return {
    nextReq: spec.nextReq,
    items: spec.items.map((i) => (want.has(i.id) && i.status !== 'dropped' ? { ...i, status: 'dropped' as const, lastChange: changeId } : i)),
  };
}

/**
 * The features to re-probe on THIS build even though this request did not name them: everything the
 * app was seen to do before. This is what makes an edit answerable for the whole app, not only for the
 * sentence that started it.
 */
export function regressionProbeFeatures(spec: AppSpec): string[] {
  return spec.items.filter((i) => i.probeable !== false && (i.status === 'verified' || i.status === 'regressed')).map((i) => i.feature);
}

/**
 * The builder-facing block. '' when the ledger holds nothing worth saying. `depth` comes from the change
 * classifier: a micro change gets one line, a deep change gets the list and an instruction.
 */
export function renderSpecForBuilder(spec: AppSpec, depth: 'light' | 'standard' | 'deep'): string {
  const live = spec.items.filter((i) => i.status !== 'dropped');
  if (live.length === 0) return '';
  const verified = live.filter((i) => i.status === 'verified');
  const regressed = live.filter((i) => i.status === 'regressed');
  const pending = live.filter((i) => i.status === 'requested');
  const built = live.filter((i) => i.status === 'built');
  if (depth === 'light') {
    return `App requirements on record: ${live.length} (${verified.length} verified working). Keep every one of them working — this change must not remove any.`;
  }
  const line = (i: SpecItem) => `  • ${i.id} ${i.label} — ${i.status === 'verified' ? 'verified working in the running app' : i.status === 'regressed' ? 'WAS working, missing on the last check — restore it' : i.status === 'built' ? 'built by an earlier change' : 'requested, not yet seen working'}`;
  const out: string[] = ['APP REQUIREMENTS ON RECORD (from this app\'s earlier requests and checks — keep every one working):'];
  for (const i of [...regressed, ...verified, ...built, ...pending].slice(0, 25)) out.push(line(i));
  if (depth === 'deep') {
    out.push('');
    out.push('This change reaches across the app. Before editing, name which of the requirements above it touches, and after editing make sure each of them still works. A requirement you remove by accident is a broken app, even if the new change works.');
  }
  return out.join('\n');
}
