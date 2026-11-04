/**
 * THE AI PROVIDER ON/OFF SWITCHES — a real kill switch, enforced (admin 2026-11-04: "sabhi ai provider (google
 * vertex ai, and gemini ai etc) ko on off karne ka switch banao … admin panel me, ai engine me … 100% real and
 * working").
 *
 * 🔴 WHY THIS IS ITS OWN SYSTEM. NavBharatAI had provider switches before (`serverStats.providerEnabled`). They
 * were removed on 2026-10-11 (audit F16) because NOTHING read them: the panel said "Disable a provider to prevent
 * new requests" and every request routed exactly as before. The audit's verdict stands as this module's contract:
 * *"A real kill switch is built as its own system, with enforcement, an audit trail and rollback."*
 *
 * ENFORCEMENT IS TWO LAYERS, so a path nobody remembered cannot leak:
 *   1. THE KEY IS WITHDRAWN. While a provider is off, its API keys are removed from this server's environment
 *      (and put back, byte for byte, when it is switched on). Every caller already handles "no key" — a ladder
 *      rung is skipped, Surplus admission falls back, the chat router moves on, a feature says "not configured" —
 *      so the platform degrades along the paths it already tests, without a doomed call first.
 *   2. THE NETWORK REFUSES. Every outbound request this process makes (`fetch`, `https.request`, `http2.connect`)
 *      is checked against the switched-off providers' addresses and refused before a socket opens. This catches
 *      the SDK clients created once and cached with the key inside them, and anything layer 1 does not reach.
 *
 * STATE is one Firestore doc shared by every instance; each instance re-reads it every SYNC_MS and applies it.
 * Before the first successful read nothing is off (the platform never starts with providers it cannot explain
 * being dead); after that, a failed read keeps the LAST KNOWN state — a storage blip never switches a provider
 * back on. The panel shows this instance's last sync time, so "has it taken effect?" has an answer.
 */
import { createRequire, syncBuiltinESMExports } from 'node:module';
import type * as HttpsT from 'node:https';
import type * as Http2T from 'node:http2';
import { getServerDb } from './serverDb';

// The REAL builtin module objects. A namespace import (`import * as https`) is a copy in the CJS bundle and
// read-only in ESM, so patching it would change nothing for anyone else. Mutating the builtin object itself is
// what every `require('https')` and (after syncBuiltinESMExports) every ESM import sees.
const nodeRequire = createRequire(`${process.cwd()}/`);
const https = nodeRequire('node:https') as typeof HttpsT;
const http2 = nodeRequire('node:http2') as typeof Http2T;

export interface ProviderFamily {
  /** Same id as the API provider directory row. */
  id: string;
  name: string;
  /** Env key names withdrawn while off. Exact names or patterns. Only AI keys — never a shared infra key. */
  keys: readonly (string | RegExp)[];
  /** Hosts refused while off. A function of env, because base URLs can be overridden. */
  hosts: (env: NodeJS.ProcessEnv) => readonly string[];
  /** Optional: refuse only these paths on the hosts (a host shared with non-AI services). */
  pathPrefix?: RegExp;
}

const hostOf = (url: string | undefined): string[] => {
  if (!url) return [];
  try { return [new URL(url).hostname.toLowerCase()]; } catch { return []; }
};

