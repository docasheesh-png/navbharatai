// AI Debugger — pure prompt-building + response-parsing core (admin autopsy 2026-07-20).
//
// WHY THIS EXISTS: the Settings → AI Tools → AI Debugger tile shipped display-only — its client
// POSTed to /api/debug, a route that never existed, and on the inevitable failure rendered a FAKE
// canned "analysis" as if an AI had produced it (a hard rule-2 violation). This module is the pure
// core of the REAL implementation: the thin /api/debug route calls the free-tier AI chain with
// these prompts and parses the model's reply with parseDebugResponse. Pure → unit-testable.
//
// WHITE-LABEL: the system prompt brands the assistant as NavBharatAI and forbids naming any
// underlying model/vendor, so the analysis text can never leak provider identity to the user.

export interface DebugResult {
  rootCause: string;
  fix: string;
  explanation: string[];
  prevention: string[];
}

const MAX_ERROR_CHARS = 20_000;
const MAX_CODE_CHARS = 60_000;

/** The system prompt for the debugger persona. Strict-JSON output so the client can render sections. */
export function buildDebugSystemPrompt(): string {
  return `You are NavBharatAI's AI Debugger — an expert software debugging assistant built into NavBharatAI.
IDENTITY RULE: you are simply "NavBharatAI". NEVER mention any underlying AI model, engine, or vendor name.

TASK: the user gives you an error (and optionally the related code). Find the TRUE root cause and give a real, working fix — not a generic lecture.

LANGUAGE RULE: write rootCause / explanation / prevention in the same language style the user writes in (Hindi, Hinglish, English, or any other language — mirror them). ALL code stays in professional English.

OUTPUT FORMAT (MANDATORY): reply with ONLY a JSON object, no markdown fences, no prose around it:
{
  "rootCause": "one/two sentences naming the exact cause",
  "fix": "the corrected code or exact steps, as plain text (may contain code)",
  "explanation": ["step-by-step reasoning, one point per array item"],
  "prevention": ["how to stop this class of bug from returning, one point per item"]
}
If the input is not actually an error/debugging question, say so honestly inside rootCause and leave fix empty — never invent a fake diagnosis.`;
}

/** The user prompt: bounded error text + optional code context + optional error-type hint. */
export function buildDebugUserPrompt(error: string, code?: string, errorType?: string): string {
  const parts: string[] = [];
  if (errorType && errorType.trim()) parts.push(`Error category (user-selected): ${errorType.trim().slice(0, 100)}`);
  parts.push(`ERROR:\n${String(error).slice(0, MAX_ERROR_CHARS)}`);
  if (code && code.trim()) parts.push(`RELATED CODE:\n${String(code).slice(0, MAX_CODE_CHARS)}`);
  return parts.join('\n\n');
}

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => String(x)) : [];

/**
 * Parse the model's reply into a DebugResult. Tolerates ```json fences and stray prose around the
 * object. HONESTY: when no valid JSON can be found, the RAW model text is returned as the
 * explanation (clearly real output, just unstructured) — never a fabricated structured answer.
 */
export function parseDebugResponse(text: string): DebugResult {
  const raw = String(text ?? '').trim();
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  // Try the whole text first, then the first {...} block inside it.
  const candidates: string[] = [unfenced];
  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(unfenced.slice(firstBrace, lastBrace + 1));
  for (const c of candidates) {
    try {
      const j = JSON.parse(c) as Record<string, unknown>;
      if (j && typeof j === 'object' && (typeof j.rootCause === 'string' || typeof j.fix === 'string')) {
        return {
          rootCause: typeof j.rootCause === 'string' ? j.rootCause : '',
          fix: typeof j.fix === 'string' ? j.fix : '',
          explanation: asStringArray(j.explanation),
          prevention: asStringArray(j.prevention),
        };
      }
    } catch { /* try the next candidate */ }
  }
  // Unstructured but REAL model output — surface it honestly instead of discarding or faking.
  return { rootCause: '', fix: '', explanation: raw ? [raw] : [], prevention: [] };
}

/** Request-shape guard for the route (pure, mirrors the validate schema bounds). */
export function isValidDebugRequest(body: unknown): body is { error: string; code?: string; errorType?: string } {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  if (typeof b.error !== 'string' || !b.error.trim()) return false;
  if (b.code !== undefined && typeof b.code !== 'string') return false;
  if (b.errorType !== undefined && typeof b.errorType !== 'string') return false;
  return true;
}
