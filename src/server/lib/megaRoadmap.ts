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
    '1. Step 1 MUST be a small but REAL, working slice a user can see in a few minutes — never an empty',
    '   shell, never a "setup" step with nothing visible. Local/sample data is allowed ONLY when the',
    '   user has not forbidden it AND the product\'s core promise is not the live thing itself: an AI',
    '   chat\'s reply, a payment, a real search result must be REAL from step 1 (using the user\'s own',
    '   key or config), never a canned or simulated stand-in.',
    '7. NEVER plan a placeholder: a button that "logs to the console", a "visual only" control, a fake',
    '   "connected" status, a simulated response, a simulated progress bar or "rendering…" animation for',
    '   work nothing is doing. A control that is not built in this step is simply',
    '   absent (or visibly disabled with an honest label) until its own step builds it.',
    '8. The user\'s explicit constraints (a required stack, a forbidden stack, "one single file", "no',
    '   fake responses") bind EVERY step, not just step 1. Repeat each one inside every buildPrompt.',
    '2. Every step must be a CONCRETE, buildable feature — never vague ("polish", "add more", "etc",',
    '   "finish the app"). Each step adds something the user can SEE and USE.',
    '3. Order steps so each builds on the previous. Keep it to at most 6 checkpoints.',
    '4. Be HONEST about ceilings. If a feature truly needs infrastructure a front-end build cannot provide',
    '   on its own — a real-time/game multiplayer server, live video/voice calling, a self-trained AI',
    '   model, billions-of-users scale — say so plainly in that step (set "needsInfra" to a short honest',
    '   phrase). Do NOT drop the feature silently and do NOT pretend it is fully done.',
    '   "needsInfra" is ONLY for a step that cannot work at all without it. A step that runs fully in the',
    '   browser (search, sort, filters, charts, CSV / JSON export, backup to a file, restore from a file)',
    '   gets "needsInfra": null — even if a bigger version of it (cloud sync, a server-made PDF) would need',
    '   a server; put that optional extra in "note" instead.',
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
/**
 * The user's request, bounded — with its TAIL kept.
 *
 * 🔴 `slice(0, 4000)` DROPPED THE CONSTRAINTS (build 681bd91b). A ~9,000-character prompt put "NO FAKE
 * FEATURES / no simulated model responses / do NOT create buttons that don't work" in its last
 * sections — exactly where people put rules — and the planner never saw them. It then planned a
 * "mock assistant that streams canned responses" and "placeholder buttons that log to the console":
 * the two things the user had forbidden, by our own instruction. Head AND tail are kept; only the
 * middle is elided, and the elision is marked so the model knows it is reading an excerpt.
 */
export function boundedRequest(prompt: string, head = 3000, tail = 1500): string {
  const text = String(prompt || '');
  if (text.length <= head + tail) return text;
  return `${text.slice(0, head)}\n…[middle of the request omitted for length]…\n${text.slice(-tail)}`;
}

/**
 * The lines of a request that read as HARD constraints — "do not", "never", "must", "only", "no fake",
 * "single file". Deterministic and bounded, so they can be restated to a step's builder verbatim after
 * the roadmap has replaced the user's own words with a step's (see routes/agentv3.ts, the swap).
 */
export function hardConstraintLines(prompt: string, max = 24): string[] {
  const out: string[] = [];
  for (const raw of String(prompt || '').split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*•]\s*/, '');
    if (line.length < 6 || line.length > 220) continue;
    if (/\b(?:do\s+not|don'?t|never|must\s+not|must\b|only\b|no\s+(?:fake|mock|simulated|placeholder|react|vite|npm|backend|build\s+(?:step|command|tool))|single\s+(?:self-contained\s+)?(?:html\s+)?file|one\s+single|self-contained)\b/i.test(line)) {
      out.push(line);
      if (out.length >= max) break;
    }
  }
  return out;
}

