/**
 * Pictures and sounds the user attaches for their game (owner 2026-11-23). Models already have a path
 * (userModels.ts). A .png, .ogg or .mp3 did not: it was read as a document or ignored. This checks the
 * type and the size, then lands the file where the game can use it.
 */
import { createHash } from 'node:crypto';

export const USER_MEDIA_MAX_BYTES = 4 * 1024 * 1024;

export interface UserMediaFile {
  from: string;
  path: string;
  bytes: Uint8Array;
  sha256: string;
  kind: 'texture' | 'sound';
}
export interface UserMediaRefusal { from: string; reason: string }

const EXT: Record<string, 'texture' | 'sound'> = { png: 'texture', ogg: 'sound', mp3: 'sound' };

function slug(fileName: string): string {
  const stem = fileName.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
  const clean = stem.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return clean || 'asset';
}

function decode(base64: string): Uint8Array | null {
  try { return new Uint8Array(Buffer.from(base64.replace(/^data:[^,]*,/, ''), 'base64')); } catch { return null; }
}

/** The bytes match the extension. A renamed text file is refused. PURE. */
export function mediaBytesMatch(kind: 'png' | 'ogg' | 'mp3', bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (kind === 'png') return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (kind === 'ogg') return bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
  return (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
}

export function isUserMediaName(name: unknown): boolean {
  return typeof name === 'string' && /\.(png|ogg|mp3)$/i.test(name);
}

/**
 * Pull .png / .ogg / .mp3 attachments out of the list that is left after models are taken. Everything
 * else is returned unchanged. A file that is too big, or whose bytes are not that type, is refused
 * with a reason the user can be told.
 */
export function splitUserMedia<T extends { name?: unknown; base64?: unknown }>(atts: readonly T[]): { rest: T[]; files: UserMediaFile[]; refused: UserMediaRefusal[] } {
  const rest: T[] = [];
  const files: UserMediaFile[] = [];
  const refused: UserMediaRefusal[] = [];
  const used = new Set<string>();
  for (const a of atts) {
    const name = typeof a?.name === 'string' ? a.name : '';
    const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
    const kind = EXT[ext];
    if (!kind) { rest.push(a); continue; }
    const bytes = typeof a.base64 === 'string' ? decode(a.base64) : null;
    if (!bytes) { refused.push({ from: name, reason: 'the file could not be read' }); continue; }
    if (bytes.byteLength > USER_MEDIA_MAX_BYTES) {
      refused.push({ from: name, reason: `larger than ${USER_MEDIA_MAX_BYTES / 1024 / 1024} MB — export a smaller file` });
      continue;
    }
    if (!mediaBytesMatch(ext as 'png' | 'ogg' | 'mp3', bytes)) {
      refused.push({ from: name, reason: `this is not a ${ext} file` });
      continue;
    }
    let path = `${kind === 'texture' ? 'public/textures' : 'public/sounds'}/${slug(name)}.${ext}`;
    if (used.has(path)) path = path.replace(new RegExp(`\\.${ext}$`), `-${used.size}.${ext}`);
    used.add(path);
    files.push({ from: name, path, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), kind });
  }
  return { rest, files, refused };
}

export function userMediaNote(files: readonly UserMediaFile[], refused: readonly UserMediaRefusal[]): string {
  if (!files.length && !refused.length) return '';
  const lines: string[] = [];
  if (files.length) {
    lines.push('[USER MEDIA ADDED] The user attached pictures or sounds. They are in the project. Use a texture on a material and play a sound by its path:');
    for (const f of files) lines.push(`- "${f.from}" → ${f.path} (${f.kind}, sha256 ${f.sha256})`);
  }
  if (refused.length) lines.push(`[USER MEDIA NOT ADDED] Tell the user plainly, in their language, which file and why: ${refused.slice(0, 12).map(r => `${JSON.stringify(r.from)}: ${r.reason}`).join(' · ')}`);
  return lines.join('\n');
}
