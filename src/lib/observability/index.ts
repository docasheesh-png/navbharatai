// THE ONE PLACE A CLIENT ERROR IS REPORTED (crash reporting, 2026-10-04).
//
// Three separate pipes, deliberately not pretended to be one:
//   1. NATIVE CRASHES (Java/ObjC/Swift, fatal and ANR-type): captured by the Firebase Crashlytics SDK
//      inside the phone app itself, before any JavaScript runs. Nothing in this file is needed for them.
//   2. JAVASCRIPT ERRORS (React render errors, window errors, unhandled rejections, handled errors we
//      choose to record): routed HERE. Inside the phone app they become Crashlytics NON-FATAL reports;
//      on every platform they also go to our own `/api/logs/error`, which feeds Cloud Error Reporting
//      and the admin Errors view (Q-013 depends on that). A JS error is never a native crash.
//   3. SERVER ERRORS: `src/server/observability/ErrorTracker.ts`, untouched by this module.
//
// Rules this file is built to keep, because a crash reporter that misbehaves is a crash:
//   • Nothing here throws, and nothing here is awaited by the app. Every sink call is wrapped.
//   • Every field passes `sanitize.ts` before it leaves the device. No caller sanitizes by hand.
//   • A report raised WHILE reporting is dropped (re-entrancy guard), identical reports within
//     DEDUP_WINDOW_MS are dropped, and no more than RATE_LIMIT reports leave per RATE_WINDOW_MS.
//   • Reports are sent only from production builds. A developer's console is not our crash data.
//   • The user is identified to Crashlytics only by a one-way hash of the Firebase uid — never the
//     email, phone, name, or a token — and the id is cleared on sign-out.

import { sanitizeText, sanitizeUrl, sanitizeKeys } from './sanitize';

export type ErrorKind = 'react-render' | 'window-error' | 'unhandled-rejection' | 'handled';

/** The product areas a report may be tagged with. A fixed list, so reports group cleanly. */
export type FeatureArea =
  | 'app' | 'auth' | 'ai' | 'builder' | 'agentv3' | 'preview'
  | 'payments' | 'github' | 'notifications' | 'native';

export const DEDUP_WINDOW_MS = 5 * 60_000;
export const RATE_WINDOW_MS = 5 * 60_000;
export const RATE_LIMIT = 20;
const MAX_STACK_FRAMES = 30;
const MAX_BREADCRUMB_CHARS = 200;

/** What leaves the device for one error. Built only by `buildReport`, so it is always sanitized. */
export interface ErrorReport {
  kind: ErrorKind;
  message: string;
  stack: string;
  url: string;
  area: FeatureArea;
  keys: Record<string, string | number | boolean>;
}

/** The native half, as plain functions — never the plugin proxy itself (see appCheckClient.ts). */
export interface CrashlyticsSink {
  recordException(report: ErrorReport, frames: StackFrame[]): Promise<void>;
  setUserId(id: string): Promise<void>;
  setCustomKey(key: string, value: string | number | boolean): Promise<void>;
  log(message: string): Promise<void>;
  crash(message: string): Promise<void>;
}

export interface StackFrame { fileName?: string; functionName?: string; lineNumber?: number }

export interface ObservabilityDeps {
  /** True only in a production build. Default: `import.meta.env.PROD`. */
  enabled: boolean;
  /** Our own log endpoint. Default: the offline-queue POST to `/api/logs/error`. */
  postLog: (body: string) => void;
  /** The Crashlytics sink inside the phone app; null on the web or when unavailable. */
  loadCrashlytics: () => Promise<CrashlyticsSink | null>;
  now: () => number;
}

const state = {
  deps: null as ObservabilityDeps | null,
  crashlytics: null as CrashlyticsSink | null,
  crashlyticsLoad: null as Promise<CrashlyticsSink | null> | null,
  reporting: false,
  recent: new Map<string, number>(),
  window: [] as number[],
  area: 'app' as FeatureArea,
  appKeys: {} as Record<string, string | number | boolean>,
  dropped: 0,
};

function safe(fn: () => unknown): void {
  try {
    const r = fn();
    if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {});
  } catch { /* the reporter never throws */ }
}

/** Parse a V8 (`at fn (file:1:2)`) or JavaScriptCore (`fn@file:1:2`) stack into frames. PURE. */
export function parseStack(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const line of stack.split('\n')) {
    if (frames.length >= MAX_STACK_FRAMES) break;
    const v8 = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):\d+\)?\s*$/.exec(line);
    const jsc = v8 ? null : /^\s*(.*?)@(.+?):(\d+):\d+\s*$/.exec(line);
    const m = v8 ?? jsc;
    if (!m) continue;
    frames.push({
      functionName: sanitizeText(m[1] || '<anonymous>', 120),
      fileName: sanitizeUrl(m[2]) || sanitizeText(m[2], 200),
      lineNumber: Number(m[3]),
    });
  }
  return frames;
}

