// THE AI GATEWAY FOR PUBLISHED APPS (ROADMAP §13, 3.1) — slice A: the pure core.
//
// A user asks NavBharatAI for a chatbot. We generate a good one, and then it asks them for an OpenAI
// key — and that is where most of them stop. Every competitor has the same wall. This gateway removes
// it: the published app calls OUR endpoint, we route the model call, and the cost lands on the SAME
// wallet the owner already has (THE ONE-WALLET LAW). No key to paste, nothing to sign up for.
//
// 🔴 THE SECURITY FACT THIS WHOLE DESIGN IS BUILT AROUND, stated first because getting it wrong would
// be expensive: THE APP'S TOKEN IS PUBLIC. It ships inside a published app's own client code, so
// anyone who opens View Source can read it. It is therefore an app IDENTIFIER, not a secret — it
// answers "which app is spending?" and never "is this caller allowed to spend?".
//
// Everything follows from that:
//   • The token is SCOPED to one app, so a token lifted from app A cannot spend app B's budget. That
//     is the one guarantee a public string can actually make, and it is why the appId is signed
//     rather than merely included.
//   • The real defence is the CAP, not the token. A per-app daily ₹ ceiling bounds what any number of
//     strangers can drain from the owner's wallet in a day, and a per-visitor ceiling stops one
//     stranger consuming the whole app's day by themselves. Both are enforced; neither is optional.
//   • There is NO expiry. The token is baked into published files, so an expiring one would break a
//     working app on a random Tuesday with nothing to explain it. Rotation is by REPUBLISH (a new
//     nonce ⇒ a new token), and revocation is by the app ceasing to be live — which the route checks
//     against the deployment record, because that is I/O and belongs there.
//
// 🔒 WHITE-LABEL LAW APPLIES TO THE APP'S OWN VISITORS, not just to ours. A stranger using a
// NavBharatAI-built chatbot must never learn which vendor answered — so every refusal and error this
// module produces is branded text with no provider name in it, and `gatewayModelFor` keeps the model
// id on the ADMIN side of the wall. A leak here would be a leak on somebody else's website, which is
// worse than a leak on ours.
//
// PURE — signing, verification and decisions. The route owns every byte of I/O, the wallet charge
// rides `aiSpendZone` exactly like every other tool, and nothing here reads a clock it was not given.

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Master switch — **default OFF**, and the direction matters more than the switch.
 *
 * 🔒 EVERY NEW PATH THAT SPENDS A REAL USER'S WALLET IN THIS CODEBASE SHIPS OFF AND IS TURNED ON
 * DELIBERATELY: `AI_WALLET_SPEND`, `STORE_BILLING`, `NAVBHARAT_WEB_RISK`, `AGENTV3_BILL_SANDBOX`. This
 * one is the most exposed of them — the caller is a STRANGER on somebody else's website, not the
 * account holder — so it would be the worst possible one to make the exception.
 *
 * It is written down because the first draft of this function defaulted to ON, reasoning that the
 * gateway is inert until a published app carries a token. That is true today and stops being true the
 * moment the publish path starts minting them: the feature would go live for every published app on a
 * deploy, with nobody having decided it should. A switch whose default only becomes dangerous LATER is
 * exactly the kind that gets shipped by accident.
 */
export function appAiGatewayEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.APP_AI_GATEWAY ?? '').trim().toLowerCase() === 'on';
}

/** Dev-only fallback. Random per process ON PURPOSE — a guessable constant would mint valid tokens. */
const processSecret = randomBytes(32).toString('hex');

/** The HMAC key. `SECRET_ENCRYPTION_KEY` is set in Cloud Run, so tokens verify across instances. */
export function gatewaySecret(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.SECRET_ENCRYPTION_KEY ?? '').trim() || processSecret;
}

/**
 * Token version. Bumping it invalidates every token ever minted, which is the break-glass lever if
 * the signing scheme ever has to change — apps recover by republishing, and until they do they get an
 * honest refusal rather than a silent wrong answer.
 */
export const APP_AI_TOKEN_VERSION = 'a1';