export const PROVIDER_FAMILIES: readonly ProviderFamily[] = [
  { id: 'surplus', name: 'Surplus', keys: ['SURPLUS_API_KEY'], hosts: (e) => ['api.surplusintelligence.ai', ...hostOf(e.SURPLUS_BASE_URL)] },
  { id: 'router-one', name: 'Router One', keys: ['ROUTER_ONE_API_KEY'], hosts: (e) => ['api.router.one', 'router.one', ...hostOf(e.ROUTER_ONE_BASE_URL)] },
  { id: 'glm', name: 'Z.ai / GLM', keys: [/^GLM_API_KEY/, 'FREE_CHAIN_GLM_API_KEY', 'FREE_CHAIN_GLMX_API_KEY'], hosts: (e) => ['api.z.ai', 'open.bigmodel.cn', ...hostOf(e.GLM_BASE_URL)] },
  { id: 'kimi', name: 'Kimi / Moonshot', keys: [/^KIMI_API_KEY/], hosts: (e) => ['api.moonshot.ai', 'api.moonshot.cn', 'api.kimi.com', ...hostOf(e.KIMI_BASE_URL)] },
  { id: 'anthropic', name: 'Anthropic / Claude', keys: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'VITE_ANTHROPIC_API_KEY', 'VITE_CLAUDE_API_KEY'], hosts: () => ['api.anthropic.com'] },
  { id: 'gemini', name: 'Google Gemini API', keys: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'VITE_GEMINI_API_KEY', 'FREE_CHAIN_GEMINI_API_KEY', 'FREE_CHAIN_GEMINIPAID_API_KEY'], hosts: () => ['generativelanguage.googleapis.com'] },
  // Vertex runs on the server's own Google identity — there is no key to withdraw, so the network layer is its
  // enforcement. Only the Vertex AI endpoints are refused; Firestore, Storage and the rest of Google Cloud are not.
  { id: 'vertex', name: 'Google Vertex AI', keys: [], hosts: () => ['aiplatform.googleapis.com'] },
  { id: 'openai', name: 'OpenAI', keys: ['OPENAI_API_KEY', 'FREE_CHAIN_OPENAI_API_KEY'], hosts: () => ['api.openai.com'] },
  { id: 'xai', name: 'xAI / Grok', keys: ['XAI_API_KEY', 'GROK_API_KEY'], hosts: () => ['api.x.ai'] },
  { id: 'openrouter', name: 'OpenRouter (Nemotron)', keys: ['OPENROUTER_API_KEY', 'NEMOTRON_API_KEY', 'FREE_CHAIN_OPENROUTER_API_KEY'], hosts: (e) => ['openrouter.ai', ...hostOf(e.NEMOTRON_BASE_URL)] },
  { id: 'deepinfra', name: 'DeepInfra', keys: ['DEEPINFRA_API_KEY', 'DEEPINFRA_TOKEN', 'FREE_CHAIN_DEEPINFRA_API_KEY'], hosts: () => ['api.deepinfra.com'] },
  { id: 'cheaperinference', name: 'CheaperInference', keys: ['CHEAPERINFERENCE_API_KEY', 'FREE_CHAIN_CHEAPINF_API_KEY'], hosts: () => ['api.cheaperinference.com'] },
  { id: 'groq', name: 'Groq', keys: ['GROQ_API_KEY', 'FREE_CHAIN_GROQ_API_KEY'], hosts: () => ['api.groq.com'] },
  { id: 'deepseek', name: 'DeepSeek Direct', keys: ['DEEPSEEK_API_KEY', 'FREE_CHAIN_DEEPSEEK_API_KEY'], hosts: () => ['api.deepseek.com'] },
  // Cloudflare's API host also serves DNS for published apps' custom domains — only the Workers AI paths are refused,
  // and only the AI token is withdrawn (CLOUDFLARE_API_TOKEN also manages domains).
  { id: 'cloudflare', name: 'Cloudflare Workers AI', keys: ['CLOUDFLARE_AI_TOKEN', 'FREE_CHAIN_CF_API_KEY'], hosts: () => ['api.cloudflare.com'], pathPrefix: /^\/client\/v4\/accounts\/[^/]+\/ai(\/|$)/ },
  { id: 'pollinations', name: 'Pollinations', keys: ['POLLINATIONS_API_KEY'], hosts: () => ['gen.pollinations.ai', 'image.pollinations.ai', 'text.pollinations.ai'] },
  // Bedrock: the GLM rung AND Nova Sonic voice (SonicBridge) both call bedrock-runtime. The shared AWS credentials are
  // not withdrawn (they are infrastructure); the network layer refuses every Bedrock runtime host.
  { id: 'bedrock', name: 'AWS Bedrock / Nova Sonic', keys: ['BEDROCK_API_KEY'], hosts: () => ['bedrock-runtime.amazonaws.com'] },
  { id: 'nvidia', name: 'NVIDIA Direct', keys: ['FREE_CHAIN_NVIDIA_API_KEY'], hosts: () => ['integrate.api.nvidia.com'] },
  { id: 'modelscope', name: 'ModelScope', keys: ['FREE_CHAIN_MODELSCOPE_API_KEY'], hosts: () => ['api-inference.modelscope.cn'] },
  { id: 'llm7', name: 'LLM7', keys: ['FREE_CHAIN_LLM7_API_KEY'], hosts: () => ['api.llm7.io'] },
  { id: 'bluesminds', name: 'BluesMinds', keys: ['FREE_CHAIN_BLUESMINDS_API_KEY'], hosts: () => ['api.bluesminds.com'] },
  { id: 'requesty', name: 'Requesty', keys: ['FREE_CHAIN_REQUESTY_API_KEY'], hosts: () => ['router.requesty.ai'] },
];

