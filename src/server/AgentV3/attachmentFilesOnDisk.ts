// AN ATTACHED TEXT FILE IS ON DISK, WHOLE — NOT ONLY AN EXCERPT IN THE PROMPT (failedbr #2415, d57e9bde, 2026-11-17).
//
// 🔴 WHAT HAPPENED. "Is website ko thik karke isme naye feature dalo" with `naveen_hub.html` attached. The builder got
// the file only as text inside its prompt, cut at 20,000 characters (`attachmentText.ts` PER_DOC_MAX), and the file
// itself was never written into the project. It said "The attached HTML is trimmed in my view", and it and its
// helpers spent seven minutes and the whole $1.00 cost ceiling hunting for the rest — `find / -name "naveen_hub*"`,
// `git show`, and finally `cd /; grep -rl "NAVEEN HUB" /`, which ran its full 300 s. Zero files were written.
//
// 🧬 THE FIX. A text attachment (HTML, CSS, JS, JSON, Markdown, …) is written, whole, to `attachments/<name>` in the
// project before the builder starts, and the builder is told where it is and that it is the complete file. Binary
// files keep their honest "you have a description, not the bytes" note (attachedFileBytes.ts). PURE.

const TEXT_TYPES = /^(?:text\/|application\/(?:json|csv|xml|x-yaml|yaml|javascript|typescript))/i;
const TEXT_EXT = /\.(?:txt|md|markdown|csv|tsv|json|xml|ya?ml|html?|css|[cm]?[jt]sx?|py|sql|log|svg)$/i;
/** Per-file ceiling: far above the prompt excerpt, small enough never to bloat a project. */
export const ATTACHMENT_FILE_MAX_BYTES = 2 * 1024 * 1024;
export const ATTACHMENTS_DIR = 'attachments';

export interface AttachmentFile { path: string; content: string; name: string }

/** A file name safe as one path segment: no folders, no dot-dot, plain characters. PURE. */
export function safeAttachmentName(name: string): string {
  const base = String(name ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 120);
  return cleaned || 'attachment.txt';
}

/** The text attachments to write into the project, decoded from base64, each at most ATTACHMENT_FILE_MAX_BYTES. PURE. */
export function attachmentFilesForProject(atts: ReadonlyArray<{ name?: string; type?: string; base64?: string }>): AttachmentFile[] {
  const out: AttachmentFile[] = [];
  const used = new Set<string>();
  for (const a of atts ?? []) {
    const name = String(a?.name ?? '');
    if (!(TEXT_TYPES.test(String(a?.type ?? '')) || TEXT_EXT.test(name))) continue;
    if (typeof a?.base64 !== 'string' || !a.base64) continue;
    let buf: Buffer;
    try { buf = Buffer.from(a.base64.replace(/^data:[^,]*,/, ''), 'base64'); } catch { continue; }
    if (buf.length === 0 || buf.length > ATTACHMENT_FILE_MAX_BYTES) continue;
    const content = buf.toString('utf8');
    if (content.includes('\u0000')) continue; // not text after all
    let file = safeAttachmentName(name);
    for (let i = 2; used.has(file); i++) file = `${i}-${safeAttachmentName(name)}`;
    used.add(file);
    out.push({ name: name || file, path: `${ATTACHMENTS_DIR}/${file}`, content });
  }
  return out;
}

/** The builder's note naming where each whole file is, or ''. PURE. */
export function attachmentFilesNote(files: ReadonlyArray<AttachmentFile>): string {
  if (!files.length) return '';
  const list = files.slice(0, 8).map((f) => `${f.name} → ${f.path}`).join('; ');
  return `[ATTACHED FILES ON DISK] The COMPLETE attached file(s) are saved in this project: ${list}. The copy shown `
    + 'above may be shortened — read the file at that path for the full content. It is the whole file: there is no '
    + 'other copy anywhere on the machine, so do not search the filesystem for it. It is the user\'s reference '
    + 'material: build the app in the project\'s own source files, not inside the attachments folder.';
}
