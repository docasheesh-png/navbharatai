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
// a future session adds is denied automatically, because it is not on the list. Creating a genuinely NEW
// file is allowed (a new test/doc file cannot break the app the browser already rendered). Refusing a
// write can only ever KEEP the working app as it was — it can never break it — so this is safe by the
// one absolute rule, by construction.
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
]);

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

/** Optional observer: called (best-effort) when a write is refused, so the route can record a diagnostic. */
let onDeferred: ((info: { workspaceId: string; path: string; pass: string | null }) => void) | null = null;

/** Register the deferred-write observer. Returns a disposer that clears it. */
export function setGreenFreezeObserver(fn: (info: { workspaceId: string; path: string; pass: string | null }) => void): () => void {
  onDeferred = fn;
  return () => { if (onDeferred === fn) onDeferred = null; };
}

/**
 * Thrown by an actuator's writeFile when a write to a green-latched file is refused. A distinct class so
 * callers/tests identify the refusal precisely; a best-effort pass simply swallows it (its try/catch),
 * exactly as it would swallow any write error, and the working app is left untouched.
 */
export class GreenFreezeError extends Error {
  constructor(public readonly path: string, public readonly pass: string | null) {
    super(`Green freeze: refused to overwrite "${path}" on a verified-working app${pass ? ` from pass "${pass}"` : ' (no allowlisted pass)'}.`);
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
  if (pass && ALLOWED_PASSES.has(pass)) return false; // the user's own request, or the restore itself
  return true;
}

/**
 * The enforcement an actuator calls at the top of writeFile. Throws `GreenFreezeError` when the write is
 * refused (notifying the observer first), and returns normally otherwise. One line at each write choke
 * point; the invariant lives here, not at twelve call sites.
 */
export function assertWriteAllowed(workspaceId: string, path: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!writeRefused(workspaceId, path, env)) return;
  const pass = currentPass();
  try { onDeferred?.({ workspaceId, path: norm(path), pass }); } catch { /* observer is best-effort */ }
  throw new GreenFreezeError(norm(path), pass);
}