function errorParts(error: unknown): { message: string; stack: string } {
  try {
    if (error instanceof Error) return { message: `${error.name}: ${error.message}`, stack: error.stack ?? '' };
    if (typeof error === 'string') return { message: error, stack: '' };
    if (error && typeof error === 'object' && 'message' in error) {
      return { message: String((error as { message: unknown }).message), stack: String((error as { stack?: unknown }).stack ?? '') };
    }
    return { message: `Non-error value thrown (${typeof error})`, stack: '' };
  } catch {
    return { message: 'Unreadable error', stack: '' };
  }
}

/**
 * Turn anything thrown into the sanitized report that may leave the device. PURE. Only a STACK and a
 * MESSAGE are read from the error; no other property of it is copied, so an error object that happens to
 * carry a request body, a prompt or a token in some field cannot smuggle it out.
 */
export function buildReport(
  error: unknown,
  opts: { kind: ErrorKind; area?: FeatureArea; url?: string; keys?: Record<string, unknown> },
  context: { area: FeatureArea; appKeys: Record<string, string | number | boolean> } = { area: 'app', appKeys: {} },
): ErrorReport {
  const { message, stack } = errorParts(error);
  return {
    kind: opts.kind,
    message: sanitizeText(message, 500),
    stack: sanitizeText(stack, 4000),
    url: sanitizeUrl(opts.url ?? ''),
    area: opts.area ?? context.area,
    keys: { ...context.appKeys, ...sanitizeKeys(opts.keys) },
  };
}

/** Same error, same place: one report. The signature ignores line noise but keeps the first frame. */
export function reportSignature(r: ErrorReport): string {
  const firstFrame = r.stack.split('\n').find((l) => /:\d+/.test(l)) ?? '';
  return `${r.kind}|${r.area}|${r.message.slice(0, 200)}|${firstFrame.trim().slice(0, 200)}`;
}

/** Decide whether a report may be sent now, updating the dedup and rate-limit state. */
export function admit(signature: string, now: number): boolean {
  for (const [sig, at] of state.recent) if (now - at > DEDUP_WINDOW_MS) state.recent.delete(sig);
  if (state.recent.has(signature)) { state.dropped++; return false; }
  state.window = state.window.filter((t) => now - t < RATE_WINDOW_MS);
  if (state.window.length >= RATE_LIMIT) { state.dropped++; return false; }
  state.recent.set(signature, now);
  if (state.recent.size > 200) state.recent.delete(state.recent.keys().next().value as string);
  state.window.push(now);
  return true;
}

function crashlytics(): Promise<CrashlyticsSink | null> {
  const deps = state.deps;
  if (!deps) return Promise.resolve(null);
  if (state.crashlytics) return Promise.resolve(state.crashlytics);
  if (!state.crashlyticsLoad) {
    // Loaded ONCE. A failed load is remembered as null, so a broken SDK is not retried in a loop.
    state.crashlyticsLoad = deps.loadCrashlytics()
      .then((sink) => { state.crashlytics = sink; return sink; })
      .catch(() => null);
  }
  return state.crashlyticsLoad;
}

/**
 * Start the reporter. Idempotent; never throws; never awaited by startup. In tests, pass `deps`.
 */
export function initializeObservability(deps: ObservabilityDeps): void {
  if (state.deps) return;
  state.deps = deps;
  if (!deps.enabled) return;
  safe(() => crashlytics().then((sink) => {
    if (!sink) return;
    for (const [k, v] of Object.entries(state.appKeys)) safe(() => sink.setCustomKey(k, v));
  }));
}

/** Record an error. Fire-and-forget; safe to call from anywhere, including an error handler. */
export function recordError(
  error: unknown,
  opts: { kind?: ErrorKind; area?: FeatureArea; url?: string; keys?: Record<string, unknown> } = {},
): void {
  const deps = state.deps;
  if (!deps || !deps.enabled || state.reporting) return;
  state.reporting = true;
  try {
    const report = buildReport(error, { kind: opts.kind ?? 'handled', area: opts.area, url: opts.url, keys: opts.keys }, state);
    if (!admit(reportSignature(report), deps.now())) return;
    const body = JSON.stringify({
      message: report.message, stack: report.stack, url: report.url, type: report.kind,
      source: report.area, ts: deps.now(),
    });
    safe(() => deps.postLog(body));
    safe(() => crashlytics().then((sink) => {
      if (!sink) return;
      return sink.recordException(report, parseStack(report.stack));
    }));
  } catch {
    /* never let reporting fail the caller */
  } finally {
    state.reporting = false;
  }
}

