/**
 * A STRUCTURED ARGUMENT SENT AS TEXT IS READ AS WHAT IT SAYS (failedbr #1326, #1322, 2026-11-20).
 *
 * OpenAI-compatible engines (Nemotron, GLM, KIMI) send a tool call's arguments as one JSON string; some
 * of them encode a nested array a second time, so `update_todo` arrived as `{ todos: "[{\"id\":…}]" }`.
 * The tool answered "todos must be an array" seven times across two builds, and the model spent 426 s
 * and 347 s of turns on a plan it could never save.
 *
 * The class is every tool argument the catalog declares as an array or an object, not one tool, so it
 * is decoded once, at the dispatcher's door, against the catalog's own schema: a string becomes the
 * value only when it parses to exactly the declared shape. A string that is meant as text — or that is
 * not JSON — is left untouched, so nothing that worked before changes.
 */
import type { ClaudeToolDef } from './ClaudeClient';

type Shape = 'array' | 'object';

function declaredShapes(def: ClaudeToolDef | undefined): Map<string, Shape> {
  const shapes = new Map<string, Shape>();
  for (const [key, prop] of Object.entries(def?.input_schema?.properties ?? {})) {
    const t = (prop as { type?: unknown } | null)?.type;
    if (t === 'array' || t === 'object') shapes.set(key, t);
  }
  return shapes;
}

function decoded(value: string, shape: Shape): unknown {
  const text = value.trim();
  if (!(shape === 'array' ? text.startsWith('[') && text.endsWith(']') : text.startsWith('{') && text.endsWith('}'))) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (shape === 'array') return Array.isArray(parsed) ? parsed : undefined;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The input with every catalog-declared array/object argument that arrived as JSON text decoded. Same object when nothing changed. */
export function withStructuredArguments(input: unknown, def: ClaudeToolDef | undefined): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const shapes = declaredShapes(def);
  if (shapes.size === 0) return input;
  let out: Record<string, unknown> | null = null;
  for (const [key, shape] of shapes) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value !== 'string') continue;
    const next = decoded(value, shape);
    if (next === undefined) continue;
    out ??= { ...(input as Record<string, unknown>) };
    out[key] = next;
  }
  return out ?? input;
}
