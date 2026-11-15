import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { GAME_ROYALE_RULES } from '../src/server/lib/GameRoyaleFoundationGenerator';
import { generateGameRoyale } from '../src/server/lib/GameRoyaleGenerator';

function rules() {
  const output = ts.transpileModule(GAME_ROYALE_RULES, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as Record<string, any> };
  new Function('exports', 'module', output)(module.exports, module);
  return module.exports;
}
describe('original offline royale practice', () => {
  it('starts two independent bots and resets every round', () => {
    const r = rules(), a = r.initialMatch(), b = r.initialMatch();
    a.bots[0] = 0; expect(b.bots).toEqual([100,100]); expect(b.health).toBe(100); expect(b.elapsed).toBe(0);
  });
  it('shrinks to a finite safe zone, damages outside and terminates', () => {
    const r = rules(), m = r.initialMatch();
    expect(r.zoneRadius(0)).toBe(38); expect(r.zoneRadius(1000)).toBe(4);
    for(let i=0;i<1000;i++)r.stepMatch(m,0.1,40);
    expect(m.result).toBe('lost'); expect(m.health).toBe(0);
    const elapsed=m.elapsed; r.stepMatch(m,0.1,40); expect(m.elapsed).toBe(elapsed);
  });
  it('rejects invalid delta and bounds suspension catchup', () => {
    const r=rules(),m=r.initialMatch();
    for(const delta of [NaN,Infinity,-1,0])r.stepMatch(m,delta,0);
    expect(m.elapsed).toBe(0); r.stepMatch(m,999,0); expect(m.elapsed).toBe(0.1);
  });
  it('cooldown prevents double shots, misses do not damage bots and win is real', () => {
    const r=rules(),m=r.initialMatch(); expect(r.fire(m,null)).toBe(true); expect(m.bots).toEqual([100,100]); expect(r.fire(m,0)).toBe(false);
    for(const bot of [0,0,0,1,1,1]){for(let i=0;i<3;i++)r.stepMatch(m,0.1,0);r.fire(m,bot);}
    r.stepMatch(m,0.1,0); expect(m.result).toBe('won'); expect(r.fire(m,0)).toBe(false);
  });
  it('emits syntactically valid original modules and an honest integration contract', () => {
    const result=generateGameRoyale(); expect(Object.keys(result.files)).toHaveLength(3);
    for(const [path,source] of Object.entries(result.files)) {
      const parsed=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,path.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
      expect((parsed as unknown as {parseDiagnostics:unknown[]}).parseDiagnostics).toEqual([]);
      expect(source).not.toMatch(/https?:\/\/|fetch\(|Math\.random\(/);
    }
    expect(result.instructions).toContain('Not multiplayer'); expect(result.instructions).toContain('preserve existing projects');
  });
  it('uses existing collision/controllers, obstructed camera shots, mobile input, and teardown on restart', () => {
    const f=generateGameRoyale().files, practice=f['src/game/royale/practice.ts'], ui=f['src/game/RoyalePractice.tsx'];
    expect(practice).toContain("from '../play/character'"); expect(practice).toContain('controller.setColliders(solids)');
    expect(practice).toContain('ray.intersectObjects([...solids,...targets],true)[0]');
    expect(practice).toContain('ctx.camera.getWorldDirection(direction)'); expect(practice).toContain("ctx.input.wasPressed('attack')");
    expect(practice).toContain('doorOccupants'); expect(practice).toContain('b.body.dispose()');
    expect(ui).toContain('practice.dispose();game?.dispose()'); expect(ui).toContain('},[run])');
    expect(ui).toContain('setRun(n=>n+1)'); expect(ui).toContain('WebGL-capable browser');
  });
});

// Drive the actual emitted adapter without WebGL. Only kit construction/controller
// physics are substituted; Three's raycaster and transform hierarchy are real.
import * as THREE from 'three';
import { GAME_ROYALE_PRACTICE } from '../src/server/lib/GameRoyaleGenerator';
function adapterHarness() {
  let disposedBodies=0;
  class Controller {
    object=new THREE.Object3D(); speed=0; isGrounded=true;
    reset(x:number,y:number,z:number){this.object.position.set(x,y,z);}
    setColliders() {} update() {}
  }
  const emitted=ts.transpileModule(GAME_ROYALE_PRACTICE,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{} as any};
  const kit:Record<string,unknown>={
    three:THREE, './rules':rules(),
    '../three/world':{createTerrain:()=>{const g=new THREE.PlaneGeometry(90,90);g.rotateX(-Math.PI/2);return new THREE.Mesh(g,new THREE.MeshBasicMaterial());}},
    '../three/buildings':{createEnterableHouse:()=>new THREE.Group()},
    '../play/character':{CharacterController:Controller},
    '../three/humanoid':{createHumanoid:()=>({root:new THREE.Group(),update(){},dispose(){disposedBodies++;}})},
  };
  new Function('require','exports','module',emitted)((name:string)=>{if(!(name in kit))throw Error(name);return kit[name];},module.exports,module);
  let status:any;
  const practice=module.exports.createPractice((s:any)=>{status=s;});
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
  const player=new Controller(); scene.add(player.object);
  let attacking=false;
  const ctx={scene,camera,player,input:{wasPressed:()=>attacking}};
  const solids=practice.options.setup(ctx);
  camera.position.set(0,1.1,18);camera.lookAt(-8,1.1,-15);camera.updateMatrixWorld(true);
  return {practice,ctx,scene,solids,get status(){return status;},get disposedBodies(){return disposedBodies;},tick(attack=false){attacking=attack;practice.options.update(ctx,0.1);}};
}
describe('emitted royale camera collision and cleanup',()=>{
  it('camera-directed shots hit a bot only after cooldown, with real raycasting',()=>{
    const h=adapterHarness();
    for(let shot=0;shot<3;shot++){h.tick(true);for(let i=0;i<3;i++)h.tick();}
    expect(h.status.bots).toBe(1);expect(h.status.shots).toBe(3);
    h.practice.dispose();h.practice.dispose();expect(h.disposedBodies).toBe(2);
  });
  it('a wall in the line of sight absorbs shots instead of damaging the bot',()=>{
    const h=adapterHarness();const wall=new THREE.Mesh(new THREE.BoxGeometry(20,5,1),new THREE.MeshBasicMaterial());wall.position.set(0,2,0);h.scene.add(wall);h.solids.push(wall);
    for(let shot=0;shot<3;shot++){h.tick(true);for(let i=0;i<3;i++)h.tick();}
    expect(h.status.bots).toBe(2);expect(h.status.shots).toBe(3);h.practice.dispose();
  });
});

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GAME_RECIPES } from '../src/server/lib/gameRecipeLayers';
it('typechecks new emitted modules against the real generated kit with strict TypeScript',()=>{
  const dir=join(__dirname,`.tmp-royale-compile-${process.pid}`);
  const own=generateGameRoyale().files;
  const files:Record<string,string>=Object.assign({},...Object.values(GAME_RECIPES).map(g=>g().files),own);
  // Generated projects use the kit's structural Three contract; this repository does not install @types/three.
  const names=new Set<string>(); for(const source of Object.values(files))for(const match of source.matchAll(/THREE\.([A-Za-z_]\w*)/g))names.add(match[1]);
  files['three-shim.d.ts']=`declare module 'three' {\n${[...names].map(n=>`export const ${n}: any; export type ${n}<A=any,B=any,C=any,D=any> = any;`).join('\n')}\n}`;
  try {
    for(const [path,source] of Object.entries(files)){const p=join(dir,path);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,source);}
    const program=ts.createProgram(Object.keys(files).filter(p=>/\.tsx?$/.test(p)).map(p=>join(dir,p)),{
      target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
      lib:['lib.esnext.d.ts','lib.dom.d.ts','lib.dom.iterable.d.ts'],jsx:ts.JsxEmit.ReactJSX,
      strict:true,noEmit:true,skipLibCheck:true,types:[],allowImportingTsExtensions:true,
    });
    const paths=new Set([...Object.keys(own),'src/game/Game.ts'].map(p=>join(dir,p)));
    const diagnostics=ts.getPreEmitDiagnostics(program).filter(d=>d.file && paths.has(d.file.fileName)).map(d=>ts.flattenDiagnosticMessageText(d.messageText,' '));
    expect(diagnostics).toEqual([]);
  } finally {rmSync(dir,{recursive:true,force:true});}
},20000);
