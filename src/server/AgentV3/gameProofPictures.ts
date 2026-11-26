/**
 * 🖼️ GAME_PROOF's PICTURES, KEPT PRIVATELY FOR 30 DAYS SO THE ADMIN REPORT CAN SHOW THEM (Q-3363, admin 2026-11-26,
 * option A).
 *
 * WHAT WAS MISSING. The playtest takes up to three small JPEGs of a game (start, after moving, far view — PROOF_PICTURES
 * in gamePlaytest.ts) and writes them only inside the sandbox. GAME_PROOF could NAME each picture, but once the sandbox
 * was recycled nobody could SEE one, so "what did the game look like?" stayed a claim in words.
 *
 * WHAT THIS DOES.
 *  - `keepProofPictures` copies each picture the playtest reported out of the sandbox into NavBharatAI's EXISTING private
 *    bucket (the workspace-asset bucket, `workspaceAssetBucketName` — no new bucket, no public ACL), under
 *    `game-proof-v1/<YYYY-MM-DD>/<buildId>/<view>-<id>.jpg`. Every picture is checked before it is stored: a JPEG, at
 *    most MAX_PICTURE_BYTES, and its bytes hash to the content id the playtest printed (so the stored picture is the one
 *    the report describes, never a truncated or swapped file). At most three a build (MAX_BUILD_BYTES in all).
 *  - 30 DAYS, BY A DELETE-AFTER SWEEP. A bucket lifecycle rule is bucket configuration, and the server deliberately
 *    never mutates bucket infrastructure (gameAssets/objectStore.ts says the same), so the day in the key IS the expiry:
 *    `sweepExpiredProofPictures` lists the day folders and deletes every one older than RETAIN_DAYS. It runs after a
 *    build keeps pictures (at most once per SWEEP_EVERY_MS per instance), and the admin route refuses an expired key
 *    whether or not the sweep has reached it yet. A bucket lifecycle rule on the prefix (age 30) is a welcome belt, set
 *    in the console — never required for the 30 days to hold.
 *  - ADMIN-ONLY VIEWING. Nothing makes these public: `readProofPicture` is called only by the admin route
 *    (routes/gameProofPicturesAdmin.ts), behind the admin token, and streams the bytes with `Cache-Control: no-store`.
 *  - HONEST WHEN IT CANNOT. No bucket configured, the kill switch off, a picture over the cap, a read that failed: the
 *    picture is not stored and GAME_PROOF says why. A build is never held or failed by this.
 *
 * Privacy: these are screenshots of the USER'S OWN app. They are seen by the admin only, never shared, never shown to
 * another user, and deleted after 30 days.
 */
import { createHash } from 'node:crypto';
import * as admin from 'firebase-admin';
import { workspaceAssetBucketName } from '../lib/workspaceAssetStorage';
import { PROOF_PICTURES, type ProofShot } from './gamePlaytest';

export const PROOF_PICTURE_PREFIX = 'game-proof-v1';
/** How long a picture is kept. The admin's decision (Q-3363): 30 days. */
export const PROOF_PICTURE_RETAIN_DAYS = 30;
/**
 * The most one picture may weigh. A 480 px JPEG at quality 0.7 is a few tens of KB; 40 KB also keeps the sandbox read
 * (base64 on stdout, which the sandbox caps at 64 KB) whole. A bigger file is not stored, and the report says so.
 */
export const MAX_PICTURE_BYTES = 40_000;
export const MAX_PICTURES_PER_BUILD = 3;
export const MAX_BUILD_BYTES = MAX_PICTURE_BYTES * MAX_PICTURES_PER_BUILD;
/** The whole copy (three sandbox reads + three writes) never takes longer than this. */
export const KEEP_BUDGET_MS = 15_000;
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const VIEW = '(start|moved|far)';
const SANDBOX_PATH = new RegExp(`^${PROOF_PICTURES.dir.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/${VIEW}-([a-f0-9]{12})\\.jpg$`);
const BUILD_ID = /^[A-Za-z0-9_-]{1,80}$/;
const KEY = new RegExp(`^${PROOF_PICTURE_PREFIX}/(\\d{4}-\\d{2}-\\d{2})/([A-Za-z0-9_-]{1,80})/${VIEW}-([a-f0-9]{12})\\.jpg$`);

