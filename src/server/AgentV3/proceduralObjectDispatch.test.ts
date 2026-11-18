import * as THREE from 'three';
import ts from 'typescript';
import {runInNewContext} from 'node:vm';
import {findInCatalog} from '../lib/heroObjectSpec';
import {describe,it,expect,afterEach,vi} from 'vitest';
import {ToolDispatcher,type ActuatorPort} from './ToolDispatcher';
import {AgentEventStream} from './AgentEventStream';
import {WorkspaceState} from './WorkspaceState';
import {generateProceduralObject} from '../lib/proceduralObjects/recipe';
import {readFileSync} from 'node:fs';
import {PROCEDURAL_OBJECT_SOURCE} from '../lib/proceduralObjects/runtimeSource';
class Memory implements ActuatorPort {
 files=new Map<string,string>([['package.json',JSON.stringify({dependencies:{three:'0.180.0'},devDependencies:{'@types/three':'0.180.0'}})]]);writes:string[]=[];reads=new Map<string,number>();
 intercept?:(path:string,count:number)=>void;
 exclusiveIntercept?:(path:string)=>void;
 async createFileExclusive(_w:string,p:string,s:string){this.exclusiveIntercept?.(p);if(this.files.has(p))throw Error('EEXIST: '+p);this.files.set(p,s);this.writes.push(p);}
 async readFile(_w:string,p:string){const n=(this.reads.get(p)??0)+1;this.reads.set(p,n);this.intercept?.(p,n);const v=this.files.get(p);if(v===undefined)throw Error('ENOENT: '+p);return v;}
 async writeFile(_w:string,p:string,s:string){this.files.set(p,s);this.writes.push(p);}
 async listFiles(){return [...this.files.keys()];}
 async runCommand(){return {exitCode:0,stdout:'',stderr:''};}
 async getPortUrl(){return 'https://sandbox.example.invalid';}
}
const plan_json=JSON.stringify({version:1,label:'Original windmill',parts:[{id:'body',geometry:{kind:'box',size:[1,2,1]},position:[0,0,0],rotation:[0,0,0],color:'#887766',roughness:.8,metalness:0}]});
const args={id:'windmill',quality:'phone',plan_json};
function setup(){const act=new Memory(),events=new AgentEventStream(),d=new ToolDispatcher(act,'procedural-test',new WorkspaceState(events),events);d.setCoverageRequest('Build a 3D game with an original windmill');return {act,run:(params=args)=>d.dispatch({id:'object',name:'run_recipe',input:{name:'generate_procedural_object',input:params}},'architect')};}
afterEach(()=>vi.unstubAllEnvs());
describe('procedural object guarded recipe',()=>{
 it('missing named object goes through dispatcher persistence placement and host gameplay simulation',async()=>{
  vi.stubEnv('AGENTV3_PROCEDURAL_OBJECTS','on');
  const name='hexapetal flux beacon';expect(findInCatalog(name)).toBeUndefined();
  const plan={version:1,label:name,parts:[
   {id:'body',geometry:{kind:'lathe',points:[[0,-1],[.6,0],[.2,1]],segments:12},position:[0,0,0],rotation:[0,0,0],color:'#887766',roughness:.8,metalness:0},
   {id:'rotor',geometry:{kind:'box',size:[2,.1,.2]},position:[0,1,0],rotation:[0,0,0],color:'#22aaff',roughness:.3,metalness:.5}
  ]};
  const x=setup();const result=await x.run({id:'flux-beacon',quality:'phone',plan_json:JSON.stringify(plan)});
  expect(result.is_error).not.toBe(true);
  function trustedModule(source:string){const exports:Record<string,any>={};runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,TextEncoder,AggregateError});return exports;}
  const runtime=trustedModule(x.act.files.get('src/game/generatedObjects/runtime.ts')!);
  const factory=trustedModule(x.act.files.get('src/game/generatedObjects/flux-beacon.ts')!);
  const scene=new THREE.Scene(),adapter=runtime.createProceduralObjectAdapter(THREE,scene,{maxTriangles:2000,maxDrawCalls:8});
  const object=factory.addGeneratedObject(adapter);object.place(3,1,4);
  const rotor=object.group.getObjectByName('rotor') as THREE.Mesh;
  expect(object.group.position.toArray()).toEqual([3,1,4]);expect(rotor.geometry.attributes.position.count).toBeGreaterThan(0);
  // Host-authored interaction, not automatic gameplay from the geometry compiler.
  let activated=false,score=0;const player=new THREE.Vector3(100,1,4);
  const use=()=>{if(player.distanceTo(object.group.position)>2||activated)return false;activated=true;score++;return true;};
  const tick=(dt:number)=>{if(activated)rotor.rotation.y+=Math.min(Math.max(dt,0),.05)*2;};
  expect(use()).toBe(false);player.set(3,1,4);expect(use()).toBe(true);expect(use()).toBe(false);tick(.016);
  expect(score).toBe(1);expect(rotor.rotation.y).toBeCloseTo(.032);expect(scene.children).toContain(object.group);
  object.dispose();expect(scene.children).toHaveLength(0);expect(adapter.usage().objects).toBe(0);adapter.dispose();
 });
 it('final read to write race uses atomic creation and preserves new user source',async()=>{vi.stubEnv('AGENTV3_PROCEDURAL_OBJECTS','on');const x=setup();x.act.exclusiveIntercept=p=>{if(p.endsWith('/windmill.ts'))x.act.files.set(p,'concurrent final-window user edit');};const r=await x.run();expect(r.is_error).toBe(true);expect(r.content).not.toContain('source_installed');expect(r.content).toContain('Earlier new files may exist');expect(x.act.files.has('src/game/generatedObjects/runtime.ts')).toBe(true);expect(x.act.files.get('src/game/generatedObjects/windmill.ts')).toBe('concurrent final-window user edit');});
 it('refuses unsupported atomic capability before writes',async()=>{vi.stubEnv('AGENTV3_PROCEDURAL_OBJECTS','on');const x=setup();(x.act as any).createFileExclusive=undefined;expect((await x.run()).is_error).toBe(true);expect(x.act.writes).toHaveLength(0);});
 it('runtime mirror exactly matches tested compiler',()=>expect(PROCEDURAL_OBJECT_SOURCE.split('export interface SceneBudget')[0].replace("import type * as Three from 'three';\n",'')).toBe(readFileSync(new URL('../lib/proceduralObjects/validatePlan.ts',import.meta.url),'utf8')));
 it('is disabled by default with no writes',async()=>{vi.stubEnv('AGENTV3_PROCEDURAL_OBJECTS','off');const x=setup(),r=await x.run();expect(r.is_error).toBe(true);expect(x.act.writes).toHaveLength(0);});
 it('existing admitted run_recipe writes and verifies source, not mounted success',async()=>{vi.stubEnv('AGENTV3_PROCEDURAL_OBJECTS','on');const x=setup(),r=await x.run();expect(r.is_error).not.toBe(true);expect(r.content).toContain('source_installed');expect(r.content).toContain('unverified');expect(x.act.files.get('src/game/generatedObjects/windmill.ts')).toContain('adapter.add');expect(x.act.files.has('src/App.tsx')).toBe(false);const count=x.act.writes.length;const retry=await x.run();expect(retry.is_error).not.toBe(true);expect(x.act.writes.length).toBe(count);});
 it('rejects invalid or executable plans before writes',async()=>{vi.stubEnv('AGENTV3_PROCEDURAL_OBJECTS','on');const x=setup();expect((await x.run({...args,plan_json:'{"code":"eval(x)"}'})).is_error).toBe(true);expect(x.act.writes).toHaveLength(0);});
 it('preserves existing changed source',async()=>{vi.stubEnv('AGENTV3_PROCEDURAL_OBJECTS','on');const x=setup();x.act.files.set('src/game/generatedObjects/windmill.ts','custom project');expect((await x.run()).is_error).toBe(true);expect(x.act.writes).toHaveLength(0);});
 it('transient read failure is not treated as absent',async()=>{vi.stubEnv('AGENTV3_PROCEDURAL_OBJECTS','on');const x=setup();x.act.intercept=p=>{if(p.endsWith('/runtime.ts'))throw Error('temporary unavailable');};expect((await x.run()).is_error).toBe(true);expect(x.act.writes).toHaveLength(0);});
 it('late concurrent edits are preserved and no installation claimed',async()=>{vi.stubEnv('AGENTV3_PROCEDURAL_OBJECTS','on');const x=setup();x.act.intercept=(p,n)=>{if(p.endsWith('/windmill.ts')&&n===2)x.act.files.set(p,'late user edit');};const r=await x.run();expect(r.is_error).toBe(true);expect(r.content).not.toContain('source_installed');expect(x.act.files.get('src/game/generatedObjects/windmill.ts')).toBe('late user edit');});
 it('rejects unreviewed dependency without package changes',async()=>{vi.stubEnv('AGENTV3_PROCEDURAL_OBJECTS','on');const x=setup();x.act.files.set('package.json',JSON.stringify({dependencies:{three:'0.120.0'}}));expect((await x.run()).is_error).toBe(true);expect(x.act.writes).toHaveLength(0);});
 it('source builder rejects reserved ids and strict extra fields',()=>{expect(()=>generateProceduralObject({...args,id:'runtime'})).toThrow();expect(()=>generateProceduralObject({...args,id:'../x'})).toThrow();expect(()=>generateProceduralObject({...args,url:'https://x'})).toThrow();});
});
