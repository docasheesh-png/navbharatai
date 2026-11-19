import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import * as THREE from 'three';
import * as hooks from './helpers/hookRuntime';
import { GAME_ROYALE_COMPONENT } from '../src/server/lib/GameRoyaleGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
function load(source:string,modules:Record<string,unknown>) {
  const exports:Record<string,any>={};
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
  new Function('require','exports',js)((name:string)=>{if(!(name in modules))throw Error(name);return modules[name];},exports);return exports;
}
function bus(){const listeners=new Map<string,Set<()=>void>>();return {
  on(name:string,fn:()=>void){let set=listeners.get(name);if(!set)listeners.set(name,set=new Set());set.add(fn);return ()=>set!.delete(fn);},
  emit(name:string){for(const fn of listeners.get(name)??[])fn();},clear(){listeners.clear();},size(){return [...listeners.values()].reduce((sum,s)=>sum+s.size,0);}
};}
describe('emitted RoyalePractice pause lifecycle',()=>{
  it('background pause resumes explicitly, terminal pause cannot resume, restart/unmount clean subscriptions',()=>{
    const events=bus(),state={status:'menu'};let report:(s:any)=>void=()=>{};
    let current:any,disposed=0;const documentMock={hidden:false},windowMock=new EventTarget();
    vi.stubGlobal('document',documentMock);vi.stubGlobal('window',windowMock);
    const status={health:100,bots:2,radius:38,result:'playing',shots:0};
    class Game { resumeCalls=0; constructor(){current=this;} start(){state.status='playing';events.emit('GAME_STARTED');} pause(){state.status='paused';events.emit('GAME_PAUSED');} resume(){this.resumeCalls++;state.status='playing';events.emit('GAME_RESUMED');} dispose(){disposed++;} }
    let firstRef:unknown;
    const react={...hooks,useRef(init:unknown){const r=hooks.useRef(init);if(!firstRef){firstRef=r;r.current={};}return r;}};
    const {default:Component}=load(GAME_ROYALE_COMPONENT,{react:{...react,default:react},'./Game':{Game},'./core/state':{state,resetRun(){state.status='menu';}},'./core/events':{events},'./royale/practice':{createPractice(fn:(s:any)=>void){report=fn;fn({...status});return {options:{},dispose(){}};}}});
    const mounted=hooks.mount(Component);
    const click=(text:string)=>{const b=hooks.findAll(mounted.tree(),n=>n.type==='button'&&hooks.textOf(n.children)===text)[0];expect(b).toBeDefined();(b.props.onClick as ()=>void)();};
    try {
      documentMock.hidden=true;current.pause();expect(hooks.textOf(mounted.tree())).toContain('Resume practice');
      click('Resume practice');expect(current.resumeCalls).toBe(0);
      documentMock.hidden=false;click('Resume practice');expect(current.resumeCalls).toBe(1);expect(hooks.textOf(mounted.tree())).not.toContain('Resume practice');
      report({...status,result:'won'});expect(hooks.textOf(mounted.tree())).toContain('Practice complete!');expect(hooks.textOf(mounted.tree())).not.toContain('Resume practice');
      const old=current;windowMock.dispatchEvent(Object.assign(new Event('keydown'),{key:'Escape'}));expect(old.resumeCalls).toBe(1);
      click('Restart practice');expect(disposed).toBe(1);expect(current).not.toBe(old);expect(hooks.textOf(mounted.tree())).not.toContain('Resume practice');expect(events.size()).toBe(3);
      mounted.unmount();expect(disposed).toBe(2);expect(events.size()).toBe(0);
      windowMock.dispatchEvent(Object.assign(new Event('keydown'),{key:'Escape'}));expect(state.status).toBe('playing');
    } finally {mounted.unmount();vi.unstubAllGlobals();}
  });
});

