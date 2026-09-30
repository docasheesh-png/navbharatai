// AgentV3 — GREEN FREEZE: once the app is proven working, deny writes to it BY DEFAULT.
//
// THE ADMIN'S OBSERVATION, PROVEN FROM OUR OWN CODE (audit 2026-08-12): after the app is latched
// `previewGreen = true`, TWELVE more write-capable passes run and only ONE checked whether the app
// already works. Nine are live in production. Nothing re-verified after those mutations, so a build a
// late pass broke was still reported "preview verified", and GreenGuard then saved the broken files as
// the new "known good". The 44-minute report's .env erasure and the unused-import corruption both live
// in that window.
//
// The real bug is NOT any single pass. It is that write permission is OPEN BY DEFAULT after green, so
// the guarantee has to be re-remembered at every call site and every pass a future session adds. Adding
// `if (previewGreen) skip` twelve times is convention; conventions rot. This is the same class the
// codebase already solved TWICE — `noClaudeZone` and `aiSpendZone` — by moving the invariant to the ONE
// place the thing actually happens and denying by construction. CLAUDE.md endorses exactly that.
//
// THE RULE: once a workspace is GREEN-LATCHED, an actuator write that would OVERWRITE a file present at
// the green moment is REFUSED — UNLESS the current async pass is on a small, explicit allowlist. A pass
// a future session adds is denied automatically, because it is not on the list. Refusing a
// write can only ever KEEP the working app as it was — it can never break it — so this is safe by the
// one absolute rule, by construction.
//
// ⚠️ THIS PARAGRAPH USED TO PROMISE A CARVE-OUT THE CODE HAD ALREADY REMOVED (corrected 2026-09-22,
// autopsy 21b431e1). It read *"Creating a genuinely NEW file is allowed (a new test/doc file cannot
// break the app the browser already rendered)"* — and `writeRefused`'s own docblock, thirty lines
// below, records that exact carve-out being deleted after the adversarial review of 2026-08-12,
// because a coordinated change (a new file plus an edit) would land half of itself. Both statements
// sat in one file for six weeks. The behaviour is, and stays, FULL DENY for a non-allowlisted pass.
// The header is the half a reader meets first, which is what made the drift expensive: the same
// build's report shows nine `GREEN_FREEZE_DEFERRED` writes — tests, a manifest, robots.txt, an icon
// and a service worker — and this paragraph said they would have been allowed.
//
// ✅ AND THOSE NINE WERE THE REAL DEFECT, NOT THE DOCUMENTATION (traced from code 2026-09-25). They
// came from the two DETERMINISTIC post-build passes — the starter-test scaffold and the U-2 launch
// basics — which run after the latch and named no pass at all, so every write was refused and
// swallowed. See `CREATE_ONLY_PASSES` below: they are named now, and may CREATE a file that was not
// present at green (which cannot change a render) while still being refused every overwrite. Full
// deny is unchanged for everything else, and for those two passes on any path that already existed.
//
// WHAT STAYS ALLOWED, and why it is not "our opinion": the runtime-error auto-fix (the app renders but
// throws — the user wants a WORKING app) and the feature-presence heal (a feature the user EXPLICITLY
// asked for is missing — rendering ≠ complete). Those are the user's own requests, the job itself. Plus
// GreenGuard's own restore, which puts the good files back. Everything else — the reviewer's opinions,
// the deterministic sweeps, index.html rewrites — becomes a NO-OP write it cannot perform, and (via the
// GREEN STOP path already built) an OFFER to the user instead.
//
// MECHANISM (mirrors noClaudeZone exactly): a module-level per-workspace latch (the set of paths that
// existed at green) + an AsyncLocalStorage "pass" zone. The actuator's writeFile checks both at its
// first line and THROWS `GreenFreezeError` before touching disk. Every post-build pass writes through
// the same idiom — `await actuator.writeFile(...)` THEN records into writtenFiles / the durable store —
// so a throw cleanly skips the sandbox write, the in-memory record AND the durable save together, and
// the pass's own try/catch swallows it. Pure Node built-in; no deps.

