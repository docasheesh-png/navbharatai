// MEGA-APP ROADMAP — Phase 2 of the mega-app system (admin 2026-08-14, the "PUBG / WhatsApp / Claude
// jaisa banao" problem). When `appScopeAnalyzer` classifies a prompt as a MEGA app, this module turns it
// into an HONEST, step-by-step roadmap: an achievable first slice small enough to preview in ~5-7 min,
// then further checkpoints the user can build one tap at a time.
//
// THE DIVISION OF LABOUR (agreed 10/10 design):
//   • The LLM PROPOSES the roadmap (accuracy — it understands what "an Instagram" really decomposes into).
//   • Deterministic rules VERIFY it (`roadmapGuardrail`) — so a hallucinated / fake / vague step can never
//     reach the user. The LLM is creative; the guardrail is the honest gate. This is the whole reason the
//     roadmap is trustworthy: no step ships unless it is a REAL, buildable slice.
//   • Heavy-infra truths are marked, never hidden: a step that needs a game server / real-time backend /
//     a trained model is flagged `infraCeiling` so the user-facing reply is honest about it (rule 6).
//
// WHITE-LABEL: every user-facing string here (title / goal / summary / note) is authored by the model in
// the USER'S OWN LANGUAGE downstream and must never name a provider. The `buildPrompt` is INTERNAL (it
// drives the next build) and is never shown to the user.
//
// This module is PURE — no I/O, no clock, no model. The LLM call itself lives in the route; this module
// only builds the prompts, parses the reply, and guards the result. Never throws.

export interface RoadmapStep {
  /** 1-based order in the roadmap. */
  n: number;
  /** Short user-facing label for the checkpoint (in the user's language). */
  title: string;
  /** What the user will SEE working after this checkpoint (in the user's language). */
  goal: string;
  /** The exact build instruction for this checkpoint — INTERNAL, never shown to the user. */
  buildPrompt: string;
  /** True when this checkpoint genuinely needs infrastructure a one-shot build cannot deliver
   *  (a real-time/game server, video calling, a trained model, etc.) — the reply must be honest. */
  infraCeiling: boolean;
}

export interface MegaRoadmap {
  /** The famous product this clones, if any (from the scope pre-screen). */
  famousApp: string | null;
  /** A short, warm, HONEST message shown to the user in THEIR OWN language: this is a big app, I'll build
   *  the working core first (fast preview), and the rest arrives as guided next steps. Model-authored so
   *  it is never a hardcoded-English line shown to a Hindi user. Falls back to achievableSummary if blank. */
  userMessage: string;
  /** One honest line: what we CAN genuinely build (the achievable core), in the user's language. */
  achievableSummary: string;
  /** The validated checkpoints, in order. Always ≥ MIN_STEPS after the guardrail, or the roadmap is null. */
  steps: RoadmapStep[];
  /** An honest scope note when part of the ask is beyond a one-shot build (else null). User's language. */
  note: string | null;
}

/** A roadmap must have at least this many real checkpoints to be worth showing (else: build directly). */
export const MIN_ROADMAP_STEPS = 2;
/** More than this is noise for a non-tech user — the guardrail keeps only the first MAX. */
export const MAX_ROADMAP_STEPS = 6;

// ── PROMPTS ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * System prompt for the roadmap call. Instructs the model to be HONEST about scope, to make step 1 a
 * genuinely small but real slice (fast preview), and to return STRICT JSON we can parse deterministically.
 */
