// OBJECT FORGE — SELF-AUTHORING: the user asks for a thing in words, NavBharatAI makes it. No spec from the builder, no pre-made model.
//
// Admin 2026-11-15: *"koi bhi object / subject apne-aap bane, api call se"* and *"atma nirbhar banao"*. The Forge (forgeRuntime.ts) already
// checks, measures and DRAWS a spec. This closes the loop with an AI call: ask a model for a spec from the description, run the Forge
// on it, and when it comes back with errors or warnings (parts floating free, a base off the ground, a clip that tears the object, an
// outline that crosses itself) hand the model THE FORGE'S OWN REPORT — the numbers and the three drawings — and ask for a corrected
// spec. A few rounds, then the best result. The model sees its own object; that is what makes a blind first draft good.
//
// What this is NOT, said plainly: it makes stylised low-poly figures from primitives. A photoreal human, a scanned car or a sculpted
// creature is a different product (a text-to-3D mesh service: real money per object, 30 to 120 seconds, a mesh to host and license — the
// admin declined that on 2026-09-14, objectSpecProvider.ts, and it needs a provider key that is not set). The honest word for what
// comes out is "stylised", and the result says so.
//
// Pure: the model is injected (`ask`), so every rule here is testable without one, and a model that is down, slow or talking nonsense
// costs nothing and breaks nothing — the caller falls back to writing a spec itself.
import { FORGE_GUIDE } from './ObjectForgeGenerator';
import { loadForge, type ObjectReport } from './forgeRuntime';
import { FORGE_EXAMPLES } from './forgeExamples';
import { specKey } from '../objectSpecProvider';

export const SELF_AUTHOR_ROUNDS = 4;

export interface SelfAuthorDeps {
  /** One model call: (prompt, system) → text, or null when it failed. MUST resolve, never throw. */
  ask: (prompt: string, system: string) => Promise<string | null>;
  /** Real-world facts about the thing (size in metres, the parts it cannot read as itself without), when the catalogue or a spec provider has them. */
  groundTruth?: string;
  rounds?: number;
  /** The id the object is saved under; default is made from the description. */
  id?: string;
}

export interface SelfAuthorAttempt { round: number; errors: string[]; warnings: string[]; triangles?: number }

export interface SelfAuthorResult {
  ok: boolean;
  /** The spec to write (valid), when ok. */
  spec?: Record<string, unknown>;
  report?: ObjectReport;
  /** Warnings that were still there in the best result (none means it came out clean). */
  remainingWarnings: string[];
  attempts: SelfAuthorAttempt[];
  /** What to tell the builder. */
  text: string;
}

export const SELF_AUTHOR_SYSTEM = [
  'You are a 3D modeller who builds game objects as a small JSON spec for a procedural engine. You answer with ONLY one JSON object: no prose, no code fence.',
  '',
  FORGE_GUIDE.split('\n').filter((l) => !l.includes('author_object')).join('\n'),
].join('\n');

/** A compact worked example, so the format is shown and not only described. */
function exampleBlock(): string {
  return 'A COMPLETE EXAMPLE of the format (a sword); yours will be different:\n' + JSON.stringify(FORGE_EXAMPLES.sword.spec);
}