const FAMILY_BY_ID = new Map(PROVIDER_FAMILIES.map((f) => [f.id, f]));
export const isProviderFamilyId = (id: unknown): id is string => typeof id === 'string' && FAMILY_BY_ID.has(id);

// ─── runtime state (this process) ────────────────────────────────────────────────────────────────────────────
let off = new Set<string>();
/** The withdrawn key values, restored exactly when a provider is switched back on. Never leaves this module. */
const withdrawn = new Map<string, Map<string, string>>();

function keyNamesFor(f: ProviderFamily, env: NodeJS.ProcessEnv): string[] {
  const names = Object.keys(env);
  return names.filter((n) => f.keys.some((k) => (typeof k === 'string' ? k === n : k.test(n))));
}

/** Is this provider switched off on this server right now? */
export function isProviderSwitchedOff(id: string): boolean { return off.has(id); }
export function switchedOffProviders(): string[] { return [...off].sort(); }

/**
 * Make `next` the set of switched-off providers on THIS process: withdraw the keys of newly-off providers and
 * restore the keys of newly-on ones. Idempotent. Unknown ids are ignored (a newer instance may know more).
 */
export function applySwitchedOff(next: Iterable<string>, env: NodeJS.ProcessEnv = process.env): void {
  const target = new Set([...next].filter(isProviderFamilyId));
  for (const id of target) {
    if (off.has(id)) {
      // Still off: a key added to env since (a restart race, a test) is withdrawn too.
      const saved = withdrawn.get(id) ?? new Map<string, string>();
      for (const n of keyNamesFor(FAMILY_BY_ID.get(id)!, env)) { if (typeof env[n] === 'string') { saved.set(n, env[n] as string); delete env[n]; } }
      withdrawn.set(id, saved);
      continue;
    }
    const saved = new Map<string, string>();
    for (const n of keyNamesFor(FAMILY_BY_ID.get(id)!, env)) { if (typeof env[n] === 'string') { saved.set(n, env[n] as string); delete env[n]; } }
    withdrawn.set(id, saved);
  }
  for (const id of off) {
    if (target.has(id)) continue;
    for (const [n, v] of withdrawn.get(id) ?? []) if (env[n] === undefined) env[n] = v;
    withdrawn.delete(id);
  }
  off = target;
}

/** Was this provider's key present before it was withdrawn (or is it present now)? Names only. */
export function providerHasKey(id: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const f = FAMILY_BY_ID.get(id);
  if (!f) return false;
  if ((withdrawn.get(id)?.size ?? 0) > 0) return true;
  return keyNamesFor(f, env).some((n) => typeof env[n] === 'string' && (env[n] as string).trim() !== '');
}

// ─── layer 2: the network refuses ────────────────────────────────────────────────────────────────────────────
export class ProviderSwitchedOffError extends Error {
  readonly code = 'PROVIDER_SWITCHED_OFF';
  constructor(readonly providerId: string) {
    // Vendor-free on purpose: this text can reach a user through an error path (White-Label Law).
    super('This AI service is switched off by the administrator.');
    this.name = 'ProviderSwitchedOffError';
  }
}

const hostMatches = (host: string, pattern: string): boolean =>
  host === pattern || host.endsWith(`.${pattern}`) || (pattern === 'bedrock-runtime.amazonaws.com' && /^bedrock-runtime(-fips)?\.[a-z0-9-]+\.amazonaws\.com$/.test(host))
  || (pattern === 'aiplatform.googleapis.com' && /^[a-z0-9-]+-aiplatform\.googleapis\.com$/.test(host));

