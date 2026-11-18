import {describe,it,expect,afterEach,vi} from 'vitest';
import {ToolDispatcher,type ActuatorPort} from './ToolDispatcher';
import {AgentEventStream} from './AgentEventStream';
import {WorkspaceState} from './WorkspaceState';
class Memory implements ActuatorPort {
 files=new Map<string,string>();writes:string[]=[];reads=new Map<string,number>();
 beforeExclusive?: (path:string)=>void;
 async createFileExclusive(_ws:string,path:string,content:string){this.beforeExclusive?.(path);if(this.files.has(path))throw Error("EEXIST: "+path);this.files.set(path,content);this.writes.push(path);}
 intercept?: (path:string,count:number)=>void;
 async readFile(_ws:string,path:string) {
  const n=(this.reads.get(path)??0)+1;this.reads.set(path,n);this.intercept?.(path,n);
  const value=this.files.get(path);if(value===undefined)throw Error('ENOENT: '+path);return value;
 }
 async writeFile(_ws:string,path:string,content:string){this.files.set(path,content);this.writes.push(path);}
 async listFiles(){return [...this.files.keys()];}
 commandResult={exitCode:0,stdout:'',stderr:''};
 async runCommand(){return this.commandResult;}
 async getPortUrl(){return 'https://sandbox.example.invalid';}
}
const composition={seed:7,profile:'explore',widthKm:8,quality:'phone',rivers:false,vegetation:false,objects:[{kind:'dog',count:1}]};
function setup(include?:string[], prompt='Build a 3D open world exploration game with one dog', composed=true, requestedComposition=composition) {
 const act=new Memory(),stream=new AgentEventStream(),d=new ToolDispatcher(act,'world-composition-test',new WorkspaceState(stream),stream);
 act.files.set('package.json',JSON.stringify({dependencies:{three:'0.180.0'}}));
 d.setCoverageRequest(prompt);
 return {act,run:()=>d.dispatch({id:'c',name:'generate_athree_map',input:{...(composed?{composition:requestedComposition}:{}),...(include===undefined?{}:{include})}},'architect')};
}
afterEach(()=>vi.unstubAllEnvs());
describe('composition dispatcher safeguards',()=>{
 it('fails before mutation when atomic creation is unavailable',async()=>{
  vi.stubEnv('AGENTV3_ATHREE_MAP','on');const x=setup([]);
  Object.defineProperty(x.act,'createFileExclusive',{value:undefined});
  const before=[...x.act.files];const r=await x.run();
  expect(r.is_error).toBe(true);expect(r.content).toContain('atomic exclusive');
  expect(x.act.writes).toHaveLength(0);expect([...x.act.files]).toEqual(before);
 });
 it('preserves a competing source created after guarded read',async()=>{
  vi.stubEnv('AGENTV3_ATHREE_MAP','on');const x=setup([]);let raced='';
  x.act.beforeExclusive=(path)=>{if(path.endsWith('/requestedWorld.ts')){raced=path;x.act.files.set(path,'// user concurrent source');}};
  const r=await x.run();expect(r.is_error).toBe(true);expect(raced).not.toBe('');
  expect(x.act.files.get(raced)).toBe('// user concurrent source');
  expect(x.act.writes).not.toContain(raced);expect(x.act.writes.length).toBeGreaterThan(0);
 });
 it('keeps identical retry files without attempting exclusive replacement',async()=>{
  vi.stubEnv('AGENTV3_ATHREE_MAP','on');const x=setup([]);expect((await x.run()).is_error).not.toBe(true);
  x.act.beforeExclusive=()=>{throw Error('identical retry must not create');};
  const before=x.act.writes.length;expect((await x.run()).is_error).not.toBe(true);expect(x.act.writes).toHaveLength(before);
 });
 it('retains explicit core-only selection for composed worlds',async()=>{
  vi.stubEnv('AGENTV3_ATHREE_MAP','on');const x=setup([]),r=await x.run();
  expect(r.is_error).not.toBe(true);expect(x.act.files.has('src/game/athree/requestedWorld.ts')).toBe(true);
  expect(x.act.files.has('src/game/athree/ocean.ts')).toBe(false);
  expect(x.act.files.has('src/game/athree/vehicles.ts')).toBe(false);
 });
 it('retains the native request-driven module selector when include is omitted',async()=>{
  vi.stubEnv('AGENTV3_ATHREE_MAP','on');const x=setup(undefined,'Build an Athree 3D open world game with roads and a dog'),r=await x.run();
  expect(r.is_error).not.toBe(true);expect(x.act.files.has('src/game/athree/roadmesh.ts')).toBe(true);
  expect(x.act.files.has('src/game/athree/ocean.ts')).toBe(false);
  expect(x.act.files.has('src/game/athree/vehicles.ts')).toBe(false);
 });
 it.each([
  {prompt:'Build an Athree 3D open world game with a river and no trees',include:undefined},
  {prompt:'Build an Athree 3D open world game with a river and no trees',include:['rivers','plants']},
  {prompt:'Build an Athree 3D open world game: nadi chahiye ped nahi',include:['rivers','plants']},
 ])('honors negative user intent even when recipe include asks for denied modules: %j',async({prompt,include})=>{
  vi.stubEnv('AGENTV3_ATHREE_MAP','on');const x=setup(include,prompt),r=await x.run();
  if(include?.includes('plants')){expect(r.is_error).toBe(true);expect(x.act.writes).toHaveLength(0);return;}
  expect(r.is_error).not.toBe(true);
  expect(x.act.files.has('src/game/athree/riverwater.ts')).toBe(true);
  expect(x.act.files.has('src/game/athree/plants.ts')).toBe(false);
 });
 it.each([true,false])('everything-except exclusion reaches generated output, composed=%s',async(composed)=>{
  vi.stubEnv('AGENTV3_ATHREE_MAP','on');const x=setup(undefined,'Build an Athree 3D open world game with everything except roads',composed),r=await x.run();
  expect(r.is_error).not.toBe(true);
  expect(x.act.files.has('src/game/athree/roadmesh.ts')).toBe(false);
  expect(x.act.files.has('src/game/athree/ocean.ts')).toBe(true);
  expect(x.act.files.get('src/game/athree/index.ts')).not.toContain("from './roadmesh'");
 });
 it('does not bypass no-vehicles intent via a visual car composition adapter',async()=>{
  vi.stubEnv('AGENTV3_ATHREE_MAP','on');const x=setup([], 'Build an Athree 3D open world with no cars',true,{...composition,objects:[{kind:'car',count:1}]}),r=await x.run();
  expect(r.is_error).toBe(true);expect(r.content).toContain('excluded vehicles');expect(x.act.writes).toHaveLength(0);
 });
 it.each([
  {prompt:'अथ्री ओपन वर्ल्ड गेम में नदी और पेड़',plants:true,rivers:true},
  {prompt:'अथ्री ओपन वर्ल्ड गेम में नदी चाहिए, पेड़ नहीं',plants:false,rivers:true},
  {prompt:'Build Athree open world game: nadi aur ped',plants:true,rivers:true},
 ])('Hindi/Hinglish intent reaches exact optional generated modules: %j',async({prompt,plants,rivers})=>{
  vi.stubEnv('AGENTV3_ATHREE_MAP','on');const x=setup(undefined,prompt,false),r=await x.run();
  expect(r.is_error).not.toBe(true);
  expect(x.act.files.has('src/game/athree/plants.ts')).toBe(plants);
  expect(x.act.files.has('src/game/athree/riverwater.ts')).toBe(rivers);
  expect(x.act.files.has('src/game/athree/ocean.ts')).toBe(false);
  expect(x.act.files.has('src/game/athree/sky.ts')).toBe(false);
  expect(x.act.files.has('src/game/athree/vehicles.ts')).toBe(false);
 });
 it('does not activate the disabled feature',async()=>{
  vi.stubEnv('AGENTV3_ATHREE_MAP','off');const x=setup(),r=await x.run();
  expect(r.is_error).toBe(true);expect(x.act.writes).toHaveLength(0);
 });
 it('propagates transient preflight reads before writing',async()=>{
  vi.stubEnv('AGENTV3_ATHREE_MAP','on');const x=setup();
  x.act.intercept=(path)=>{if(path.endsWith('noise.ts'))throw Error('temporary unavailable')};
  const r=await x.run();expect(r.is_error).toBe(true);expect(x.act.writes).toHaveLength(0);expect(r.content).toContain('temporary unavailable');
 });
 it('preserves differing source present before preflight',async()=>{
  vi.stubEnv('AGENTV3_ATHREE_MAP','on');const x=setup();x.act.files.set('src/game/three/objects.ts','user customized models');
  const r=await x.run();expect(r.is_error).toBe(true);expect(x.act.writes).toHaveLength(0);
  expect(x.act.files.get('src/game/three/objects.ts')).toBe('user customized models');
 });
 it('does not refresh source created after preflight and does not claim complete installation',async()=>{
  vi.stubEnv('AGENTV3_ATHREE_MAP','on');const x=setup();
  x.act.intercept=(path,n)=>{if(path==='src/game/athree/noise.ts'&&n===2)x.act.files.set(path,'concurrent custom terrain')};
  const r=await x.run();expect(r.is_error).toBe(true);expect(r.content).toContain('changed existing source');
  expect(x.act.files.get('src/game/athree/noise.ts')).toBe('concurrent custom terrain');expect(x.act.writes).toHaveLength(0);
 });
 it('publishes complete additive modules only after readback succeeds',async()=>{
  vi.stubEnv('AGENTV3_ATHREE_MAP','on');const x=setup(),r=await x.run();
  expect(r.is_error).not.toBe(true);expect(r.content).toContain('Added the Athree map');
  expect(x.act.files.get('src/game/athree/requestedWorld.ts')).toContain('createRequestedWorld');
 });
 it('reports failure rather than completion when a late conflict leaves earlier new files',async()=>{
  vi.stubEnv('AGENTV3_ATHREE_MAP','on');const x=setup();
  x.act.intercept=(path,n)=>{if(path==='src/game/athree/config.ts'&&n===2)x.act.files.set(path,'late custom config')};
  const r=await x.run();expect(r.is_error).toBe(true);expect(r.content).toContain('Earlier new files may exist');
  expect(x.act.writes).toContain('src/game/athree/noise.ts');
  expect(x.act.files.get('src/game/athree/config.ts')).toBe('late custom config');
 });

 it('does not skip dependency readiness when package.json is absent',async()=>{
  vi.stubEnv('AGENTV3_ATHREE_MAP','on');const x=setup();x.act.files.delete('package.json');
  const r=await x.run();expect(r.is_error).toBe(true);expect(x.act.writes).toHaveLength(0);
 });
 it('does not report runnable success when missing Three fails to install',async()=>{
  vi.stubEnv('AGENTV3_ATHREE_MAP','on');const x=setup();
  x.act.files.set('package.json',JSON.stringify({dependencies:{}}));
  x.act.commandResult={exitCode:1,stdout:'',stderr:'registry unavailable'};
  const r=await x.run();expect(r.is_error).toBe(true);expect(r.content).toContain('dependencies are not ready');
 });

 it('does not treat an unreadable dependency manifest as already ready',async()=>{
  vi.stubEnv('AGENTV3_ATHREE_MAP','on');const x=setup();
  x.act.files.set('package.json',JSON.stringify({dependencies:{}}));
  x.act.intercept=(path,n)=>{if(path==='package.json'&&n===2)throw Error('transient manifest read')};
  const r=await x.run();expect(r.is_error).toBe(true);
  expect(r.content).not.toContain('Added the Athree map');expect(r.content).toContain('dependency is not verified');
 });

});
