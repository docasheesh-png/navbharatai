/** Private originals only. Never copied to a sandbox, published, or sent to a model. */
import { createHash } from 'node:crypto';
import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { workspaceAssetBucketName } from './workspaceAssetStorage';
import { MAX_ATTACHMENT_BYTES } from '../../lib/attachmentLimits';

export const PRO_ATTACHMENT_COLLECTION = 'pro_attachment_owners_v1';
export interface AttachmentCapacity { maxBytes: number; maxFiles: number }
export interface ProAttachment {
  id: string; name: string; size: number; sha256: string; sessionId: string; messageId: string;
  state: 'pending' | 'ready' | 'deleting';
  leaseUntil: number;
}
export interface AttachmentOwner { uid: string; blocked?: boolean; files: Record<string, ProAttachment> }
export interface AttachmentScope { sessionId: string; messageId?: string; fileId?: string; block?: boolean }
export interface AttachmentBackend {
  transaction<T>(uid: string, change: (owner: AttachmentOwner, scopeBlocked: boolean) => T, scope?: AttachmentScope): Promise<T>;
  eraseScopes?(uid: string): Promise<void>;
  put(uid: string, id: string, bytes: Buffer): Promise<void>;
  read(uid: string, id: string): Promise<Buffer>;
  remove(uid: string, id: string): Promise<void>;
}
export class AttachmentError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function attachmentIdValid(id: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id); }
export function attachmentObjectKey(uid: string, id: string): string {
  if (!uid || !attachmentIdValid(id)) throw new AttachmentError(400, 'Invalid attachment identity.');
  return `pro-attachments-v1/${Buffer.from(uid).toString('base64url')}/${id}`;
}
export function decodeOriginal(input: unknown): { name: string; bytes: Buffer; sessionId: string; messageId: string } {
  const v = input as Record<string, unknown> | null;
  if (!v || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 240
    || /[\\/\x00-\x1f\x7f]/.test(v.name) || v.name === '.' || v.name === '..') {
    throw new AttachmentError(400, 'Choose a file with a valid filename.');
  }
  for (const key of ['sessionId', 'messageId']) {
    if (typeof v[key] !== 'string' || !/^[\w-]{1,160}$/.test(v[key] as string)) {
      throw new AttachmentError(400, 'A valid chat and message are required.');
    }
  }
  if (typeof v.base64 !== 'string' || v.base64.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4) {
    throw new AttachmentError(413, 'Files must be 15 MB or smaller.');
  }
  if (v.base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(v.base64)) {
    throw new AttachmentError(400, 'The file data is invalid.');
  }
  const bytes = Buffer.from(v.base64, 'base64');
  if (bytes.length > MAX_ATTACHMENT_BYTES || bytes.toString('base64') !== v.base64) {
    throw new AttachmentError(400, 'The file data is invalid.');
  }
  return { name: v.name, bytes, sessionId: v.sessionId as string, messageId: v.messageId as string };
}
export class ProAttachmentStore {
  constructor(private backend: AttachmentBackend, private capacity: () => AttachmentCapacity, private now = Date.now) {}
  async upload(uid: string, input: unknown): Promise<ProAttachment> {
    const v = decodeOriginal(input);
    const capacity = this.capacity();
    if (!Number.isSafeInteger(capacity.maxBytes) || capacity.maxBytes <= 0 || !Number.isInteger(capacity.maxFiles) || capacity.maxFiles < 1 || capacity.maxFiles > 256) throw new AttachmentError(503, 'Attachment storage capacity is not configured.');
    const sha256 = createHash('sha256').update(v.bytes).digest('hex');
    // Same original retried in the same message returns one receipt, even after response loss.
    const hash = createHash('sha256').update(JSON.stringify([uid, v.sessionId, v.messageId, v.name, sha256])).digest('hex');
    const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
    const record: ProAttachment = { id, name: v.name, size: v.bytes.length, sha256,
      sessionId: v.sessionId, messageId: v.messageId, state: 'pending', leaseUntil: this.now() + 120_000 };
    const existing = await this.backend.transaction(uid, (owner, scopeBlocked) => {
      if (owner.blocked || scopeBlocked) throw new AttachmentError(409, 'This attachment or chat was deleted.');
      const old = owner.files[id];
      if (old?.state === 'ready') return old;
      if (old?.state === 'deleting') throw new AttachmentError(409, 'This file is being deleted. Retry deletion first.');
      if (old && old.leaseUntil > this.now()) throw new AttachmentError(409, 'This file is still uploading. Check saved files before retrying.');
      const files = Object.values(owner.files);
      if (!old && (files.length >= capacity.maxFiles || files.reduce((n, f) => n + f.size, 0) + record.size > capacity.maxBytes)) {
        throw new AttachmentError(413, 'Attachment storage is full. Delete saved files and try again.');
      }
      owner.files[id] = record;
      return null;
    }, { sessionId: v.sessionId, messageId: v.messageId, fileId: id });
    if (existing) return existing;
    try {
      try { await this.backend.put(uid, id, v.bytes); }
      catch (writeError) {
        // A prior attempt may have saved bytes then died before recording ready. Recover, never overwrite.
        const original = await this.backend.read(uid, id).catch(() => null);
        if (!original || original.length !== record.size || createHash('sha256').update(original).digest('hex') !== sha256) throw writeError;
      }
      await this.backend.transaction(uid, (owner, scopeBlocked) => {
        const saved = owner.files[id];
        if (owner.blocked || scopeBlocked || saved?.state !== 'pending' || saved.leaseUntil !== record.leaseUntil) {
          throw new AttachmentError(409, 'The upload was cancelled.');
        }
        saved.state = 'ready'; saved.leaseUntil = 0;
      }, { sessionId: v.sessionId, messageId: v.messageId, fileId: id });
      return { ...record, state: 'ready', leaseUntil: 0 };
    } catch (e) {
      // A delayed old attempt must not delete a newer lease's successfully saved original.
      const compensate = await this.backend.transaction(uid, owner => {
        const current = owner.files[id];
        if (current?.state === 'pending' && current.leaseUntil === record.leaseUntil) current.leaseUntil = 0;
        return !current || current.state === 'deleting' || !!owner.blocked;
      }).catch(() => false);
      if (compensate) await this.remove(uid, id).catch(() => undefined);
      throw e;
    }
  }
  async list(uid: string, sessionId?: string): Promise<ProAttachment[]> {
    // Pending/deleting entries stay visible and explicitly removable; a storage outage must not hide them.
    return this.backend.transaction(uid, owner => Object.values(owner.files).filter(f =>
      !owner.blocked && (!sessionId || f.sessionId === sessionId)));
  }
  async inspect(uid: string, id: string): Promise<ProAttachment> {
    const record = await this.backend.transaction(uid, owner => !owner.blocked ? owner.files[id] : undefined);
    if (!record) throw new AttachmentError(404, 'That file is not available.');
    return record;
  }
  async get(uid: string, id: string): Promise<ProAttachment> {
    const record = await this.inspect(uid, id);
    if (record.state !== 'ready') throw new AttachmentError(409, 'This file has not finished saving or is being deleted.');
    return record;
  }
  async read(uid: string, id: string): Promise<{ record: ProAttachment; bytes: Buffer }> {
    const record = await this.get(uid, id);
    const bytes = await this.backend.read(uid, id);
    if (bytes.length !== record.size || createHash('sha256').update(bytes).digest('hex') !== record.sha256) {
      throw new AttachmentError(502, 'The saved file could not be verified.');
    }
    await this.get(uid, id); // deletion during download preparation revokes access
    return { record, bytes };
  }
  async remove(uid: string, id: string): Promise<void> {
    const exists = await this.backend.transaction(uid, owner => {
      const f = owner.files[id]; if (!f) return false; f.state = 'deleting'; return true;
    }, { sessionId: '', fileId: id, block: true });
    // Always remove the random key: an upload may have completed after a deletion race.
    await this.backend.remove(uid, id);
    if (exists) await this.backend.transaction(uid, owner => { delete owner.files[id]; });
  }
  async cleanup(uid: string): Promise<void> {
    const ids = await this.backend.transaction(uid, owner => Object.values(owner.files)
      .filter(f => f.state === 'deleting').map(f => f.id));
    for (const id of ids) await this.remove(uid, id);
  }
  async erase(uid: string, scope?: { sessionId: string; messageId?: string }): Promise<void> {
    const ids = await this.backend.transaction(uid, owner => {
      if (!scope) owner.blocked = true; // prevents concurrent/retried uploads during account erasure
      const files = Object.values(owner.files).filter(f => !scope || (f.sessionId === scope.sessionId
        && (!scope.messageId || f.messageId === scope.messageId)));
      for (const file of files) file.state = 'deleting';
      return files.map(f => f.id);
    }, scope ? { ...scope, block: true } : undefined);
    for (const id of ids) await this.remove(uid, id);
    if (!scope) await this.backend.eraseScopes?.(uid);
  }
}

