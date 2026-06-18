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
import { selectArchitecture, manifestContract } from './ArchitectureManifest';
import { featureChecklist } from './FeatureCoverage';

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
Use relative paths. Prefer "patch" for small, localized changes; "write" for new files or full rewrites. ALL code identifiers in English.`;

/** Engineering standards the model must follow for real, complex apps. */
const ENGINEERING_RULES = `Rules for production-quality output:
- Plan the WHOLE app first: decide the file tree (entry point + every module/component/style/asset it needs), then emit complete, consistent files. Do not stop at a single HTML file for a non-trivial request.
- Separate concerns: split UI into components, keep state/logic/data in dedicated modules, put styles in their own files. Avoid one giant file.
- EVERY file you reference (imports, <script src>, <link href>, asset paths) MUST also exist — either already in the project or written in THIS reply. Never leave a dangling reference.
- Provide a working entry point (e.g. index.html, or src/main.tsx + index.html for a bundled app). Wire everything together so it runs.
- ES MODULES (CRITICAL): If ANY .js file uses "import" or "export" statements, the HTML MUST load the entry script with <script type="module" src="app.js"> — NEVER a plain <script src="app.js">. A missing type="module" causes SyntaxError: Unexpected token '{' in every browser.
- Write real, complete code. No TODO/placeholder/"...rest of code" stubs, no empty handlers. Implement the behavior the user asked for.
- Keep JSON valid: escape newlines/quotes inside "content". Output the FULL content of every file you write.`;

/** Visual design directive — make generated UIs genuinely beautiful, not plain. */
const DESIGN_RULES = `VISUAL DESIGN (make it genuinely beautiful — never plain/unstyled):
- Premium, modern look: a cohesive palette with an accent color, generous spacing, rounded corners, subtle shadows, clear visual hierarchy. Default to a polished dark theme unless asked otherwise.
- Use CSS variables for colors/spacing/radius (a small design system) and STYLE EVERY element — no bare browser defaults.
- Buttons: padded, rounded, accent/gradient background, white text, hover + active states, pointer cursor, smooth transition. Never ship unstyled <button>.
- Cards/sections: padding, border or soft shadow, rounded. Inputs: styled with focus states. Readable typography (system-ui), strong contrast.
- Responsive layout (mobile + desktop), tasteful header/nav, and nice empty/loading states. Aim for a UI a designer would approve.`;

/** How much of each existing file's content to inline for edit context. */
// Raised so the files being edited are shown in FULL — truncated content made
// `patch find` snippets miss (RC2), so edits silently no-op (RC3) and apps broke.
const MAX_FILE_CHARS = 12_000;
const MAX_CONTEXT_FILES = 60;
const MAX_TOTAL_CONTEXT = 200_000;

function fileList(vfs: VirtualFileSystem): string {
  const paths = vfs.paths();
  return paths.length ? paths.join('\n') : '(empty project)';
}

/** Inline current file contents (bounded) so edits/patches can target exact text. */
function fileContext(vfs: VirtualFileSystem): string {
  const paths = vfs.paths();
  if (!paths.length) return '(empty project — this is a fresh build)';
  let total = 0;
  const blocks: string[] = [];
  for (const path of paths.slice(0, MAX_CONTEXT_FILES)) {
    const file = vfs.read(path);
    if (!file) continue;
    if (file.encoding === 'base64') {
      blocks.push(`--- ${path} (binary, ${file.size} bytes, omitted) ---`);
      continue;
    }
    let body = file.content;
    if (body.length > MAX_FILE_CHARS) {
      body = body.slice(0, MAX_FILE_CHARS) + `\n… (truncated, ${file.content.length - MAX_FILE_CHARS} more chars)`;
    }
    if (total + body.length > MAX_TOTAL_CONTEXT) {
      blocks.push(`--- ${path} (omitted: context budget reached) ---`);
      continue;
    }
    total += body.length;
    blocks.push(`--- ${path} ---\n${body}`);
  }
  return blocks.join('\n\n');
}

/** A planned file in a multi-file build. */
interface PlannedFile { path: string; purpose: string }

/** Upper bound on planned files — large enough for real multi-module apps. */
const MAX_PLAN_FILES = 48;

const PLAN_FORMAT = `Reply with ONLY JSON, no prose, no markdown fences:
{"entry":"index.html","files":[{"path":"relative/path","purpose":"what this file contains"}]}
Plan a COMPLETE multi-file app — do NOT simplify or drop requested modules:
- A working entry point + the App shell + a router/navigation file.
- For EVERY module/feature the user asked for, include ITS pages, ITS major
  components, and the shared store/service/types/hooks/layouts it needs — as
  SEPARATE files (one responsibility per file). A 10-module app needs dozens of files.
