import { describe, expect, it, vi } from 'vitest';
vi.mock("../src/server/lib/serverDb", () => ({ getServerDb: () => { throw Error("no production database in test"); } }));
import { ProAttachmentStore, decodeOriginal, attachmentObjectKey, type AttachmentBackend, type AttachmentOwner } from '../src/server/lib/proAttachmentStore';
function fixture() {
  const scopes = new Set<string>(); let now=1000;
  const owners = new Map<string, AttachmentOwner>(); const bytes = new Map<string, Buffer>();
  const backend: AttachmentBackend = {
    async transaction(uid, fn, scope) { const owner = structuredClone(owners.get(uid) || { uid, files: {} });
      const key=(message?:string)=>JSON.stringify([uid,scope?.sessionId,message||null]);
      const fileKey=JSON.stringify([uid,'file',scope?.fileId]);
      const blocked=!!scope && (scopes.has(key()) || scopes.has(key(scope.messageId)) || (!!scope.fileId && scopes.has(fileKey)));
      const result = fn(owner,blocked); if(scope?.block) scopes.add(scope.fileId ? fileKey : key(scope.messageId));
      owners.set(uid, owner); return structuredClone(result); },
    async put(uid, id, data) { bytes.set(uid + id, data); },
    async read(uid, id) { const b = bytes.get(uid + id); if (!b) throw Error('missing'); return b; },
    async remove(uid, id) { bytes.delete(uid + id); },
  };
  const store = new ProAttachmentStore(backend, () => ({maxBytes:100*1024*1024,maxFiles:64}),()=>now);
  return { store, backend, owners, bytes, advance: () => {now+=120001;} };
}
const input = { name: 'opaque.exe', sessionId: 's-1', messageId: '1000', base64: Buffer.from([0, 255, 77, 90]).toString('base64') };
describe('private original attachments', () => {
  it('preserves opaque original bytes without parsing or execution', async () => {
    const f = fixture(); const r = await f.store.upload('alice', input);
    expect((await f.store.read('alice', r.id)).bytes).toEqual(Buffer.from([0, 255, 77, 90]));
    expect(r.state).toBe('ready'); expect(r.sha256).toHaveLength(64);
  });
  it('isolates owner reads, lists and deletes', async () => {
    const f = fixture(); const r = await f.store.upload('alice', input);
    await expect(f.store.get('bob', r.id)).rejects.toMatchObject({ status: 404 });
    expect(await f.store.list('bob')).toEqual([]);
    await f.store.remove('bob', r.id); expect((await f.store.read('alice', r.id)).bytes.length).toBe(4);
  });
  it.each(['../file', 'a/b', 'a\\b', 'a\n.html', '..'])('rejects unsafe filename %s', name => {
    expect(() => decodeOriginal({ ...input, name })).toThrow();
  });
  it.each(['@@==', 'AB==', 'abc', 'data:text/plain;base64,AAAA'])('rejects invalid base64 %s', base64 => {
    expect(() => decodeOriginal({ ...input, base64 })).toThrow();
  });
  it('rejects oversized upload before allocation', () => {
    expect(() => decodeOriginal({ ...input, base64: 'A'.repeat(21 * 1024 * 1024) })).toThrow();
  });
  it('bounds file count including reservations', async () => {
    const f = fixture(); for (let n = 0; n < 64; n++) await f.store.upload('alice', {...input,messageId:String(n)});
    await expect(f.store.upload('alice', input)).rejects.toMatchObject({ status: 413 });
  });
  it('retains originals until explicitly removed', async () => {
    const f = fixture(); const r = await f.store.upload('alice', input);
    await f.store.cleanup('alice'); expect((await f.store.list('alice')).length).toBe(1);
    await f.store.remove('alice',r.id); expect(f.bytes.size).toBe(0);
  });
  it('keeps tombstones and quota on deletion failure; retries cleanup', async () => {
    const f = fixture(); const r = await f.store.upload('alice', input);
    const remove = f.backend.remove; f.backend.remove = vi.fn().mockRejectedValue(Error('storage down'));
    await expect(f.store.remove('alice', r.id)).rejects.toThrow();
    expect(f.owners.get('alice')!.files[r.id].state).toBe('deleting');
    f.backend.remove = remove; await f.store.cleanup('alice'); expect(f.bytes.size).toBe(0);
  });
  it('erases scoped messages without touching other messages', async () => {
    const f = fixture(); await f.store.upload('alice', input);
    await f.store.upload('alice', { ...input, messageId: '1001' });
    await f.store.erase('alice', { sessionId: 's-1', messageId: '1000' });
    expect((await f.store.list('alice')).map(r => r.messageId)).toEqual(['1001']);
  });
  it('fences account erasure and subsequent uploads', async () => {
    const f = fixture(); await f.store.upload('alice', input); await f.store.erase('alice');
    expect(f.bytes.size).toBe(0); await expect(f.store.upload('alice', input)).rejects.toMatchObject({ status: 409 });
  });
  it('does not return corrupt bytes', async () => {
    const f = fixture(); const r = await f.store.upload('alice', input); f.bytes.set('alice' + r.id, Buffer.from('evil'));
    await expect(f.store.read('alice', r.id)).rejects.toMatchObject({ status: 502 });
  });
  it('does not release reservation when failed upload cleanup also fails', async () => {
    const f = fixture(); f.backend.put = vi.fn().mockRejectedValue(Error('write failed'));
    f.backend.remove = vi.fn().mockRejectedValue(Error('delete failed'));
    await expect(f.store.upload('alice', input)).rejects.toThrow('write failed');
    expect(Object.values(f.owners.get('alice')!.files)[0].state).toBe('pending');
  });
  it('returns the same receipt on response-loss retry without double quota', async()=>{
    const f=fixture(); const a=await f.store.upload('alice',input); const b=await f.store.upload('alice',input);
    expect(b.id).toBe(a.id);expect((await f.store.list('alice')).length).toBe(1);expect(f.bytes.size).toBe(1);
  });
  it('keeps pending and deletion-failed records visible and cancellable',async()=>{
    const f=fixture();const r=await f.store.upload('alice',input);f.owners.get('alice')!.files[r.id].state='pending';
    expect((await f.store.list('alice'))[0].state).toBe('pending');
    await f.store.remove('alice',r.id);expect(f.bytes.size).toBe(0);
  });
  it('recovers an expired pending reservation using exact saved bytes',async()=>{
    const f=fixture();const r=await f.store.upload('alice',input);
    Object.assign(f.owners.get('alice')!.files[r.id],{state:'pending',leaseUntil:1100}); f.advance();
    f.backend.put=vi.fn().mockRejectedValue(Error('already exists'));
    const restored=await f.store.upload('alice',input);expect(restored.state).toBe('ready');expect(restored.id).toBe(r.id);
  });
  it('rejects new uploads into deleted message but allows a different message',async()=>{
    const f=fixture();await f.store.erase('alice',{sessionId:'s-1',messageId:'1000'});
    await expect(f.store.upload('alice',input)).rejects.toMatchObject({status:409});
    await expect(f.store.upload('alice',{...input,messageId:'1001'})).resolves.toMatchObject({state:'ready'});
  });
  it('fences an upload racing chat erasure and removes late bytes',async()=>{
    const f=fixture();let unblock!:()=>void;let entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});
    const put=f.backend.put;f.backend.put=async(...args)=>{entered();await new Promise<void>(r=>{unblock=r;});await put(...args);};
    const upload=f.store.upload('alice',input);const rejected=expect(upload).rejects.toMatchObject({status:409});
    await started;await f.store.erase('alice',{sessionId:'s-1'});unblock();await rejected;
    expect(f.bytes.size).toBe(0);expect(await f.store.list('alice')).toEqual([]);
  });
  it('keeps failed pending uploads retryable instead of losing bytes or double quota',async()=>{
    const f=fixture();const put=f.backend.put;f.backend.put=vi.fn().mockRejectedValue(Error('temporary outage'));
    await expect(f.store.upload('alice',input)).rejects.toThrow('temporary outage');
    expect((await f.store.list('alice'))[0].state).toBe('pending');
    f.backend.put=put;expect((await f.store.upload('alice',input)).state).toBe('ready');
    expect((await f.store.list('alice')).length).toBe(1);
  });
  it('fences explicitly deleted file IDs against late response-loss retries',async()=>{
    const f=fixture();const file=await f.store.upload('alice',input);await f.store.remove('alice',file.id);
    await expect(f.store.upload('alice',input)).rejects.toMatchObject({status:409});
    expect(f.bytes.size).toBe(0);
  });
  it('uses disjoint encoded owner paths, never filenames', () => {
    const id = '12345678-1234-1234-1234-123456789abc';
    expect(attachmentObjectKey('a/b', id)).not.toContain('a/b');
    expect(attachmentObjectKey('a', id)).not.toBe(attachmentObjectKey('ab', id));
  });
});