function shellHarness(fail:'renderer'|'setup'|null) {
  const events=bus();let renderDisposals=0,inputDisposals=0,observerOff=0;
  const documentMock=Object.assign(new EventTarget(),{hidden:false,createElement:()=>Object.assign(new EventTarget(),{style:{},focus(){},parentElement:null as any})});
  const children:any[]=[];const container={appendChild(c:any){children.push(c);c.parentElement=container;},removeChild(c:any){children.splice(children.indexOf(c),1);c.parentElement=null;}};
  vi.stubGlobal('document',documentMock);
  class Input {axis(){return {x:0,y:0};}isDown(){return false;}wasPressed(){return false;}wasReleased(){return false;}dispose(){inputDisposals++;}}
  class Controller {object=new THREE.Object3D();}
  const state={status:'playing'};
  const {Game}=load(generateGameShell().files['src/game/Game.ts'],{
    three:THREE,'./core/loop':{GameLoop:class {stop(){}start(){}setPaused(){}}},'./core/input':{Input},'./core/feel':{GameFeel:class {}},'./core/events':{events},
    './core/state':{state,setStatus(status:string){state.status=status;},resetRun(){}},'./core/meta':{startMeta(){},mountMetaToasts(){return ()=>{};},combo:{break(){}}},
    './three/renderer':{createRenderer(){if(fail==='renderer')throw Error('renderer fail');return {dispose(){renderDisposals++;},getPixelRatio(){return 1;},setPixelRatio(){}};},handleResize(){return ()=>{observerOff++;};}},
    './three/lighting':{applyLighting:()=>({}),followShadow(){}},'./three/materials':{disposeMaterials(){}},'./three/surfaces':{groundScene(){}},
    './three/buildings':{interactHouseDoor(){},updateHouseDoors(){}},'./three/collision':{setSceneColliders(){}},
    './three/camera':{CameraRig:class {camera=new THREE.PerspectiveCamera();setCollisionScene(){}}},'./three/objects':{watchVehicles:(_callback:unknown,fn:()=>unknown)=>fn(),isVehicle:()=>false,setDriftInput:()=>{},notePlayerAxis:()=>{},onVehicleDrift:()=>()=>{}},
    './play/character':{CharacterController:Controller},'./three/humanoid':{createHumanoid:()=>({root:new THREE.Group(),dispose(){}})},
    './fx/particles':{ParticleSystem:class {addTo(){}dispose(){}}},'./fx/audio':{audio:{unlock(){},stopAll(){},setVolume(){}}},'./core/strings':{setGameLanguage(){return 'en';},t:(k:string)=>k},'./core/settings':{settings:{get:()=>({masterVolume:1,musicVolume:1,sfxVolume:1,muted:false,quality:'high',lookSensitivity:1,vibration:true}),subscribe:()=>()=>{}}},'./fx/feedback':{bindGameFeedback:()=>()=>{}},
    './ui/touchControls':{TouchControls:class {dispose(){}},DEFAULT_TOUCH_BUTTONS:[]},
  });
  return {Game,container,children,events,get rendererDisposed(){return renderDisposals;},get inputDisposed(){return inputDisposals;},get observerOff(){return observerOff;},options:{container,touchControls:false,playerBody:false,setup(){if(fail==='setup')throw Error('setup fail');return [];}}};
}
describe('actual emitted Game constructor rollback',()=>{
  it('removes appended canvas when renderer creation throws, including repeated retries',()=>{
    const h=shellHarness('renderer');try{for(let i=0;i<3;i++){expect(()=>new h.Game(h.options)).toThrow('renderer fail');expect(h.children).toHaveLength(0);}}finally{vi.unstubAllGlobals();}
  });
  it('releases acquired renderer, input, observer and scene geometry when setup throws',()=>{
    const h=shellHarness('setup');let geometryDisposed=0;
    try{expect(()=>new h.Game({...h.options,setup(ctx:any){const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());mesh.geometry.dispose=()=>{geometryDisposed++;};ctx.scene.add(mesh);throw Error('setup fail');}})).toThrow('setup fail');
      expect(h.children).toHaveLength(0);expect(h.rendererDisposed).toBe(1);expect(h.inputDisposed).toBe(1);expect(h.observerOff).toBe(1);expect(geometryDisposed).toBe(1);expect(h.events.size()).toBe(0);
    }finally{vi.unstubAllGlobals();}
  });
  it('successful construction still starts and disposal is idempotent',()=>{const h=shellHarness(null);try{const g=new h.Game(h.options);g.start();expect(h.children).toHaveLength(1);g.dispose();g.dispose();expect(h.children).toHaveLength(0);expect(h.rendererDisposed).toBe(1);}finally{vi.unstubAllGlobals();}});
});