/** Is the kill switch on? Default ON; `AGENTV3_GAME_PROOF_KEEP=off` stops pictures leaving the sandbox. */
export function proofPictureKeepEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_GAME_PROOF_KEEP ?? '').trim().toLowerCase() !== 'off';
}

/** The storage this module needs — the real one is the private bucket, a test passes a map. */
export interface ProofPictureStore {
  save(key: string, bytes: Buffer, meta: Record<string, string>): Promise<void>;
  /** The bytes, or null when the object does not exist. Throws when storage could not answer. */
  read(key: string, maxBytes: number): Promise<Buffer | null>;
  /** The day folders under the prefix (`game-proof-v1/YYYY-MM-DD/`). */
  listDays(): Promise<string[]>;
  deleteDay(dayPrefix: string): Promise<void>;
}

/** The private workspace-asset bucket, or null when none is configured (the pictures then stay in the sandbox). */
export function privateProofPictureStore(env: NodeJS.ProcessEnv = process.env): ProofPictureStore | null {
  const name = workspaceAssetBucketName(env);
  if (!name) return null;
  const bucket = () => admin.storage().bucket(name);
  return {
    async save(key, bytes, meta) {
      if (!KEY.test(key) || bytes.length > MAX_PICTURE_BYTES) throw new Error('Proof picture key or size refused');
      await bucket().file(key).save(bytes, {
        resumable: false, validation: 'crc32c', contentType: 'image/jpeg', timeout: 10_000,
        // PRIVATE: no ACL is set, nothing serves these directly; only the admin route reads them back.
        metadata: { cacheControl: 'private, no-store', metadata: meta },
      });
    },
    async read(key, maxBytes) {
      if (!KEY.test(key)) return null;
      const stream = bucket().file(key).createReadStream({ validation: 'crc32c' });
      const timer = setTimeout(() => stream.destroy(new Error('Proof picture read timed out')), 10_000);
      timer.unref?.();
      try {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > maxBytes) throw new Error('Proof picture exceeds its size cap');
          chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks, size);
      } catch (e) {
        if ((e as { code?: number }).code === 404) return null;
        throw e;
      } finally { clearTimeout(timer); stream.destroy(); }
    },
    async listDays() {
      const [, , api] = await bucket().getFiles({ prefix: `${PROOF_PICTURE_PREFIX}/`, delimiter: '/', autoPaginate: false, maxResults: 1000 });
      const prefixes = (api as { prefixes?: unknown } | undefined)?.prefixes;
      return Array.isArray(prefixes) ? prefixes.filter((p): p is string => typeof p === 'string') : [];
    },
    async deleteDay(dayPrefix) {
      if (!/^game-proof-v1\/\d{4}-\d{2}-\d{2}\/$/.test(dayPrefix)) throw new Error('Refusing to delete outside the proof prefix');
      await bucket().deleteFiles({ prefix: dayPrefix, force: true });
    },
  };
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The object key for one picture, or null when any part is not what the playtest writes. PURE. */
export function proofPictureKey(buildId: string, view: string, id: string, nowMs: number): string | null {
  const key = `${PROOF_PICTURE_PREFIX}/${dayOf(nowMs)}/${buildId}/${view}-${id}.jpg`;
  return BUILD_ID.test(buildId) && KEY.test(key) ? key : null;
}

/** Is this a key this module writes? The admin route serves nothing else. PURE. */
export function isProofPictureKey(key: unknown): key is string {
  return typeof key === 'string' && KEY.test(key);
}

/** Is the picture past its 30 days (by the day in its key)? A key that cannot be read counts as expired. PURE. */
export function proofPictureExpired(key: string, nowMs: number, retainDays = PROOF_PICTURE_RETAIN_DAYS): boolean {
  return dayExpired(KEY.exec(key)?.[1], nowMs, retainDays);
}

/** Is a `YYYY-MM-DD` day past the retention? The whole of the 30th day after it is still kept. PURE. */
function dayExpired(day: string | undefined, nowMs: number, retainDays = PROOF_PICTURE_RETAIN_DAYS): boolean {
  const t = day ? Date.parse(`${day}T00:00:00Z`) : NaN;
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= (retainDays + 1) * DAY_MS;
}

