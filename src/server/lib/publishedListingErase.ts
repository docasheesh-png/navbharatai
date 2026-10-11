// WHAT ACCOUNT DELETION DOES TO AN APP SOMEBODY ELSE PAID FOR (Q-766, with Q-682's last four items).
//
// 🔴 THE PROBLEM, AND WHY IT WAS A DECISION RATHER THAN A BUG. Three stores are keyed to one person and
// all three survived account deletion: `gallery_apps`, `nav_store_apps` and `nav_store_web_apps`, each
// by a plain `uid` field. Registering them as ordinary erases would have been one line — and wrong,
// because they are PUBLIC LISTINGS and an App Mart app can be BOUGHT. Terms §4 makes such a purchase
// non-refundable *"because every such app can be run free before buying"*. Deleting a listing because
// its AUTHOR closed their account would take away something a stranger had paid for and cannot get
// back. So the row recorded the options and waited, which is what the sixth rule asks for.
//
// ✅ THE ADMIN ANSWERED on 2026-10-09 ("sabhi Q complete karo" — complete every row), which is the
// row's own requested input, and its recommendation (b) stands: **erase what was never public, and
// UNLIST + DE-IDENTIFY what was.** The author's personal link goes; the buyer's purchase survives.
// It is the reasoning that already keeps `gift_codes` out of the eraser — value sitting in SOMEBODY
// ELSE's hands is not the departing account's to destroy.
//
// 🔎 TWO FACTS FOUND WHILE IMPLEMENTING IT, which REFINE that recommendation rather than restate it —
// both read off the code, neither assumed:
//
//   1. **`unlisted` still SERVES.** `routes/navStore.ts` 404s a web app only when
//      `status === 'removed'`; an `unlisted` app still opens for anyone holding the link. So "unlist"
//      really does preserve a buyer's access, which is the whole point of recommendation (b). Moving a
//      listing to `removed` would have satisfied the words and broken the purpose.
//   2. **`gallery_apps` and `nav_store_apps` carry no `priceInr` at all** — nothing in either store can
//      be bought, and both serve ONLY an `approved` listing. So the "a stranger paid for it" argument,
//      which is the entire basis of recommendation (b), applies to the web store alone. They are still
//      de-identified rather than hard-deleted when they were public, because a public listing may be
//      linked from elsewhere and a de-identified record holds no personal data — the erasure duty is
//      satisfied by removing the person, not the pixels.
//
// 🔒 WHAT "DE-IDENTIFIED" MEANS HERE, FIELD BY FIELD, because a vague answer would leave real identity
// behind. Each store carries MORE than a uid, and that was the thing worth checking:
//   · `gallery_apps`        — `authorEmail` and `authorName`, both on the listing record.
//   · `nav_store_apps`      — a whole `developer` block: name, EMAIL, phone, website.
//   · `nav_store_web_apps`  — `workspaceId`, which is `agentv3-{uid}-…` and so CONTAINS the uid.
// The uid field itself becomes `CREATOR_GONE`, a tombstone rather than an empty string, so that every
// reader can tell "no creator" apart from "creator not loaded yet" — and so the purchase path can
// refuse (see below) instead of crediting a wallet that no longer exists.
//
// 🔴 AND THE MONEY PATH HAD TO CLOSE WITH IT. A paid listing whose creator is gone would still be
// purchasable: `settleRemixPurchase` debits the buyer and credits `creatorUid`. Credit a tombstone and
// NavBharatAI has taken a stranger's money for a person who cannot be paid. `creatorHasLeft` is what
// the purchase path asks before any money moves.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

/**
 * The value a departed creator's uid field is set to.
 *
 * A sentinel, not `''` or a delete: a reader must be able to distinguish "this app has no creator any
 * more" from "the creator field was not loaded". It also can never equal a real Firebase uid (28
 * characters of [A-Za-z0-9]), so no live account can be mistaken for a departed one.
 */
