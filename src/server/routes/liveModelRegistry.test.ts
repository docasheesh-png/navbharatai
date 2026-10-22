import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ view:vi.fn(), sync:vi.fn(), control:vi.fn() }));
vi.mock('../AI/LiveRegistry/runtime', () => ({ liveModelRegistryView:mocks.view, syncLiveModels:mocks.sync, controlLiveModel:mocks.control }));
vi.mock('../lib/adminAuth', () => ({ adminUsername:()=>'admin' }));
vi.mock('express-rate-limit', () => ({ default:()=> (_req:unknown,_res:unknown,next:()=>void)=>next() }));
import { registerLiveModelRegistryRoutes } from './liveModelRegistry';
function setup() {
  const routes = new Map<string, any[]>();
  const auth = vi.fn(); const app:any={ get:(p:string,...handlers:any[])=>routes.set(`GET ${p}`,handlers), post:(p:string,...handlers:any[])=>routes.set(`POST ${p}`,handlers) };
  registerLiveModelRegistryRoutes(app,auth);
  const response:any={ setHeader:vi.fn(), status:vi.fn(), json:vi.fn() }; response.status.mockReturnValue(response);
  return { routes,auth,response, handler:(method:string,path:string)=>routes.get(`${method} /api/admin/live-model-registry${path}`)!.at(-1) };
}
beforeEach(()=>vi.clearAllMocks());
describe('admin registry routes',()=>{
  it('auth is first middleware on every route, ahead of rate limiter and I/O',()=>{ const { routes,auth }=setup(); expect(routes.size).toBe(3); for(const handlers of routes.values()) expect(handlers[0]).toBe(auth); expect(mocks.view).not.toHaveBeenCalled(); });
  it('returns no-store status',async()=>{ const { handler,response }=setup(); mocks.view.mockResolvedValue({enabled:false}); await handler('GET','')({},response); expect(response.setHeader).toHaveBeenCalledWith('Cache-Control','no-store'); expect(response.json).toHaveBeenCalledWith({enabled:false}); });
  it('missing database is unavailable not fabricated empty green catalog',async()=>{ const { handler,response }=setup(); mocks.view.mockRejectedValue(new Error('secret database string')); await handler('GET','')({},response); expect(response.status).toHaveBeenCalledWith(503); expect(JSON.stringify(response.json.mock.calls)).not.toContain('secret'); });
  it('manual sync performs metadata sync only',async()=>{ const { handler,response }=setup(); mocks.sync.mockResolvedValue({status:'synced',version:'v'}); await handler('POST','/sync')({},response); expect(mocks.sync).toHaveBeenCalledOnce(); expect(mocks.control).not.toHaveBeenCalled(); });
  it.each(['paid-override','test-paid','set-price',''])('rejects unsupported action %s',async action=>{ const { handler,response }=setup(); await handler('POST','/models/action')({body:{modelId:'test/model:free',action,registryVersion:'11111111-1111-1111-1111-111111111111',reason:'Reviewed intended usage'}},response); expect(response.status).toHaveBeenCalledWith(400); expect(mocks.control).not.toHaveBeenCalled(); });
  it('rejects path-injected model ID',async()=>{ const { handler,response }=setup(); await handler('POST','/models/action')({body:{modelId:'../secret',action:'enable',registryVersion:'11111111-1111-1111-1111-111111111111',reason:'Reviewed intended usage'}},response); expect(response.status).toHaveBeenCalledWith(400); });
  it('stale review version is 409, never silently retried',async()=>{ const { handler,response }=setup(); mocks.control.mockRejectedValue(new Error('REGISTRY_VERSION_CHANGED')); await handler('POST','/models/action')({body:{modelId:'test/model:free',action:'approve-terms',registryVersion:'11111111-1111-1111-1111-111111111111',reason:'Reviewed intended usage'}},response); expect(response.status).toHaveBeenCalledWith(409); expect(mocks.control).toHaveBeenCalledOnce(); });
  it('authorized approval is audited with server identity and exact version',async()=>{ const { handler,response }=setup(); mocks.control.mockResolvedValue(undefined); await handler('POST','/models/action')({body:{modelId:'test/model:free',action:'approve-terms',registryVersion:'11111111-1111-1111-1111-111111111111',reason:'Reviewed intended usage'}},response); expect(mocks.control).toHaveBeenCalledWith('test/model:free','approve-terms','admin','11111111-1111-1111-1111-111111111111','Reviewed intended usage'); expect(response.json).toHaveBeenCalledWith({ok:true}); });
});
