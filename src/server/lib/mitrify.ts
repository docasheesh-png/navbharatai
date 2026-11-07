import { setTimeout as delay } from 'node:timers/promises';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

/** Server-only transport. No upstream provider catalogue, pricing or capability assumptions. */
type Env = Record<string, string | undefined>;
type Log = (metadata: Record<string, unknown>) => void;
const defaultLog: Log = metadata => console.info('[MITRIFY]', JSON.stringify(metadata));
const headerNames = ['X-Mitrify-Request-Id', 'X-Mitrify-Provider', 'X-Mitrify-Model', 'X-Mitrify-Attempts', 'X-Mitrify-Trail'] as const;
const standardFields = new Set(['model', 'messages', 'stream', 'stream_options', 'temperature', 'max_tokens', 'max_completion_tokens', 'top_p', 'n', 'stop', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'logprobs', 'top_logprobs', 'seed']);

// AI_BACKEND is canonical. Its explicit value always wins, including rollback to
// direct. AI_PROVIDER is a compatibility alias only when AI_BACKEND is unset/blank.
function backend(env: Env): string { return env.AI_BACKEND?.trim() || env.AI_PROVIDER?.trim() || 'direct'; }

/** Stop waiting on non-cooperative dependencies without retaining a capacity permit. */
async function untilCancelled<T>(work: () => T | Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new MitrifyError('MITRIFY_CANCELLED'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }), cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

const mitrifyModel = (env: Env) => env.MITRIFY_MODEL?.trim() || 'mitrify/auto-cheap';

/** No caller flag/regex can prove the entire ordinary-chat payload public. An exact server approval and shared monetary hold are additionally required. */
export function mitrifyChainStatus(dataClass: string, capability: string, env: Env = process.env) {
  return { model: mitrifyModel(env), eligible: false as const, reason: env.MITRIFY_CHAIN_ENABLED !== '1' ? 'mitrify-chain-disabled'
    : capability !== 'text' ? 'mitrify-capability-excluded' : dataClass !== 'public' ? 'mitrify-privacy-blocked'
    : 'mitrify-public-provenance-and-spend-admission-unavailable' };
}

/** Exact-payload approval, written only by an existing trusted server operator.
 * It is NOT minted from a caller checkbox, UID, regex or an estimated token price.
 * No approval writer or new account/data access is exposed by this module.
 */
export function mitrifyChainBinding(uid: string, body: Record<string, unknown>, env: Env = process.env) {
  const cfg = mitrifyConfig(env);
  const wire = JSON.stringify({ ...body, model: cfg.model,
    ...(body.stream === true ? { stream_options: { ...(body.stream_options as object ?? {}), include_usage: true } } : {}) });
  const gateway = { baseURL: cfg.baseURL, model: cfg.model,
    credentialBinding: createHash('sha256').update('mitrify-chain-credential-v1\0').update(cfg.apiKey).digest('hex') };
  const payloadDigest = createHash('sha256').update(wire).digest('hex');
  return { id: createHash('sha256').update(JSON.stringify({ uid, payloadDigest, gateway })).digest('hex'), payloadDigest, gateway };
}

/** Reads an independently reviewed approval, then owns one durable dispatch claim.
 * The supplier contract must enforce the stated ceiling PER HTTP REQUEST including
 * all its internal retries/failovers/fees. Four transport attempts are reserved in
 * the caller's existing shared daily/monthly pool; no new budget is manufactured.
 * Used holds remain conservative liabilities, never inferred actual invoice cost.
 */
export async function runApprovedMitrifyChain(options: {
  db: Firestore; uid: string; body: Record<string, unknown>; privateTurn: boolean; healthTurn: boolean;
  requestId: string; signal: AbortSignal; maxHttpAttempts?: number; onChunk?: (text: string) => void; revalidate?: () => Promise<void>;
  reserve: (maximumNanoUsd: number) => Promise<null | { releaseUndispatched(): Promise<void> }>;
}, env: Env = process.env, log: Log = defaultLog): Promise<
  { kind: 'skipped'; reason: string } |
  { kind: 'response'; content: string; model: string; usage?: { inputTokens: number; outputTokens: number } }