export const CREATOR_GONE = '__deleted_account__';

/** Has this listing's creator deleted their account? PURE. */
export function creatorHasLeft(uid: unknown): boolean {
  return String(uid ?? '') === CREATOR_GONE;
}

export interface ListingPolicy {
  collection: string;
  uidField: string;
  /** Fields holding the author's identity. Removed when the listing is kept. */
  personalFields: readonly string[];
  statusField: string;
  /** Statuses that were never public and can have no buyer — the listing is deleted outright. */
  deleteWhenStatusIn: readonly string[];
  /** Where a listing that WAS public moves to: out of the catalogue, still served if it was bought. */
  unlistTo: string;
  /** Subcollections page-deleted BEFORE a listing that is being deleted. Firestore does not cascade. */
  subs?: readonly string[];
  why: string;
}

/**
 * ⚠️ EVERY FIELD BELOW WAS READ AT ITS OWN STORE, never inferred from a name — the same discipline the
 * erase registries hold themselves to, and the reason this file took reading rather than typing.
 */
export const LISTING_POLICIES: readonly ListingPolicy[] = [
  {
    collection: 'gallery_apps',
    uidField: 'uid',
    // `galleryStore.ts:36-37` — both on the record, and the email is admin-only in `toPublic` but
    // stored in the clear regardless, which is what matters for an erasure duty.
    personalFields: ['authorEmail', 'authorName'],
    statusField: 'status',
    // `GalleryStatus`: pending → never seen by anyone; rejected → refused. Neither was ever public and
    // neither can be bought (there is no price in this store at all), so there is nothing to preserve.
    deleteWhenStatusIn: ['pending', 'rejected'],
    unlistTo: 'removed',
    why: 'a code-gallery listing; not purchasable, and only an `approved` one is served',
  },
  {
    collection: 'nav_store_apps',
    uidField: 'uid',
    // `navStoreStore.ts` — `DeveloperDetails { name, email, phone?, website? }`. The heaviest identity
    // of the three, and the reason "de-identify" could not just mean "blank the uid".
    personalFields: ['developer'],
    statusField: 'status',
    deleteWhenStatusIn: ['pending', 'rejected'],
    unlistTo: 'removed',
    why: 'an APK submission; not purchasable, and only an `approved` one is served',
  },
  {
    collection: 'nav_store_web_apps',
    uidField: 'uid',
    // `workspaceId` is `agentv3-{uid}-…`, so leaving it would leave the uid in the record under another
    // name — exactly the composite-id class Q-762 was about.
    personalFields: ['workspaceId'],
    statusField: 'status',
    /**
     * 🔒 DELIBERATELY EMPTY, and this is the one judgement in the file that is mine rather than read
     * off the code. `WebAppStatus` is `'unlisted' | 'listed' | 'removed'`, and an app is CREATED
     * unlisted (`routes/navStore.ts:788`) — so `unlisted` means either "never published" or
     * "published and then hidden", and the two are indistinguishable from the record. A hidden app can
     * have buyers. Deleting on an ambiguous state would destroy a purchase to save storage, so nothing
     * in this store is ever deleted by an account erase; it is de-identified and unlisted.
     */
    deleteWhenStatusIn: [],
    unlistTo: 'unlisted',
    subs: ['files', 'baked', 'screenshots'],
    why: 'the purchasable store (`priceInr`): a buyer keeps what they paid for, so the record stays and '
      + 'only the person leaves',
  },
];

export interface ListingEraseResult {
  collection: string;
  /** Listings deleted outright (never public, no possible buyer). */
  deleted: number;
  /** Listings kept but stripped of their author, and unlisted if they were public. */
  deIdentified: number;
  /** Documents removed from a deleted listing's subcollections. */
  children: number;
  error?: string;
}
export interface ListingEraseReport {
  uid: string;
  collections: ListingEraseResult[];
  totalDeleted: number;
  totalDeIdentified: number;
}