export function megaRoadmapSystemPrompt(): string {
  return [
    'You are the planning brain of an AI app builder. The user asked for a LARGE app (often a clone of a',
    'famous product). A single build cannot deliver the whole thing, and pretending otherwise would be',
    'dishonest. Your job: break the ask into an HONEST, incremental roadmap of buildable checkpoints.',
    '',
    'HARD RULES:',
    '1. Step 1 MUST be a small but REAL, working slice a user can see in a few minutes (e.g. the core',
    '   screen with its main interaction working on local/mock data) — never an empty shell, never a',
    '   "setup" step with nothing visible.',
    '2. Every step must be a CONCRETE, buildable feature — never vague ("polish", "add more", "etc",',
    '   "finish the app"). Each step adds something the user can SEE and USE.',
    '3. Order steps so each builds on the previous. Keep it to at most 6 checkpoints.',
    '4. Be HONEST about ceilings. If a feature truly needs infrastructure a front-end build cannot provide',
    '   on its own — a real-time/game multiplayer server, live video/voice calling, a self-trained AI',
    '   model, billions-of-users scale — say so plainly in that step (set "needsInfra" to a short honest',
    '   phrase). Do NOT drop the feature silently and do NOT pretend it is fully done.',
    '5. Write every user-facing field (achievableSummary, note, each title, each goal) in the SAME',
    '   language the user wrote their request in. Keep "buildPrompt" in clear English (it drives the build).',
    '6. NEVER mention any AI vendor or model name anywhere. You are "the builder".',
    '',
    'Return ONLY strict JSON, no prose, in exactly this shape:',
    '{',
    '  "userMessage": "2-3 warm, honest sentences to the user IN THEIR OWN LANGUAGE: this is a big app, so I will build the working core first (a real preview in a few minutes) and the rest will come as simple next steps you can tap one at a time",',
    '  "achievableSummary": "one honest sentence: what we can really build",',
    '  "note": "one honest sentence about anything beyond a normal build, or null",',
    '  "steps": [',
    '    { "title": "short label", "goal": "what the user will see working", "buildPrompt": "the exact build instruction", "needsInfra": "short honest phrase or null" }',
    '  ]',
    '}',
  ].join('\n');
}

/** User prompt for the roadmap call: the original request plus the deterministic scope signals. */
export function megaRoadmapUserPrompt(prompt: string, famousApp: string | null, signals: string[]): string {
  const clean = String(prompt || '').slice(0, 4000);
  const lines = [
    `User's request:\n${clean}`,
    '',
    famousApp ? `This resembles: ${famousApp}. Build an ORIGINAL app inspired by it — do not copy its brand, logos, or assets.` : '',
    signals.length ? `Scope signals detected: ${signals.join('; ')}.` : '',
    '',
    'Produce the honest roadmap JSON now.',
  ];
  return lines.filter(Boolean).join('\n');
}

// ── PARSING ─────────────────────────────────────────────────────────────────────────────────────────

interface RawStep { title?: unknown; goal?: unknown; buildPrompt?: unknown; needsInfra?: unknown }
interface RawRoadmap { userMessage?: unknown; achievableSummary?: unknown; note?: unknown; steps?: unknown }

/** Pull the first balanced JSON object out of a model reply (tolerates ```json fences / stray prose). */
function extractJsonObject(text: string): string | null {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Parse a model reply into a RAW roadmap (pre-guardrail). Returns null on unparseable input — never throws.
 * Parsing is deliberately permissive; the GUARDRAIL is where correctness is enforced.
 */
export function parseMegaRoadmap(text: string, famousApp: string | null): {
  userMessage: string;
  achievableSummary: string;
  note: string | null;
  steps: Array<{ title: string; goal: string; buildPrompt: string; needsInfra: string | null }>;
} | null {
  const json = extractJsonObject(text);
  if (!json) return null;
  let raw: RawRoadmap;
  try {
    raw = JSON.parse(json) as RawRoadmap;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.steps)) return null;
  const steps = (raw.steps as RawStep[]).map((s) => ({
    title: str(s?.title),
    goal: str(s?.goal),
    buildPrompt: str(s?.buildPrompt),
    needsInfra: str(s?.needsInfra) || null,
  }));
  return {
    userMessage: str(raw.userMessage),
    achievableSummary: str(raw.achievableSummary),
    note: str(raw.note) || null,
    steps,
  };
}

// ── GUARDRAIL (deterministic — this is what makes the roadmap trustworthy) ────────────────────────────

/** Vague/filler that must never survive as a real step's build instruction. */
const VAGUE = /^(?:etc\.?|and more|more features|\.\.\.|todo|tbd|polish|cleanup|clean up|finish (?:it|the app)|complete (?:it|the app)|improve|misc|various|other stuff)\.?$/i;

/** Heavy-infra phrases the guardrail flags on its OWN — it does not trust the model to always self-declare. */
const INFRA_RE = /\b(multiplayer|real-?time|websocket|game server|matchmaking|video call|voice call|webrtc|live stream|push notification server|train (?:a|an|our|my) (?:ai|ml|model)|foundation model|blockchain|peer-?to-?peer|p2p)\b/i;

