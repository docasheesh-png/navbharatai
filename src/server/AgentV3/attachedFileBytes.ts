// AN ATTACHED FILE REACHES THE BUILDER AS A DESCRIPTION, NOT AS A FILE — and the builder is told so.
//
// 🔴 WHY (autopsy 981ce4cc, 2026-10-04). The user sent a scanned letter as a PDF with "Edit pdf". The builder
// received a 2,831-character description of it; the file's bytes are never written into the project. It then
// ran `base64 -d > public/frankfinn-experience.pdf` with a PDF it made up ("Created PDF placeholder"), loaded
// that in the app, and told the user "📄 View the PDF document (your attached experience letter is loaded)".
// Nothing in the prompt said the bytes were absent, so a stand-in looked like the obvious move — and the claim
// about the user's own document was false.
//
// The rule, outside the untrusted fence because it is ours, not the file's: never write a stand-in for an
// attached file, never say the user's file is in the app, and when the app needs it, let the user open it
// (a file picker reads it in their browser and sends it nowhere). A text file's extracted text IS its content,
// so plain text, CSV, JSON and Markdown are not covered. PURE.

const TEXT_TYPES = /^(?:text\/|application\/(?:json|csv|xml|x-yaml|yaml|javascript|typescript))/i;
const TEXT_EXT = /\.(?:txt|md|markdown|csv|tsv|json|xml|ya?ml|html?|css|[cm]?[jt]sx?|py|sql|log)$/i;

/** The names of attached files whose bytes the builder does not have (anything that is not plain text). PURE. */
export function filesWithoutBytes(attachments: ReadonlyArray<{ name?: string; type?: string }>): string[] {
  const out: string[] = [];
  for (const a of attachments ?? []) {
    const name = String(a?.name ?? 'file');
    if (TEXT_TYPES.test(String(a?.type ?? '')) || TEXT_EXT.test(name)) continue;
    out.push(name);
  }
  return out;
}

/** The note that follows the attached-files block, or ''. PURE. */
export function attachedBytesNote(attachments: ReadonlyArray<{ name?: string; type?: string }>): string {
  const names = filesWithoutBytes(attachments);
  if (names.length === 0) return '';
  const list = names.slice(0, 5).join(', ');
  return `[ATTACHED FILES — WHAT YOU HAVE] You received a DESCRIPTION of ${list}, not the file itself: its bytes are `
    + 'not in this project. Never write a stand-in file in its place (no made-up PDF, image or document), and never '
    + 'tell the user their file is loaded in the app. If the app needs the file, give it a file picker so the user '
    + 'opens their own copy in the app; you may use the description only to understand what the file contains.';
}