> {
  if (env.MITRIFY_CHAIN_ENABLED !== '1') return { kind: 'skipped', reason: 'mitrify-chain-disabled' };
  // These exclusions are never downgraded, even by a stale or mistaken approval.
  if (options.privateTurn || options.healthTurn) return { kind: 'skipped', reason: 'mitrify-privacy-blocked' };
  const maxHttpAttempts = options.maxHttpAttempts ?? 4;
  if (!Number.isInteger(maxHttpAttempts) || maxHttpAttempts < 1 || maxHttpAttempts > 4) throw new MitrifyError('MITRIFY_CONFIGURATION');
  const cfg = mitrifyConfig(env);
  if (!cfg.apiKey) return { kind: 'skipped', reason: 'mitrify-configuration' };
  // Snapshot before any async boundary; later mutation cannot alter reviewed content or credentials.
  const requestEnv = { ...env, MITRIFY_BASE_URL: cfg.baseURL, MITRIFY_MODEL: cfg.model, MITRIFY_API_KEY: cfg.apiKey };
  const body = JSON.parse(JSON.stringify(options.body)) as Record<string, unknown>;
  if (Object.keys(body).some(k => !standardFields.has(k)) || !Array.isArray(body.messages) || !body.messages.length
    || body.messages.some(m => !m || typeof m !== 'object' || !['system', 'developer', 'user', 'assistant'].includes(m.role)
      || typeof m.content !== 'string' || Object.keys(m).some(k => !['role', 'content'].includes(k)))) {
    return { kind: 'skipped', reason: 'mitrify-capability-excluded' };
  }
  const binding = mitrifyChainBinding(options.uid, body, requestEnv);
  const ref = options.db.doc(`mitrify_chain_approvals/${binding.id}`);
  const policyDigest = (a: any) => JSON.stringify([a.uid, a.payloadDigest, a.gateway?.baseURL, a.gateway?.model, a.gateway?.credentialBinding, a.publicReview?.entirePayloadReviewed, a.publicReview?.containsSensitiveData, a.publicReview?.reviewRef, a.supplierContract?.currency, a.supplierContract?.hardCeilingEnforced, a.supplierContract?.includesInternalRetriesFailoversAndFees, a.supplierContract?.evidenceRef, a.supplierContract?.perHttpRequestCeilingNanoUsd, a.reviewedAtMs, a.expiresAtMs]);
  const now = Date.now();
  const approval = await untilCancelled(() => options.db.runTransaction(async tx => {
    const a = (await tx.get(ref)).data();
    if (!a || a.kind !== 'mitrify-exact-public-approval-v1' || a.uid !== options.uid || a.payloadDigest !== binding.payloadDigest
      || (a.gateway?.baseURL !== binding.gateway.baseURL || a.gateway?.model !== binding.gateway.model || a.gateway?.credentialBinding !== binding.gateway.credentialBinding) || a.state !== 'approved'
      || a.publicReview?.entirePayloadReviewed !== true || a.publicReview?.containsSensitiveData !== false
      || typeof a.publicReview?.reviewRef !== 'string' || !a.publicReview.reviewRef.trim()
      || !Number.isSafeInteger(a.reviewedAtMs) || a.reviewedAtMs > now || !Number.isSafeInteger(a.expiresAtMs)
      || a.expiresAtMs <= now || a.expiresAtMs > a.reviewedAtMs + 3600000
      || a.supplierContract?.currency !== 'USD' || a.supplierContract?.hardCeilingEnforced !== true
      || a.supplierContract?.includesInternalRetriesFailoversAndFees !== true
      || typeof a.supplierContract?.evidenceRef !== 'string' || !a.supplierContract.evidenceRef.trim()
      || !Number.isSafeInteger(a.supplierContract?.perHttpRequestCeilingNanoUsd)
      || a.supplierContract.perHttpRequestCeilingNanoUsd <= 0
      || !Number.isSafeInteger(a.supplierContract.perHttpRequestCeilingNanoUsd * 4)) return null;
    options.signal.throwIfAborted();
    tx.update(ref, { state: 'claimed', requestId: options.requestId, claimedAtMs: now, attemptsStarted: 0, maxHttpAttempts });
    return { maximumNanoUsd: a.supplierContract.perHttpRequestCeilingNanoUsd * maxHttpAttempts, expiresAtMs: a.expiresAtMs, policyDigest: policyDigest(a) };
  }), options.signal).catch(() => { throw new MitrifyError(options.signal.aborted ? 'MITRIFY_CANCELLED' : 'MITRIFY_ADMISSION_FAILED'); });
  if (!approval) return { kind: 'skipped', reason: 'mitrify-public-approval-or-ceiling-unavailable' };
  let hold: Awaited<ReturnType<typeof options.reserve>> = null;
  let released = false;
  const releaseUnused = async () => { if (hold && !entered && !released) { released = true; try { await hold.releaseUndispatched(); } catch { log({ code: 'MITRIFY_UNUSED_HOLD_RELEASE_FAILED' }); } } };
  let entered = false; let content = ''; let usage: { inputTokens: number; outputTokens: number } | undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, approval.expiresAtMs - Date.now()));
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const inspect = (data: any) => {
    const choice = data?.choices?.[0];
    if (choice?.delta?.tool_calls || choice?.delta?.function_call || choice?.message?.tool_calls || choice?.message?.function_call
      || choice?.delta?.refusal || choice?.message?.refusal || ['content_filter', 'safety', 'sensitive'].includes(choice?.finish_reason)) throw new MitrifyError('MITRIFY_POLICY_BLOCKED', 0, !!content);
    const text = choice?.delta?.content ?? choice?.message?.content;
    if (typeof text === 'string') { content += text; options.onChunk?.(text); }
    const u = data?.usage;
    if (Number.isSafeInteger(u?.prompt_tokens) && u.prompt_tokens >= 0 && Number.isSafeInteger(u?.completion_tokens) && u.completion_tokens >= 0) usage = { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens };
    if (choice?.finish_reason === 'length') throw new MitrifyError('MITRIFY_INCOMPLETE_STREAM', 0, !!content);
  };
  try {
    signal.throwIfAborted();
    // Observe and clean up late reservations without delaying cancellation.
    const pendingHold = options.reserve(approval.maximumNanoUsd).then(async receipt => { hold = receipt; if (signal.aborted) await releaseUnused(); return receipt; });
    await untilCancelled(() => pendingHold, signal);
    signal.throwIfAborted();
    if (!hold) return { kind: 'skipped', reason: 'mitrify-budget' };
    const result = await createMitrifyClient(requestEnv, log).chat(body, { signal, maxAttempts: maxHttpAttempts,
      beforeAttempt: async () => {
        if (env.MITRIFY_CHAIN_ENABLED !== '1' || mitrifyChainBinding(options.uid, body, env).id !== binding.id) throw new MitrifyError('MITRIFY_APPROVAL_REVOKED');
        await untilCancelled(async () => { await options.revalidate?.(); }, signal);
        await untilCancelled(() => options.db.runTransaction(async tx => {
          const a = (await tx.get(ref)).data();
          if (!a || a.state !== 'claimed' || a.requestId !== options.requestId || policyDigest(a) !== approval.policyDigest || a.expiresAtMs !== approval.expiresAtMs
            || a.expiresAtMs <= Date.now() || !Number.isSafeInteger(a.attemptsStarted) || a.attemptsStarted < 0 || a.maxHttpAttempts !== maxHttpAttempts || a.attemptsStarted >= maxHttpAttempts) throw new MitrifyError('MITRIFY_APPROVAL_REVOKED');
          signal.throwIfAborted(); tx.update(ref, { attemptsStarted: a.attemptsStarted + 1 });
        }), signal);
        // Conservatively retain the hold if cancellation/crash races the actual fetch.
        entered = true;
      },
      ...(body.stream === true ? { onChunk: (wire: Uint8Array) => {
        const payload = new TextDecoder().decode(wire).split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (payload && payload !== '[DONE]') inspect(JSON.parse(payload));
      } } : {}),
    });
    if (body.stream !== true) inspect(result.data);
    signal.throwIfAborted();
    if (!content.trim()) throw new MitrifyError('MITRIFY_INVALID_RESPONSE');
    return { kind: 'response', content, model: cfg.model, ...(usage ? { usage } : {}) };
  } catch (error) {
    // Once an HTTP attempt may have begun, liability and failure are terminal to the chain.
    throw new MitrifyError(error instanceof MitrifyError ? error.code : signal.aborted ? 'MITRIFY_CANCELLED' : 'MITRIFY_ADMISSION_FAILED', error instanceof MitrifyError ? error.status : 0, !!content);
  } finally {
    clearTimeout(timer); controller.abort();
    await releaseUnused();
  }
}

export function mitrifyConfig(env: Env = process.env) {
  const maxInflight = env.MITRIFY_MAX_INFLIGHT?.trim() ? Number(env.MITRIFY_MAX_INFLIGHT) : 200;
  if (!Number.isInteger(maxInflight) || maxInflight < 1 || maxInflight > 1000) throw new MitrifyError('MITRIFY_CONFIGURATION');
  return {
    enabled: backend(env) === 'mitrify', maxInflight,
    baseURL: env.MITRIFY_BASE_URL?.trim() || 'https://mitrify.com/v1',
    apiKey: env.MITRIFY_API_KEY?.trim() || '',
    model: mitrifyModel(env),
  };
}

