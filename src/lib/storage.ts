/**
 * Workspace persistence: code files → IndexedDB, binary assets → Cache API.
 * All public functions are fire-and-forget safe: callers may .catch(() => {}).
 */

const DB_NAME = 'navbharat_workspace';
const DB_VERSION = 1;
const STORE_NAME = 'files';
const CACHE_NAME = 'navbharat_assets';

const TEXT_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.css', '.scss', '.less',
  '.html', '.htm',
  '.json', '.jsonc',
  '.md', '.mdx',
  '.yaml', '.yml',
  '.svg',
  '.xml',
  '.txt',
  '.vue', '.svelte',
  '.py', '.php',
  '.sh', '.bash',
  '.toml', '.ini', '.env',
]);

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp',
  '.pdf',
  '.ttf', '.otf', '.woff', '.woff2',
  '.mp4', '.webm', '.mp3', '.ogg',
]);

function ext(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

// ── IndexedDB ──────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(path: string, content: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(content, path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetAll(): Promise<Record<string, string>> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const result: Record<string, string> = {};
    const cursor = tx.objectStore(STORE_NAME).openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c) { result[c.key as string] = c.value as string; c.continue(); }
      else resolve(result);
    };
    cursor.onerror = () => reject(cursor.error);
  });
}

async function idbDelete(path: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Cache API (binary assets stored as data-URLs) ─────────────────────────

function cacheKey(path: string) {
  return `/__navbharat_asset__/${path}`;
}

async function cachePut(path: string, dataUrl: string): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  // fetch() decodes data: URLs into a proper blob with correct MIME type
  const blob = await (await fetch(dataUrl)).blob();
  await cache.put(cacheKey(path), new Response(blob));
}

async function cacheGetAll(): Promise<Record<string, string>> {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  const result: Record<string, string> = {};
  for (const req of keys) {
    const resp = await cache.match(req);
    if (!resp) continue;
    const blob = await resp.blob();
    const dataUrl = await new Promise<string>((res) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result as string);
      reader.readAsDataURL(blob);
    });
    const path = decodeURIComponent(req.url.replace(/.*\/__navbharat_asset__\//, ''));
    result[path] = dataUrl;
  }
  return result;
}

async function cacheDelete(path: string): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  await cache.delete(cacheKey(path));
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function saveFile(path: string, content: string): Promise<void> {
  const e = ext(path);
  if (TEXT_EXTS.has(e)) await idbPut(path, content);
  else if (BINARY_EXTS.has(e)) await cachePut(path, content);
  // unknown extension: skip silently
}

export async function saveAllFiles(workspace: Record<string, string>): Promise<void> {
  const entries = Object.entries(workspace).filter(([k]) => !k.startsWith('__pending__'));
  await Promise.all(entries.map(([p, c]) => saveFile(p, c).catch(() => {})));
}

export async function loadAllFiles(): Promise<Record<string, string>> {
  const [text, binary] = await Promise.all([
    idbGetAll().catch(() => ({} as Record<string, string>)),
    cacheGetAll().catch(() => ({} as Record<string, string>)),
  ]);
  return { ...text, ...binary };
}

export async function deleteFile(path: string): Promise<void> {
  const e = ext(path);
  if (TEXT_EXTS.has(e)) await idbDelete(path);
  else if (BINARY_EXTS.has(e)) await cacheDelete(path);
}

export async function clearWorkspace(): Promise<void> {
  await Promise.all([idbClear().catch(() => {}), caches.delete(CACHE_NAME).catch(() => {})]);
}