import { AsyncLocalStorage } from 'node:async_hooks';

/** Kill switch. Default ON — this is the fix the admin approved. `off` restores today's behaviour. */
export function greenFreezeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTV3_GREEN_FREEZE !== 'off';
}

/**
 * The passes permitted to write to a green app. Each is the USER's own request or the safety mechanism
 * itself — never the engine's opinion. A pass identifies itself by wrapping its work in `runInPass`.
 *
 * ADDING TO THIS LIST IS A DELIBERATE ACT: it asserts "this pass writes to a working app on purpose".
 * That is true of exactly these three and should stay rare.
 */
export const ALLOWED_PASSES: ReadonlySet<string> = new Set([
  'runtime-error-autofix', // the app renders but throws — the user wants a working app
  'feature-presence-heal', // a feature the user explicitly asked for is missing
  'green-guard-restore',   // puts the last-known-good files back — the safety mechanism itself
  // Re-seeding an EMPTY sandbox from the durable store before a build (sandboxSeed.ts). Added
  // 2026-08-20 after it broke a real publish: the seed writes through `actuator.writeFile`, the freeze
  // refused every write on a green app, and the user was told "your files could not be restored".
  //
  // It belongs here for the same reason `green-guard-restore` does, and the distinction matters: the
  // freeze exists to stop a pass ALTERING a working app. This alters nothing — it copies the app's own
  // durable bytes into a machine that has none, which is what makes a green app publishable at all.
  // Refusing it does not protect the app; it strands it. The seed also only runs when the sandbox is
  // empty or missing package.json, never against a populated warm one, so there is no path by which it
  // can overwrite live work with something older.
  'sandbox-file-restore',
  // The design repair runs BEFORE the preview is browsed, so on the normal path the workspace is not
  // latched yet and this entry is not what lets it write. It is here for the case where a latch DOES
  // exist by then (a resumed session that was already proven green), so the pass behaves the same either
  // way instead of silently doing nothing on one path. It carries its own revert net — see
  // designHealGuard.ts — and unlike the reviewer it repairs the app's OWN stated design contract, not an
  // opinion about it.
  'design-consistency-heal',
  // A REAL BUG THE REVIEWER FOUND IN A WORKING APP (admin 2026-09-23, autopsy ac41a924: "han to fix
  // karo"). A news site rendered, and the reviewer found every article showing as ONE paragraph and
  // footer links to pages that do not exist — both shipped, because on a green app the reviewer could
  // only suggest. This pass repairs ONLY the reviewer's FUNCTIONAL findings (`selectAutoFixableWarnings`
  // plus criticals — never style, naming or a11y polish), runs once, and is wrapped in verifyAfterFix:
  // a repair that breaks the render is reverted to the green snapshot. It is the one allowlisted pass
  // with a history of harm — the 2026-08-12 reviewer erased a user's real .env secrets — so it is ALSO
  // refused every secret file, below, whatever else it is allowed.
  'reviewer-functional-repair',
  // A BUTTON THE CLICK EXPLORER PROVED BROKEN (admin 2026-09-28: "han dono ho jaye … world class
  // banao"). The strongest evidence this platform collects — a real browser pressed a real control and
  // the app crashed, blanked, threw or led nowhere — and until now it could only be reported. One
  // repair, then EVERY button is pressed again; kept only if the app renders, a broken control now
  // works and nothing that worked broke (explorerRepair.ts). A model-driven edit to a working app, so it
  // carries the reviewer repair's restraints: an unproven result is undone, and no secret file, below.
  'explorer-repair',
  // A TEST SUITE THE APP SHIPS THAT FAILS ON A WORKING APP (autopsy 8e124182, admin 2026-09-30: "baaki bhi
  // fix karo"). It named no pass, so the freeze refused all of it and the model went round the freeze with
  // the shell. Now it is verified: kept only if the suite then passes with the same command AND the app
  // still renders, else undone (routes/agentv3.ts). It may never touch a secret file, and never a TEST file
  // — "fix the source, do not weaken the test" is enforced here rather than merely asked for.
  'vaccine-repair',
]);