/**
 * General chat is health/clinical, including when profile/history are empty.
 * Third-party free-model providers and Surplus sellers receive the whole prompt:
 * never route health records, personal identifiers, payments or sensitive data here.
 * No browser flag or keyword test can authorize disclosure to public-only models.
 * Keep the existing callback intact until a reviewed server-owned boundary exists.
 */
export function withMitrifyChatPrivacyBoundary<T>(direct: () => Promise<T>, env: Env = process.env, log: Log = defaultLog): Promise<T> {
  if (env.AI_BACKEND?.trim() && env.AI_PROVIDER?.trim() && env.AI_BACKEND.trim() !== env.AI_PROVIDER.trim()) log({ code: 'MITRIFY_LEGACY_SWITCH_IGNORED' });
  if (backend(env) === 'mitrify') log({ code: 'MITRIFY_PRIVACY_BLOCKED', selected: 'direct', dataClass: 'health' });
  return direct();
}

// Presets remain for old clients. New clients submit one explicitly reviewed public
// message; profile, history, files and client-authored model parameters are rejected.
const publicQuestions = [
  { id: 'arithmetic', label: 'What is 2 + 2?', prompt: 'What is 2 + 2? Reply with only the number.' },
  { id: 'rainbow', label: 'Why does a rainbow appear?', prompt: 'Explain why a rainbow appears in three short sentences.' },
  { id: 'solar-system', label: 'Explain the solar system', prompt: 'Explain the solar system in three short sentences for a beginner.' },
] as const;
type Identify = () => Promise<{ uid: string; email: string | null; emailVerified: boolean } | null>;

async function authorizePublicBot(identify: Identify, signal: AbortSignal, env: Env) {
  const identity = await untilCancelled(identify, signal);
  if (!identity?.uid || !identity.emailVerified || !identity.email?.trim()) {
    throw new MitrifyError('MITRIFY_BOT_FORBIDDEN', 403);
  }
  // Default/rollback preserves the existing single-account boundary. Unknown modes
  // fail closed; neither a browser flag nor a missing selector enables public access.
  const access = env.MITRIFY_BOT_ACCESS?.trim() || 'selected';
  if (access !== 'selected' && access !== 'verified') throw new MitrifyError('MITRIFY_CONFIGURATION', 503);
  if (access === 'selected') {
    const target = env.MITRIFY_CHAT_ACCOUNT_EMAIL?.trim().toLowerCase();
    if (!target || identity.email.trim().toLowerCase() !== target) throw new MitrifyError('MITRIFY_BOT_FORBIDDEN', 403);
  }
  signal.throwIfAborted();
  return identity;
}

/** Visibility is server-authorized even when the bot is disabled or unconfigured. */
export async function mitrifyPublicBotStatus(identify: Identify, signal: AbortSignal, env: Env = process.env) {
  await authorizePublicBot(identify, signal, env);
  const config = mitrifyConfig(env);
  return { available: config.enabled && Boolean(config.apiKey), questions: publicQuestions.map(({ id, label }) => ({ id, label })) };
}

/** Defense in depth only: user review is still required; this is not a complete PII detector. */
function recognizableSensitiveText(text: string): boolean {
  return /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text)
    || /(?:\d[\s().+-]*){7,}/.test(text)
    || /\b(?:bearer\s+\S+|(?:api[_ -]?key|password|secret|private key)\s*[:=]|sk-[a-z0-9_-]{8,})/i.test(text)
    || /\b(?:patients?|medical records?|health records?|lab reports?|prescriptions?|diagnosis|my symptoms|my name is|my address|date of birth|passport|aadhaar|aadhar|credit card|bank account|account number|upi id)\b/i.test(text)
    || /मेरा नाम|मेरा पता|आधार|मरीज|रोगी|मेडिकल रिपोर्ट|बैंक खाता/.test(text);
}

/** Separate, user-reviewed public-text bot; never invokes direct providers. */
export async function runMitrifyPublicBot(options: { body: unknown; identify: Identify; signal: AbortSignal; continuation?: MitrifyContinuationRuntime }, env: Env = process.env, log: Log = defaultLog) {
  const identity = await authorizePublicBot(options.identify, options.signal, env);
  if (backend(env) !== 'mitrify') throw new MitrifyError('MITRIFY_BOT_DISABLED', 503);
  const body = options.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new MitrifyError('MITRIFY_BOT_PUBLIC_QUESTION_REQUIRED', 400);
  }
  const fields = body as Record<string, unknown>;
  let prompt: string;
  if (Object.keys(fields).length === 1 && Object.hasOwn(fields, 'questionId')) {
    // Compatibility for older installed clients; they can still send the reviewed presets.
    const question = publicQuestions.find(item => item.id === fields.questionId);
    if (!question) throw new MitrifyError('MITRIFY_BOT_PUBLIC_QUESTION_REQUIRED', 400);
    prompt = question.prompt;
  } else {
    if (!Object.hasOwn(fields, 'message')) throw new MitrifyError('MITRIFY_BOT_PUBLIC_QUESTION_REQUIRED', 400);
    if (Object.keys(fields).length !== 2 || !Object.hasOwn(fields, 'message') || !Object.hasOwn(fields, 'publicContentConfirmed')
      || fields.publicContentConfirmed !== true || typeof fields.message !== 'string' || !fields.message.trim() || fields.message.length > 2000) {
      throw new MitrifyError('MITRIFY_BOT_REVIEW_REQUIRED', 400);
    }
    if (recognizableSensitiveText(fields.message)) throw new MitrifyError('MITRIFY_BOT_SENSITIVE_CONTENT', 400);
    prompt = fields.message; // Preserve the reviewed message exactly; never append profile/history.
  }
  const maxOutputTokens = mitrifyBotOutputTokens(env);
  const result = await createMitrifyClient(env, log).chat({ messages: [{ role: 'user', content: prompt }], max_tokens: maxOutputTokens, stream: false }, { signal: options.signal });
  const reply = mitrifyBotReply(result.data);
  if (reply.completion !== 'length') return reply;
  const continuation = await offerMitrifyContinuation(options.continuation, { uid: identity.uid, prompt, answer: reply.reply, usedRounds: 0,
    expiresAtMs: Date.now() + 600000, maxOutputTokens }, options.signal, env);
  return { ...reply, continuation };
}

