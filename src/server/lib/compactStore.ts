// ONE WAY TO FIT MORE INTO A FIRESTORE DOCUMENT — compress it (admin 2026-09-24: "jo hamari navbharatai
// ko world class banaye woh build karo", after the compression audit).
//
// 🔴 WHY THIS EXISTS. Firestore caps a document at 1 MiB, and several stores met that cap by DROPPING
// data: the Time Machine kept the first ~900 KB of an app and silently left the rest out, so restoring
// a big app produced something that never existed. Source code and report JSON are text, and text
// compresses 4–6×, so the same document can carry a whole app instead of a fragment.
//
// ONE shared helper, not a zlib call per store, because four stores need exactly the same three things
// and a private copy in each is the drifted-copy class this repo keeps paying for (`safeRelPath` ×4):
//   1. a TAGGED format, so a reader can tell a packed payload from a legacy one and old documents stay
//      readable for ever;
//   2. a size measured in BYTES, never in JavaScript string length — a Hindi file is 3 bytes a
//      character, and a "900 KB" cap measured in characters is how a write reaches 2.7 MB and fails;
//   3. an HONEST fit: when even the compressed payload does not fit, say exactly which items were left
//      out instead of truncating in silence.
//
// ⚠️ WHY BROTLI AND NOT ZSTD. Measured on this repo's own sources (3.09 MB of component JSON):
// brotli quality 5 → 4.1× in ~170 ms, gzip 6 → 3.6×, zstd 3 → 3.7× in ~24 ms. zstd is far faster, but
// in Node 22 (our runtime image) `zlib.zstd*` is still EXPERIMENTAL, and this format is read back for
// the life of every stored version. A stable decoder beats a faster encoder for data that must be
// readable years from now. The tag (`br1`) leaves room to add `zs1` once zstd is stable in Node — a
// reader that meets an unknown tag refuses it rather than guessing.

import { brotliCompressSync, brotliDecompressSync, constants } from 'zlib';

/** The only encoding written today. A new one gets a new tag; an old tag is never re-used. */
export const PACKED_ENCODING = 'br1' as const;
export type PackedEncoding = typeof PACKED_ENCODING;

/**
 * Firestore's hard cap is 1,048,576 bytes for the WHOLE document, field names included. 900 KB for the
 * packed payload leaves room for the metadata beside it on every store that uses this helper.
 */
export const MAX_PACKED_BYTES = 900_000;

/** Quality 5: within 3% of quality 6's ratio, and a third of quality 9's time (measured, see above). */
const QUALITY = 5;

/** UTF-8 byte length — the unit Firestore measures in. Never `string.length`. */
export function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

export interface Packed {
  enc: PackedEncoding;
  data: Buffer;
  /** UTF-8 bytes of the JSON before packing. */
  rawBytes: number;
}

/** Pack any JSON-serialisable value. Never throws for JSON-safe input. */
export function packJson(value: unknown): Packed {
  const raw = Buffer.from(JSON.stringify(value) ?? 'null', 'utf8');
  const data = brotliCompressSync(raw, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: QUALITY,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
    },
  });
  return { enc: PACKED_ENCODING, data, rawBytes: raw.length };
}

/**
 * The admin SDK hands a bytes field back as a Buffer; the web SDK and some emulators use a Uint8Array
 * or a `Bytes` object with `toUint8Array()`. Anything else is not a packed payload.
 */
function asBuffer(data: unknown): Buffer | null {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  const maybe = data as { toUint8Array?: () => Uint8Array } | null;
  if (maybe && typeof maybe.toUint8Array === 'function') return Buffer.from(maybe.toUint8Array());
  return null;
}

/**
 * Unpack a stored payload. THROWS on an unknown tag or corrupt bytes — the caller decides what an
 * unreadable document means for it; this helper never invents a value.
 */
export function unpackJson<T = unknown>(enc: unknown, data: unknown): T {
  if (enc !== PACKED_ENCODING) throw new Error(`unknown packed encoding: ${String(enc)}`);
  const buf = asBuffer(data);
  if (!buf) throw new Error('packed payload is not bytes');
  return JSON.parse(brotliDecompressSync(buf).toString('utf8')) as T;
}

export interface FittedFiles {
  /** The files that fit, in the caller's order. */
  files: Record<string, string>;
  /** Paths that did not fit even compressed — the caller must record these, never hide them. */
  omitted: string[];
  /** The packed form of `files`, ready to store. */
  packed: Packed;
}

/**
 * Pack a file map into at most `maxPackedBytes`, keeping the caller's order.
 *
 * The whole map is tried first — the normal case, one compression. Only when that does not fit does it
 * search for the longest PREFIX that does (binary search, so ~log2(n) compressions, bounded), and it
 * reports every path it left out. A prefix rather than "largest files out first" because callers
 * already order by importance, and a stable rule is one the report can describe in a sentence.
 */
export function fitFilesPacked(
  files: Record<string, string>,
  maxPackedBytes: number = MAX_PACKED_BYTES,
): FittedFiles {
  const entries = Object.entries(files).filter(
    ([p, c]) => typeof p === 'string' && typeof c === 'string',
  );
  const build = (n: number): Record<string, string> => Object.fromEntries(entries.slice(0, n));

  const whole = build(entries.length);
  const wholePacked = packJson(whole);
  if (wholePacked.data.length <= maxPackedBytes) {
    return { files: whole, omitted: [], packed: wholePacked };
  }

  // Largest n in [0, entries.length) whose prefix fits. n = 0 always fits (an empty map packs to a
  // handful of bytes), so the search always has an answer.
  let lo = 0;
  let hi = entries.length - 1;
  let best: Packed | null = null;
  let bestN = -1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const p = packJson(build(mid));
    if (p.data.length <= maxPackedBytes) { lo = mid; best = p; bestN = mid; } else { hi = mid - 1; }
  }
  if (!best || bestN !== lo) best = packJson(build(lo));
  return {
    files: build(lo),
    omitted: entries.slice(lo).map(([p]) => p),
    packed: best,
  };
}