/** The switched-off provider this request would reach, or null. PURE given state + env. */
export function switchedOffProviderFor(hostname: string, path: string, env: NodeJS.ProcessEnv = process.env): string | null {
  // Until the first successful durable read, never infer Google providers are ON.
  // Their admin OFF setting must survive restart even when storage is unavailable.
  const blocked = lastSync.at === null ? new Set([...off, 'gemini', 'vertex']) : off;
  if (blocked.size === 0) return null;
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '');
  for (const id of blocked) {
    const f = FAMILY_BY_ID.get(id)!;
    if (!f.hosts(env).some((p) => hostMatches(host, p))) continue;
    if (f.pathPrefix && !f.pathPrefix.test(path || '/')) continue;
    return id;
  }
  return null;
}

function targetOf(args: unknown[]): { host: string; path: string } | null {
  const [a, b] = args as [unknown, unknown];
  try {
    if (typeof a === 'string') { const u = new URL(a); return { host: u.hostname, path: u.pathname }; }
    if (a instanceof URL) return { host: a.hostname, path: a.pathname };
    const o = (a && typeof a === 'object' ? a : b) as { hostname?: string; host?: string; path?: string } | undefined;
    if (o && (o.hostname || o.host)) return { host: String(o.hostname || o.host), path: String(o.path || '/').split('?')[0] };
  } catch { /* unparseable target: not ours to judge */ }
  return null;
}

let installed = false;
/**
 * Install the network layer on this process. Must run before any SDK client is created (an SDK keeps the fetch it
 * saw at construction) — server.ts imports `providerSwitchInstall` first for that reason. Idempotent. With nothing
 * switched off every call goes straight through to the original function.
 */
export function installProviderSwitchGuard(): void {
  if (installed) return;
  installed = true;
  const origRequest = https.request;
  const origGet = https.get;
  const wrap = (orig: typeof HttpsT.request) => function (this: unknown, ...args: unknown[]) {
    const req = (orig as (...a: unknown[]) => ReturnType<typeof HttpsT.request>).apply(this, args);
    if (off.size > 0 || lastSync.at === null) {
      const t = targetOf(args);
      const id = t && switchedOffProviderFor(t.host, t.path);
      // Destroyed before the socket connects: the caller gets an ordinary request 'error', nothing is sent.
      if (id) req.destroy(new ProviderSwitchedOffError(id));
    }
    return req;
  };
  (https as { request: unknown }).request = wrap(origRequest);
  (https as { get: unknown }).get = function (this: unknown, ...args: unknown[]) {
    const req = (wrap(origGet as typeof HttpsT.request) as (...a: unknown[]) => ReturnType<typeof HttpsT.get>).apply(this, args);
    return req;
  };
  const origConnect = http2.connect;
  (http2 as { connect: unknown }).connect = function (this: unknown, ...args: unknown[]) {
    const session = (origConnect as (...a: unknown[]) => Http2T.ClientHttp2Session).apply(this, args);
    if (off.size > 0 || lastSync.at === null) {
      const t = targetOf(args);
      const id = t && switchedOffProviderFor(t.host, '/');
      if (id) session.destroy(new ProviderSwitchedOffError(id));
    }
    return session;
  };
  try { syncBuiltinESMExports(); } catch { /* no ESM consumers */ }
  const origFetch = globalThis.fetch;
  if (typeof origFetch === 'function') {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (off.size > 0 || lastSync.at === null) {
        let url: URL | null = null;
        try { url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url); } catch { url = null; }
        const id = url && switchedOffProviderFor(url.hostname, url.pathname);
        if (id) throw new ProviderSwitchedOffError(id);
      }
      return origFetch(input as Parameters<typeof fetch>[0], init);
    }) as typeof fetch;
  }
}

// ─── durable shared state ────────────────────────────────────────────────────────────────────────────────────
export const PROVIDER_SWITCHES_COLLECTION = 'admin_provider_switches';
const DOC = 'state';
export const SYNC_MS = 10_000;
const HISTORY_MAX = 50;

export interface SwitchChange { at: number; by: string; id: string; on: boolean; reason: string }
export interface SwitchState { off: string[]; revision: number; updatedAt: number | null; history: SwitchChange[] }