function mitrifyBotOutputTokens(env: Env): number {
  // Output allowance is not monetary authorization or a model capability claim.
  const n = env.MITRIFY_BOT_MAX_OUTPUT_TOKENS?.trim() ? Number(env.MITRIFY_BOT_MAX_OUTPUT_TOKENS) : 8192;
  if (!Number.isSafeInteger(n) || n < 1 || n > 32768) throw new MitrifyError('MITRIFY_CONFIGURATION', 503);
  return n;
}
function mitrifyBotReply(data: unknown) {
  const choice = (data as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }> })?.choices?.[0];
  const reply = choice?.message?.content;
  if (typeof reply !== 'string' || !reply.trim()) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', 502);
  const completion = choice?.finish_reason === 'stop' ? 'complete' as const
    : choice?.finish_reason === 'length' ? 'length' as const
    : choice?.finish_reason === 'content_filter' ? 'filtered' as const : 'unconfirmed' as const;
  return { reply, completion };
}

const continuationInstruction = 'Continue the answer from where it stopped. Do not repeat earlier text. If the answer is already complete, say so.';
const continuationInputBytes = 32768;
const continuationRounds = 3;
type ContinuationGateway = { baseURL: string; model: string; credentialFingerprint: string };
/** Trusted server adapter only. Must atomically authorize the verified payer and
 * reserve/enforce a finite monetary ceiling for this exact request, credential,
 * endpoint and model, including all supplier failovers/fees. Reject expired,
 * exhausted or uncertain funding; never release uncertain liability. No production
 * implementation is supplied. A token estimate, checkbox or local nonce is NOT funding.
 * The adapter must invoke execute at most once and must not retry it.
 */
export interface MitrifyContinuationAdmission {
  runOnce<T>(claim: { uid: string; requestId: string; requestDigest: string; gateway: ContinuationGateway;
    maxHttpAttempts: 1; maxOutputTokens: number; signal: AbortSignal }, execute: () => Promise<T>): Promise<T>;
}
export type MitrifyContinuationRuntime = { db: Firestore; admission: MitrifyContinuationAdmission };
type ContinuationContext = { uid: string; prompt: string; answer: string; usedRounds: number; expiresAtMs: number; maxOutputTokens: number };
const continuationDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function continuationGateway(env: Env): ContinuationGateway {
  const cfg = mitrifyConfig(env);
  return { baseURL: cfg.baseURL, model: cfg.model, credentialFingerprint: continuationDigest(cfg.apiKey) };
}
function continuationBody(prompt: string, answer: string, maxOutputTokens: number, env: Env) {
  return { model: mitrifyModel(env), messages: [{ role: 'user', content: prompt }, { role: 'assistant', content: answer },
    { role: 'user', content: continuationInstruction }], max_tokens: maxOutputTokens, stream: false };
}
async function offerMitrifyContinuation(runtime: MitrifyContinuationRuntime | undefined, context: ContinuationContext, signal: AbortSignal, env: Env) {
  const unavailable = (reason: string) => ({ available: false as const, reason });
  if (!runtime?.admission || !runtime.db) return unavailable('funding-unavailable');
  if (context.usedRounds >= continuationRounds) return unavailable('round-limit');
  if (context.expiresAtMs <= Date.now()) return unavailable('expired');
  const body = continuationBody(context.prompt, context.answer, context.maxOutputTokens, env);
  if (Buffer.byteLength(JSON.stringify(body)) > continuationInputBytes) return unavailable('context-limit');
  const ticket = randomUUID();
  try {
    await untilCancelled(() => runtime.db.doc(`mitrify_bot_continuations/${ticket}`).create({ kind: 'mitrify-continuation-v1',
      uid: context.uid, contextDigest: continuationDigest([context.prompt, context.answer]), gatewayDigest: continuationDigest(continuationGateway(env)),
      state: 'offered', usedRounds: context.usedRounds, expiresAtMs: context.expiresAtMs, maxOutputTokens: context.maxOutputTokens,
      instructionDigest: continuationDigest(continuationInstruction) }), signal);
    signal.throwIfAborted();
    return { available: true as const, ticket, instruction: continuationInstruction, roundsRemaining: continuationRounds - context.usedRounds };
  } catch { if (signal.aborted) throw new MitrifyError('MITRIFY_CANCELLED'); return unavailable('admission-unavailable'); } // Never log/store text.
}

/** Explicitly reviewed context only. Production route passes no funding adapter and
 * therefore fails closed. Neither an environment variable nor caller data grants it.
 */
