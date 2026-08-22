// ASKING THE USER FOR A KEY, MID-BUILD — the decision half.
//
// WHY THIS EXISTS (admin 2026-08-08). When v5 builds an app that needs a credential — a payment key, an
// SMS sender, a maps token — the build has always had exactly two options: write a placeholder and
// carry on toward a feature that cannot work, or finish and tell the user afterwards which keys to go
// and paste in Settings. Both put the dead end AFTER the build, and the second asks someone to leave
// the screen they are on, find the right tile, and type a name they must copy exactly.
//
// This lets the build ask WHILE it is running, with the exact variable names already filled in.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE SECRET VALUE NEVER TRAVELS THROUGH THE BUILD.
//
// The obvious design — user types the value into a popup, the popup sends it back through the same
// approval channel the build is waiting on — would push a live credential through the build's event
// stream, and this codebase records that stream: `buildDiag.recordCommand` stores raw strings
// unredacted, the session transcript is persisted, and the admin build report is assembled from it.
// A key pasted there would sit in storage forever.
//
// So the value goes NOWHERE NEAR here. The client saves it directly through the existing authenticated
// secrets API (AES-256, per-user, the same vault Settings writes to) and then answers the build with a
// bare "saved". The build re-reads the vault and merges the keys into the app's `.env`. This module
// only ever handles NAMES.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// PURE — no I/O, so every decision here is tested directly.

/** A single credential the app needs, as the builder describes it. */
export interface SecretAsk {
  /** The exact env var the generated code reads — `STRIPE_SECRET_KEY`, not "your Stripe key". */
  name: string;
  /** Plain-language: what it is for, and where the user gets it. */
  why: string;
}

export interface SecretRequestPlan {
  /** Keys genuinely still needed — already-saved ones are removed. */
  ask: SecretAsk[];
  /** Names dropped because the user already has them. Reported, never silently discarded. */
  alreadyHave: string[];
  /** Names dropped because they are not usable env var names. */
  rejected: string[];
}

/**
 * A usable environment-variable name.
 *
 * Deliberately strict — `A-Z`, digits and underscore, starting with a letter. The generated code reads
 * these through `process.env.X` / `import.meta.env.X`, and a name outside this shape either cannot be
 * read at all or needs quoting the generated code will not have. Rejecting it here is better than
 * writing a line into `.env` that silently never resolves. PURE.
 */
export function isUsableEnvName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(String(name ?? '').trim());
}

/**
 * Names that must never be requested from a user, whatever the model says.
 *
 * These are NavBharatAI's OWN platform credentials. A model that has seen this codebase's env registry
 * could plausibly emit one, and a user typing a value for `ANTHROPIC_API_KEY` would be pasting a key
 * into their app's `.env` believing it configures their app — when it configures nothing, costs them
 * money if real, and teaches them that NavBharatAI asks for provider keys. It also breaks the
 * white-label law by naming a vendor on a user-facing screen. PURE.
 */
export const NEVER_ASK = [
  /^ANTHROPIC_/i, /^OPENAI_/i, /^GEMINI_/i, /^GLM_/i, /^KIMI_/i, /^GROK_/i, /^XAI_/i, /^VERTEX_/i,
  /^BEDROCK_/i, /^AWS_/i, /^E2B_/i, /^AGENTV3_/i, /^ADMIN_/i, /^SECRET_ENCRYPTION_KEY$/i,
  /^FIREBASE_PROJECT_ID$/i, /^GOOGLE_CLOUD_PROJECT$/i, /^CASHFREE_/i,
];

/** True when this name is one of NavBharatAI's own platform credentials. PURE. */
export function isPlatformSecret(name: string): boolean {
  const n = String(name ?? '').trim();
  return NEVER_ASK.some((re) => re.test(n));
}

/**
 * Decide what to actually ask for.
 *
 * Three filters, each of which exists because skipping it produces a worse experience than not asking
 * at all: a key the user ALREADY saved must not be asked for again (that is how a product teaches people
 * their input does not stick); an unusable name must not reach `.env`; and NavBharatAI's own provider
 * keys must never be requested from a user. PURE.
 */
export function planSecretRequest(
  asks: Array<Partial<SecretAsk>> | null | undefined,
  alreadySaved: readonly string[] | null | undefined,
): SecretRequestPlan {
  const have = new Set((alreadySaved || []).map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean));
  const ask: SecretAsk[] = [];
  const alreadyHave: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();

  for (const raw of asks || []) {
    const name = String(raw?.name ?? '').trim();
    if (!name) continue;
    const upper = name.toUpperCase();
    if (seen.has(upper)) continue;          // the same key twice in one request is one key
    seen.add(upper);

    if (!isUsableEnvName(name) || isPlatformSecret(name)) { rejected.push(name); continue; }
    if (have.has(upper)) { alreadyHave.push(name); continue; }

    const why = String(raw?.why ?? '').trim();
    ask.push({ name, why: why || 'This app needs this key to work.' });
  }
  return { ask, alreadyHave, rejected };
}