/** The model's text → a JSON object, or null. Models wrap JSON in a fence or a sentence more often than not. */
export function parseSpecText(raw: string | null | undefined): Record<string, unknown> | null {
  const text = String(raw ?? '').trim();
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v: unknown = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

/** The id an object is saved under, made from what the user asked for ("a lighthouse with a spiral stair" → lighthouse-with-a-spiral-stair). */
export function objectIdFor(request: string): string {
  const k = specKey(request).slice(0, 36).replace(/-+$/g, '');
  return /^[a-z]/.test(k) && k.length >= 2 ? k : 'object-' + (k || 'made');
}

function firstPrompt(request: string, groundTruth: string | undefined, id: string): string {
  return [
    'Make this object for a 3D game: "' + request.trim() + '".',
    groundTruth ? '\nReal-world facts to build to (use these sizes, in metres):\n' + groundTruth : '',
    '',
    exampleBlock(),
    '',
    'Answer with ONLY the JSON spec. Use "id": "' + id + '". Block the main masses with true proportions, make every part touch its neighbour, stand it on y = 0 facing +z, and give anything alive pivots at its joints and a "walk" clip.',
  ].filter((l) => l !== '').join('\n');
}

function fixPrompt(request: string, previous: string, feedback: string): string {
  return [
    'You are building: "' + request.trim() + '". Your last spec had problems. The Forge checked it and says:',
    '',
    feedback,
    '',
    'Your last spec was:',
    previous.length > 12000 ? previous.slice(0, 12000) + ' ...(cut)' : previous,
    '',
    'Answer with ONLY the corrected, COMPLETE JSON spec (the whole object, not a patch). Read the drawings: fix what they show.',
  ].join('\n');
}

/** How bad a set of warnings is: each warning counts, and a warning about N groups of floating parts counts N more (two detached groups are worse than one). */
export function warningScore(warnings: string[]): number {
  let n = warnings.length * 100;
  for (const w of warnings) { const m = /^(\d+) group\(s\) of parts float free/.exec(w); if (m) n += Number(m[1]); }
  return n;
}

/** Make an object from a description: ask, check, show the model its own drawing, correct — up to `rounds` times. Never throws. */
export async function selfAuthorObject(request: string, deps: SelfAuthorDeps): Promise<SelfAuthorResult> {
  const wanted = String(request ?? '').trim();
  const attempts: SelfAuthorAttempt[] = [];
  if (wanted.length < 2) return { ok: false, remainingWarnings: [], attempts, text: 'Describe the object (what it is, roughly how big, anything that matters) and call again.' };
  const rounds = Math.max(1, Math.min(SELF_AUTHOR_ROUNDS, deps.rounds ?? SELF_AUTHOR_ROUNDS));
  const id = deps.id ?? objectIdFor(wanted);
  const { check } = loadForge();
  let prompt = firstPrompt(wanted, deps.groundTruth, id);
  let previousText = '';
  let best: { spec: Record<string, unknown>; report: ObjectReport; warnings: string[] } | null = null;

  for (let round = 1; round <= rounds; round++) {
    let raw: string | null = null;
    try { raw = await deps.ask(prompt, SELF_AUTHOR_SYSTEM); } catch { raw = null; }
    if (raw === null || raw === undefined) { attempts.push({ round, errors: ['the model did not answer'], warnings: [] }); break; }
    previousText = raw;
    const parsed = parseSpecText(raw);
    if (!parsed) {
      attempts.push({ round, errors: ['the answer was not a JSON object'], warnings: [] });
      prompt = fixPrompt(wanted, raw.slice(0, 4000), 'Your answer was not valid JSON. Answer with ONLY one JSON object.');
      continue;
    }
    parsed.id = id; // the id is ours: stable, valid, and the same on every round
    const v = check.validateObjectSpec(parsed);
    if (!v.spec) {
      attempts.push({ round, errors: v.errors, warnings: [] });
      prompt = fixPrompt(wanted, JSON.stringify(parsed), 'The spec was NOT built:\n' + v.errors.map((e) => '- ' + e).join('\n'));
      continue;
    }
    const report = check.measureObject(v.spec);
    const warnings = [...v.warnings, ...report.warnings];
    attempts.push({ round, errors: [], warnings, triangles: report.triangles });
    if (!best || warningScore(warnings) < warningScore(best.warnings)) best = { spec: v.spec, report, warnings };
    if (warnings.length === 0) break;
    prompt = fixPrompt(wanted, JSON.stringify(parsed), check.formatReport({ ...report, warnings }));
  }

  if (!best) {
    const last = attempts[attempts.length - 1];
    return {
      ok: false, remainingWarnings: [], attempts,
      text: 'The Forge could not make "' + wanted + '" from the description after ' + attempts.length + ' attempt(s). Last problem: ' + (last?.errors.slice(0, 3).join('; ') || 'no answer') + '. Write the spec yourself with author_object({ spec }) (call it with no arguments for the guide) or simplify the request. Last model answer began: ' + previousText.slice(0, 120).replace(/\s+/g, ' '),
    };
  }
  return { ok: true, spec: best.spec, report: best.report, remainingWarnings: best.warnings, attempts, text: '' };
}

/** A bounded cache of finished specs by description, so the same thing asked twice (or by two builds) costs one model call. */
const MAX_CACHE = 200;
const made = new Map<string, Record<string, unknown>>();
export const madeCache = {
  get: (request: string): Record<string, unknown> | undefined => made.get(specKey(request)),
  set: (request: string, spec: Record<string, unknown>): void => {
    const k = specKey(request);
    if (!k) return;
    if (made.size >= MAX_CACHE) { const oldest = made.keys().next().value; if (oldest !== undefined) made.delete(oldest); }
    made.set(k, spec);
  },
  size: (): number => made.size,
  clear: (): void => { made.clear(); },
};
