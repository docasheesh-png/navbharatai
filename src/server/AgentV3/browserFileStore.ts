/**
 * 📁 WHERE AN UPLOADED FILE LIVES IN AN APP WITH NO DATABASE (queue Q-542, autopsy 68f0a486, 2026-10-04).
 *
 * The school app turned every uploaded video and PDF into a data URL (`FileReader.readAsDataURL`) and saved
 * it in `localStorage`, and the summary said "drag-and-drop uploads work". `localStorage` holds about 5 MB
 * for the WHOLE site, and every character of a data URL counts against it: one short video, or a handful of
 * PDFs, fills it, and from then on every save fails. The app keeps working in memory, so it looks fine until
 * the page is reloaded and the files — and anything saved after them — are gone.
 *
 * THE CLASS: file BYTES put into a small key-value store (localStorage, sessionStorage, the 2 KB `NavData`
 * rows) that was built for a few settings, not for files. Nothing in the engine said where a file should go
 * when no database is connected, and our own social-feed starter modelled the wrong pattern — a data URL in
 * `useCollection`, whose quota error was swallowed in silence.
 *
 * THE RIGHT PLACE, in order:
 *   1. a database is connected → `generate_storage` (the user's own Supabase / S3 / Cloudinary storage);
 *   2. no database → the File itself in IndexedDB (`BROWSER_FILE_STORE_TS`, written as `src/lib/files.ts`):
 *      the browser stores the Blob as it is, with room for hundreds of megabytes, and it survives a reload.
 *      The app's list keeps only the file's id, name, size and type — and the app says plainly that files
 *      are kept on this device until a database is connected.
 *
 * PURE: the module source, the detectors and the note text.
 */

/**
 * The IndexedDB file store every app gets when it needs one — the pro starters ship it as `src/lib/files.ts`,
 * and the write-time note hands the same text to an app that has none. Small on purpose, no dependencies,
 * and every failure is a rejected promise with a readable message — never a silent loss.
 */
export const BROWSER_FILE_STORE_TS = `import { useEffect, useState } from 'react';

// Files the user uploads are kept here — in this browser's IndexedDB, as the file itself, not as text.
// Room for hundreds of megabytes, and they survive a reload. They stay on THIS device: to share them
// across devices, connect a database and keep them in its storage instead.
const DB = 'app-files';
const STORE = 'files';

export interface StoredFile { id: string; name: string; type: string; size: number; }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('This browser cannot keep files.')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the file store.'));
  });
}

function run<T>(mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = act(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req.result as T); };
    tx.onerror = tx.onabort = () => {
      db.close();
      const e = tx.error ?? req.error;
      reject(new Error(e && e.name === 'QuotaExceededError' ? 'There is no more room on this device to save files.' : 'The file could not be saved.'));
    };
  }));
}

/** Save an uploaded file. Resolves to what the app should keep in its list. */
export async function saveFile(file: File): Promise<StoredFile> {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await run('readwrite', (s) => s.put(file, id));
  return { id, name: file.name, type: file.type, size: file.size };
}

export function loadFile(id: string): Promise<Blob | undefined> {
  return run<Blob | undefined>('readonly', (s) => s.get(id));
}

export function removeFile(id: string): Promise<void> {
  return run<void>('readwrite', (s) => s.delete(id));
}

/** A URL to show or download a saved file: <img src={url}>, <video src={url}>, <a href={url} download>. */
export function useFileUrl(id: string | undefined | null): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let live = true;
    let made = '';
    if (!id) { setUrl(''); return; }
    loadFile(id).then((blob) => {
      if (!live || !blob) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
    }).catch(() => { if (live) setUrl(''); });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [id]);
  return url;
}
`;

const CODE = /\.(?:[cm]?[jt]sx?|vue|svelte|html)$/i;
const NOT_APP = /(?:^|\/)(?:node_modules|dist|build)\/|\.(?:test|spec)\./i;