export class ProviderSwitchConflictError extends Error {}
export class ProviderSwitchInputError extends Error {}

function parseState(d: unknown): SwitchState {
  const x = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
  const offList = Array.isArray(x.off) ? x.off.filter(isProviderFamilyId) : [];
  const history = Array.isArray(x.history) ? (x.history as SwitchChange[]).filter((h) => h && isProviderFamilyId(h.id) && typeof h.on === 'boolean').slice(-HISTORY_MAX) : [];
  return { off: [...new Set(offList)].sort(), revision: Number.isInteger(x.revision) ? (x.revision as number) : 0, updatedAt: typeof x.updatedAt === 'number' ? x.updatedAt : null, history };
}

export async function readSwitchState(): Promise<SwitchState> {
  const db = getServerDb();
  if (!db) throw new Error('Storage unavailable.');
  const snap = await db.collection(PROVIDER_SWITCHES_COLLECTION).doc(DOC).get();
  return parseState(snap.exists ? snap.data() : {});
}

/** Switch one provider on or off, against the revision the admin saw (two admins never overwrite each other). */
export async function writeSwitch(args: { id: unknown; on: unknown; reason: unknown; expectedRevision: unknown; by: string; now?: () => number }): Promise<SwitchState> {
  if (!isProviderFamilyId(args.id)) throw new ProviderSwitchInputError('Unknown provider.');
  if (typeof args.on !== 'boolean') throw new ProviderSwitchInputError('"on" must be true or false.');
  const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
  if (reason.length < 3 || reason.length > 300) throw new ProviderSwitchInputError('Give a reason (3–300 characters) — it is kept in the change history.');
  if (!Number.isInteger(args.expectedRevision)) throw new ProviderSwitchInputError('expectedRevision is required.');
  const db = getServerDb();
  if (!db) throw new Error('Storage unavailable.');
  const ref = db.collection(PROVIDER_SWITCHES_COLLECTION).doc(DOC);
  const now = (args.now ?? Date.now)();
  const next = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = parseState(snap.exists ? snap.data() : {});
    if (cur.revision !== args.expectedRevision) throw new ProviderSwitchConflictError('Someone changed the switches since you loaded them. Reload and try again.');
    const offSet = new Set(cur.off);
    if (args.on) offSet.delete(args.id as string); else offSet.add(args.id as string);
    const state: SwitchState = {
      off: [...offSet].sort(), revision: cur.revision + 1, updatedAt: now,
      history: [...cur.history, { at: now, by: args.by, id: args.id as string, on: args.on as boolean, reason }].slice(-HISTORY_MAX),
    };
    tx.set(ref, state);
    return state;
  });
  applySwitchSnapshot(next, now); // this instance at once; the others within SYNC_MS
  return next;
}

// ─── the sync loop (each instance) ───────────────────────────────────────────────────────────────────────────
let lastSync: { at: number | null; ok: boolean } = { at: null, ok: false };
let appliedRevision = -1;
function applySwitchSnapshot(state: SwitchState, at: number): void {
  // A poll started before an admin write must never restore the old ON state.
  if (state.revision < appliedRevision) return;
  applySwitchedOff(state.off);
  appliedRevision = state.revision;
  lastSync = { at, ok: true };
}
export function lastSwitchSync(): { at: number | null; ok: boolean } { return { ...lastSync }; }

export async function syncSwitchesOnce(now: () => number = Date.now): Promise<void> {
  try {
    const s = await readSwitchState();
    applySwitchSnapshot(s, now());
  } catch {
    // Keep the last known state: a storage blip must never switch a provider back on.
    lastSync = { at: lastSync.at, ok: false };
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startProviderSwitchSync(): void {
  if (timer) return;
  void syncSwitchesOnce();
  timer = setInterval(() => { void syncSwitchesOnce(); }, SYNC_MS);
  (timer as { unref?: () => void }).unref?.();
}

/** Test hook: back to the boot state. */
export function __resetProviderSwitchesForTests(env: NodeJS.ProcessEnv = process.env): void {
  applySwitchedOff([], env);
  off = new Set();
  withdrawn.clear();
  appliedRevision = -1;
  lastSync = { at: null, ok: false };
}