/**
 * 🔴 THE DETERMINISTIC POST-BUILD PASSES, WHICH HAD BEEN REFUSED IN SILENCE SINCE THIS FILE SHIPPED
 * (traced from code 2026-09-25, from autopsy e628efd4's nine deferrals).
 *
 * The green latch is set the moment a real browser confirms the render (`routes/agentv3.ts`), and
 * BOTH deterministic post-build passes run after it: the starter-test scaffold, and the U-2 launch
 * basics (a web manifest, an installable icon, robots.txt, an offline service worker, and the
 * SEO/OG/viewport patch to index.html). Neither wrapped itself in `runInPass`, so `currentPass()`
 * was `null`, every write was refused, and each refusal was swallowed by the pass's own `catch`.
 *
 * **So on every build whose preview was verified in a real browser, the launch basics
 * `AppKnowledgeBase.ts` promises "BY DEFAULT after each build" did not happen at all** — and the
 * same report's `READINESS_WARNING: No tests at all`, beside three deferred `*.test.ts` writes the
 * engine had itself produced, is that one defect seen from the other end.
 *
 * 🔒 WHY THEY ARE "CREATE-ONLY" AND NOT SIMPLY ALLOWLISTED. `ALLOWED_PASSES` asserts *"this pass
 * writes to a working app on purpose"* — true of a user's own repair, and NOT true of these. A file
 * that did not exist when the browser rendered the app cannot have been part of what rendered, so
 * creating it cannot change the render; overwriting one that DID exist is exactly what this file is
 * for. The latch already holds the set of paths present at green, so that question is answered
 * exactly rather than guessed.
 *
 * ⚠️ THIS IS NARROWER THAN THE CARVE-OUT THAT WAS REMOVED, deliberately. That one let ANY
 * non-allowlisted pass — including a model-driven one — create files, so a coordinated change (a new
 * file plus an edit) landed half of itself. These two passes are deterministic, idempotent, and
 * already skip any path that exists; the only write either makes to an existing file is the U-2
 * index.html patch, which stays REFUSED. The honest consequence is stated rather than hidden: on a
 * green app the manifest and service worker land but are not linked from index.html, so they are
 * inert — the narration says what actually happened instead of claiming them.
 *
 * 🔁 SINCE #3313 BOTH PASSES RUN BEFORE THE LATCH (with the E2E net and the ADR note), so on a normal
 * build none of this applies: the index.html patch lands and the browser check verifies it. This tier
 * remains the net for a latch that already exists when they run — a resumed, already-green session.
 */
const CREATE_ONLY_PASSES: ReadonlySet<string> = new Set([
  'starter-tests',        // additive Vitest skeletons — nothing in the app can import a test file
  'production-defaults',  // U-2 launch basics: manifest, icon, robots.txt, service worker
]);

/**
 * Passes that may write to a green app but NEVER to a secret file. See `writeRefused`.
 *
 * Every create-only pass is here too, by construction rather than by listing it twice: none of them
 * has any business writing a `.env`, and a future entry to that set must not have to remember this.
 */
const SECRET_FILE_DENIED_PASSES: ReadonlySet<string> = new Set([
  'vaccine-repair',
  'reviewer-functional-repair',
  'explorer-repair',
  ...CREATE_ONLY_PASSES,
]);

/** `.env`, `.env.local`, `.env.production` … at any depth — the files that hold the user's real keys. */
export function isSecretFilePath(path: string): boolean {
  return /(^|\/)\.env(\.[\w.-]+)?$/i.test(String(path ?? '').replace(/\\/g, '/'));
}

interface GreenLatch {
  /** Source paths that existed when the app was proven green — the files an "edit" would overwrite. */
  paths: Set<string>;
  /** When it was latched (epoch ms) — for honest diagnostics only. */
  at: number;
}

/** Per-workspace latch. Module-level (request-scoped in practice) and cleared in the request's finally. */
const latches = new Map<string, GreenLatch>();