/** Reads an uploaded file into TEXT — a data URL or a binary string. (A canvas drawing's `toDataURL` is not an upload.) */
export const FILE_TO_TEXT = /\breadAsDataURL\s*\(|\breadAsBinaryString\s*\(/;
/** Keeps files where files belong: IndexedDB, or a real storage service. */
export const KEEPS_FILES_PROPERLY = /\bindexedDB\b|from\s*['"](?:idb|idb-keyval|localforage|dexie)['"]|from\s*['"][^'"]*\/lib\/files['"]|\bsaveFile\s*\(|\.storage\s*\.\s*from\s*\(|\buploadBytes(?:Resumable)?\s*\(|firebase\/storage|cloudinary|\bPutObjectCommand\b|getSignedUrl/i;
/** Saves into a small key-value store: localStorage, sessionStorage, or the 2 KB NavData rows. */
export const SMALL_KEY_VALUE_STORE = /\b(?:localStorage|sessionStorage)\s*\.\s*setItem\s*\(|\buseLocalStorage\b|\bNavData\s*\.\s*(?:add|set|update|put)\s*\(|\buseCollection\s*[<(]/;

/** The written file reads an upload into text and does not keep it anywhere proper itself. PURE. */
export function readsUploadIntoText(path: string, content: string | undefined | null): boolean {
  if (!CODE.test(String(path ?? '')) || NOT_APP.test(String(path ?? ''))) return false;
  const c = String(content ?? '');
  return FILE_TO_TEXT.test(c) && !KEEPS_FILES_PROPERLY.test(c);
}

/**
 * The whole app turns uploads into text AND saves into a small key-value store AND keeps files nowhere
 * proper. Read on the files that ARE the app (never a slice an edit wrote). PURE.
 */
export function appKeepsUploadsInSmallStore(files: Readonly<Record<string, string>>): boolean {
  const code = Object.entries(files ?? {}).filter(([p, c]) => typeof c === 'string' && CODE.test(p) && !NOT_APP.test(p));
  if (!code.some(([, c]) => FILE_TO_TEXT.test(c))) return false;
  if (code.some(([, c]) => KEEPS_FILES_PROPERLY.test(c))) return false;
  return code.some(([, c]) => SMALL_KEY_VALUE_STORE.test(c));
}

/**
 * The note the builder hears the moment it writes such a file — once per build (the dispatcher keeps the
 * flag), with the module it needs so the right fix is one write away. Empty when the file is fine. PURE.
 */
export function uploadStorageWriteNote(path: string, content: string | undefined | null): string {
  if (!readsUploadIntoText(path, content)) return '';
  return `\n\n📁 Upload storage — ${path} reads an uploaded file into text (readAsDataURL). If that file is SAVED, `
    + `not only previewed, do not put the text into localStorage, sessionStorage, NavData or a list saved there: `
    + `localStorage holds about 5 MB for the whole app, so one video or a few PDFs fill it and every later save fails. `
    + `With a database connected, use generate_storage. Without one, write src/lib/files.ts below (if it is not there `
    + `yet), call saveFile(file) and keep only the returned { id, name, type, size } in your list; show or download `
    + `it with useFileUrl(id). Say plainly in the app and in your summary that files are kept on this device until `
    + `a database is connected. Showing a picked image before it is saved is fine as it is.\n`
    + `--- src/lib/files.ts ---\n${BROWSER_FILE_STORE_TS}--- end ---`;
}

/** A sentence that claims uploads work. One that already says where the files stay is honest. */
const UPLOADS_CLAIMED = /\b(?:uploads?|uploading|uploaded|drag[\s-]*(?:and|&|n)[\s-]*drop|file\s+(?:picker|attachments?))\b/i;
const SAYS_WHERE_FILES_STAY = /\b(?:this|your|one|the same)\s+(?:device|browser)\b|\blocal(?:ly|\s+storage|Storage)\b|\bon[\s-]device\b|\b\d+\s*MB\b|\btemporar\w*\b|\bnot\s+(?:saved|stored|kept)\b/i;

/** The first sentence of the summary that claims uploads work without saying where the files stay. PURE. */
export function uploadsClaim(summary: string): string | null {
  for (const sentence of String(summary ?? '').split(/(?<=[.!?])\s+|\n+/)) {
    if (UPLOADS_CLAIMED.test(sentence) && !SAYS_WHERE_FILES_STAY.test(sentence)) return sentence.trim();
  }
  return null;
}
