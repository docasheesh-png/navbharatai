// AgentV3 — HAND A SPECIALIST THE FILES ITS TASK NAMES (admin 2026-09-24: "builder bhatakta tha —
// isko fix karo").
//
// 🔴 THE MEASURED WASTE (build f15a9bcc, 2026-09-23). 64 file reads covered 24 distinct files; 40 of
// them re-read a file that had not changed. `src/BusinessContext.tsx` alone was read 11 times. The
// architect read it, then delegated seven tasks that each said "use BusinessContext", and every one of
// the seven specialists started with an EMPTY context and read it again — usually twice, one step after
// the other. Nothing was wrong with any single read. The waste was structural: the architect held the
// file, the specialist needed it, and the handoff carried only a sentence.
//
// So the spawn now carries the files the instruction NAMES, exactly as they are on disk at that moment.
// Bounded so a handoff can never become a context flood: at most MAX_FILES, each under MAX_FILE_CHARS,
// MAX_TOTAL_CHARS in all. A file that does not fit is simply not attached — the specialist reads it the
// ordinary way, exactly as it does today.
//
// PURE except `collectHandoff`, which only reads through the port it is given and never throws.

export const HANDOFF_MAX_FILES = 6;
export const HANDOFF_MAX_FILE_CHARS = 14_000;
export const HANDOFF_MAX_TOTAL_CHARS = 36_000;

/**
 * Project paths named in an instruction, in first-mention order. Only paths that LOOK like project
 * files: a directory-qualified source path, or one of a few well-known root files. URLs are skipped.
 */
export function filesNamedIn(instruction: string): string[] {
  const text = String(instruction ?? '');
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /(^|[\s`'"(\[,:])((?:\.\/)?(?:[\w@-]+\/)+[\w.@-]+\.(?:tsx?|jsx?|mjs|cjs|css|scss|json|html?|vue|svelte|prisma|sql)|index\.html|package\.json|vite\.config\.[jt]s|tsconfig\.json)(?![\w/])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 8), m.index + m[1].length);
    if (/:\/\/[^\s]*$/.test(before) || /https?:$/.test(before)) continue; // part of a URL
    const p = m[2].replace(/^\.\//, '');
    if (p.startsWith('node_modules/') || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

export interface HandedFile { path: string; content: string }

/** Read the named files through `read`, within the bounds. A failed read is simply skipped. */
export async function collectHandoff(
  instruction: string,
  read: (path: string) => Promise<string | null>,
): Promise<HandedFile[]> {
  const out: HandedFile[] = [];
  let total = 0;
  for (const path of filesNamedIn(instruction)) {
    if (out.length >= HANDOFF_MAX_FILES) break;
    let content: string | null = null;
    try { content = await read(path); } catch { content = null; }
    if (typeof content !== 'string' || content.length === 0) continue;
    if (content.length > HANDOFF_MAX_FILE_CHARS) continue;
    if (total + content.length > HANDOFF_MAX_TOTAL_CHARS) continue;
    total += content.length;
    out.push({ path, content });
  }
  return out;
}

/** The block prepended to the specialist's task. '' when nothing was attached. PURE. */
export function handoffBlock(files: readonly HandedFile[]): string {
  if (!files || files.length === 0) return '';
  const body = files.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
  return 'Files your task names, exactly as they are on disk right now. You already have them — do NOT '
    + 'read_file these again unless you change them or need a file that is not here.\n\n' + body;
}
