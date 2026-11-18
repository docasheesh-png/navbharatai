import { validateObjectPlan } from './validatePlan';
import { PROCEDURAL_OBJECT_SOURCE } from './runtimeSource';
export function generateProceduralObject(input:unknown) {
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Explicit procedural object plan required.');
 const r=input as Record<string,unknown>;
 if(Object.keys(r).some(k=>!['id','quality','plan_json'].includes(k)))throw Error('Unsupported procedural object option.');
 if(typeof r.id!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(r.id)||r.id==='runtime')throw Error('Invalid generated object ID.');
 if(r.quality!=='phone'&&r.quality!=='desktop')throw Error('Explicit object quality required.');
 if(typeof r.plan_json!=='string')throw Error('A bounded JSON plan is required, not executable code.');
 const checked=validateObjectPlan(r.plan_json,r.quality),json=JSON.stringify(checked.plan);
 const files:Record<string,string>={
  'src/game/generatedObjects/runtime.ts':PROCEDURAL_OBJECT_SOURCE,
  ['src/game/generatedObjects/'+r.id+'.ts']:
   "import type { createProceduralObjectAdapter } from './runtime';\n"+
   'const planJson = '+JSON.stringify(json)+';\n'+
   '/** A real scene mount when invoked by the host. No collision or animation supplied. */\n'+
   'export function addGeneratedObject(adapter: ReturnType<typeof createProceduralObjectAdapter>) { return adapter.add(planJson, '+JSON.stringify(r.quality)+'); }\n',
 };
 return {files,triangles:checked.triangles,drawCalls:checked.drawCalls,id:r.id};
}
