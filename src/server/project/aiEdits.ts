/**
 * Phase 4 — AI ⇄ engine bridge.
 *
 * Turns an LLM's (often messy) text reply into validated `FileEdit[]` for the
 * BuildPipeline, and builds the prompts that ask the model for that JSON. The
 * model call is injected so the bridge is unit-testable without a live model.
 *
 * Robust parsing: strips ```json fences and surrounding prose, accepts either a
 * bare array or an object with an `edits` array, and drops malformed ops rather
 * than throwing (a partial-but-valid edit set is better than a hard failure).
 */
import type { FileEdit } from './EditEngine';
import type { VirtualFileSystem } from './ProjectModel';
import type { ProjectIssue } from './ProjectVerifier';

/** Extract the first JSON value (array or object) from arbitrary model text. */
function extractJson(raw: string): unknown {
  if (!raw) return null;
  let s = raw.trim();
  // strip code fences
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // try direct parse, else slice from first [ or { to its matching last bracket
  try { return JSON.parse(s); } catch { /* fall through */ }
  const start = s.search(/[[{]/);
  if (start < 0) return null;
  const open = s[start];
  const close = open === '[' ? ']' : '}';
  const end = s.lastIndexOf(close);
  if (end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

const VALID_OPS = new Set(['write', 'delete', 'rename', 'patch']);

/** Validate + coerce a raw object into a FileEdit, or null if malformed. */
function toFileEdit(o: any): FileEdit | null {
  if (!o || typeof o !== 'object' || typeof o.op !== 'string' || !VALID_OPS.has(o.op)) return null;
  if (typeof o.path !== 'string' || !o.path.trim()) return null;
  switch (o.op) {
    case 'write':
      return typeof o.content === 'string' ? { op: 'write', path: o.path, content: o.content } : null;
    case 'delete':
      return { op: 'delete', path: o.path };
    case 'rename':
      return typeof o.to === 'string' && o.to.trim() ? { op: 'rename', path: o.path, to: o.to } : null;
    case 'patch':
      return typeof o.find === 'string' && typeof o.replace === 'string'
        ? { op: 'patch', path: o.path, find: o.find, replace: o.replace, count: o.count } : null;
    default:
      return null;
  }
}

/** Parse an LLM reply into a validated, deduped FileEdit[] (malformed ops dropped). */
export function parseFileEdits(raw: string): FileEdit[] {
  const json: any = extractJson(raw);
  const arr: any[] = Array.isArray(json) ? json : Array.isArray(json?.edits) ? json.edits : [];
  const edits: FileEdit[] = [];
  for (const item of arr) {
    const e = toFileEdit(item);
    if (e) edits.push(e);
  }
  return edits;
}

/** A model call: (system, user) → assistant text. Injected (defaults to aiCalls). */
export type ModelCall = (system: string, user: string) => Promise<string>;

const EDIT_FORMAT = `Reply with ONLY a JSON array of edit operations, no prose, no markdown fences. Each op is one of:
{"op":"write","path":"src/App.tsx","content":"<full file content>"}
{"op":"patch","path":"src/App.tsx","find":"<exact snippet>","replace":"<new snippet>","count":1}
{"op":"rename","path":"old","to":"new"}
{"op":"delete","path":"file"}
Use relative paths. Prefer "patch" for small changes; "write" for new/rewritten files. ALL code identifiers in English.`;

function fileList(vfs: VirtualFileSystem): string {
  const paths = vfs.paths();
  return paths.length ? paths.join('\n') : '(empty project)';
}

/** Build generate+fix functions for the BuildPipeline backed by an injected model. */
export function makeAiEditGenerator(callModel: ModelCall) {
  const generate = async (prompt: string, vfs: VirtualFileSystem): Promise<FileEdit[]> => {
    const sys = `You are an expert full-stack engineer building/editing a real multi-file web app. ${EDIT_FORMAT}`;
    const user = `Current files:\n${fileList(vfs)}\n\nUser request:\n${prompt}`;
    return parseFileEdits(await callModel(sys, user));
  };
  const fix = async (issues: ProjectIssue[], vfs: VirtualFileSystem): Promise<FileEdit[]> => {
    if (issues.length === 0) return [];
    const sys = `You are fixing build/verification errors in a web app. ${EDIT_FORMAT}`;
    const user = `Files:\n${fileList(vfs)}\n\nFix these issues:\n${issues.map(i => `- [${i.severity}] ${i.file}: ${i.message}`).join('\n')}`;
    return parseFileEdits(await callModel(sys, user));
  };
  return { generate, fix };
}
