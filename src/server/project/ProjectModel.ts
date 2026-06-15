/**
 * Phase 2 — Real Project Model / Virtual File System.
 *
 * Replaces the ad-hoc `Record<string, string>` file maps used across the old
 * AppEngine/sync code with a typed, binary-safe, metadata-carrying file system
 * that supports arbitrary paths/depth and has NO arbitrary size caps (the old
 * 60KB/file + 800KB/workspace drops that silently lost user work are gone).
 *
 * This module is additive and fully backward-compatible:
 *   - `VirtualFileSystem.fromRecord(record)` lifts a legacy `{path: content}` map.
 *   - `vfs.toRecord()` projects back to the legacy shape (text files only) so
 *     existing call sites keep working during migration.
 *
 * Binary files are stored as base64 with `encoding: 'base64'`; text as 'utf8'.
 */

export type FileEncoding = 'utf8' | 'base64';

export interface ProjectFile {
  /** POSIX-style, normalized, no leading slash (e.g. "src/index.ts"). */
  path: string;
  /** File content. For binary files this is base64 (see `encoding`). */
  content: string;
  encoding: FileEncoding;
  /** Byte length of the decoded content. */
  size: number;
  updatedAt: string;
}

export interface ProjectFileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: ProjectFileTreeNode[];
  size?: number;
}

/** Normalize a path: backslashes → slashes, collapse `.`/`..`, strip leading slash. */
export function normalizePath(input: string): string {
  if (!input) return '';
  let p = String(input).replace(/\\/g, '/').trim();
  // strip a leading "./" repeatedly and any leading slashes
  p = p.replace(/^\/+/, '');
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.webm', '.wav', '.ogg', '.pdf', '.zip', '.wasm',
]);

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i >= 0 ? path.slice(i).toLowerCase() : '';
}

/** Heuristic: a data-URL or known-binary extension or NUL bytes ⇒ binary. */
export function looksBinary(path: string, content: string): boolean {
  if (content.startsWith('data:')) return true;
  if (BINARY_EXT.has(extOf(path))) return true;
  return content.includes('\u0000');
}

function byteLength(content: string, encoding: FileEncoding): number {
  if (encoding === 'base64') {
    // approximate decoded size from base64 length
    const clean = content.replace(/=+$/, '');
    return Math.floor((clean.length * 3) / 4);
  }
  return Buffer.byteLength(content, 'utf8');
}

/**
 * In-memory typed virtual file system for a single project/workspace.
 * No size caps; preserves every file. Path-traversal safe via normalization.
 */
export class VirtualFileSystem {
  private files = new Map<string, ProjectFile>();

  /** Number of files currently stored. */
  get count(): number {
    return this.files.size;
  }

  /** Total decoded byte size across all files. */
  get totalBytes(): number {
    let total = 0;
    for (const f of this.files.values()) total += f.size;
    return total;
  }

  has(path: string): boolean {
    return this.files.has(normalizePath(path));
  }

  /** Write (create or overwrite) a file. Encoding auto-detected if omitted. */
  write(path: string, content: string, encoding?: FileEncoding): ProjectFile {
    const norm = normalizePath(path);
    if (!norm) throw new Error('VFS.write: empty/invalid path');
    const enc: FileEncoding = encoding ?? (looksBinary(norm, content) ? 'base64' : 'utf8');
    const file: ProjectFile = {
      path: norm,
      content,
      encoding: enc,
      size: byteLength(content, enc),
      updatedAt: new Date().toISOString(),
    };
    this.files.set(norm, file);
    return file;
  }

  read(path: string): ProjectFile | undefined {
    return this.files.get(normalizePath(path));
  }

  /** Raw text content (decoding base64 to utf8 if needed). */
  readText(path: string): string | undefined {
    const f = this.read(path);
    if (!f) return undefined;
    return f.encoding === 'base64' ? Buffer.from(f.content, 'base64').toString('utf8') : f.content;
  }

  delete(path: string): boolean {
    return this.files.delete(normalizePath(path));
  }

  rename(from: string, to: string): boolean {
    const f = this.read(from);
    if (!f) return false;
    const norm = normalizePath(to);
    if (!norm) throw new Error('VFS.rename: empty/invalid target path');
    this.files.delete(f.path);
    this.files.set(norm, { ...f, path: norm, updatedAt: new Date().toISOString() });
    return true;
  }

  /** All file paths, sorted. */
  paths(): string[] {
    return [...this.files.keys()].sort();
  }

  list(): ProjectFile[] {
    return this.paths().map(p => this.files.get(p)!);
  }

  /** Build a nested directory tree for UI/file-explorer rendering. */
  tree(): ProjectFileTreeNode {
    const root: ProjectFileTreeNode = { name: '', path: '', type: 'dir', children: [] };
    for (const file of this.list()) {
      const segs = file.path.split('/');
      let node = root;
      let acc = '';
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        acc = acc ? `${acc}/${seg}` : seg;
        const isLeaf = i === segs.length - 1;
        node.children = node.children || [];
        let child = node.children.find(c => c.name === seg);
        if (!child) {
          child = isLeaf
            ? { name: seg, path: acc, type: 'file', size: file.size }
            : { name: seg, path: acc, type: 'dir', children: [] };
          node.children.push(child);
        }
        node = child;
      }
    }
    return root;
  }

  /** Project to the legacy `{ path: content }` shape (text + data-URL safe). */
  toRecord(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of this.list()) {
      out[f.path] = f.encoding === 'base64' && !f.content.startsWith('data:')
        ? `data:application/octet-stream;base64,${f.content}`
        : f.content;
    }
    return out;
  }

  /** Lift a legacy `{ path: content }` map into a typed VFS. */
  static fromRecord(record: Record<string, string> | null | undefined): VirtualFileSystem {
    const vfs = new VirtualFileSystem();
    if (record) {
      for (const [path, content] of Object.entries(record)) {
        if (typeof content === 'string') vfs.write(path, content);
      }
    }
    return vfs;
  }
}