/**
 * Which SCRIPT the user wrote in, stated to the planner as a fact rather than left for it to infer.
 *
 * 🔴 AUTOPSY 4499741f (2026-09-29). The request was English with Hindi words typed in Roman letters
 * ("Website mein user YouTube ka … URL paste karke"). Rule 5 already says "the SAME language the user
 * wrote in", and the planner answered every user-facing field in DEVANAGARI — it read "Hindi words" as
 * "Hindi script". Roman Hinglish is its own way of writing: a reader who types it may not read
 * Devanagari at all. The script is counted here, deterministically, so the instruction names it. PURE.
 */
export function replyScriptLine(prompt: string): string {
  const text = String(prompt || '');
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const indic = (text.match(/[\u0900-\u0DFF]/g) || []).length;
  if (latin + indic === 0) return '';
  if (indic / (latin + indic) < 0.1) {
    return 'REPLY SCRIPT: the user wrote in LATIN letters (English, or Hindi words typed in Roman letters). '
      + 'Write EVERY user-facing field (userMessage, achievableSummary, note, titles, goals) in Latin letters — '
      + 'English, or Roman Hinglish if they mixed Hindi words. NEVER use Devanagari or any other script.';
  }
  return 'REPLY SCRIPT: the user wrote in an Indian script. Write every user-facing field in that SAME script.';
}

