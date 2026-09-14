// Admin-only triage for the "All builds — every user, no submit needed" list (admin 2026-09-14).
//
// THE INCIDENT THIS EXISTS FOR, in the admin's own words: *"abhi ek hi report 2 agent ko send kar di!
// dono ne fix ki, aur dono ki PR apas me 2 hr tak conflict kari rahi!!"* — build `1ef27cd7` went to two
// sessions, which produced PRs #2929 and #2931 autopsying the same report, conflicting with each other
// for two hours until one was reduced to a fragment of itself. Neither session could have known: the
// All-builds list showed no sign that a row had already been handed out.
//
// The USER-SUBMITTED inbox has had exactly this mark since 2026-08-12 (AdminBuildReportStore + the
// `📤 Downloaded` badge). The All-builds list — which is where the admin actually picks reports from,
// because it does not need the user to press anything — never got it. This is that same mark, for that
// list, deliberately reusing `reportTriage.ts` rather than inventing a second vocabulary: one meaning
// of "sent", one meaning of "fixed", both already test-locked.
//
// 🔑 KEYED BY workspaceId, WHICH IS THE ROW THE ADMIN LOOKS AT — not by buildId.
// The All-builds list shows one row per workspace, and both of its buttons ("⧉ Copy session",
// "⬇ Full session") hand over the WHOLE session. A per-build key would leave the row itself unmarked,
// which is the only place the duplicate could have been noticed. Downloading ONE build from inside an
// expanded row therefore also marks its session: from that moment somebody is working on that
// workspace, and that is the fact worth showing.
//
// ⚠️ COPY MARKS IT TOO, not only Download. The admin's phrasing says "download", but the row's other
// button copies the identical JSON to the clipboard, and a report pasted into a chat has left the
// admin's hands exactly as much as one saved to disk. Marking only Download would leave the commonest
// path on a phone unmarked — and this whole feature is a no-op the moment it can be bypassed.
//
// What the badge claims is unchanged from reportTriage.ts and is deliberately modest: `sent` means
// "this left my inbox", NOT "someone is fixing it". We know the first; we cannot know the second.
//
// Collection: `admin_build_triage`  ·  Doc ID: the workspaceId, sanitised.
// Pattern mirrors AdminApkReportStore.ts: firebase-admin, VITEST-skip, best-effort, never throws — a
// failure here must never break the list it decorates.

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { applyReportMark, type ReportTriage } from './reportTriage';

const COLLECTION = 'admin_build_triage';

/** Bounded read — the panel fetches at most a few hundred rows at a time. */
export const BUILD_TRIAGE_MAX_KEYS = 500;

let _db: admin.firestore.Firestore | null = null;
function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = getServerDb();
    return _db;
  } catch {
    return null;
  }
}

/**
 * The Firestore document id for a workspace's triage.
 *
 * Sanitised because a workspaceId becomes a document id, and a `/` in one would silently create a
 * NESTED PATH rather than a document — the row would be written somewhere the read never looks, and
 * the mark would appear to save and then vanish. Real workspace ids are already safe
 * (`agentv3-<uid>-<uuid>`); this guards the ones that are not.
 */
export function buildTriageDocId(workspaceId: string): string {
  return String(workspaceId ?? '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 400);
}

/** Only the triage fields — never echo back whatever else a legacy document happens to carry. */
function readTriage(data: unknown): ReportTriage {
  const d = (data ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  return {
    downloadedAt: num(d.downloadedAt),
    fixedAt: num(d.fixedAt),
    fixedNote: typeof d.fixedNote === 'string' && d.fixedNote.trim() ? d.fixedNote.trim() : null,
  };
}

/**
 * The triage marks for a set of workspaces, as a map. One batched read, never one per row: the list
 * renders up to 500 rows and the admin refreshes it constantly.
 *
 * Returns an EMPTY map when the store is unavailable — the list then draws no badges, which is the
 * honest degradation. Inventing "not taken" would be the same claim, but it would be a claim.
 */
export async function getBuildTriage(workspaceIds: ReadonlyArray<string>): Promise<Map<string, ReportTriage>> {
  const out = new Map<string, ReportTriage>();
  const db = getDb();
  if (!db) return out;
  const ids = [...new Set((workspaceIds ?? []).map((w) => String(w ?? '').trim()).filter(Boolean))].slice(0, BUILD_TRIAGE_MAX_KEYS);
  if (ids.length === 0) return out;
  try {
    // getAll takes refs, so this is ONE round trip however many ids there are — and it returns a
    // miss as a non-existent snapshot rather than throwing, so an untouched row needs no special case.
    const refs = ids.map((id) => db.collection(COLLECTION).doc(buildTriageDocId(id)));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap, i) => {
      if (!snap.exists) return;
      out.set(ids[i], readTriage(snap.data()));
    });
  } catch { /* best-effort — a failed read draws no badges rather than breaking the list */ }
  return out;
}

/**
 * Merge a mark onto one workspace's triage and return what was actually PERSISTED.
 *
 * Returns `null` when nothing could be written, so the panel can say so instead of drawing a badge
 * from an optimistic guess — the same rule the user-report inbox already follows, and the reason it
 * exists: a badge showing "taken" on a write that silently failed would send the next agent to the
 * same report, which is precisely the bug being fixed.
 */
export async function markBuildTriage(
  workspaceId: string,
  mark: { downloaded?: boolean | undefined; fixed?: boolean | undefined; note?: string | null },
  now: number = Date.now(),
): Promise<ReportTriage | null> {
  const id = String(workspaceId ?? '').trim();
  if (!id) return null;
  const db = getDb();
  if (!db) return null;
  try {
    const ref = db.collection(COLLECTION).doc(buildTriageDocId(id));
    const snap = await ref.get();
    const next = applyReportMark(snap.exists ? readTriage(snap.data()) : null, mark, now);
    // `set` with merge:false — the document holds nothing but these three fields plus its key, so a
    // full write is the whole truth and cannot leave a stale `fixedNote` behind after a clear.
    await ref.set({ workspaceId: id, ...next, updatedAt: now });
    return next;
  } catch {
    return null;
  }
}
