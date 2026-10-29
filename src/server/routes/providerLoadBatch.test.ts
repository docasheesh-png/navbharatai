import express from 'express';
import type { Server } from 'node:http';
import { afterEach, expect,it,vi } from 'vitest';
import { mintAdminToken } from '../lib/adminAuth';
import { registerProviderLoadBatchRoutes } from './providerLoadBatch';
let server:Server|undefined;
afterEach(async()=>{if(server){server.closeAllConnections();await new Promise<void>(r=>server!.close(()=>r()));server=undefined;}vi.unstubAllEnvs();});
async function setup(){
 vi.stubEnv('ADMIN_PASSWORD','synthetic');vi.stubEnv('ADMIN_USERNAME','test-admin');
 const service={status:vi.fn().mockResolvedValue({batch:null,settings:null}),configure:vi.fn().mockResolvedValue({revision:1}),advance:vi.fn().mockResolvedValue({next:2}),resume:vi.fn().mockResolvedValue({batch:{stopped:false}}),stop:vi.fn().mockResolvedValue({batch:{stopped:true}}),item:vi.fn().mockResolvedValue({requestId:'synthetic-id'})};
 const resolve=vi.fn(()=>service),app=express();app.use(express.json());registerProviderLoadBatchRoutes(app,resolve);
 server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server!.once('listening',r));const address=server.address();if(!address||typeof address==='string')throw Error('address');
 return {service,resolve,base:`http://127.0.0.1:${address.port}/api/admin/provider-load-batch`,headers:{'content-type':'application/json','x-admin-token':mintAdminToken('synthetic','test-admin',Date.now())}};
}
it.each(['/status','/items/0','/configure','/advance','/stop','/resume','/unknown'])('denies unauthenticated direct access to %s before any dependency call',async path=>{
 const f=await setup();const r=await fetch(f.base+path,{method:['/configure','/advance','/stop','/resume'].includes(path)?'POST':'GET',headers:{'content-type':'application/json'},body:['/configure','/advance','/stop','/resume'].includes(path)?'{}':undefined});
 expect([401,403]).toContain(r.status);expect(f.resolve).not.toHaveBeenCalled();
});
it('status/items are read-only, configure uses server admin identity, and advance requires wave identity',async()=>{
 const f=await setup();await fetch(f.base+'/status',{headers:f.headers});await fetch(f.base+'/items/0',{headers:f.headers});expect(f.service.advance).not.toHaveBeenCalled();
 await fetch(f.base+'/configure',{method:'POST',headers:f.headers,body:'{"concurrency":2}'});expect(f.service.configure).toHaveBeenCalledWith({concurrency:2},'test-admin');
 expect((await fetch(f.base+'/advance',{method:'POST',headers:f.headers,body:'{}'})).status).toBe(400);
 const waveId='11111111-1111-4111-8111-111111111111';await fetch(f.base+'/advance',{method:'POST',headers:f.headers,body:JSON.stringify({waveId})});expect(f.service.advance).toHaveBeenCalledWith(waveId);
 f.service.advance.mockRejectedValue(new Error('Bearer secret'));const r=await fetch(f.base+'/advance',{method:'POST',headers:f.headers,body:JSON.stringify({waveId})});expect(await r.text()).not.toContain('secret');
});

it('configure returns correlation and sanitized failure evidence without invoking advance',async()=>{
 const {LoadDiagnosticError}=await import('../lib/providerLoadDiagnostics');const f=await setup();
 f.service.configure.mockRejectedValue(new LoadDiagnosticError('unavailable','quote_http','http_rejected',400,'list_price_unknown'));
 const r=await fetch(f.base+'/configure',{method:'POST',headers:f.headers,body:'{}'});const data=await r.json();
 expect(r.status).toBe(503);expect(data.diagnostic).toMatchObject({stage:'quote_http',reason:'http_rejected',upstreamStatus:400,supplierCode:'list_price_unknown'});expect(data.diagnostic.correlationId).toMatch(/^[0-9a-f-]{36}$/);expect(f.service.advance).not.toHaveBeenCalled();
});
