// Shared attachment-text extraction — turns ANY document the user uploads into
// plain text the AI can read, on the SERVER, with no per-call API cost. This is
// the backbone of "send any file in the world" file support for every AI surface
// (Free chat, Pro chat, Doctor AI / SDA, and Pro v3.0).
//
// Images and PDFs are NOT handled here — those go to the multimodal/vision
// providers (Gemini / Vertex / Grok / Claude) which read them natively. This
// module covers everything else: Word, Excel, PowerPoint, ZIP archives, and all
// plain-text/code formats. Each extractor is wrapped so a single bad file never
// throws — it degrades to a short honest note instead, so the app never breaks.

export interface RawAttachment {
  name: string;
  type: string;
  /** base64 WITHOUT the data: URL prefix. */
  base64: string;
}

/** Per-document character cap so one huge file can't blow the model context. */
const PER_DOC_MAX = 20000;
/** Max files we extract from inside a single ZIP. */
const ZIP_MAX_ENTRIES = 40;

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|xml|html?|css|scss|less|js|jsx|ts|tsx|py|rb|go|rs|java|kt|php|c|h|cpp|cc|cs|swift|sh|bash|sql|env|ini|toml|log|srt|vtt)$/i;
const TEXT_MIME = /^(text\/|application\/(json|xml|x-yaml|javascript|x-sh|x-httpd-php|sql))/i;

/** Is this attachment an image or PDF? Those bypass this module (vision path). */
export function isVisionAttachment(type: string, name = ''): boolean {
  return type.startsWith('image/') || type === 'application/pdf' || /\.pdf$/i.test(name);
}

function ext(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

function clamp(text: string): { text: string; truncated: boolean } {
  if (text.length <= PER_DOC_MAX) return { text, truncated: false };
  return { text: text.slice(0, PER_DOC_MAX), truncated: true };
}

function isTextual(name: string, type: string): boolean {
  return TEXT_MIME.test(type) || TEXT_EXT.test(name);
}

/** Word .docx → raw text via mammoth. */
async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer: buf });
  return (result?.value || '').trim();
}

/** Excel .xlsx/.xls → CSV-per-sheet via the xlsx (SheetJS) reader. */
async function extractSpreadsheet(buf: Buffer): Promise<string> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer' });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const csv = XLSX.utils.sheet_to_csv(ws).trim();
    if (csv) parts.push(`# Sheet: ${sheetName}\n${csv}`);
  }
  return parts.join('\n\n');
}

/** PowerPoint .pptx → slide text by unzipping and stripping the slide XML. */
async function extractPptx(buf: Buffer): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0);
      const nb = Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0);
      return na - nb;
    });
  const out: string[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const xml = await zip.files[slidePaths[i]].async('string');
    // <a:t>…</a:t> runs hold the visible text; join them with spaces.
    const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1]));
    const slideText = runs.join(' ').replace(/\s+/g, ' ').trim();
    if (slideText) out.push(`# Slide ${i + 1}\n${slideText}`);
  }
  return out.join('\n\n');
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** ZIP archive → a listing plus extracted text from the text/office files inside. */
async function extractZip(buf: Buffer): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  const listing = entries.map((f) => `  - ${f.name}`).join('\n');
  const out: string[] = [`[ZIP archive — ${entries.length} file(s)]\n${listing}`];

  let extracted = 0;
  for (const f of entries) {
    if (extracted >= ZIP_MAX_ENTRIES) {
      out.push(`…(${entries.length - extracted} more file(s) not extracted)`);
      break;
    }
    const inner = f.name;
    const innerExt = ext(inner);
    try {
      let text = '';
      if (isTextual(inner, '')) {
        text = (await f.async('string')).slice(0, PER_DOC_MAX);
      } else if (innerExt === 'docx') {
        text = await extractDocx(await f.async('nodebuffer'));
      } else if (innerExt === 'xlsx' || innerExt === 'xls') {
        text = await extractSpreadsheet(await f.async('nodebuffer'));
      } else {
        continue; // skip binaries/images inside the zip
      }
      if (text.trim()) {
        out.push(`\n=== ${inner} ===\n${clamp(text).text}`);
        extracted++;
      }
    } catch {
      /* skip a single unreadable entry — never break the whole extraction */
    }
  }
  return out.join('\n');
}

/**
 * Extract readable text from a non-image, non-PDF attachment. Returns the text,
 * or null when the type isn't a document we can read (caller then either routes
 * it to the vision path or shows an honest "can't read this type" message).
 * Never throws — on any failure it returns a short note describing the problem.
 */
export async function extractDocumentText(att: RawAttachment): Promise<string | null> {
  if (!att?.base64 || isVisionAttachment(att.type, att.name)) return null;
  const e = ext(att.name);
  let buf: Buffer;
  try {
    buf = Buffer.from(att.base64, 'base64');
  } catch {
    return null;
  }

  try {
    if (isTextual(att.name, att.type)) {
      return clamp(buf.toString('utf-8')).text;
    }
    if (e === 'docx' || att.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return clamp(await extractDocx(buf)).text;
    }
    if (e === 'xlsx' || e === 'xls' || /spreadsheetml|ms-excel/i.test(att.type)) {
      return clamp(await extractSpreadsheet(buf)).text;
    }
    if (e === 'pptx' || /presentationml|ms-powerpoint/i.test(att.type)) {
      return clamp(await extractPptx(buf)).text;
    }
    if (e === 'zip' || att.type === 'application/zip' || att.type === 'application/x-zip-compressed') {
      return clamp(await extractZip(buf)).text;
    }
  } catch (err: any) {
    return `[Could not extract "${att.name}": ${err?.message || 'unreadable file'}]`;
  }
  return null; // unknown binary type — not a document we can read as text
}

/**
 * Build a single prompt-ready block from a set of document attachments. Returns
 * '' when none are extractable. Each document is fenced and labelled so the model
 * knows it is reading uploaded file content, not the user's own words.
 */
export async function buildDocumentContext(atts: RawAttachment[]): Promise<string> {
  const docs = (atts || []).filter((a) => a && !isVisionAttachment(a.type, a.name));
  if (docs.length === 0) return '';
  const blocks: string[] = [];
  for (const d of docs) {
    const text = await extractDocumentText(d);
    if (text && text.trim()) {
      blocks.push(`[Attached file: ${d.name}]\n\`\`\`\n${text}\n\`\`\``);
    } else {
      blocks.push(`[Attached file: ${d.name} — could not read this file type as text.]`);
    }
  }
  return blocks.join('\n\n');
}