export async function runMitrifyContinuation(options: { body: unknown; identify: Identify; signal: AbortSignal;
  continuation?: MitrifyContinuationRuntime }, env: Env = process.env, log: Log = defaultLog) {
  const identity = await authorizePublicBot(options.identify, options.signal, env);
  if (backend(env) !== 'mitrify') throw new MitrifyError('MITRIFY_BOT_DISABLED', 503);
  const runtime = options.continuation;
  if (!runtime?.admission || !runtime.db) throw new MitrifyError('MITRIFY_CONTINUATION_FUNDING_UNAVAILABLE', 503);
  const b = options.body as Record<string, unknown> | null;
  if (!b || Array.isArray(b) || Object.keys(b).length !== 5
    || Object.keys(b).some(k => !['ticket', 'prompt', 'answer', 'reviewedInstruction', 'publicContentConfirmed'].includes(k))
    || typeof b.ticket !== 'string' || !/^[a-f0-9-]{36}$/.test(b.ticket)
    || typeof b.prompt !== 'string' || !b.prompt.trim() || b.prompt.length > 2000
    || typeof b.answer !== 'string' || !b.answer.trim() || b.publicContentConfirmed !== true
    || b.reviewedInstruction !== continuationInstruction) throw new MitrifyError('MITRIFY_CONTINUATION_REVIEW_REQUIRED', 400);
  if (recognizableSensitiveText(b.prompt) || recognizableSensitiveText(b.answer)) throw new MitrifyError('MITRIFY_BOT_SENSITIVE_CONTENT', 400);
  const cfg = mitrifyConfig(env);
  const requestEnv = { ...env, MITRIFY_BASE_URL: cfg.baseURL, MITRIFY_MODEL: cfg.model, MITRIFY_API_KEY: cfg.apiKey };
  const maxOutputTokens = mitrifyBotOutputTokens(env);
  const body = continuationBody(b.prompt, b.answer, maxOutputTokens, requestEnv);
  if (Buffer.byteLength(JSON.stringify(body)) > continuationInputBytes) throw new MitrifyError('MITRIFY_CONTINUATION_CONTEXT_LIMIT', 413);
  const gateway = continuationGateway(requestEnv);
  const ticket = b.ticket, prompt = b.prompt, answer = b.answer;
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(60000)]);
  const ref = runtime.db.doc(`mitrify_bot_continuations/${ticket}`);
  const record = await untilCancelled(() => runtime.db.runTransaction(async tx => {
    const r = (await tx.get(ref)).data();
    const now = Date.now();
    if (!r || r.kind !== 'mitrify-continuation-v1' || r.state !== 'offered' || r.uid !== identity.uid
      || r.contextDigest !== continuationDigest([prompt, answer]) || r.gatewayDigest !== continuationDigest(gateway)
      || r.instructionDigest !== continuationDigest(continuationInstruction) || r.maxOutputTokens !== maxOutputTokens
      || !Number.isSafeInteger(r.usedRounds) || r.usedRounds < 0 || r.usedRounds >= continuationRounds
      || !Number.isSafeInteger(r.expiresAtMs) || r.expiresAtMs <= now || r.expiresAtMs > now + 600000) throw new MitrifyError('MITRIFY_CONTINUATION_EXPIRED_OR_USED', 409);
    signal.throwIfAborted();
    tx.update(ref, { state: 'claimed' }); // Never refund the claim, including cancellation or unknown charging.
    return { usedRounds: r.usedRounds as number, expiresAtMs: r.expiresAtMs as number, policyDigest: continuationDigest([r.uid, r.contextDigest, r.gatewayDigest, r.usedRounds, r.expiresAtMs, r.maxOutputTokens, r.instructionDigest]) };
  }), signal).catch(error => { throw error instanceof MitrifyError ? error : new MitrifyError('MITRIFY_CONTINUATION_ADMISSION_FAILED', 503); });
  const controller = new AbortController();
  const executionSignal = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(Math.max(0, record.expiresAtMs - Date.now()))]);
  let entered = false;
  try {
    const result = await untilCancelled(() => runtime.admission.runOnce({ uid: identity.uid, requestId: ticket,
      requestDigest: continuationDigest(body), gateway, maxHttpAttempts: 1, maxOutputTokens, signal: executionSignal }, async () => {
      executionSignal.throwIfAborted();
      if (entered || Date.now() >= record.expiresAtMs || backend(env) !== 'mitrify'
        || continuationDigest(continuationGateway(env)) !== continuationDigest(gateway)) throw new MitrifyError('MITRIFY_CONTINUATION_EXPIRED_OR_USED', 409);
      entered = true; // Set before any await, including a misbehaving adapter's second callback.
      const currentIdentity = await authorizePublicBot(options.identify, executionSignal, env);
      const current = await untilCancelled(() => ref.get(), executionSignal);
      const r = current.data();
      if (currentIdentity.uid !== identity.uid || mitrifyBotOutputTokens(env) !== maxOutputTokens || !r || r.state !== 'claimed'
        || continuationDigest([r.uid, r.contextDigest, r.gatewayDigest, r.usedRounds, r.expiresAtMs, r.maxOutputTokens, r.instructionDigest]) !== record.policyDigest) throw new MitrifyError('MITRIFY_CONTINUATION_EXPIRED_OR_USED', 409);
      return createMitrifyClient(requestEnv, log).chat(body, { signal: executionSignal, maxAttempts: 1 });
    }), executionSignal);
    executionSignal.throwIfAborted();
    if (!entered) throw new MitrifyError('MITRIFY_CONTINUATION_ADMISSION_FAILED', 503);
    const reply = mitrifyBotReply(result.data);
    if (reply.completion !== 'length') return reply;
    const continuation = await offerMitrifyContinuation(runtime, { uid: identity.uid, prompt, answer: answer + '\n\n' + reply.reply,
      usedRounds: record.usedRounds + 1, expiresAtMs: record.expiresAtMs, maxOutputTokens }, executionSignal, requestEnv);
    return { ...reply, continuation };
  } catch (error) {
    throw error instanceof MitrifyError ? error : new MitrifyError(executionSignal.aborted ? 'MITRIFY_CANCELLED' : 'MITRIFY_CONTINUATION_ADMISSION_FAILED', 503);
  } finally { controller.abort(); }
}

/** Controlled synthetic traffic without Firebase login; not anonymous free-form chat. */
export function mitrifyGuestTestTokenValid(token: unknown, env: Env = process.env): boolean {
  const expected = env.MITRIFY_GUEST_TEST_TOKEN || '';
  if (env.MITRIFY_GUEST_TEST_ENABLED !== '1' || expected.length < 32 || expected.length > 512 || typeof token !== 'string' || token.length > 512) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(token), digest(expected));
}

/**
 * Shared immutable slots cap a campaign at 10 + 100 + 1000 admitted calls. Claims
 * are never refunded (including abort/failure), and transport retries reuse a claim.
 * The server-owned campaign must bind an already enforced inclusive USD ceiling
 * to this exact credential/endpoint/model. This ledger is NOT a monetary cap.
 */
export async function runMitrifyGuestTest(options: {
  body: unknown; token: unknown; signal: AbortSignal;
  db: Pick<Firestore, 'doc' | 'runTransaction'> | null;
}, env: Env = process.env, log: Log = defaultLog) {
  if (!mitrifyGuestTestTokenValid(options.token, env)) throw new MitrifyError('MITRIFY_GUEST_TEST_FORBIDDEN', 403);
  const config = mitrifyConfig(env);
  const campaignId = env.MITRIFY_GUEST_TEST_CAMPAIGN || '';
  if (!config.enabled || !config.apiKey || !/^[a-zA-Z0-9_-]{1,64}$/.test(campaignId) || !options.db) {
    throw new MitrifyError('MITRIFY_GUEST_TEST_UNAVAILABLE', 503);
  }
  const body = options.body as Record<string, unknown> | null;
  if (!body || Array.isArray(body) || Object.keys(body).length !== 2
    || ![10, 100, 1000].includes(body.batch as number) || !Number.isInteger(body.slot)
    || (body.slot as number) < 0 || (body.slot as number) >= (body.batch as number)) {
    throw new MitrifyError('MITRIFY_GUEST_TEST_INVALID_SLOT', 400);
  }
  const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');
  const tokenFingerprint = fingerprint(env.MITRIFY_GUEST_TEST_TOKEN!);
  const requestEnv = { MITRIFY_BASE_URL: config.baseURL, MITRIFY_MODEL: config.model,
    MITRIFY_API_KEY: config.apiKey, MITRIFY_MAX_INFLIGHT: String(config.maxInflight) };
  const campaign = options.db.doc(`mitrify_test_campaigns/${campaignId}`);
  const claim = options.db.doc(`mitrify_test_campaigns/${campaignId}/claims/${body.batch}-${body.slot}`);
  const expiresAtMs = await untilCancelled(() => options.db!.runTransaction(async tx => {
    options.signal.throwIfAborted();
    const record = (await tx.get(campaign)).data();
    const now = Date.now();
    if (!record || record.enabled !== true || !Number.isSafeInteger(record.createdAtMs)
      || !Number.isSafeInteger(record.expiresAtMs) || record.createdAtMs > now || record.expiresAtMs <= now
      || record.expiresAtMs - record.createdAtMs <= 0 || record.expiresAtMs - record.createdAtMs > 3_600_000
      || record.baseURL !== config.baseURL || record.model !== config.model
      || record.credentialFingerprint !== fingerprint(config.apiKey)
      || record.tokenFingerprint !== tokenFingerprint
      || record.includesAllCharges !== true || record.hardCapConfirmed !== true
      || typeof record.maxTotalUsd !== 'number' || !Number.isFinite(record.maxTotalUsd)
      || record.maxTotalUsd <= 0 || record.maxTotalUsd > 10) {
      throw new MitrifyError('MITRIFY_GUEST_TEST_UNAVAILABLE', 503);
    }
    if ((await tx.get(claim)).exists) throw new MitrifyError('MITRIFY_GUEST_TEST_REPLAY', 409);
    options.signal.throwIfAborted();
    tx.create(claim, { admittedAtMs: now }); // No identifiers, prompts, tokens or fingerprints in claims.
    return record.expiresAtMs as number;
  }), options.signal).catch(error => {
    if (error instanceof MitrifyError) throw error;
    throw new MitrifyError('MITRIFY_GUEST_TEST_UNAVAILABLE', 503);
  });
  options.signal.throwIfAborted();
  const remainingMs = expiresAtMs - Date.now();
  if (remainingMs <= 0) throw new MitrifyError('MITRIFY_GUEST_TEST_UNAVAILABLE', 503);
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(Math.min(60_000, remainingMs))]);
  return createMitrifyClient(requestEnv, log).chat({
    messages: [{ role: 'user', content: 'What is 2 + 2? Reply with only the number.' }],
    max_tokens: 16, temperature: 0, stream: false,
  }, { signal });
}