/**
 * The one-line prompt shown above the fields.
 *
 * Says WHY the build stopped to ask and what happens next, because a popup demanding credentials with
 * no context is the shape of a phishing prompt — and the user is being asked for real money keys. PURE.
 */
export function secretRequestPrompt(plan: SecretRequestPlan): string {
  const n = plan.ask.length;
  if (n === 0) return '';
  return `Your app needs ${n === 1 ? 'this key' : `these ${n} keys`} to work. `
    + 'They are saved to your own encrypted vault (Settings → Secrets & API Keys) and used only by your app — '
    + 'NavBharatAI never shows them to the AI or puts them in your code.';
}

// ── The POST-BUILD ask (admin 2026-08-22) ─────────────────────────────────────────────────────────
//
// "Agar keys/secrets ki need hai, to user se maang kyun nahi lete? AI ka last message 'app complete'
// nahi hona chahiye — 'app ban gaya hai, par yeh yeh keys chahiye, yahan fill karo, nahi hai to main
// guide karunga' hona chahiye."
//
// The mid-build ask above fires only when the MODEL decides to call `request_secrets` — and on real
// builds it often finishes without asking, which is exactly the failure the admin reported. This half
// is DETERMINISTIC: after a successful build the route already computes which of the user's own
// credentials the app still needs (`unconfiguredRequirements` — pure static analysis, zero LLM cost)
// and appends a localized text notice. These helpers turn that same computation into a fill-in ASK
// CARD as the build's closing act, so the last thing the user sees is the form, not a sentence
// pointing at Settings.

/** A minimal slice of AppRequirement — kept structural so this module stays dependency-free. */
export interface RequirementLike {
  label: string;
  /** Env names that satisfy the requirement (any one). */
  envVars: readonly string[];
  /** The names the app's OWN code actually reads — preferred, so a Mapbox user is never asked for a Google key. */
  matchedEnvVars: readonly string[];
}

/** The card stays a form, not a wall — beyond this many keys, the rest go to Settings via the text notice. */
export const POST_BUILD_ASK_MAX = 6;

/**
 * Turn the post-build "unconfigured requirements" into the ask-card's key list. PURE.
 *
 * Per requirement, the names the app's own code READS win over the catalogue's full list (a service
 * can be satisfied by more than one provider, and asking for the one the code does not read teaches
 * the user to paste keys that do nothing). The same guards as the mid-build ask apply: usable env
 * names only, never a platform credential, no duplicates, and already-saved keys are dropped.
 */
export function postBuildKeyAsks(
  missing: readonly RequirementLike[] | null | undefined,
  alreadySaved: readonly string[] | null | undefined,
): SecretAsk[] {
  const raw: Array<Partial<SecretAsk>> = [];
  for (const req of missing || []) {
    const names = (req.matchedEnvVars?.length ? req.matchedEnvVars : req.envVars) || [];
    for (const name of names) {
      raw.push({ name, why: `Needed for ${req.label}. Your app is built — this key is what makes that feature actually work.` });
    }
  }
  return planSecretRequest(raw, alreadySaved).ask.slice(0, POST_BUILD_ASK_MAX);
}

/**
 * The closing card's headline. Distinct from the mid-build prompt on purpose: mid-build the message
 * is "the build stopped to ask"; here the message is "the app is DONE and this is the last step" —
 * conflating the two makes a finished app sound unfinished. Honest about timing: a key saved now is
 * wired in when the app next starts, not by magic into the already-running process. PURE.
 */
export function postBuildKeyPrompt(count: number): string {
  if (count <= 0) return '';
  return `Your app is built. One last step: ${count === 1 ? 'it needs this key' : `it needs these ${count} keys`} from your own account${count === 1 ? '' : 's'} to fully work. `
    + 'Paste what you have — each is saved to your encrypted vault and wired in the next time your app starts. '
    + 'Don’t have one? Tap "Guide me" and I’ll walk you to it step by step.';
}

export type SecretRequestOutcome = 'saved' | 'skipped' | 'nothing-to-ask';

/**
 * What the build says after the user answers.
 *
 * "Skipped" is a first-class, non-apologetic outcome: the user may not have the key to hand, and the
 * build carries on and finishes. What it must NOT do is pretend the feature works — so the skip line
 * names the consequence. PURE.
 */
export function secretRequestResult(outcome: SecretRequestOutcome, names: readonly string[]): string {
  const list = names.join(', ');
  if (outcome === 'nothing-to-ask') return '';
  if (outcome === 'saved') {
    return `🔐 Saved ${names.length === 1 ? 'your key' : `${names.length} keys`} (${list}) and wired ${names.length === 1 ? 'it' : 'them'} into the app.`;
  }
  return `👍 Skipped for now. The feature that needs ${list} will stay switched off until you add ${names.length === 1 ? 'it' : 'them'} in Settings → Secrets & API Keys.`;
}
