/** Trusted, bounded procedural geometry. Provider output is data, never code.
 * No textures, URLs, shaders, animation, physics or arbitrary hierarchy accepted.
 */
type Vec = [number, number, number];
type Geometry = { kind: 'box'; size: Vec } | { kind: 'sphere'; radius: number; segments: number; rings: number } | { kind: 'cylinder'; top: number; bottom: number; height: number; segments: number } | { kind: 'lathe'; points: [number, number][]; segments: number };
export interface ObjectPlan { version: 1; label: string; parts: { id: string; geometry: Geometry; position: Vec; rotation: Vec; color: string; roughness: number; metalness: number }[] }
export type ObjectQuality = 'phone' | 'desktop';
const LIMITS = { phone: { parts: 24, triangles: 12000 }, desktop: { parts: 64, triangles: 60000 } };
function fail(): never { throw new Error('Invalid or over-budget procedural object plan.'); }
function record(x: unknown, fields: string[]): Record<string, unknown> {
 if (!x || typeof x !== 'object' || Array.isArray(x) || Object.getPrototypeOf(x) !== Object.prototype) fail();
 const r = x as Record<string,unknown>;
 if(Object.keys(r).length !== fields.length || Object.keys(r).some(k=>!fields.includes(k))) fail();
 return r;
}
function num(x:unknown,min:number,max:number):number { if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max)fail(); return x; }
function integer(x:unknown,min:number,max:number):number { const n=num(x,min,max);if(!Number.isInteger(n))fail();return n; }
function vec(x:unknown,min:number,max:number):Vec { if(!Array.isArray(x)||x.length!==3)fail();return x.map(n=>num(n,min,max)) as Vec; }
function text(x:unknown,re:RegExp):string {if(typeof x!=='string'||!re.test(x))fail();return x;}
/** Bound bytes/depth before JSON.parse; reject nested payload bombs even in unknown fields. */
function decode(raw:string):unknown {
 if(typeof raw!=='string'||raw.length>32768||new TextEncoder().encode(raw).length>32768)fail();
 let depth=0,quoted=false,escaped=false;
 for(const c of raw){if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}else if(c==='"')quoted=true;else if(c==='{'||c==='['){if(++depth>8)fail();}else if(c==='}'||c===']'){if(--depth<0)fail();}}
 try{return JSON.parse(raw);}catch{fail();}
}
export function validateObjectPlan(raw:string,quality:ObjectQuality='phone'):{plan:ObjectPlan; triangles:number; drawCalls:number} {
 if(quality!=='phone'&&quality!=='desktop')fail();
 const root=record(decode(raw),['version','label','parts']);if(root.version!==1)fail();
 const label=text(root.label,/^[^\u0000-\u001f\u007f]{1,80}$/u);
 if(!Array.isArray(root.parts)||root.parts.length<1||root.parts.length>LIMITS[quality].parts)fail();
 let triangles=0;const ids=new Set<string>();
 const parts=root.parts.map(rawPart=>{
  const p=record(rawPart,['id','geometry','position','rotation','color','roughness','metalness']);
  const id=text(p.id,/^[a-z][a-z0-9_-]{0,31}$/);if(ids.has(id))fail();ids.add(id);
  const position=vec(p.position,-50,50),rotation=vec(p.rotation,-Math.PI*2,Math.PI*2);
  const color=text(p.color,/^#[0-9a-fA-F]{6}$/),roughness=num(p.roughness,0,1),metalness=num(p.metalness,0,1);
  const g=p.geometry as Record<string,unknown>;if(!g||typeof g!=='object')fail();
  let geometry:Geometry, radius:number;
  if(g.kind==='box') {record(g,['kind','size']);const size=vec(g.size,0.001,50);geometry={kind:'box',size};radius=Math.hypot(...size)/2;triangles+=12;}
  else if(g.kind==='sphere') {record(g,['kind','radius','segments','rings']);const r=num(g.radius,0.001,25),segments=integer(g.segments,3,48),rings=integer(g.rings,2,32);geometry={kind:'sphere',radius:r,segments,rings};radius=r;triangles+=2*segments*rings;}
  else if(g.kind==='cylinder') {record(g,['kind','top','bottom','height','segments']);const top=num(g.top,0,25),bottom=num(g.bottom,0,25),height=num(g.height,0.001,50),segments=integer(g.segments,3,48);if(top===0&&bottom===0)fail();geometry={kind:'cylinder',top,bottom,height,segments};radius=Math.hypot(Math.max(top,bottom),height/2);triangles+=4*segments;}
  else if(g.kind==='lathe') {record(g,['kind','points','segments']);if(!Array.isArray(g.points)||g.points.length<2||g.points.length>32)fail();let y=-Infinity;const points=g.points.map(point=>{if(!Array.isArray(point)||point.length!==2)fail();const r=num(point[0],0,25),h=num(point[1],-25,25);if(h<=y)fail();y=h;return [r,h] as [number,number];});if(points.every(p=>p[0]===0))fail();const segments=integer(g.segments,3,48);geometry={kind:'lathe',points,segments};radius=Math.max(...points.map(p=>Math.hypot(...p)));triangles+=2*segments*(points.length-1);}
  else fail();
  // Rotation-invariant bounding sphere; no parent transforms or user scale allowed.
  if(position.some(n=>Math.abs(n)+radius>75))fail();
  if(triangles>LIMITS[quality].triangles)fail();
  return {id,geometry,position,rotation,color,roughness,metalness};
 });
 return {plan:{version:1,label,parts},triangles,drawCalls:parts.length};
}