const normTitle = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The honest gate. Takes the parsed (raw) roadmap and returns a VALIDATED MegaRoadmap, or null if too few
 * real steps survive. Rules:
 *   • a step needs a non-empty title, goal, and a substantive buildPrompt (≥ 12 chars, not vague filler);
 *   • duplicate titles are dropped (keep first);
 *   • at most MAX_ROADMAP_STEPS are kept; steps are re-numbered 1..n;
 *   • infraCeiling is TRUE if the model declared "needsInfra" OR the guardrail's own INFRA_RE matches the
 *     step text (belt-and-suspenders honesty — the model cannot hide a ceiling by omitting the field);
 *   • fewer than MIN_ROADMAP_STEPS survivors ⇒ null (not a real roadmap — the caller builds directly).
 * Pure; never throws.
 */
export function roadmapGuardrail(
  parsed: { userMessage?: string; achievableSummary: string; note: string | null; steps: Array<{ title: string; goal: string; buildPrompt: string; needsInfra: string | null }> } | null,
  famousApp: string | null,
): { roadmap: MegaRoadmap | null; rejected: string[] } {
  const rejected: string[] = [];
  if (!parsed) return { roadmap: null, rejected: ['no parseable roadmap'] };

  const seen = new Set<string>();
  const kept: RoadmapStep[] = [];
  for (const s of parsed.steps) {
    if (kept.length >= MAX_ROADMAP_STEPS) {
      rejected.push(`dropped extra step "${s.title}" (past ${MAX_ROADMAP_STEPS} cap)`);
      continue;
    }
    if (!s.title || !s.goal) { rejected.push(`step missing title/goal: "${s.title || s.goal || '(blank)'}"`); continue; }
    const bp = s.buildPrompt;
    if (!bp || bp.length < 12 || VAGUE.test(bp) || VAGUE.test(s.title)) {
      rejected.push(`step "${s.title}" rejected — vague/empty build instruction`);
      continue;
    }
    const key = normTitle(s.title);
    if (!key || seen.has(key)) { rejected.push(`duplicate step "${s.title}"`); continue; }
    seen.add(key);
    const infraCeiling = !!s.needsInfra || INFRA_RE.test(`${s.title} ${s.goal} ${s.buildPrompt} ${s.needsInfra || ''}`);
    kept.push({ n: kept.length + 1, title: s.title, goal: s.goal, buildPrompt: bp, infraCeiling });
  }

  if (kept.length < MIN_ROADMAP_STEPS) {
    return { roadmap: null, rejected: [...rejected, `only ${kept.length} valid step(s) — below the ${MIN_ROADMAP_STEPS} minimum`] };
  }

  const summary = parsed.achievableSummary || (famousApp ? `A working app inspired by ${famousApp}, built step by step.` : 'A working app, built step by step.');
  // If any kept step hit a ceiling but the model gave no note, synthesise an honest one so the truth is
  // never silent (rule 6). Kept short and vendor-free; the reply layer localises/keeps as-is.
  let note = parsed.note;
  if (!note && kept.some((k) => k.infraCeiling)) {
    note = 'Some parts (like real-time or server-heavy features) need extra infrastructure and will be built as honest, separate steps.';
  }

  // The user-facing message falls back to the (also user's-language) achievableSummary if the model
  // omitted it — never a hardcoded-English default that a non-English user could be shown.
  const userMessage = (parsed.userMessage && parsed.userMessage.trim()) || summary;

  return { roadmap: { famousApp, userMessage, achievableSummary: summary, steps: kept, note }, rejected };
}

/** A compact, admin-facing one-liner summary of a roadmap for the build diagnostics report. */
export function summarizeRoadmapForDiag(roadmap: MegaRoadmap): string {
  const ceils = roadmap.steps.filter((s) => s.infraCeiling).length;
  return `${roadmap.steps.length} checkpoint(s)${ceils ? `, ${ceils} with an honest infra ceiling` : ''}: `
    + roadmap.steps.map((s) => `${s.n}) ${s.title}${s.infraCeiling ? ' [infra]' : ''}`).join('  ');
}