/** A handled, application-level failure worth knowing about, described in our own words. */
export function recordNonFatal(message: string, area: FeatureArea, keys?: Record<string, unknown>): void {
  recordError(new Error(message), { kind: 'handled', area, keys });
}

/** A short, sanitized trail of what led up to a crash (Crashlytics log lines; native only). */
export function addBreadcrumb(message: string): void {
  const deps = state.deps;
  if (!deps?.enabled) return;
  const text = sanitizeText(message, MAX_BREADCRUMB_CHARS);
  safe(() => crashlytics().then((sink) => sink?.log(text)));
}

/** One allowlisted custom key, sanitized. Keys whose name suggests private data are refused. */
export function setCrashKey(key: string, value: string | number | boolean): void {
  const clean = sanitizeKeys({ [key]: value });
  if (!(key in clean)) return;
  state.appKeys[key] = clean[key];
  if (!state.deps?.enabled) return;
  safe(() => crashlytics().then((sink) => sink?.setCustomKey(key, clean[key])));
}

/** App-wide facts every report carries: version, build, platform, environment. */
export function setAppContext(ctx: Record<string, string | number | boolean>): void {
  for (const [k, v] of Object.entries(ctx)) setCrashKey(k, v);
}

/** Which part of the product the user is in now. Reports default to this area. */
export function setFeatureContext(area: FeatureArea): void {
  state.area = area;
  setCrashKey('feature_area', area);
}

/**
 * The pseudonymous id Crashlytics sees for a signed-in user: the first 32 hex characters of
 * SHA-256("nbai-crash:" + uid). One-way, stable per user, and the same for a given uid on every device,
 * so an engineer who already knows a uid can find that user's reports — and nobody can go the other way.
 */
export async function crashUserId(uid: string): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || !uid) return null;
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(`nbai-crash:${uid}`));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  } catch {
    return null;
  }
}

/** Attach a signed-in user to future reports (hashed uid only). */
export function setUserContext(uid: string): void {
  setCrashKey('signed_in', true);
  if (!state.deps?.enabled) return;
  safe(() => crashUserId(uid).then((id) => {
    if (!id) return;
    return crashlytics().then((sink) => sink?.setUserId(id));
  }));
}

/** Forget the user on sign-out: an empty id, and `signed_in` false. */
export function clearUserContext(): void {
  setCrashKey('signed_in', false);
  if (!state.deps?.enabled) return;
  safe(() => crashlytics().then((sink) => sink?.setUserId('')));
}

/**
 * Controlled test events for verifying the pipeline on a device. Available ONLY in a build made with
 * VITE_CRASH_TEST=1 — a value only the store workflows can set, and only when the bundle is NOT being
 * uploaded to Play or TestFlight. Vite replaces the condition at build time, so a normal build contains
 * no reachable crash path at all.
 */
export function crashTestTools(): { nonFatal: () => void; crash: () => void } | null {
  if (import.meta.env.VITE_CRASH_TEST !== '1') return null;
  return {
    nonFatal: () => recordNonFatal('Crashlytics test: controlled non-fatal error', 'app', { crash_test: true }),
    crash: () => safe(() => crashlytics().then((sink) => sink?.crash('Crashlytics test: controlled crash'))),
  };
}

/** Test-only: reset every piece of module state. */
export function __resetObservability(): void {
  state.deps = null;
  state.crashlytics = null;
  state.crashlyticsLoad = null;
  state.reporting = false;
  state.recent.clear();
  state.window = [];
  state.area = 'app';
  state.appKeys = {};
  state.dropped = 0;
}

/** Test/diagnostic: how many reports were dropped by dedup or the rate limit. */
export function droppedReports(): number { return state.dropped; }

/**
 * Which product area a top-level screen belongs to. PURE. An unknown screen is `app`, never a guess.
 * (Screen names are our own view ids — `billing`, `preview` — never user data.)
 */
export function featureAreaForView(view: string): FeatureArea {
  if (view === 'nbi_pro_chat' || view === 'studio' || view === 'engine_builder') return 'agentv3';
  if (view === 'preview') return 'preview';
  if (view === 'billing' || view === 'monetize' || view === 'cost') return 'payments';
  if (view === 'git') return 'github';
  if (view === 'apk' || view === 'appstore') return 'native';
  if (view === 'templates' || view === 'deploy' || view === 'files' || view === 'diff') return 'builder';
  if (view.endsWith('_ai') || view.endsWith('_chat') || view === 'chat' || view === 'professionals' || view === 'imagegen') return 'ai';
  return 'app';
}