// One FIFO for every client in this process: never one pool per key/model/client.
// Limits retained serialized request bytes, not total heap or Cloud Run fleet concurrency.
const activeCalls = new Set<{ limit: number }>();
const pendingCalls: QueueEntry[] = [];
let retainedBytes = 0;
type QueueEntry = { limit: number; bytes: number; signal: AbortSignal; settled: boolean;
  resolve: (release: () => void) => void; reject: (error: Error) => void; cleanup: () => void };
function dropQueued(entry: QueueEntry, error: Error) {
  if (entry.settled) return;
  entry.settled = true; entry.cleanup();
  pendingCalls.splice(pendingCalls.indexOf(entry), 1); retainedBytes -= entry.bytes;
  entry.reject(error);
}
function drainQueue() {
  while (pendingCalls.length) {
    const entry = pendingCalls[0];
    if (entry.signal.aborted) { dropQueued(entry, new MitrifyError('MITRIFY_CANCELLED')); continue; }
    let limit = entry.limit;
    for (const active of activeCalls) limit = Math.min(limit, active.limit);
    if (activeCalls.size >= limit) return;
    pendingCalls.shift(); entry.settled = true; entry.cleanup();
    const active = { limit: entry.limit }; activeCalls.add(active);
    entry.resolve(() => {
      if (!activeCalls.delete(active)) return;
      retainedBytes -= entry.bytes; drainQueue();
    });
  }
}
function acquireCapacity(limit: number, bytes: number, signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) throw new MitrifyError('MITRIFY_CANCELLED');
  // Throw before yielding, so a rejected burst does not retain serialized bodies
  // in thousands of suspended async frames waiting for a rejected promise.
  if (pendingCalls.length >= 1000 || retainedBytes + bytes > 64 * 1024 * 1024) throw new MitrifyError('MITRIFY_QUEUE_FULL', 503);
  retainedBytes += bytes;
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cancel = () => { dropQueued(entry, new MitrifyError('MITRIFY_CANCELLED')); drainQueue(); };
    const entry: QueueEntry = { limit, bytes, signal, settled: false, resolve, reject,
      cleanup: () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); } };
    pendingCalls.push(entry);
    signal.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => { dropQueued(entry, new MitrifyError('MITRIFY_QUEUE_TIMEOUT', 503)); drainQueue(); }, 30_000);
    drainQueue();
  });
}

/**
 * Server-owned admission only, never supplied by a request or an environment flag.
 * An implementation must verify a gateway-enforced total INR cap, including all
 * retries/upstream failover, and atomically consume this test once across instances.
 * The UID is a local admission key only; it must never be transmitted to Mitrify.
 * A local ledger/token estimate is not a gateway charge ceiling. No live adapter
 * exists yet; production must remain unavailable until that proof is implemented.
 */
export interface MitrifyPublicTestAdmission {
  readonly maxTotalInr: number;
  runOnce<T>(claim: { uid: string; testId: 'public-arithmetic-v1'; maxTotalInr: number; includesAllAttempts: true;
    gateway: { baseURL: string; model: string; credentialFingerprint: string }; signal: AbortSignal }, execute: () => Promise<T>): Promise<T>;
}

/** Separate synthetic test, never a rewrite or downgrade of an ordinary chat request. */
export async function runMitrifyPublicTest(options: {
  body: unknown;
  identify: () => Promise<{ uid: string; email: string | null; emailVerified: boolean } | null>;
  signal: AbortSignal;
  admission?: MitrifyPublicTestAdmission;
}, env: Env = process.env, log: Log = defaultLog) {
  const target = env.MITRIFY_CHAT_ACCOUNT_EMAIL?.trim().toLowerCase();
  if (backend(env) !== 'mitrify' || !target) throw new MitrifyError('MITRIFY_TEST_DISABLED', 503);
  // Accept no caller-controlled content, history, profile, messages or parameters.
  if (!options.body || typeof options.body !== 'object' || Array.isArray(options.body)
    || Object.keys(options.body).length) throw new MitrifyError('MITRIFY_TEST_EMPTY_BODY_REQUIRED', 400);
  options.signal.throwIfAborted();
  const identity = await untilCancelled(options.identify, options.signal);
  options.signal.throwIfAborted();
  if (!identity?.uid || !identity.emailVerified || identity.email?.trim().toLowerCase() !== target) {
    throw new MitrifyError('MITRIFY_TEST_FORBIDDEN', 403);
  }
  const admission = options.admission;
  const maxTotalInr = admission?.maxTotalInr;
  if (!admission || typeof maxTotalInr !== 'number' || !Number.isFinite(maxTotalInr) || maxTotalInr < 0) {
    throw new MitrifyError('MITRIFY_TEST_BUDGET_UNVERIFIED', 503);
  }
  const config = mitrifyConfig(env);
  if (!config.apiKey) throw new MitrifyError('MITRIFY_CONFIGURATION', 401);
  // Bind admission to the exact credential/endpoint/model snapshot used for dispatch.
  // Never log the credential or fingerprint. No env read after admission may replace it.
  const requestEnv = { MITRIFY_BASE_URL: config.baseURL, MITRIFY_MODEL: config.model, MITRIFY_API_KEY: config.apiKey, MITRIFY_MAX_INFLIGHT: String(config.maxInflight) };
  let dispatched = false;
  return untilCancelled(() => admission.runOnce({ uid: identity.uid, testId: 'public-arithmetic-v1', maxTotalInr,
    includesAllAttempts: true, gateway: { baseURL: config.baseURL, model: config.model,
      credentialFingerprint: createHash('sha256').update(config.apiKey).digest('hex') }, signal: options.signal }, async () => {
    options.signal.throwIfAborted();
    if (dispatched) throw new MitrifyError('MITRIFY_TEST_ALREADY_USED', 409);
    dispatched = true;
    const result = await createMitrifyClient(requestEnv, log).chat({
      messages: [{ role: 'user', content: 'What is 2 + 2? Reply with only the number.' }],
      max_tokens: 16, temperature: 0, stream: false,
    }, { signal: options.signal });
    return result;
  }), options.signal);
}

