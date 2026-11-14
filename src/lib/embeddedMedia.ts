// EMBEDDED MEDIA — taking base64 media OUT of code, and keeping it out of the model's sight
// (single-file game autopsy, 2026-11-14).
//
// 🔴 WHAT HAPPENS WITHOUT THIS. A user's game is ONE html file, 5.4 MB, of which about 4.6 MB is base64: an intro video
// in `window.__introB64`, engine sounds in `new Audio('data:audio/mpeg;base64,…')`, face and body textures in
// `'data:image/jpeg;base64,…'` strings. Every limit in the platform counts that as TEXT:
//   • the import filters (900 KB per file) refuse the page, or the import route takes it and the durable store silently drops it;
//   • when it does land, the builder reads it — megabytes of base64 in a prompt that costs money per token and cannot be
//     understood — and a whole-file rewrite quietly throws the media away;
//   • an edit that corrupts one character of a base64 string produces a game that still loads and plays no sound.
//
// 🔑 THE RULE: media is a FILE, code is code. On the way in, every media payload is moved to `assets/media/<name>` and the
// page refers to it by path; the HTML that remains is the user's code, byte for byte, with only the payload swapped for the
// path. On the way to the model, any media that is still inside a file is replaced by a short placeholder, so the builder is
// never sent base64 media and can never "edit" it.
//
// Two shapes exist in real pages:
//   1. A data: URI — `data:audio/mpeg;base64,SUQz…` — inside an attribute, a CSS url(), or a JS string. The replacement is a
//      relative path, which every one of those positions accepts. Behaviour is identical.
//   2. A BARE base64 string that the page's own code decodes (`atob(window.__introB64)`). There is no URL to swap in, so the
//      literal is replaced by `__nbAsset64('assets/media/…')`, a small synchronous loader that returns exactly the same base64
//      string from the file. The consumer is untouched. The loader is added once, before the first script, and only when needed.
//
// PURE and dependency-free (no DOM, no Node): the browser runs it before upload so a 5.4 MB page becomes a 760 KB page plus
// files, and the server runs it as the backstop for every other door. Idempotent. Never throws.

export interface EmbeddedMediaOptions {
  /** The folder the HTML file lives in, relative to the workspace root ('' for the root). Assets are written beside it. */
  baseDir?: string;
  /** Where extracted media goes, relative to baseDir. */
  mediaDir?: string;
  /** A payload smaller than this many decoded bytes stays inline (a 1-pixel gif is code, not media). */
  minBytes?: number;
  /** A single payload larger than this stays where it is, and is reported. */
  maxAssetBytes?: number;
  /** All media taken out of one page. */
  maxTotalBytes?: number;
}

export interface ExtractedMedia {
  path: string;
  mime: string;
  bytes: number;
  kind: 'data-uri' | 'base64-literal';
  /** How many places in the page referred to it. */
  occurrences: number;
}

export interface EmbeddedMediaReport {
  extracted: ExtractedMedia[];
  /** Small data URIs left inline on purpose. */
  keptInline: number;
  skipped: Array<{ reason: 'too-large' | 'over-budget' | 'not-media'; bytes: number; mime: string }>;
  htmlBytesBefore: number;
  htmlBytesAfter: number;
  /** The synchronous base64 loader was added (a bare base64 literal was replaced). */
  loaderAdded: boolean;
}

export interface EmbeddedMediaResult {
  /** The page with every extracted payload replaced by a relative path. Identical to the input when nothing was extracted. */
  html: string;
  /** workspace-relative path → `data:<mime>;base64,…`, the shape every importer already carries assets in. */
  assets: Record<string, string>;
  report: EmbeddedMediaReport;
}

export const EMBEDDED_MEDIA_DEFAULTS = Object.freeze({
  mediaDir: 'assets/media',
  minBytes: 1_500,
  maxAssetBytes: 12 * 1024 * 1024,
  maxTotalBytes: 60 * 1024 * 1024,
});