/** The pass currently executing, propagated to every awaited descendant. */
const passZone = new AsyncLocalStorage<{ name: string }>();

type WriteInfo = { workspaceId: string; path: string; pass: string | null };
type Observer = { fn: (info: WriteInfo) => void; workspaceId?: string };

/**
 * 🔴 ONE OBSERVER PER BUILD, NOT ONE PER SERVER (autopsy 6a5fb04b / dfd81a3a, 2026-09-30).
 *
 * Both observers used to be a single module-level slot: `onDeferred = fn`. Every build registers one, so
 * with two builds on the same Cloud Run instance the SECOND registration replaced the first. A voice-
 * assistant build's report then carried four GREEN_FREEZE_DEFERRED lines about `src/lib/stock.ts`,
 * `src/pages/AddStock.tsx` and `src/components/TransactionForm.tsx` — another user's inventory app — each
 * saying "the app was already verified working" 330 s before this app had rendered at all. The other
 * build's own report lost them, and when either finished, its disposer left the survivor with none.
 * POST_GREEN_WRITES, fed by the write observer, counted the other build's writes the same way.
 *
 * So observers are a SET, and a build registers with its own workspace: an observer scoped to a
 * workspace hears only that workspace. An unscoped observer (tests, a future server-wide ledger) hears
 * every write, as before.
 */
const deferredObservers = new Set<Observer>();

function notify(set: Set<Observer>, info: WriteInfo): void {
  for (const o of set) {
    if (o.workspaceId !== undefined && o.workspaceId !== info.workspaceId) continue;
    try { o.fn(info); } catch { /* an observer is best-effort — it must never break a write */ }
  }
}

function register(set: Set<Observer>, fn: (info: WriteInfo) => void, workspaceId?: string): () => void {
  const entry: Observer = { fn, workspaceId };
  set.add(entry);
  return () => { set.delete(entry); };
}

/**
 * Register a deferred-write observer. Returns a disposer that removes exactly this registration.
 * Pass `workspaceId` from a build: without it the observer hears every workspace on this server.
 */
export function setGreenFreezeObserver(fn: (info: WriteInfo) => void, workspaceId?: string): () => void {
  return register(deferredObservers, fn, workspaceId);
}

/**
 * The sibling observer: every write that was ALLOWED through `assertWriteAllowed`, with the pass that
 * made it. Added 2026-09-18 for postGreenWrites.ts — the ledger of who edits an app after it first
 * rendered. Same chokepoint as the refusal observer, so tool writes, heals, restores and sub-agents
 * are all seen once, and nothing has to be threaded through the twenty places that persist a file.
 */
const writeObservers = new Set<Observer>();
export function setWriteObserver(fn: (info: WriteInfo) => void, workspaceId?: string): () => void {
  return register(writeObservers, fn, workspaceId);
}

/**
 * Thrown by an actuator's writeFile when a write to a green-latched file is refused. A distinct class so
 * callers/tests identify the refusal precisely; a best-effort pass simply swallows it (its try/catch),
 * exactly as it would swallow any write error, and the working app is left untouched.
 */
export class GreenFreezeError extends Error {
  constructor(public readonly path: string, public readonly pass: string | null) {
    // The second sentence is for the model that reads this as a tool error. Autopsy 8e124182: told only
    // "refused", a model reasoned its way to `cat > file` to get around it. Say plainly that the answer is
    // to report, not to find another route — and every route (the shell included) is refused the same way.
    super(`Green freeze: refused to overwrite "${path}" on a verified-working app${pass ? ` from pass "${pass}"` : ' (no allowlisted pass)'}. `
      + 'Do not try another way to change it (the shell is refused too) — tell the user what you would change and why.');
    this.name = 'GreenFreezeError';
  }
}