export class MitrifyError extends Error {
  readonly status: number;
  readonly code: string;
  readonly partial: boolean;
  constructor(code: string, status = 0, partial = false) {
    const messages: Record<string, string> = {
      MITRIFY_BOT_FORBIDDEN: 'This chatbot is not available for this account.',
      MITRIFY_BOT_DISABLED: 'This chatbot is not enabled on the server.',
      MITRIFY_BOT_REVIEW_REQUIRED: 'Review and confirm one public message of up to 2000 characters, without additional fields.',
      MITRIFY_BOT_SENSITIVE_CONTENT: 'This message may contain sensitive information and was not sent. Use the existing private chat path for sensitive information.',
      MITRIFY_BOT_PUBLIC_QUESTION_REQUIRED: 'Choose one of the public questions. Free text and additional fields are not accepted.',
      MITRIFY_TEST_DISABLED: 'The public test is disabled.',
      MITRIFY_TEST_FORBIDDEN: 'This test requires the configured verified account.',
      MITRIFY_TEST_EMPTY_BODY_REQUIRED: 'The public test accepts only an empty JSON object, without chat content.',
      MITRIFY_TEST_BUDGET_UNVERIFIED: 'The public test is unavailable until a single-use total spending cap is verified.',
      MITRIFY_TEST_ALREADY_USED: 'The single-use public test authorization has already been consumed.',
      MITRIFY_QUEUE_FULL: 'Mitrify capacity is full; no new request was dispatched.',
      MITRIFY_QUEUE_TIMEOUT: 'The request timed out waiting for Mitrify capacity; it was not dispatched.',
    };
    super(messages[code] || (code === 'MITRIFY_CONFIGURATION' ? 'Mitrify configuration error: check server credentials and URL.'
      : partial ? 'The AI reply was interrupted and is incomplete.' : 'Mitrify request failed; see status and error code in server metadata.'));
    this.name = 'MitrifyError'; this.code = code; this.status = status; this.partial = partial;
  }
}

function safeHeaders(response: Response, key: string): Record<string, string | null> {
  return Object.fromEntries(headerNames.map(name => {
    const value = response.headers.get(name);
    return [name, value === null ? null : value.split(key).join('[REDACTED]').replace(/[\r\n]/g, ' ').slice(0, 2048)];
  }));
}

/** Raw gateway error messages can echo credentials or prompts. Never log/return them. */
function statusCode(status: number): string {
  return status === 401 ? 'MITRIFY_CONFIGURATION' : status === 400 ? 'MITRIFY_BAD_REQUEST' : `MITRIFY_HTTP_${status}`;
}