- Map every requested feature/module to concrete files; leave nothing out.
- Scale the file count to the request: small app ~6 files, large multi-module
  app 30–48 files. Paths must be consistent (imports will reference them).`;

/** True when the VFS holds only the freshly-seeded scaffold (so this is a from-scratch build). */
function isScaffoldState(vfs: VirtualFileSystem): boolean {
  if (vfs.paths().length === 0) return true;
  // Recognize BOTH the JS (.jsx) and TypeScript (.tsx) scaffolds — missing the
  // .tsx case made every TypeScript build skip the from-scratch plan→batch path
  // and fall into the weak "minimal edit" path → intermittently scaffold-only.
  for (const p of ['src/App.tsx', 'src/App.jsx']) {
    const app = vfs.readText(p);
    if (app && app.includes('Hello from App')) return true;
  }
  const js = vfs.readText('app.js');
  if (js && js.includes("getElementById('app').innerHTML")) return true;
  return false;
}

/** Ask the model for a complete file plan (architecture) for a fresh app build. */
async function planFiles(callModel: ModelCall, prompt: string): Promise<PlannedFile[]> {
  const contract = manifestContract(selectArchitecture(prompt));
  const checklist = featureChecklist(prompt);
  const sys = `You are a senior software architect planning a real, runnable multi-file web app.\n\n${contract}\n\n${ENGINEERING_RULES}\n\n${DESIGN_RULES}\n\n${PLAN_FORMAT}`;
  const raw = await callModel(sys, `App request:\n${prompt}\n\n${checklist ? checklist + '\n\n' : ''}Plan the full file tree now. Conform strictly to the ARCHITECTURE above — one framework only. Ensure EVERY module, page, entity, and checklist feature maps to concrete files.`);
  const json: any = extractJson(raw);
  const arr: any[] = Array.isArray(json) ? json : Array.isArray(json?.files) ? json.files : [];
  const seen = new Set<string>();
  const files: PlannedFile[] = [];
  for (const f of arr) {
    if (f && typeof f.path === 'string' && f.path.trim() && !seen.has(f.path)) {
      seen.add(f.path);
      files.push({ path: f.path.trim(), purpose: typeof f.purpose === 'string' ? f.purpose : '' });
    }
  }
  return files.slice(0, MAX_PLAN_FILES);
}

/** Generate the planned files in small batches so no single call truncates a large app. */
async function generateBatched(callModel: ModelCall, prompt: string, plan: PlannedFile[]): Promise<FileEdit[]> {
  const BATCH = 4;
  const contract = manifestContract(selectArchitecture(prompt));
  const checklist = featureChecklist(prompt);
  const planStr = plan.map(f => `- ${f.path}: ${f.purpose}`).join('\n');
  const edits: FileEdit[] = [];
  const done = new Set<string>();
  for (let i = 0; i < plan.length; i += BATCH) {
    const batch = plan.slice(i, i + BATCH);
    const sys = `You are a world-class engineer writing complete files of a real multi-file app.\n\n${contract}\n\n${checklist ? checklist + '\n\n' : ''}${ENGINEERING_RULES}\n\n${DESIGN_RULES}\n\n${EDIT_FORMAT}`;
    const user = `App request:\n${prompt}\n\nFull file plan (for cross-file imports):\n${planStr}\n\n`
      + `Write COMPLETE, fully-functional content for ONLY these files (one write op each):\n${batch.map(f => `- ${f.path}: ${f.purpose}`).join('\n')}\n`
      + `Make imports/paths match the plan exactly. No TODOs, no placeholders.`;
    const part = parseFileEdits(await callModel(sys, user));
    for (const e of part) {
      if (e.op === 'write' && !done.has(e.path)) { done.add(e.path); edits.push(e); }
    }
  }
  return edits;
}

/** Build generate+fix functions for the BuildPipeline backed by an injected model. */
export function makeAiEditGenerator(callModel: ModelCall) {
  const generate = async (prompt: string, vfs: VirtualFileSystem): Promise<FileEdit[]> => {
    const fresh = isScaffoldState(vfs);

    if (fresh) {
      // FAST PATH: one strong from-scratch call. The multi-call plan→batch path
      // made synchronous builds do 10+ sequential model calls → gateway 504
      // timeout. Do a single high-budget generation first; only fall back to
      // plan→batch if that genuinely under-delivers (rare).
      const contract = manifestContract(selectArchitecture(prompt)) + '\n\n';
      const checklist = featureChecklist(prompt);
      const sys = `You are a world-class full-stack engineer building a real, multi-file web application that must actually build and run.\n\n${contract}${checklist ? checklist + '\n\n' : ''}${ENGINEERING_RULES}\n\n${DESIGN_RULES}\n\n${EDIT_FORMAT}`;
      const user = `Build this application from scratch as a complete, runnable multi-file project.\n\nUser request:\n${prompt}\n\nReturn the full set of files needed to run it — implement EVERY requested feature in separate component/page files, not just a shell. Make the UI genuinely beautiful per the VISUAL DESIGN rules.`;
      const edits = parseFileEdits(await callModel(sys, user));
      if (edits.length >= 2) return edits;

      // Single shot under-delivered → plan→batch fallback (more calls, slower).
      try {
        const plan = await planFiles(callModel, prompt);
        if (plan.length >= 2) {
          const batched = await generateBatched(callModel, prompt, plan);
          if (batched.length >= 2) return batched;
        }
      } catch { /* keep whatever the single shot produced */ }
      return edits;
    }

    // Edit path (existing project) — single surgical-edit call.
    const sys = `You are a world-class full-stack engineer editing a real, multi-file web application.\n\n${ENGINEERING_RULES}\n\n${DESIGN_RULES}\n\n${EDIT_FORMAT}`;
    const user = `Current project files (with FULL contents below):\n\n${fileContext(vfs)}\n\nUser request:\n${prompt}\n\n`
      + `Apply the correct set of edits and keep all existing references valid. CRITICAL for reliability: a "patch" find string MUST be copied EXACTLY (character-for-character) from the file content shown above — if you are unsure it matches exactly, use a full "write" of that file instead. Preserve everything you are not changing.`;
    return parseFileEdits(await callModel(sys, user));
  };
  const fix = async (issues: ProjectIssue[], vfs: VirtualFileSystem): Promise<FileEdit[]> => {
    if (issues.length === 0) return [];
    const sys = `You are fixing real build/verification errors in a web app so it builds and runs cleanly. ${ENGINEERING_RULES}\n\n${EDIT_FORMAT}`;
    const user = `Current project files (with contents):\n\n${fileContext(vfs)}\n\nFix exactly these issues without breaking anything else:\n${issues.map(i => `- [${i.severity}] ${i.file}: ${i.message}`).join('\n')}`;
    return parseFileEdits(await callModel(sys, user));
  };
  // Agentic feature completion: implement the requested features that are still
  // missing, editing the EXISTING project (so a shell becomes a working app).
  const completeFeatures = async (prompt: string, missing: string[], vfs: VirtualFileSystem): Promise<FileEdit[]> => {
    if (!missing.length) return [];
    const contract = manifestContract(selectArchitecture(prompt));
    const sys = `You are a world-class engineer ADDING missing features to an existing app — keep the SAME architecture, never mix frameworks.\n\n${contract}\n\n${ENGINEERING_RULES}\n\n${DESIGN_RULES}\n\n${EDIT_FORMAT}`;
    const user = `Current project files (with contents):\n\n${fileContext(vfs)}\n\nApp request:\n${prompt}\n\n`
      + `These requested features are MISSING — implement them with real, working code, wiring them into the existing app (routes/components/state as needed):\n`
      + missing.map((m) => `- ${m}`).join('\n');
    return parseFileEdits(await callModel(sys, user));
  };
  return { generate, fix, completeFeatures };
}