/** Reads one picture out of the sandbox. null when it could not be read. */
export type SandboxPictureReader = (sandboxPath: string) => Promise<Buffer | null>;

/**
 * The sandbox reader the build route uses: one bounded command per picture. The path is matched against the exact shape
 * the playtest writes BEFORE it reaches a shell, so nothing from stdout can be run. `head -c` caps what is read one byte
 * past the limit, so an oversized file is seen as oversized rather than silently cut. Never throws.
 */
export function sandboxPictureReader(run: ((command: string) => Promise<{ exitCode?: number; stdout: string }>) | undefined): SandboxPictureReader {
  return async (sandboxPath) => {
    if (!run || !SANDBOX_PATH.test(sandboxPath)) return null;
    try {
      const r = await run(`head -c ${MAX_PICTURE_BYTES + 1} '${sandboxPath}' | base64 -w0`);
      if (typeof r.exitCode === 'number' && r.exitCode !== 0) return null;
      const out = String(r.stdout || '').trim();
      return out ? Buffer.from(out, 'base64') : null;
    } catch { return null; }
  };
}

export interface KeptPicture { view: string; id: string; key: string; bytes: number }
export interface KeepResult { kept: KeptPicture[]; notKept: Array<{ view: string; why: string }>; retainDays: number }

const isJpeg = (b: Buffer) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const contentId = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 12);

async function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<T>((r) => { timer = setTimeout(() => r(fallback), ms); })]);
  } finally { if (timer) clearTimeout(timer); }
}

/**
 * Copy the pictures the playtest reported into the private store. `store` null means no bucket is configured. Bounded
 * by KEEP_BUDGET_MS, MAX_PICTURES_PER_BUILD and MAX_BUILD_BYTES; every picture not kept is said with its reason. Never
 * throws.
 */
export async function keepProofPictures(input: {
  buildId: string | undefined;
  shots: ProofShot[];
  read: SandboxPictureReader;
  store: ProofPictureStore | null;
  nowMs?: number;
  enabled?: boolean;
}): Promise<KeepResult> {
  const nowMs = input.nowMs ?? Date.now();
  const out: KeepResult = { kept: [], notKept: [], retainDays: PROOF_PICTURE_RETAIN_DAYS };
  const shots = (input.shots || []).filter((s) => s && typeof s.id === 'string');
  const all = (why: string): KeepResult => ({ ...out, notKept: shots.map((s) => ({ view: s.view, why })) });
  if (shots.length === 0) return out;
  if (input.enabled === false) return all('keeping pictures is switched off (AGENTV3_GAME_PROOF_KEEP=off)');
  if (!input.store) return all('no private storage bucket is configured on this server');
  if (!input.buildId || !BUILD_ID.test(input.buildId)) return all('this build has no id to file the pictures under');
  let timedOut = false;
  const work = (async () => {
    let total = 0;
    for (const [i, s] of shots.entries()) {
      if (timedOut) return true; // past the budget: nothing more is stored, so nothing is stored that the report omits
      if (i >= MAX_PICTURES_PER_BUILD) { out.notKept.push({ view: s.view, why: `over the ${MAX_PICTURES_PER_BUILD}-picture cap for one build` }); continue; }
      const key = proofPictureKey(input.buildId!, s.view, s.id, nowMs);
      if (!key || !SANDBOX_PATH.test(s.path)) { out.notKept.push({ view: s.view, why: 'the picture is not one the playtest writes' }); continue; }
      const bytes = await input.read(s.path);
      if (!bytes || bytes.length === 0) { out.notKept.push({ view: s.view, why: 'it could not be read from the sandbox' }); continue; }
      if (bytes.length > MAX_PICTURE_BYTES) { out.notKept.push({ view: s.view, why: `over the ${Math.round(MAX_PICTURE_BYTES / 1000)} KB size cap` }); continue; }
      if (total + bytes.length > MAX_BUILD_BYTES) { out.notKept.push({ view: s.view, why: `over the ${Math.round(MAX_BUILD_BYTES / 1000)} KB cap for one build` }); continue; }
      if (!isJpeg(bytes) || contentId(bytes) !== s.id) { out.notKept.push({ view: s.view, why: 'the file read back is not the picture the playtest described' }); continue; }
      if (timedOut) return true;
      try {
        await input.store!.save(key, bytes, { buildId: input.buildId!, view: s.view, deleteAfter: new Date(nowMs + PROOF_PICTURE_RETAIN_DAYS * DAY_MS).toISOString() });
        total += bytes.length;
        out.kept.push({ view: s.view, id: s.id, key, bytes: bytes.length });
      } catch { out.notKept.push({ view: s.view, why: 'the private store did not accept it' }); }
    }
    return true;
  })().catch(() => true);
  const finished = await within(work, KEEP_BUDGET_MS, false);
  if (!finished) {
    timedOut = true;
    const done = new Set([...out.kept.map((k) => k.view), ...out.notKept.map((n) => n.view)]);
    for (const s of shots) if (!done.has(s.view)) out.notKept.push({ view: s.view, why: `copying ran past its ${KEEP_BUDGET_MS / 1000} s budget` });
  }
  return { kept: [...out.kept], notKept: [...out.notKept], retainDays: out.retainDays };
}

