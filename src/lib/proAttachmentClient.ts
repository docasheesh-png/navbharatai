/** Opaque originals are private downloads, never executable workspace files or AI input. */
export interface StoredProAttachment {
  id: string;
  name: string;
  sessionId: string;
  size: number;
  sha256: string;
  expiresAt?: number | null;
  readable: false;
  state: 'pending' | 'ready' | 'deleting';
}

// Keep established document/vision and ZIP import paths unchanged. All other binary
// formats go to opaque storage, even when their extension is disguised as text.
const DOCUMENT = /\.(docx?|xlsx?|pptx?|pdf|png|jpe?g|gif|webp|bmp|svg|heic|heif|zip)$/i;
const EXECUTABLE = /\.(exe|dll|so|dylib|com|msi|apk|ipa|wasm)$/i;
export async function needsOpaqueStorage(file: Pick<File, 'name' | 'type' | 'arrayBuffer'>): Promise<boolean> {
  if (EXECUTABLE.test(file.name)) return true;
  if (DOCUMENT.test(file.name)) return false;
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength === 0) return true;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text);
  } catch { return true; }
}

export function opaqueAttachmentNotice(files: readonly StoredProAttachment[]): string {
  if (!files.length) return '';
  // JSON-escape names: filenames are untrusted data, not instructions or paths.
  return '\n\n[Private file storage receipt: ' + JSON.stringify(files.map(({ id, name }) => ({ id, name })))
    + '. Original bytes saved for download, not read by the AI and not added to the app workspace. Do not claim to analyze their contents or use them as app assets.]';
}

export function validStoredAttachment(value: unknown): value is StoredProAttachment {
  if (!value || typeof value !== 'object') return false;
  const v = value as StoredProAttachment;
  return typeof v.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v.id)
    && typeof v.name === 'string' && v.name.length <= 255
    && typeof v.sessionId === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(v.sessionId)
    && Number.isSafeInteger(v.size) && v.size >= 0 && v.size <= 15 * 1024 * 1024
    && typeof v.sha256 === 'string' && /^[a-f0-9]{64}$/.test(v.sha256)
    && v.readable === false && ['pending', 'ready', 'deleting'].includes(v.state);
}

export async function attachmentResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.ok === false) {
    const detail = response.status === 404 ? 'Private binary uploads are not enabled on this server. Supported text, documents and images still use the existing attachment flow.' : typeof body?.error === 'string' ? body.error.slice(0, 300) : 'The file service is unavailable. Try again; do not assume the file was saved.';
    throw new Error(detail);
  }
  return body;
}

/** Tickets must stay on our own download endpoint, never a response-supplied external URL. */
export function safeAttachmentDownloadPath(path: unknown): string {
  if (typeof path !== 'string' || !/^\/api\/(?:v1\/)?agentv3\/attachments\/[a-zA-Z0-9_-]+\/download\?/.test(path)
    || /[\r\n\\]/.test(path)) throw new Error('The file download link was invalid. Refresh and try again.');
  return path;
}

export function originalFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const encoded = typeof reader.result === 'string' ? reader.result.split(',')[1] : undefined;
      if (encoded === undefined) reject(new Error('The original file could not be read. Select it again.'));
      else resolve(encoded);
    };
    reader.onerror = () => reject(new Error('The original file could not be read. Select it again.'));
    reader.onabort = () => reject(new Error('File reading was cancelled.'));
    reader.readAsDataURL(file);
  });
}

export function attachmentStateLabel(file: StoredProAttachment): string {
  return file.state === 'ready' ? 'Saved privately' : file.state === 'pending' ? 'Upload unfinished; refresh or remove' : 'Deletion unfinished; retry removal';
}

/** Account-wide is the default: an original must remain reachable after its local chat disappears. */
export function visiblePrivateAttachments(files: readonly StoredProAttachment[], sessionId: string, onlyThisChat: boolean): StoredProAttachment[] {
  return files.filter((file) => !onlyThisChat || file.sessionId === sessionId);
}
export function attachmentChatLabel(file: StoredProAttachment, currentSessionId: string): string {
  return file.sessionId === currentSessionId ? 'This chat' : `Other chat · ${file.sessionId.slice(0, 12)}`;
}