const PAGE = 300;
const MAX_PAGES = 200;

function db(): admin.firestore.Firestore | null {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    return getServerDb();
  } catch {
    return null;
  }
}

/** The Firestore surface this needs. Satisfied by firebase-admin and by the test fake. */
export interface ListingFirestore {
  collection(name: string): {
    where(field: string, op: '==', value: unknown): {
      get(): Promise<{
        docs: Array<{
          id: string;
          data(): Record<string, unknown>;
          ref: {
            update(patch: Record<string, unknown>): Promise<unknown>;
            delete(): Promise<unknown>;
            collection?(sub: string): { limit(n: number): { get(): Promise<{ docs: Array<{ ref: { delete(): Promise<unknown> } }> }> } };
          };
        }>;
      }>;
    };
  };
}

/**
 * De-identify (or, where nothing was ever public, delete) every listing this person published.
 *
 * Best-effort per collection, like every other eraser here: one failing store is recorded and the rest
 * still run, so a flaky index cannot leave the remainder of somebody's identity in the database.
 * Throws only on an empty uid — a blank key would match the wrong rows, and this writes.
 */
export async function deIdentifyPublishedListings(
  store: ListingFirestore,
  uid: string,
  policies: readonly ListingPolicy[] = LISTING_POLICIES,
): Promise<ListingEraseReport> {
  if (!uid || typeof uid !== 'string') {
    throw new Error('deIdentifyPublishedListings: a non-empty uid is required.');
  }
  const collections: ListingEraseResult[] = [];
  for (const policy of policies) {
    let deleted = 0;
    let deIdentified = 0;
    let children = 0;
    try {
      const snap = await store.collection(policy.collection).where(policy.uidField, '==', uid).get();
      for (const doc of snap.docs) {
        const row = doc.data() ?? {};
        const status = String(row[policy.statusField] ?? '');
        if (policy.deleteWhenStatusIn.includes(status)) {
          // CHILDREN FIRST — Firestore does not cascade, and a listing's bytes live one level down.
          for (const sub of policy.subs ?? []) {
            if (typeof doc.ref.collection !== 'function') {
              throw new Error(`${policy.collection}: this handle cannot reach the '${sub}' subcollection`);
            }
            for (let page = 0; page < MAX_PAGES; page++) {
              const kids = await doc.ref.collection(sub).limit(PAGE).get();
              if (kids.docs.length === 0) break;
              for (const kd of kids.docs) { await kd.ref.delete(); children++; }
              if (kids.docs.length < PAGE) break;
            }
          }
          await doc.ref.delete();
          deleted++;
          continue;
        }
        /**
         * Kept, and stripped. The patch is built explicitly rather than by spreading the row back:
         * a spread would re-write every field we just read, and a concurrent edit between the read and
         * the write would be silently reverted.
         */
        const patch: Record<string, unknown> = { [policy.uidField]: CREATOR_GONE, creatorDeletedAt: Date.now() };
        for (const field of policy.personalFields) patch[field] = null;
        // Only a listing that is CURRENTLY public is unlisted. One already out of the catalogue stays
        // where it is — moving it would change what a buyer can reach, for no privacy gain.
        if (status !== policy.unlistTo && status !== 'removed') patch[policy.statusField] = policy.unlistTo;
        await doc.ref.update(patch);
        deIdentified++;
      }
      collections.push({ collection: policy.collection, deleted, deIdentified, children });
    } catch (e) {
      collections.push({
        collection: policy.collection, deleted, deIdentified, children,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return {
    uid,
    collections,
    totalDeleted: collections.reduce((s, c) => s + c.deleted, 0),
    totalDeIdentified: collections.reduce((s, c) => s + c.deIdentified, 0),
  };
}

/** The production handle, or null under test / without a database. */
export function getListingDb(): ListingFirestore | null {
  const d = db();
  return d ? (d as unknown as ListingFirestore) : null;
}