/** Delete every day folder older than RETAIN_DAYS. Returns the folders deleted. Throws only when listing fails. */
export async function sweepExpiredProofPictures(store: ProofPictureStore, nowMs = Date.now()): Promise<string[]> {
  const deleted: string[] = [];
  for (const day of await store.listDays()) {
    const m = /^game-proof-v1\/(\d{4}-\d{2}-\d{2})\/$/.exec(day);
    if (!m || !dayExpired(m[1], nowMs)) continue;
    try { await store.deleteDay(day); deleted.push(day); } catch { /* the next sweep tries again; reads refuse it anyway */ }
  }
  return deleted;
}

let lastSweepAt = 0;
/** The sweep, at most once per SWEEP_EVERY_MS on this instance, in the background. Never throws. */
export function maybeSweepProofPictures(store: ProofPictureStore | null, nowMs = Date.now()): boolean {
  if (!store || nowMs - lastSweepAt < SWEEP_EVERY_MS) return false;
  lastSweepAt = nowMs;
  void sweepExpiredProofPictures(store, nowMs).catch(() => { lastSweepAt = 0; });
  return true;
}
export function __resetProofPictureSweepForTests(): void { lastSweepAt = 0; }

/**
 * The admin route's read: the key must be one this module writes and not past its 30 days. 'expired', 'missing' and
 * 'unavailable' are each their own answer — never an empty image. Never throws.
 */
export async function readProofPicture(store: ProofPictureStore | null, key: unknown, nowMs = Date.now()): Promise<
  { kind: 'ok'; bytes: Buffer } | { kind: 'invalid' } | { kind: 'expired' } | { kind: 'missing' } | { kind: 'unavailable' }
> {
  if (!isProofPictureKey(key)) return { kind: 'invalid' };
  if (proofPictureExpired(key, nowMs)) return { kind: 'expired' };
  if (!store) return { kind: 'unavailable' };
  try {
    const bytes = await store.read(key, MAX_PICTURE_BYTES);
    return bytes && isJpeg(bytes) ? { kind: 'ok', bytes } : { kind: 'missing' };
  } catch { return { kind: 'unavailable' }; }
}

/**
 * The one call the build route makes (a helper call only — the route stays small): keeps a played game's pictures in the
 * private store and starts the expiry sweep. `run` runs a command in this build's sandbox. Never throws.
 */
export function gameProofKeeper(opts: {
  buildId: string | undefined;
  run: ((command: string) => Promise<{ exitCode?: number; stdout: string }>) | undefined;
  env?: NodeJS.ProcessEnv;
}): (shots: ProofShot[]) => Promise<KeepResult> {
  return async (shots) => {
    const env = opts.env ?? process.env;
    const store = proofPictureKeepEnabled(env) ? privateProofPictureStore(env) : null;
    const result = await keepProofPictures({ buildId: opts.buildId, shots, read: sandboxPictureReader(opts.run), store, enabled: proofPictureKeepEnabled(env) });
    if (result.kept.length) maybeSweepProofPictures(store);
    return result;
  };
}
