/**
 * Requirement Spec extraction (Phase 7.1 — understand ANY app, not just keywords).
 *
 * Before planning a fresh build, ask the model to distill the prompt into a
 * structured spec — appType, modules, pages, entities. Feeding this into the
 * planner makes the file plan cover EVERY module/page/entity the user described,
 * even for domains the keyword catalog doesn't know (the goal: handle every app).
 *
 * The model call is injected (same ModelCall as the generator), so this is
 * unit-testable; on any failure it returns an empty spec and the planner falls
 * back to prompt-only planning (no regression).
 */
import type { ModelCall } from './aiEdits';

export interface RequirementSpec {
  appType: string;
  modules: string[];
  pages: string[];
  entities: string[];
}

const EMPTY: RequirementSpec = { appType: '', modules: [], pages: [], entities: [] };

/** Extract the first JSON object from arbitrary model text. */
function extractJsonObject(raw: string): any {
  if (!raw) return null;
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* slice */ }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

function strArray(v: any, cap = 40): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = typeof item === 'string' ? item.trim() : (item && typeof item.name === 'string' ? item.name.trim() : '');
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

const SPEC_SYS = `You are a senior requirements analyst. Read the app request and extract a structured specification. Reply with ONLY JSON, no prose, no markdown fences:
{"appType":"short label","modules":["major feature areas"],"pages":["distinct screens/views"],"entities":["data models"]}
Be thorough: list EVERY module, page, and entity the request implies — do not summarize or drop any.`;

/** Distill the prompt into a structured spec. Empty spec on any failure (safe fallback). */
export async function extractRequirementSpec(callModel: ModelCall, prompt: string): Promise<RequirementSpec> {
  try {
    const raw = await callModel(SPEC_SYS, `App request:\n${prompt}\n\nExtract the full specification now.`);
    const j = extractJsonObject(raw);
    if (!j || typeof j !== 'object') return EMPTY;
    return {
      appType: typeof j.appType === 'string' ? j.appType.trim() : '',
      modules: strArray(j.modules),
      pages: strArray(j.pages),
      entities: strArray(j.entities),
    };
  } catch {
    return EMPTY;
  }
}

/** Render the spec as a planning directive (empty string when nothing useful was extracted). */
export function specSummary(spec: RequirementSpec): string {
  const parts: string[] = [];
  if (spec.modules.length) parts.push(`MODULES (each needs its own pages + components + store/service/types):\n${spec.modules.map((m) => `- ${m}`).join('\n')}`);
  if (spec.pages.length) parts.push(`PAGES/SCREENS (each is a separate route + file):\n${spec.pages.map((p) => `- ${p}`).join('\n')}`);
  if (spec.entities.length) parts.push(`ENTITIES (data models for the store/types):\n${spec.entities.map((e) => `- ${e}`).join('\n')}`);
  if (!parts.length) return '';
  return `STRUCTURED SPEC — cover ALL of the following, leave nothing out:\n${parts.join('\n\n')}`;
}

/** True if the spec carries enough signal to guide planning. */
export function hasUsefulSpec(spec: RequirementSpec): boolean {
  return spec.modules.length + spec.pages.length + spec.entities.length >= 2;
}