// ---- what counts as media -----------------------------------------------------------------------------------------

const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif',
  'image/bmp': 'bmp', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/svg+xml': 'svg',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/webm': 'weba', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/opus': 'opus',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv', 'video/quicktime': 'mov',
  'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf', 'application/font-woff': 'woff',
  'application/font-woff2': 'woff2', 'application/vnd.ms-fontobject': 'eot', 'application/x-font-ttf': 'ttf',
};

/** The extension for a media MIME, or null when it is not a media type we move out of code. */
export function mediaExtensionFor(mime: string): string | null {
  return MIME_EXT[String(mime ?? '').toLowerCase()] ?? null;
}

/** What a bare base64 string is, from the first bytes it decodes to. null when it is not a known media format. */
export function sniffMedia(head: Uint8Array): { mime: string; ext: string } | null {
  const at = (i: number): number => head[i] ?? -1;
  const ascii = (i: number, s: string): boolean => { for (let k = 0; k < s.length; k++) if (head[i + k] !== s.charCodeAt(k)) return false; return true; };
  if (ascii(4, 'ftyp')) return { mime: 'video/mp4', ext: 'mp4' };
  if (at(0) === 0x1a && at(1) === 0x45 && at(2) === 0xdf && at(3) === 0xa3) return { mime: 'video/webm', ext: 'webm' };
  if (ascii(0, 'OggS')) return { mime: 'audio/ogg', ext: 'ogg' };
  if (ascii(0, 'ID3') || (at(0) === 0xff && (at(1) & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', ext: 'mp3' };
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return { mime: 'audio/wav', ext: 'wav' };
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { mime: 'image/webp', ext: 'webp' };
  if (at(0) === 0x89 && ascii(1, 'PNG')) return { mime: 'image/png', ext: 'png' };
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (ascii(0, 'GIF8')) return { mime: 'image/gif', ext: 'gif' };
  if (ascii(0, 'wOF2')) return { mime: 'font/woff2', ext: 'woff2' };
  if (ascii(0, 'wOFF')) return { mime: 'font/woff', ext: 'woff' };
  return null;
}

// ---- small pure helpers --------------------------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => { const t = new Int16Array(128).fill(-1); for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i; return t; })();

/** The first `n` bytes a base64 string decodes to. Never reads more than it needs, so a 2 MB string costs nothing. */
export function base64Prefix(b64: string, n: number): Uint8Array {
  const out = new Uint8Array(n);
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < b64.length && o < n; i++) {
    const c = b64.charCodeAt(i);
    const v = c < 128 ? B64_LOOKUP[c] : -1;
    if (v < 0) break;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; acc &= (1 << bits) - 1; }
  }
  return out;
}

/** The raw byte length of a base64 payload (with its padding), without decoding it. */
export function base64ByteLength(b64: string): number {
  const len = b64.length;
  if (len === 0) return 0;
  let pad = 0;
  if (b64.charCodeAt(len - 1) === 61) pad++;
  if (len > 1 && b64.charCodeAt(len - 2) === 61) pad++;
  return Math.floor((len * 3) / 4) - pad;
}

/** A short, stable name for a payload: two FNV-1a passes over its characters, 16 hex digits. Not a security hash. */
export function payloadFingerprint(payload: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ payload.length;
  for (let i = 0; i < payload.length; i++) {
    const c = payload.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

const hex8 = (payload: string): string => payloadFingerprint(payload).slice(0, 10);

function joinPath(a: string, b: string): string { return a ? a.replace(/\/+$/, '') + '/' + b : b; }

/** data:<mime>[;param=value]*;base64,<payload> — the payload is the longest run of base64 characters. */
const DATA_URI = /data:([a-zA-Z]+\/[a-zA-Z0-9.+-]+)((?:;[a-zA-Z0-9=._-]+)*);base64,([A-Za-z0-9+/]*={0,2})/g;
/** A quoted string that is nothing but base64: the shape of `window.__introB64="…"`. */
const BARE_LITERAL = /(["'])([A-Za-z0-9+/]{4096,}={0,2})\1/g;

/** The smallest bare base64 literal worth moving out: below this it is a token or a hash, not media. */
const BARE_MIN_CHARS = 64 * 1024;

/** The synchronous loader that gives a bare-base64 consumer exactly the string it used to hold. ES5, no dependencies. */
export const MEDIA_LOADER_NAME = '__nbAsset64';
const LOADER_SCRIPT =
  '<script>/* NavBharatAI: media moved out of this page to assets/media/ — this returns the same base64 the page used to hold, so the page behaves exactly as before. */' +
  'function ' + MEDIA_LOADER_NAME + '(u){var x=new XMLHttpRequest();x.open("GET",u,false);x.overrideMimeType("text/plain; charset=x-user-defined");x.send(null);' +
  'if(x.status!==200&&x.status!==0)throw new Error("Could not load "+u);var s=x.responseText,o="",i=0,n=s.length;' +
  'for(;i<n;i+=8192){var a=[],e=Math.min(n,i+8192),j=i;for(;j<e;j++)a.push(s.charCodeAt(j)&255);o+=String.fromCharCode.apply(null,a);}return btoa(o);}' +
  '</script>\n';

// ---- finding media (used by the guards, which only need to know WHAT is there) -------------------------------------

export interface FoundMedia { kind: 'data-uri' | 'base64-literal'; mime: string; bytes: number; fingerprint: string; start: number; end: number }

/**
 * Every embedded media payload in a text: data: URIs of a media type, and bare base64 literals that decode to a known media
 * format or are at least 64 KB. `minBytes` skips small inline images. Pure; never throws; a text with no base64 at all costs one
 * `indexOf`.
 */
export function findEmbeddedMedia(text: string, minBytes: number = EMBEDDED_MEDIA_DEFAULTS.minBytes): FoundMedia[] {
  const src = String(text ?? '');
  const out: FoundMedia[] = [];
  if (src.length < minBytes) return out;
  if (src.includes(';base64,')) {
    DATA_URI.lastIndex = 0;
    for (let m = DATA_URI.exec(src); m; m = DATA_URI.exec(src)) {
      const mime = m[1].toLowerCase();
      if (!mediaExtensionFor(mime)) continue;
      const bytes = base64ByteLength(m[3]);
      if (bytes < minBytes) continue;
      out.push({ kind: 'data-uri', mime, bytes, fingerprint: payloadFingerprint(m[3]), start: m.index, end: m.index + m[0].length });
    }
  }
  if (/[A-Za-z0-9+/]{4096}/.test(src)) {
    BARE_LITERAL.lastIndex = 0;
    for (let m = BARE_LITERAL.exec(src); m; m = BARE_LITERAL.exec(src)) {
      const payload = m[2];
      const sniffed = sniffMedia(base64Prefix(payload, 16));
      if (!sniffed && payload.length < BARE_MIN_CHARS) continue;
      out.push({ kind: 'base64-literal', mime: sniffed?.mime ?? 'application/octet-stream', bytes: base64ByteLength(payload), fingerprint: payloadFingerprint(payload), start: m.index + 1, end: m.index + 1 + payload.length });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---- moving media out ----------------------------------------------------------------------------------------------

/**
 * Move every embedded media payload out of an HTML page into files, and point the page at them. The HTML that comes back is the
 * page's own code with ONLY the payloads replaced; nothing else is touched. Returns the input unchanged (same string) when
 * there is nothing to move — so running it twice is safe.
 */
export function extractEmbeddedMedia(source: string, options: EmbeddedMediaOptions = {}): EmbeddedMediaResult {
  const html = String(source ?? '');
  const baseDir = (options.baseDir ?? '').replace(/^\/+|\/+$/g, '');
  const mediaDir = (options.mediaDir ?? EMBEDDED_MEDIA_DEFAULTS.mediaDir).replace(/^\/+|\/+$/g, '');
  const minBytes = options.minBytes ?? EMBEDDED_MEDIA_DEFAULTS.minBytes;
  const maxAsset = options.maxAssetBytes ?? EMBEDDED_MEDIA_DEFAULTS.maxAssetBytes;
  const maxTotal = options.maxTotalBytes ?? EMBEDDED_MEDIA_DEFAULTS.maxTotalBytes;
  const report: EmbeddedMediaReport = { extracted: [], keptInline: 0, skipped: [], htmlBytesBefore: html.length, htmlBytesAfter: html.length, loaderAdded: false };
  const none: EmbeddedMediaResult = { html, assets: {}, report };
  try {
    if (!html.includes(';base64,') && !/[A-Za-z0-9+/]{4096}/.test(html)) return none;

    const assets: Record<string, string> = {};
    const byPayload = new Map<string, string>(); // payload -> asset path
    const pathOwner = new Map<string, string>(); // asset path -> payload (collision guard)
    const entries = new Map<string, ExtractedMedia>();
    let total = 0;

    const place = (payload: string, mime: string, ext: string, kind: 'data-uri' | 'base64-literal'): string | null => {
      const bytes = base64ByteLength(payload);
      const known = byPayload.get(payload);
      if (known) { entries.get(known)!.occurrences++; return known; }
      if (bytes > maxAsset) { report.skipped.push({ reason: 'too-large', bytes, mime }); return null; }
      if (total + bytes > maxTotal) { report.skipped.push({ reason: 'over-budget', bytes, mime }); return null; }
      const family = mime.split('/')[0] === 'application' ? 'font' : mime.split('/')[0];
      let name = family + '-' + hex8(payload) + '.' + ext;
      let n = 2;
      while (pathOwner.has(name) && pathOwner.get(name) !== payload) name = family + '-' + hex8(payload) + '-' + n++ + '.' + ext;
      const path = joinPath(baseDir, joinPath(mediaDir, name));
      pathOwner.set(name, payload);
      byPayload.set(payload, path);
      assets[path] = 'data:' + mime + ';base64,' + payload;
      const entry: ExtractedMedia = { path, mime, bytes, kind, occurrences: 1 };
      entries.set(path, entry);
      report.extracted.push(entry);
      total += bytes;
      return path;
    };
    const relative = (path: string): string => (baseDir && path.startsWith(baseDir + '/') ? path.slice(baseDir.length + 1) : path);

    // 1. data: URIs — the replacement is a plain relative path, valid in an attribute, a CSS url() and a JS string alike.
    let out = html.replace(DATA_URI, (whole, rawMime: string, _params: string, payload: string) => {
      const mime = rawMime.toLowerCase();
      const ext = mediaExtensionFor(mime);
      if (!ext) { report.skipped.push({ reason: 'not-media', bytes: base64ByteLength(payload), mime }); return whole; }
      if (base64ByteLength(payload) < minBytes) { report.keptInline++; return whole; }
      const path = place(payload, mime, ext, 'data-uri');
      if (!path) return whole;
      return relative(path);
    });

    // 2. bare base64 literals the page decodes itself — replaced by a call that returns the SAME string from the file.
    let usedLoader = false;
    out = out.replace(BARE_LITERAL, (whole, quote: string, payload: string) => {
      const sniffed = sniffMedia(base64Prefix(payload, 16));
      if (!sniffed) {
        if (payload.length >= BARE_MIN_CHARS) report.skipped.push({ reason: 'not-media', bytes: base64ByteLength(payload), mime: 'application/octet-stream' });
        return whole;
      }
      const path = place(payload, sniffed.mime, sniffed.ext, 'base64-literal');
      if (!path) return whole;
      usedLoader = true;
      return MEDIA_LOADER_NAME + '(' + quote + relative(path) + quote + ')';
    });

    if (report.extracted.length === 0) { report.htmlBytesAfter = html.length; return { html, assets: {}, report }; }

    if (usedLoader) {
      // Defined before the first script that could call it, so it exists when the first decoder runs. A page with no script
      // ahead of the first call gets it right after <head> (or after the doctype).
      const firstCall = out.indexOf(MEDIA_LOADER_NAME + '(');
      const firstScript = out.search(/<script\b/i);
      if (firstScript >= 0 && firstScript < firstCall) {
        out = out.slice(0, firstScript) + LOADER_SCRIPT + out.slice(firstScript);
      } else {
        const head = /<head\b[^>]*>/i.exec(out);
        const doctype = /<!doctype[^>]*>\s*/i.exec(out);
        const at = head ? head.index + head[0].length : doctype ? doctype.index + doctype[0].length : 0;
        out = out.slice(0, at) + '\n' + LOADER_SCRIPT + out.slice(at);
      }
      report.loaderAdded = true;
    }
    report.htmlBytesAfter = out.length;
    return { html: out, assets, report };
  } catch {
    return none; // a page this could not read is left exactly as it was
  }
}

// ---- keeping media out of the model's sight ------------------------------------------------------------------------

/** The smallest embedded payload hidden from the model; below this it is a tiny icon and harmless. */
export const MODEL_ELIDE_MIN_BYTES = 1_024;
/** A bare quoted base64 run at least this long is hidden whatever it decodes to. */
const MODEL_ELIDE_BARE_MIN_CHARS = 8 * 1024;

function kb(bytes: number): string { return bytes >= 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'; }

export interface ElisionResult { text: string; elided: number; bytes: number }

/**
 * What the model is shown instead of embedded media: each payload becomes a short placeholder that names its type, size and
 * fingerprint — `data:audio/mpeg;base64,<<media omitted: 435 KB, id 1f3a9c0b7e>>` — so it can see THAT a sound is there and
 * leave it alone. The output is never longer than the input. A text with no embedded media is returned as the same string.
 * The real payload is never altered by this: it only changes what is SHOWN.
 */
export function elideEmbeddedMedia(text: string): ElisionResult {
  const src = String(text ?? '');
  const none: ElisionResult = { text: src, elided: 0, bytes: 0 };
  if (src.length < MODEL_ELIDE_MIN_BYTES) return none;
  try {
    let elided = 0;
    let bytes = 0;
    let out = src;
    if (out.includes(';base64,')) {
      out = out.replace(DATA_URI, (whole, rawMime: string, _p: string, payload: string) => {
        const n = base64ByteLength(payload);
        if (n < MODEL_ELIDE_MIN_BYTES) return whole;
        const mime = rawMime.toLowerCase();
        const note = 'data:' + mime + ';base64,<<media omitted: ' + kb(n) + ', id ' + hex8(payload) + '>>';
        if (note.length >= whole.length) return whole;
        elided++; bytes += n;
        return note;
      });
    }
    if (/[A-Za-z0-9+/]{4096}/.test(out)) {
      out = out.replace(BARE_LITERAL, (whole, quote: string, payload: string) => {
        if (payload.length < MODEL_ELIDE_BARE_MIN_CHARS) return whole;
        const n = base64ByteLength(payload);
        elided++; bytes += n;
        return quote + '<<base64 media omitted: ' + kb(n) + ', id ' + hex8(payload) + '>>' + quote;
      });
    }
    return elided === 0 ? none : { text: out, elided, bytes };
  } catch {
    return none;
  }
}

/** True when a text still holds embedded media the model must not be shown (the class the guards lock). */
export function holdsEmbeddedMedia(text: string): boolean {
  return findEmbeddedMedia(text, MODEL_ELIDE_MIN_BYTES).length > 0;
}

/** The fingerprints of the media in a text, as a set — for "did this edit add or drop media?". */
export function mediaFingerprints(text: string): Set<string> {
  return new Set(findEmbeddedMedia(text, MODEL_ELIDE_MIN_BYTES).map((m) => m.fingerprint));
}