/** Normalize a path so `./src/x`, `src/x` and a leading slash all compare equal. */
function norm(path: string): string {
  return String(path ?? '').replace(/\\/g, '/').replace(/^\.?\//, '');
}

/**
 * Latch a workspace as GREEN with the set of source paths that existed at that moment. Idempotent for a
 * given green — re-latching updates the snapshot. Only source paths are kept (a write to node_modules or
 * a build artifact is never the concern here). Pure aside from the module map.
 */
export function latchGreen(workspaceId: string, presentPaths: Iterable<string>): void {
  if (!workspaceId) return;
  if (latches.has(workspaceId)) return; // already latched this build — never re-snapshot a mutated tree
  const paths = new Set<string>();
  for (const p of presentPaths) {
    const n = norm(p);
    if (n && !/(^|\/)(node_modules|dist|build|\.next|\.git|coverage)\//.test(n)) paths.add(n);
  }
  latches.set(workspaceId, { paths, at: Date.now() });
}

/** Clear a workspace's latch — MUST run in the request's finally so a latch never leaks to a later build. */
export function clearGreenLatch(workspaceId: string): void {
  latches.delete(workspaceId);
}

/** Is this workspace currently green-latched? */
export function isGreenLatched(workspaceId: string): boolean {
  return latches.has(workspaceId);
}

/** Run `fn` inside a named pass, so writes it performs are attributed to `name` for the freeze decision. */
export function runInPass<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return passZone.run({ name }, fn);
}

/** The pass currently executing, or null. */
export function currentPass(): string | null {
  return passZone.getStore()?.name ?? null;
}

/** Infrastructure paths that are never the app's own source — a write here is never the concern. */
function isInfraPath(path: string): boolean {
  return /(^|\/)(node_modules|dist|build|\.next|\.nuxt|\.svelte-kit|\.vite|\.git|coverage|\.cache|\.turbo)\//.test(norm(path));
}

/**
 * THE PURE DECISION. Would a write to `path` in `workspaceId` be refused right now?
 *
 * Refused iff: the freeze is enabled, the workspace is green-latched, the path is APP SOURCE (not
 * node_modules / a build artefact), and the current pass is not on the allowlist. This is FULL DENY for
 * a non-allowlisted pass — a NEW app file is refused too, not only an edit.
 *
 * The earlier "a new file is always allowed" carve-out was removed after the adversarial review
 * (2026-08-12): a non-allowlisted pass making a coordinated change (a new file plus an edit to an
 * existing one) would land the new half and have the edit refused, a half-applied state. Deny-by-default
 * must mean deny, so a non-allowlisted pass simply cannot write to the app at all once it is green.
 * (An allowlisted pass — the user's own request — may still create the new files its fix needs.) Pure.
 */
export function writeRefused(workspaceId: string, path: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!greenFreezeEnabled(env)) return false;
  if (!latches.has(workspaceId)) return false;        // not green yet → today's behaviour
  if (isInfraPath(path)) return false;                // node_modules / build output — never app source
  const pass = currentPass();
  if (pass && SECRET_FILE_DENIED_PASSES.has(pass) && isSecretFilePath(path)) return true; // never the user's keys
  if (pass === 'vaccine-repair' && /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(norm(path))) return true; // fix the source, never the test
  if (pass && ALLOWED_PASSES.has(pass)) return false; // the user's own request, or the restore itself
  // A create-only pass may add a file that was NOT there when the browser rendered, and nothing else.
  // Refused iff the path was present at green — which is the one question the latch can answer exactly.
  if (pass && CREATE_ONLY_PASSES.has(pass)) return latches.get(workspaceId)?.paths.has(norm(path)) ?? true;
  return true;
}

/**
 * The enforcement an actuator calls at the top of writeFile. Throws `GreenFreezeError` when the write is
 * refused (notifying the observer first), and returns normally otherwise. One line at each write choke
 * point; the invariant lives here, not at twelve call sites.
 */
export function assertWriteAllowed(workspaceId: string, path: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!writeRefused(workspaceId, path, env)) {
    if (!isInfraPath(path)) notify(writeObservers, { workspaceId, path: norm(path), pass: currentPass() });
    return;
  }
  const pass = currentPass();
  notify(deferredObservers, { workspaceId, path: norm(path), pass });
  throw new GreenFreezeError(norm(path), pass);
}
