// P-DESIGN.5 — AI design generation & critique.
//
// AISuggestions was static/pattern-based. This adds a REAL AI design pass over the multi-model FREE
// router: (1) context-aware improvement suggestions/critique for the current app, and (2) a colour
// palette + type-scale generated from a brand/prompt to feed the DesignSystem tokens.
//
// The prompt builders and the response PARSERS are pure (string in → validated object out), so they
// are unit-tested without any network. The AI calls are thin wrappers that route through the provided
// router fn and parse — honest fallback ([] / null) when the model returns nothing usable; never throws.

export type SuggestionCategory = 'improve' | 'add' | 'fix' | 'style';

export interface DesignSuggestion {
  label: string;
  prompt: string;
  category: SuggestionCategory;
}

const CATEGORIES: ReadonlySet<string> = new Set<SuggestionCategory>(['improve', 'add', 'fix', 'style']);
const MAX_SUGGESTIONS = 6;

/** Strip markdown code fences and pull out the first JSON array or object. Pure. Returns '' if none. */
export function extractJson(text: string, kind: 'array' | 'object'): string {
  const s = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const open = kind === 'array' ? '[' : '{';
  const close = kind === 'array' ? ']' : '}';
  const start = s.indexOf(open);
  const end = s.lastIndexOf(close);
  if (start === -1 || end === -1 || end <= start) return '';
  return s.slice(start, end + 1);
}

/** Build the prompt that asks for actionable, context-aware design/improvement suggestions. Pure. */
export function buildSuggestionPrompt(code: string): string {
  const snippet = String(code || '').slice(0, 6000);
  return [
    'You are a senior product designer reviewing a web app. Suggest the most impactful, CONCRETE',
    'improvements for THIS app. Return ONLY a JSON array (no prose) of 4-6 objects, each:',
    '{ "label": "<short button text>", "prompt": "<a clear instruction the build agent can act on>",',
    '  "category": "improve" | "add" | "fix" | "style" }.',
    'Base them on what the code actually has or lacks — be specific, not generic.',
    '',
    snippet ? `App code/context:\n${snippet}` : 'No code yet — suggest strong starting-point features.',
  ].join('\n');
}

/** Parse the model output into validated suggestions. Pure. Returns [] when nothing usable. */
export function parseSuggestions(text: string): DesignSuggestion[] {
  try {
    const json = extractJson(text, 'array');
    if (!json) return [];
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    const out: DesignSuggestion[] = [];
    for (const raw of arr) {
      if (!raw || typeof raw !== 'object') continue;
      const label = typeof raw.label === 'string' ? raw.label.trim() : '';
      const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
      if (!label || !prompt) continue;
      const category: SuggestionCategory = CATEGORIES.has(raw.category) ? raw.category : 'improve';
      out.push({ label: label.slice(0, 80), prompt: prompt.slice(0, 400), category });
      if (out.length >= MAX_SUGGESTIONS) break;
    }
    return out;
  } catch {
    return [];
  }
}

export interface DesignPalette {
  colors: Record<string, string>;
  typeScale: Record<string, string>;
}

/** Build the prompt that asks for a colour palette + type scale from a brand/description. Pure. */
export function buildPalettePrompt(brand: string): string {
  return [
    'You are a brand/visual designer. From the brand description below, produce a cohesive UI palette',
    'and type scale. Return ONLY a JSON object (no prose):',
    '{ "colors": { "primary": "#RRGGBB", "secondary": "#RRGGBB", "accent": "#RRGGBB",',
    '  "background": "#RRGGBB", "surface": "#RRGGBB", "text": "#RRGGBB", "muted": "#RRGGBB" },',
    '  "typeScale": { "xs": "12px", "sm": "14px", "base": "16px", "lg": "20px", "xl": "28px", "2xl": "40px" } }.',
    'Use real hex colours with good contrast (WCAG AA for text on background).',
    '',
    `Brand: ${String(brand || '').slice(0, 600)}`,
  ].join('\n');
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Parse the model output into a validated palette. Pure. Returns null when nothing usable. */
export function parsePalette(text: string): DesignPalette | null {
  try {
    const json = extractJson(text, 'object');
    if (!json) return null;
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== 'object') return null;
    const colors: Record<string, string> = {};
    if (obj.colors && typeof obj.colors === 'object') {
      for (const [k, v] of Object.entries(obj.colors)) {
        if (typeof v === 'string' && HEX_RE.test(v.trim())) colors[k] = v.trim();
      }
    }
    if (Object.keys(colors).length === 0) return null; // a palette with no valid colours is useless
    const typeScale: Record<string, string> = {};
    if (obj.typeScale && typeof obj.typeScale === 'object') {
      for (const [k, v] of Object.entries(obj.typeScale)) {
        if (typeof v === 'string' && v.trim()) typeScale[k] = v.trim().slice(0, 12);
      }
    }
    return { colors, typeScale };
  } catch {
    return null;
  }
}

/** A minimal router shape (matches AIRouter.route) so this module is testable with a fake. */
export type RouteFn = (prompt: string, system?: string) => Promise<{ response: { content: string } }>;

/** Generate AI design suggestions for the given app code. Never throws; [] on any failure. */
export async function aiSuggestions(code: string, route: RouteFn): Promise<DesignSuggestion[]> {
  try {
    const { response } = await route(
      buildSuggestionPrompt(code),
      'You are a precise design assistant. Reply with ONLY the requested JSON, no commentary.',
    );
    return parseSuggestions(response?.content || '');
  } catch {
    return [];
  }
}

/** Generate an AI palette + type scale from a brand description. Never throws; null on failure. */
export async function aiPalette(brand: string, route: RouteFn): Promise<DesignPalette | null> {
  try {
    const { response } = await route(
      buildPalettePrompt(brand),
      'You are a precise design assistant. Reply with ONLY the requested JSON, no commentary.',
    );
    return parsePalette(response?.content || '');
  } catch {
    return null;
  }
}
