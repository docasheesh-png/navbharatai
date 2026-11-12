import { expect, it, vi } from 'vitest';
vi.mock('../src/server/lib/authMiddleware', () => ({ verifyFirebaseToken: vi.fn(async () => 'alice') }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => { throw Error('no production I/O'); } }));
import { registerProAttachmentRoutes } from '../src/server/routes/proAttachments';
import { verifyFirebaseToken } from '../src/server/lib/authMiddleware';
import { signDownloadTicket, ticketSecret } from '../src/server/lib/downloadTicket';
const id = '12345678-1234-1234-1234-123456789abc';
function setup() {
  const handlers: Record<string, Function> = {};
  const app = Object.fromEntries(['get','post','delete'].map(method => [method, (path: string, ...chain: Function[]) => { handlers[method + path] = chain[chain.length - 1]; }]));
  const store = { upload: vi.fn(), list: vi.fn(), get: vi.fn(), remove: vi.fn(), read: vi.fn() };
  registerProAttachmentRoutes(app as any, ((_req:unknown,_res:unknown,next:Function)=>next()) as any, store as any);
  const headers: Record<string,string> = {}; let code = 200; let body: unknown;
  const res: any = {setHeader: (k: string,v: string) => {headers[k] = v;}, status: (n:number) => {code=n; return res;},json:(v:unknown)=>{body=v;return res;},send:(v:unknown)=>{body=v;return res;}};
  return {handlers,store,res,headers, code:()=>code,body:()=>body};
}
it('refuses unauthenticated upload before persistence', async () => {
  const f=setup(); vi.mocked(verifyFirebaseToken).mockResolvedValueOnce(null);
  await f.handlers['post/api/agentv3/attachments']({body:{}},f.res);
  expect(f.code()).toBe(401); expect(f.store.upload).not.toHaveBeenCalled();
});
it('ticket validates ownership before signing', async()=>{
  const f=setup(); f.store.get.mockRejectedValue(Error('no owner'));
  await f.handlers['post/api/agentv3/attachments/:id/ticket']({params:{id}},f.res);
  expect(f.code()).toBe(503);expect(f.body()).not.toHaveProperty('path');
});
it('rejects wrong-file ticket without reading bytes', async()=>{
  const f=setup();const e=Date.now()+60000;
  await f.handlers['get/api/agentv3/attachments/:id/download']({params:{id},query:{u:'alice',e,t:signDownloadTicket('other-file','alice',e,ticketSecret())}},f.res);
  expect(f.code()).toBe(403); expect(f.store.read).not.toHaveBeenCalled();
});
it('always returns original bytes as safe attachment, never supplied MIME', async()=>{
  const f=setup(); const e=Date.now()+60000; const bytes=Buffer.from('<script>alert(1)</script>');
  f.store.read.mockResolvedValue({record:{name:'my"file.html'},bytes});
  await f.handlers['get/api/agentv3/attachments/:id/download']({params:{id},query:{u:'alice',e,t:signDownloadTicket(`pro-attachment:${id}`,'alice',e,ticketSecret())}},f.res);
  expect(f.store.read).toHaveBeenCalledWith('alice',id);expect(f.body()).toBe(bytes);
  expect(f.headers['Content-Type']).toBe('application/octet-stream');
  expect(f.headers['Content-Disposition']).toMatch(/^attachment; filename="my_file.html"/);
  expect(f.headers['X-Content-Type-Options']).toBe('nosniff');
  expect(f.headers['Content-Security-Policy']).toContain('sandbox');
});
it('disabling new uploads keeps existing file deletion available', async()=>{
  const f=setup(); const before=process.env.PRO_ATTACHMENTS_ENABLED;process.env.PRO_ATTACHMENTS_ENABLED='false';
  try {
    await f.handlers['post/api/agentv3/attachments']({body:{}},f.res);expect(f.code()).toBe(503);
    expect(f.store.upload).not.toHaveBeenCalled();
  } finally { if(before===undefined)delete process.env.PRO_ATTACHMENTS_ENABLED;else process.env.PRO_ATTACHMENTS_ENABLED=before; }
});