/** `a1.<appId>.<nonce>.<sig>` — self-describing, so a malformed token is rejected before any crypto. */
export function mintAppAiToken(appId: string, secret: string, nonce?: string): string {
  const id = String(appId ?? '').trim();
  if (!id) return '';
  // A fresh nonce per PUBLISH is what makes republishing a real rotation: the previous token stops
  // verifying the moment the new one is stamped, so a token scraped from an old copy of the page dies.
  const n = String(nonce ?? '').trim() || randomBytes(9).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${APP_AI_TOKEN_VERSION}|${id}|${n}`).digest('base64url').slice(0, 43);
  return `${APP_AI_TOKEN_VERSION}.${id}.${n}.${sig}`;
}

export type TokenVerdict =
  | { ok: true; appId: string; nonce: string }
  | { ok: false; reason: 'malformed' | 'version' | 'signature' };

/**
 * Verify a token. Constant-time on the signature; malformed input is a verdict, never an exception.
 *
 * 🔒 The appId is taken from the VERIFIED token and nowhere else. A route that read the app id from
 * the request body and used the token only as a yes/no would let any app's token spend any other
 * app's budget — the exact hole the scoping exists to close.
 */
export function verifyAppAiToken(token: string | null | undefined, secret: string): TokenVerdict {
  const raw = String(token ?? '').trim();
  const parts = raw.split('.');
  if (parts.length !== 4) return { ok: false, reason: 'malformed' };
  const [ver, appId, nonce, sig] = parts;
  if (ver !== APP_AI_TOKEN_VERSION) return { ok: false, reason: 'version' };
  if (!appId || !nonce || !sig) return { ok: false, reason: 'malformed' };
  const want = createHmac('sha256', secret).update(`${ver}|${appId}|${nonce}`).digest('base64url').slice(0, 43);
  const a = Buffer.from(want);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return { ok: false, reason: 'signature' };
  try {
    if (!timingSafeEqual(a, b)) return { ok: false, reason: 'signature' };
  } catch { return { ok: false, reason: 'signature' }; }
  return { ok: true, appId, nonce };
}

/**
 * What one app may spend in a day, in rupees, before its gateway stops answering.
 *
 * ₹20 is deliberately small. This is somebody's wallet being spent by strangers on the internet, and
 * the failure the owner would never forgive is waking up to an empty balance — so the default errs
 * toward "your chatbot stopped" over "your money is gone". It is a floor to raise from evidence, not
 * a guess to defend.
 */
export const DEFAULT_APP_DAILY_CAP_INR = 20;

/** What ONE visitor may spend of it. A single stranger must not be able to consume the app's whole day. */
export const DEFAULT_VISITOR_DAILY_CAP_INR = 2;

export function appDailyCapInr(env: NodeJS.ProcessEnv = process.env): number {
  return positiveOr(env.APP_AI_DAILY_CAP_INR, DEFAULT_APP_DAILY_CAP_INR);
}

export function visitorDailyCapInr(env: NodeJS.ProcessEnv = process.env): number {
  return positiveOr(env.APP_AI_VISITOR_CAP_INR, DEFAULT_VISITOR_DAILY_CAP_INR);
}

/**
 * A cap value that is present but unreadable falls back to the DEFAULT, never to unlimited — the same
 * reasoning as `parseRolloutPercent` and the Web Risk budget: someone who wanted the default would
 * have left the key unset, so a value that is present and unparseable cannot have meant "no limit".
 * An explicit `0` is a real setting meaning "this app's gateway answers nothing".
 */
function positiveOr(raw: unknown, fallback: number): number {
  const s = String(raw ?? '').trim();
  if (!s) return fallback;
  const n = Number(s.replace(/[_,\s₹]/g, ''));
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`[APPAI] cap "${s}" is not a number — using ${fallback}.`);
    return fallback;
  }
  return n;
}

export interface GatewayUsage {
  /** ₹ this app has already spent today. */
  appSpentInr: number;
  /** ₹ this visitor has already spent on this app today. */
  visitorSpentInr: number;
  /** The owner's wallet balance in ₹, or null when it could not be read. */
  ownerBalanceInr: number | null;
}

export type GatewayRefusal = 'app-cap' | 'visitor-cap' | 'owner-empty' | 'disabled' | 'not-live' | 'bad-token';
export type GatewayDecision = { allow: true } | { allow: false; reason: GatewayRefusal };

/**
 * May this call run? PURE.
 *
 * 🔒 AN UNREADABLE BALANCE FAILS OPEN, matching the build gate and the chat-turn gate rather than
 * inventing a third behaviour. The reasoning is the platform's, not this module's: refusing on a
 * Firestore hiccup would break every published app at once, while allowing it risks at most one
 * call's cost against a cap that is already small.
 */
export function gatewayDecision(usage: GatewayUsage, caps: { appCapInr: number; visitorCapInr: number }): GatewayDecision {
  if (!(caps.appCapInr > 0)) return { allow: false, reason: 'app-cap' };
  if (num(usage.appSpentInr) >= caps.appCapInr) return { allow: false, reason: 'app-cap' };
  if (caps.visitorCapInr > 0 && num(usage.visitorSpentInr) >= caps.visitorCapInr) return { allow: false, reason: 'visitor-cap' };
  // Null is "we could not read it" and is NOT zero — see the doc comment.
  if (typeof usage.ownerBalanceInr === 'number' && usage.ownerBalanceInr <= 0) return { allow: false, reason: 'owner-empty' };
  return { allow: true };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 🔒 WHAT THE APP'S VISITOR IS TOLD. Branded, no provider name, no mention of the owner's money.
 *
 * A stranger on somebody's website is not entitled to know that the site owner's balance ran out —
 * that is the owner's business, and leaking it would turn a billing state into public information
 * about a real person. So `owner-empty` and `app-cap` deliberately say the SAME thing: the assistant
 * is unavailable right now. The owner gets the true reason through their own admin surface.
 */
export function visitorFacingMessage(reason: GatewayRefusal): string {
  switch (reason) {
    case 'visitor-cap':
      return 'You have reached this assistant’s limit for today. Please try again tomorrow.';
    case 'bad-token':
    case 'not-live':
      return 'This assistant is not available.';
    case 'app-cap':
    case 'owner-empty':
    case 'disabled':
    default:
      return 'This assistant is temporarily unavailable. Please try again later.';
  }
}

/** The true reason, for the OWNER's screen and the admin log. Never sent to the app's visitors. */
export function ownerFacingMessage(reason: GatewayRefusal): string {
  switch (reason) {
    case 'app-cap': return 'This app reached its daily AI limit. Raise the limit or wait for tomorrow.';
    case 'visitor-cap': return 'One visitor reached their daily limit on this app.';
    case 'owner-empty': return 'Your balance is empty, so your app’s assistant stopped answering. Top up to restart it.';
    case 'not-live': return 'This app is not published, so its assistant is switched off.';
    case 'bad-token': return 'This app’s assistant key is not valid. Publish the app again to refresh it.';
    case 'disabled': return 'The assistant service is switched off platform-wide.';
    default: return 'The assistant is unavailable.';
  }
}

/** How long a prompt from a published app may be. A stranger's input is never trusted for size. */
export const MAX_GATEWAY_PROMPT_CHARS = 4_000;

export interface GatewayRequest { prompt: string; system?: string }

export type RequestVerdict =
  | { ok: true; prompt: string; system: string }
  | { ok: false; reason: 'empty' | 'too-long' };

/** Validate the body a published app sends. PURE — no trust in anything a visitor typed. */
export function readGatewayRequest(body: unknown): RequestVerdict {
  const b = (body ?? {}) as Partial<GatewayRequest>;
  const prompt = String(b.prompt ?? '').trim();
  if (!prompt) return { ok: false, reason: 'empty' };
  if (prompt.length > MAX_GATEWAY_PROMPT_CHARS) return { ok: false, reason: 'too-long' };
  // The system prompt is the APP AUTHOR's, not the visitor's, but it arrives over the same public
  // wire — so it is bounded too rather than trusted because of where it is supposed to come from.
  const system = String(b.system ?? '').trim().slice(0, MAX_GATEWAY_PROMPT_CHARS);
  return { ok: true, prompt, system };
}

// ── SLICE B: what the published app actually carries, and how a republish rotates it ────────────
//
// The pieces below turn the core above into something a real page can call. They stay PURE for the
// same reason the rest of the module is: the publish path and the route own the I/O.

/** Where a published app sends its question. One constant, so the page and the route cannot drift. */
export const GATEWAY_PATH = '/api/app-ai/ask';

/** Marks the injected snippet, so a re-publish replaces rather than stacks. Mirrors the beacon's. */
export const APP_AI_MARKER = 'data-nbai-ai';

/**
 * The nonce pair stored beside an app: the token minted by the LATEST publish, and the one before it.
 *
 * 🔒 WHY THE PREVIOUS ONE IS STILL ACCEPTED, and it is not laxity. The registry is written BEFORE the
 * new files reach the host, so between those two moments the page a visitor already has open still
 * carries the old token. Accepting only the newest would break a working chatbot for the length of
 * every deploy — a self-inflicted outage with nothing to explain it. Exactly ONE generation of slack
 * is kept: a token from two publishes ago is dead, so rotation is real rather than decorative.
 */
export interface AppNoncePair { nonce: string; prevNonce?: string }

/** Is this token's nonce one of the two this app currently honours? */
export function nonceAccepted(nonce: string, pair: AppNoncePair | null | undefined): boolean {
  const n = String(nonce ?? '').trim();
  if (!n || !pair) return false;
  return n === String(pair.nonce ?? '').trim() || n === String(pair.prevNonce ?? '').trim();
}

/** What a publish should store: the fresh nonce, with the outgoing one demoted to previous. */
export function rotateNonce(existing: AppNoncePair | null | undefined, fresh: string): AppNoncePair {
  const prev = String(existing?.nonce ?? '').trim();
  const next = String(fresh ?? '').trim();
  return prev && prev !== next ? { nonce: next, prevNonce: prev } : { nonce: next };
}

/**
 * The snippet stamped into every published HTML page.
 *
 * Dependency-free and deliberately small. It exposes ONE thing — `window.NavAI.ask(prompt, opts)` —
 * which resolves to the answer's text and rejects with a branded message. Generated app code calls
 * that and nothing else, so the wire format can change without touching a single published app.
 *
 * 🔒 EVERY FAILURE PATH ENDS IN BRANDED TEXT. A `fetch` that throws, a body that is not JSON, a
 * refusal — all of them surface `visitorFacingMessage`-shaped wording, never a status code, never a
 * provider name, and never the owner's billing state (White-Label Law, applied to somebody else's
 * visitors).
 */
export function gatewayScriptHtml(appId: string, token: string, origin: string): string {
  const url = `${String(origin ?? '').replace(/\/+$/, '')}${GATEWAY_PATH}`;
  const fallback = visitorFacingMessage('disabled');
  return `<script ${APP_AI_MARKER}="1">(function(){try{
var U=${JSON.stringify(url)},T=${JSON.stringify(token)},F=${JSON.stringify(fallback)};
window.NavAI={app:${JSON.stringify(appId)},available:true,ask:function(p,o){
return fetch(U,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:T,prompt:String(p==null?"":p),system:(o&&o.system)||""})})
.then(function(r){return r.json().catch(function(){return{ok:false,message:F};});})
.catch(function(){return{ok:false,message:F};})
.then(function(d){if(d&&d.ok&&typeof d.text==="string")return d.text;throw new Error((d&&d.message)||F);});
}};
}catch(e){}})();</script>`;
}

function looksLikeHtmlDocument(html: string): boolean {
  return /<html[\s>]/i.test(html) || /<body[\s>]/i.test(html) || /<!doctype\s+html/i.test(html);
}

/** Stamp one HTML document. Idempotent; a non-document string is returned unchanged. */
export function injectGatewayScript(html: string, appId: string, token: string, origin: string): string {
  if (typeof html !== 'string' || !html) return html;
  if (html.includes(APP_AI_MARKER)) return html;
  if (!looksLikeHtmlDocument(html)) return html;
  const tag = gatewayScriptHtml(appId, token, origin);
  // Injected into <head> rather than before </body>, unlike the analytics beacon: the app's own
  // bundle may call window.NavAI as soon as it executes, and a helper defined after the script that
  // uses it is a race the app author cannot see or fix.
  const head = html.search(/<\/head\s*>/i);
  if (head >= 0) return html.slice(0, head) + tag + '\n' + html.slice(head);
  const close = html.search(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i);
  if (close >= 0) return html.slice(0, close) + tag + '\n' + html.slice(close);
  return html + '\n' + tag;
}

/**
 * Does this bundle actually USE the gateway?
 *
 * 🔴 ADMIN, 2026-09-13: *"user ko lagega ham spy daal rahe hai user ki app me"* — and on the half that
 * matters, they were right. Nothing is shown to anyone and no app data is read, but the first version
 * stamped the helper into EVERY published page, including apps that never asked for AI. Something the
 * user did not request has no business being in their page, however small or inert it is.
 *
 * So the stamp now follows the app's own code. `generate_ai` writes a helper that calls
 * `window.NavAI`, and that property access survives bundling and minification (a minifier may rename
 * the variable holding `window`, never the property being read off it). An app that never asked for
 * AI contains the string nowhere, and gets nothing.
 *
 * 🔒 CONSERVATIVE BY DESIGN: when in doubt it stamps NOTHING. A false negative means one app's
 * assistant does not work until it is republished with the helper actually referenced — visible,
 * fixable, and honestly reported by `isAiReady()`. A false positive puts uninvited code in somebody's
 * page, which is the thing being corrected.
 */
export function appUsesGateway(files: Map<string, Buffer>): boolean {
  for (const [path, buf] of files) {
    if (!/\.(html?|js|mjs|cjs)$/i.test(path)) continue;
    if (buf.toString('utf8').includes('NavAI')) return true;
  }
  return false;
}

/**
 * Stamp every HTML file in a publish bundle IN PLACE. Returns how many files were stamped.
 *
 * Stamps nothing at all unless the app's own code references the assistant — see `appUsesGateway`.
 */
export function injectGatewayIntoFiles(
  files: Map<string, Buffer>,
  opts: { appId: string; token: string; origin: string; env?: NodeJS.ProcessEnv },
): number {
  if (!appAiGatewayEnabled(opts.env)) return 0;
  if (!opts.appId || !opts.token) return 0;
  if (!appUsesGateway(files)) return 0;
  let stamped = 0;
  for (const [path, buf] of files) {
    if (!/\.html?$/i.test(path)) continue;
    const html = buf.toString('utf8');
    const out = injectGatewayScript(html, opts.appId, opts.token, opts.origin);
    if (out !== html) {
      files.set(path, Buffer.from(out, 'utf8'));
      stamped++;
    }
  }
  return stamped;
}