export function megaRoadmapUserPrompt(prompt: string, famousApp: string | null, signals: string[]): string {
  const clean = boundedRequest(prompt);
  const constraints = hardConstraintLines(prompt);
  const lines = [
    `User's request:\n${clean}`,
    replyScriptLine(prompt),
    constraints.length
      ? `\nNON-NEGOTIABLE CONSTRAINTS the user stated (bind EVERY step — restate them in each buildPrompt):\n${constraints.map((c) => `- ${c}`).join('\n')}`
      : '',
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

/**
 * Heavy-infra phrases the guardrail flags on its OWN — it does not trust the model to always self-declare.
 *
 * 🔴 "REAL-TIME" ON ITS OWN IS A UI WORD (autopsy 2a7fa4b0, 2026-09-25). An expense tracker's step
 * "Add a real-time search input that filters expenses as the user types" was badged as needing a
 * server — to the user, in the 💡 roadmap — because a bare `real-?time` matched. Filtering a list while
 * someone types runs entirely in their browser. Real-time is infrastructure only when it is real-time
 * BETWEEN people or devices (chat, sync, collaboration, live location), so only those spellings count.
 */
/**
 * A build instruction that asks for work to be FAKED — "simulate the process: show 'Generating Script',
 * then a 'Rendering' progress bar". 🔴 Autopsy f385a5f9 (2026-09-30): the planner wrote exactly that for
 * a video generator whose real service was not connected, and rule 7 above had already forbidden it in
 * words. A rule the model may ignore is a request; this is the check.
 */
const SIMULATION_RE = /\b(?:simulat\w*|fake|pretend\w*)\b[^.;]{0,80}?\b(?:process|progress|render\w*|generat\w*|upload\w*|processing|response|result|status|loading|job)\b|\b(?:progress bar|rendering|processing)\b[^.;]{0,40}?\b(?:simulat\w*|fake)\b/gi;
/** "no fake responses", "never simulate…", "without faking" — the user's own constraint, restated. */
const NEGATED_BEFORE = /\b(?:no|not|never|don'?t|do not|without|avoid|must not|instead of)\s+(?:\w+\s+){0,2}$/i;

/** Does this build instruction ask for work to be faked? A negated mention is the opposite. Pure. */
export function asksForSimulation(buildPrompt: string): boolean {
  const text = String(buildPrompt ?? '');
  for (const m of text.matchAll(SIMULATION_RE)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
    if (!NEGATED_BEFORE.test(before)) return true;
  }
  return false;
}

/** What replaces a simulated step's promise: the honest not-available state, said in the instruction itself. */
export const NO_SIMULATION_CLAUSE = 'Do NOT simulate or animate work that nothing is doing: no fake progress bar, no staged "generating…/rendering…" messages. Where the real service is not connected, show one honest, clearly labelled "not available yet" state that says what it needs.';

const INFRA_RE = /\b(multiplayer|real-?time\s+(?:chat|messag\w*|sync\w*|collaborat\w*|co-?editing|location|tracking|multiplayer|notifications?|updates?\s+(?:between|across|for all|to (?:all|other))|feed)|websocket|game server|matchmaking|video call|voice call|webrtc|live stream|push notification server|train (?:a|an|our|my) (?:ai|ml|model)|foundation model|blockchain|peer-?to-?peer|p2p)\b/i;

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
    const simulated = asksForSimulation(bp);
    if (simulated) rejected.push(`step "${s.title}" asked for work to be simulated — rewritten to an honest not-available state`);
    const infraCeiling = simulated || !!s.needsInfra || INFRA_RE.test(`${s.title} ${s.goal} ${s.buildPrompt} ${s.needsInfra || ''}`);
    kept.push({ n: kept.length + 1, title: s.title, goal: s.goal, buildPrompt: simulated ? `${bp} ${NO_SIMULATION_CLAUSE}` : bp, infraCeiling });
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

// ── PUBLIC (USER-FACING) VIEW — Phase 4, the 💡 guided roadmap ────────────────────────────────────────

export type PublicRoadmapStepStatus = 'done' | 'current' | 'next' | 'upcoming';

export interface PublicRoadmapStep {
  n: number;
  title: string;
  goal: string;
  infraCeiling: boolean;
  status: PublicRoadmapStepStatus;
}

export interface PublicRoadmap {
  famousApp: string | null;
  userMessage: string;
  note: string | null;
  /** The milestone the user has reached (1-based). Step `currentStep` is "current", earlier are "done". */
  currentStep: number;
  totalSteps: number;
  /** True once every checkpoint has been reached — the journey is finished. */
  complete: boolean;
  /** The step number to build next (currentStep+1), or null when complete. */
  nextStep: number | null;
  /** The ready-to-send instruction for the next step, IN THE USER'S OWN LANGUAGE (title + goal), or null.
   *  Deliberately NOT the internal English `buildPrompt`: sending English here would build the next step in
   *  English, breaking the user-language rule. The user reviews/edits this before sending. */
  nextFillPrompt: string | null;
  steps: PublicRoadmapStep[];
}

/**
 * Shape a stored roadmap for the client. `currentStep` = the milestone reached (never marks a step "done"
 * that has not been passed). The internal per-step `buildPrompt` is intentionally withheld — the client
 * only ever needs the user-language title/goal to fill the composer. Pure; clamps a bad currentStep.
 */
export function publicRoadmapView(roadmap: MegaRoadmap, currentStepRaw: number): PublicRoadmap {
  const total = roadmap.steps.length;
  const currentStep = Math.min(Math.max(1, Math.floor(currentStepRaw || 1)), Math.max(1, total));
  const complete = currentStep >= total;
  const nextStep = complete ? null : currentStep + 1;
  const nextStepObj = nextStep ? roadmap.steps[nextStep - 1] : null;
  const steps: PublicRoadmapStep[] = roadmap.steps.map((s) => ({
    n: s.n,
    title: s.title,
    goal: s.goal,
    infraCeiling: s.infraCeiling,
    status: s.n < currentStep ? 'done' : s.n === currentStep ? 'current' : s.n === currentStep + 1 ? 'next' : 'upcoming',
  }));
  return {
    famousApp: roadmap.famousApp,
    userMessage: roadmap.userMessage,
    note: roadmap.note,
    currentStep,
    totalSteps: total,
    complete,
    nextStep,
    nextFillPrompt: nextStepObj ? `${nextStepObj.title}. ${nextStepObj.goal}` : null,
    steps,
  };
}

/** A compact, admin-facing one-liner summary of a roadmap for the build diagnostics report. */
export function summarizeRoadmapForDiag(roadmap: MegaRoadmap): string {
  const ceils = roadmap.steps.filter((s) => s.infraCeiling).length;
  return `${roadmap.steps.length} checkpoint(s)${ceils ? `, ${ceils} with an honest infra ceiling` : ''}: `
    + roadmap.steps.map((s) => `${s.n}) ${s.title}${s.infraCeiling ? ' [infra]' : ''}`).join('  ');
}