export function createMitrifyClient(env: Env = process.env, log: Log = defaultLog) {
  const config = mitrifyConfig(env);
  function endpoint(path: string): string {
    let url: URL;
    try { url = new URL(config.baseURL); } catch { throw new MitrifyError('MITRIFY_CONFIGURATION'); }
    // Loopback HTTP is exclusively for offline mock tests. Never follow redirects with a key.
    if (!config.apiKey || url.username || url.password || url.search || url.hash
      || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) {
      throw new MitrifyError('MITRIFY_CONFIGURATION');
    }
    return `${url.href.replace(/\/$/, '')}/${path}`;
  }

  async function request(path: string, body: string | undefined, signal: AbortSignal, beforeAttempt?: () => Promise<void>, maxAttempts = 4): Promise<Response> {
    const url = endpoint(path);
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      await beforeAttempt?.();
      signal.throwIfAborted();
      const started = Date.now();
      let response: Response;
      try {
        response = await fetch(url, {
          method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal,
          headers: { Authorization: `Bearer ${config.apiKey}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          body,
        });
      } catch {
        throw new MitrifyError(signal.aborted ? 'MITRIFY_CANCELLED' : 'MITRIFY_NETWORK');
      }
      log({ ...safeHeaders(response, config.apiKey), status: response.status, latencyMs: Date.now() - started, attempt });
      if (response.ok) return response;
      const retryAfter = response.headers.get('retry-after');
      await response.body?.cancel();
      if (![429, 503].includes(response.status) || attempt >= maxAttempts - 1) {
        const code = statusCode(response.status);
        log({ code, status: response.status });
        throw new MitrifyError(code, response.status);
      }
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const serverDelay = Number.isFinite(seconds) ? Math.max(0, seconds * 1000)
        : retryAfter ? Math.max(0, Date.parse(retryAfter) - Date.now()) : 0;
      let waitMs = Math.max(1000 * 2 ** attempt + Math.random() * 250, Number.isFinite(serverDelay) ? serverDelay : 0);
      log({ code: 'MITRIFY_RETRY', status: response.status, delayMs: waitMs });
      // Avoid setTimeout's 32-bit overflow for a distant Retry-After date.
      while (waitMs > 0) {
        const part = Math.min(waitMs, 2_147_483_647);
        await delay(part, undefined, { signal });
        waitMs -= part;
      }
    }
  }

  return {
    /** Manual diagnostics only. Never used to construct a UI model list. */
    async models(signal: AbortSignal): Promise<{ status: number; headers: Record<string, string | null> }> {
      let release: (() => void) | undefined;
      try {
        release = await acquireCapacity(config.maxInflight, 0, signal);
        const response = await request('models', undefined, signal);
        if (!response.headers.get('content-type')?.includes('application/json')) {
          await response.body?.cancel(); throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
        }
        const data = await response.json();
        signal.throwIfAborted();
        if (!data || !Array.isArray(data.data)) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
        return { status: response.status, headers: safeHeaders(response, config.apiKey) };
      } catch (error) { throw error instanceof MitrifyError ? error : new MitrifyError(signal.aborted ? 'MITRIFY_CANCELLED' : 'MITRIFY_INVALID_RESPONSE'); }
      finally { release?.(); }
    },
    /** Low-level transport only: production general-chat ingress cannot authorize this call. */
    async chat(input: Record<string, unknown>, options: { signal: AbortSignal; onChunk?: (chunk: Uint8Array) => void | Promise<void>; beforeAttempt?: () => Promise<void>; maxAttempts?: number }) {
      let partial = false;
      let release: (() => void) | undefined;
      const controller = new AbortController();
      const signal = AbortSignal.any([options.signal, controller.signal]);
      const started = Date.now();
      try {
        if (Object.keys(input).some(key => !standardFields.has(key)) || !Array.isArray(input.messages) || !input.messages.length
          || input.messages.some(m => !m || typeof m !== 'object' || !['system', 'developer', 'user', 'assistant'].includes(m.role)
            || typeof m.content !== 'string' || Object.keys(m).some(k => !['role', 'content'].includes(k)))
          || (input.stream !== undefined && typeof input.stream !== 'boolean')
          || (input.stream === true && !options.onChunk)) throw new MitrifyError('MITRIFY_UNSUPPORTED_REQUEST');
        const streamOptions = input.stream_options;
        if (streamOptions !== undefined && (!streamOptions || typeof streamOptions !== 'object' || Array.isArray(streamOptions))) throw new MitrifyError('MITRIFY_UNSUPPORTED_REQUEST');
        const body = JSON.stringify({ ...input, model: config.model,
          ...(input.stream === true ? { stream_options: { ...streamOptions as object, include_usage: true } } : {}),
        });
        if (options.maxAttempts !== undefined && (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 4)) throw new MitrifyError('MITRIFY_CONFIGURATION');
        const bytes = Buffer.byteLength(body);
        if (bytes > 8 * 1024 * 1024) throw new MitrifyError('MITRIFY_BODY_TOO_LARGE', 413);
        release = await acquireCapacity(config.maxInflight, bytes, signal);
        const response = await request('chat/completions', body, signal, options.beforeAttempt, options.maxAttempts);
        const headers = safeHeaders(response, config.apiKey);
        if (input.stream !== true) {
          if (!response.headers.get('content-type')?.includes('application/json')) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
          const data = await response.json();
          signal.throwIfAborted();
          if (JSON.stringify(data).includes(config.apiKey) || data?.error || !Array.isArray(data?.choices) || !data.choices.some((c: any) => typeof c?.message?.content === 'string' && c.message.content.trim())) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
          return { status: response.status, headers, data };
        }
        if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = ''; let done = false;
        // Never retain answer events while waiting for an optional field to recur.
        // Reject a substantial credential prefix before disclosure, including when
        // split over events. At most the short prefix preceding this marker can pass.
        const protectedPrefix = config.apiKey.slice(0, Math.min(8, Math.ceil(config.apiKey.length / 4)));
        const prefixes = new Map<string, string>();
        // Inspect all forwarded strings, including extension fields and field names.
        const inspectStrings = (value: unknown, path: string[]): void => {
          if (typeof value === 'string') {
            const channel = JSON.stringify(path);
            const text = (prefixes.get(channel) ?? '') + value;
            if (text.includes(protectedPrefix)) throw new MitrifyError('MITRIFY_STREAM_ERROR', response.status, partial);
            let length = Math.min(text.length, protectedPrefix.length - 1);
            while (length && !text.endsWith(protectedPrefix.slice(0, length))) length--;
            if (length) prefixes.set(channel, text.slice(-length));
            else prefixes.delete(channel);
          } else if (Array.isArray(value)) {
            value.forEach((item, index) => inspectStrings(item, [...path,
              path.at(-1) === 'field:choices' ? `choice:${item?.index ?? index}` : 'array']));
          } else if (value && typeof value === 'object') {
            for (const [key, item] of Object.entries(value)) {
              inspectStrings(key, [...path, 'keys']); inspectStrings(item, [...path, `field:${key}`]);
            }
          }
          if (prefixes.size > 1024) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status, partial);
        };
        try {
          for (;;) {
            signal.throwIfAborted();
            const item = await reader.read();
            signal.throwIfAborted();
            if (item.done) break;
            // Inspect one bounded SSE event at a time; forward valid events immediately.
            pending += decoder.decode(item.value, { stream: true });
            pending = pending.replace(/\r\n/g, '\n');
            let boundary: number;
            while ((boundary = pending.indexOf('\n\n')) >= 0) {
              signal.throwIfAborted();
              const event = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
              if (event.length > 1024 * 1024) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status, partial);
              if (event.includes(config.apiKey)) throw new MitrifyError('MITRIFY_STREAM_ERROR', response.status, partial);
              // SSE comments/control fields are not answer data and must not expose
              // arbitrary upstream strings to the client.
              const dataLines = event.split('\n').filter(line => line.startsWith('data:'));
              const payload = dataLines.map(line => line.slice(5).trimStart()).join('\n');
              if (payload && payload !== '[DONE]') {
                const data = JSON.parse(payload);
                if (JSON.stringify(data).includes(config.apiKey) || data.error) throw new MitrifyError('MITRIFY_STREAM_ERROR', response.status, partial);
                inspectStrings(data, []);
              }
              if (payload === '[DONE]') done = true;
              if (dataLines.length) {
                partial = true; // The consumer may write before throwing or stalling.
                const wire = `${dataLines.join('\n')}\n\n`;
                await untilCancelled(() => options.onChunk!(new TextEncoder().encode(wire)), signal);
                signal.throwIfAborted();
              }
              if (done) break;
            }
            if (done) break;
            if (pending.length > 1024 * 1024) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status, partial);
          }
          if (!done) throw new MitrifyError('MITRIFY_INCOMPLETE_STREAM', response.status, partial);
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        signal.throwIfAborted();
        return { status: response.status, headers, data: undefined };
      } catch (error) {
        const safe = error instanceof MitrifyError ? new MitrifyError(error.code, error.status, partial || error.partial) : new MitrifyError(signal.aborted ? 'MITRIFY_CANCELLED' : 'MITRIFY_INVALID_RESPONSE', 0, partial);
        log({ code: safe.code, status: safe.status, partial: safe.partial });
        throw safe;
      } finally { controller.abort(); release?.(); log({ code: 'MITRIFY_FINISHED', latencyMs: Date.now() - started, partial }); }
    },
  };
}