/** Fail closed unless the configured bucket itself forbids public access. No in-memory fallback. */
export function firebaseAttachmentBackend(): AttachmentBackend {
  function db() {
    if (!admin.apps.length) admin.initializeApp({});
    const store = getServerDb();
    if (!store) throw new AttachmentError(503, 'Attachment storage is unavailable.');
    return store;
  }
  async function bucket() {
    const name = workspaceAssetBucketName();
    if (!name) throw new AttachmentError(503, 'Private attachment storage is not configured.');
    db();
    const b = admin.storage().bucket(name);
    const [metadata] = await b.getMetadata();
    if (metadata.iamConfiguration?.publicAccessPrevention !== 'enforced') {
      throw new AttachmentError(503, 'Private attachment storage has not passed its security check.');
    }
    return b;
  }
  return {
    async transaction(uid, change, scope) {
      if (!uid) throw new AttachmentError(401, 'Please sign in.');
      const ref = db().collection(PRO_ATTACHMENT_COLLECTION).doc(Buffer.from(uid).toString('base64url'));
      return db().runTransaction(async tx => {
        const snap = await tx.get(ref);
        const owner = (snap.exists ? snap.data() : { uid, files: {} }) as AttachmentOwner;
        const original = JSON.stringify(owner);
        if (owner.uid !== uid) throw new AttachmentError(403, 'Attachment owner mismatch.');
        const scopeKey = (messageId?: string) => createHash('sha256').update(JSON.stringify([scope!.sessionId, messageId || null])).digest('hex');
        const scopeRefs = scope ? [
          ...(scope.sessionId ? [ref.collection('deleted_scopes').doc(scopeKey())] : []),
          ...(scope.messageId ? [ref.collection('deleted_scopes').doc(scopeKey(scope.messageId))] : []),
          ...(scope.fileId ? [ref.collection('deleted_scopes').doc(`file-${scope.fileId}`)] : []),
        ] : [];
        const fences = await Promise.all(scopeRefs.map(r => tx.get(r)));
        const result = change(owner, fences.some(f => f.exists));
        if (scope?.block) tx.set(scopeRefs[scopeRefs.length - 1], { blocked: true });
        if (JSON.stringify(owner) !== original) tx.set(ref, owner);
        return result;
      });
    },
    async eraseScopes(uid) {
      const ref = db().collection(PRO_ATTACHMENT_COLLECTION).doc(Buffer.from(uid).toString('base64url'));
      // Account parent remains blocked; scopes contain only hashed identity and may now be removed safely.
      for (;;) {
        const page = await ref.collection('deleted_scopes').limit(200).get();
        if (page.empty) break;
        const batch = db().batch(); for (const doc of page.docs) batch.delete(doc.ref); await batch.commit();
      }
    },
    async put(uid, id, bytes) {
      await (await bucket()).file(attachmentObjectKey(uid, id)).save(bytes, { resumable: false,
        contentType: 'application/octet-stream', preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { cacheControl: 'private, no-store', contentDisposition: 'attachment' } });
    },
    async read(uid, id) { const [bytes] = await (await bucket()).file(attachmentObjectKey(uid, id)).download(); return bytes; },
    async remove(uid, id) { await (await bucket()).file(attachmentObjectKey(uid, id)).delete({ ignoreNotFound: true }); },
  };
}
export const proAttachmentStore = new ProAttachmentStore(firebaseAttachmentBackend(), () => ({
  maxBytes: Number(process.env.PRO_ATTACHMENTS_MAX_BYTES), maxFiles: Number(process.env.PRO_ATTACHMENTS_MAX_FILES),
}));
