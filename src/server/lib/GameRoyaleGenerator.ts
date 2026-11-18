import { generateGameRoyaleFoundation } from './GameRoyaleFoundationGenerator';

export const GAME_ROYALE_PRACTICE = `import * as THREE from 'three';
import type { GameContext, GameOptions } from '../Game';
import { createTerrain } from '../three/world';
import { createEnterableHouse } from '../three/buildings';
import { createHumanoid, type Humanoid } from '../three/humanoid';
import { CharacterController } from '../play/character';
import { ARENA_HALF, initialMatch, stepMatch, zoneRadius, fire } from './rules';
export type PracticeStatus = { health: number; bots: number; radius: number; result: string; shots: number };
export function createPractice(report: (status: PracticeStatus) => void) {
  const match = initialMatch();
  const bots: { controller: CharacterController; body: Humanoid; target: THREE.Mesh; timer: number }[] = [];
  const solids: THREE.Object3D[] = [];
  const materials: THREE.Material[] = [];
  let ring: THREE.Mesh | undefined, stopped = false, lastReport = '', shots = 0;
  const ray = new THREE.Raycaster(), direction = new THREE.Vector3();
  const emit = () => {
    const status = { health: Math.ceil(match.health), bots: match.bots.filter(h => h > 0).length, radius: Math.ceil(zoneRadius(match.elapsed)), result: match.result, shots };
    const key = JSON.stringify(status); if (!stopped && key !== lastReport) { lastReport = key; report(status); }
  };
  const options: Omit<GameOptions, 'container'> = {
    camera: 'first-person', playerBody: false, gameId: 'original-royale-practice', shadows: false,
    doorOccupants: () => bots.filter((_, i) => match.bots[i] > 0).map(b => ({ feet: b.controller.object.position, radius: 0.4, height: 1.8 })),
    setup(ctx) {
      const terrain = createTerrain({ size: 90, segments: 24, flat: true }); ctx.scene.add(terrain); solids.push(terrain);
      const material = new THREE.MeshStandardMaterial({ color: 0x777e80, roughness: 0.9 }); materials.push(material);
      for (const [x,z,w,d] of [[0,-43,88,2],[0,43,88,2],[-43,0,2,88],[43,0,2,88]]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(w,4,d), material); wall.position.set(x,2,z); wall.userData.collider = true; ctx.scene.add(wall); solids.push(wall);
      }
      const house = createEnterableHouse({ width: 8, depth: 8, storeys: 1 }); house.position.set(-12,0,-5); ctx.scene.add(house); solids.push(house);
      ctx.player.reset(0,0.2,18);
      for (const [i,x] of [-8,8].entries()) {
        const controller = new CharacterController({ config: { maxSpeed: 2.2 } }); controller.reset(x,0.2,-15); ctx.scene.add(controller.object); controller.setColliders(solids);
        const body = createHumanoid({ shirt: i ? 0xc59d36 : 0xb24949 }); controller.object.add(body.root);
        const targetMaterial = new THREE.MeshBasicMaterial({ visible: false }); materials.push(targetMaterial);
        const target = new THREE.Mesh(new THREE.BoxGeometry(0.7,1.8,0.7),targetMaterial); target.position.y=0.9; controller.object.add(target);
        bots.push({controller,body,target,timer:1+i});
      }
      const zoneMaterial = new THREE.MeshBasicMaterial({color:0x54d9ff,transparent:true,opacity:0.7,side:THREE.DoubleSide,depthWrite:false}); materials.push(zoneMaterial);
      ring = new THREE.Mesh(new THREE.RingGeometry(0.985,1,64),zoneMaterial); ring.rotation.x=-Math.PI/2; ring.position.y=0.04; ctx.scene.add(ring); emit(); return solids;
    },
    update(ctx: GameContext, delta: number) {
      if (stopped || match.result !== 'playing') return;
      const dt = Math.min(0.1, Math.max(0, Number.isFinite(delta) ? delta : 0));
      const player = ctx.player.object.position;
      // Keep the bounded arena contract even after a large external impulse.
      player.x = THREE.MathUtils.clamp(player.x,-ARENA_HALF+0.5,ARENA_HALF-0.5); player.z = THREE.MathUtils.clamp(player.z,-ARENA_HALF+0.5,ARENA_HALF-0.5);
      ctx.scene.updateMatrixWorld(true);
      if (ctx.input.wasPressed('attack')) {
        ctx.camera.getWorldDirection(direction); ray.set(ctx.camera.getWorldPosition(new THREE.Vector3()), direction); ray.far=80;
        const targets = bots.filter((_,i)=>match.bots[i]>0).map(b=>b.target);
        const hit = ray.intersectObjects([...solids,...targets],true)[0];
        const index = hit ? bots.findIndex(b=>b.target===hit.object) : -1;
        if (fire(match,index < 0 ? null : index)) shots++;
      }
      for (const [i,b] of bots.entries()) {
        b.controller.object.visible = match.bots[i]>0; if (match.bots[i]<=0) continue;
        const p = b.controller.object.position;
        const outside = Math.hypot(p.x,p.z)>zoneRadius(match.elapsed)-2;
        const dx = (outside ? 0 : player.x)-p.x, dz=(outside ? 0 : player.z)-p.z;
        const distance=Math.hypot(dx,dz), move=outside||distance>12;
        b.controller.update(dt,{moveX:move?dx/Math.max(1,distance):0,moveZ:move?dz/Math.max(1,distance):0,sprint:false,jumpPressed:false,jumpHeld:false});
        b.body.root.rotation.y=Math.atan2(dx,dz); b.body.update(dt,b.controller.speed,b.controller.isGrounded);
        if(Math.hypot(p.x,p.z)>zoneRadius(match.elapsed)) match.bots[i]=Math.max(0,match.bots[i]-12*dt);
        b.timer-=dt;
        if(b.timer<=0){ b.timer=1.4; const origin=p.clone().add(new THREE.Vector3(0,1.4,0)); direction.copy(player).add(new THREE.Vector3(0,1.2,0)).sub(origin); const range=direction.length(); ray.set(origin,direction.normalize()); ray.far=range;
          if(range<26 && ray.intersectObjects(solids,true).length===0) match.health=Math.max(0,match.health-7);
        }
      }
      stepMatch(match,dt,Math.hypot(player.x,player.z)); const radius=zoneRadius(match.elapsed); ring?.scale.set(radius,radius,1); emit();
    },
  };
  return { options, dispose() { if(stopped)return; stopped=true; for(const b of bots)b.body.dispose(); for(const m of materials)m.dispose(); } };
}
`;

export const GAME_ROYALE_COMPONENT = `import React, { useEffect, useRef, useState } from 'react';
import { Game } from './Game';
import { resetRun, state } from './core/state';
import { events } from './core/events';
import { createPractice, type PracticeStatus } from './royale/practice';
export default function RoyalePractice() {
  const host=useRef<HTMLDivElement>(null);
  const instance=useRef<Game | null>(null), result=useRef('playing');
  const [paused,setPaused]=useState(false);
  const resume=()=>{if(result.current==='playing' && !document.hidden && state.status==='paused')instance.current?.resume();};
  const [run,setRun]=useState(0), [error,setError]=useState('');
  const [status,setStatus]=useState<PracticeStatus>({health:100,bots:2,radius:38,result:'playing',shots:0});
  useEffect(()=>{
    if(!host.current)return;
    let active=true, game:Game|undefined;
    setError(''); setPaused(false); result.current='playing'; resetRun();
    const sync=()=>{if(active)setPaused(state.status==='paused');};
    const offs=['GAME_PAUSED','GAME_RESUMED','GAME_STARTED'].map(event=>events.on(event,sync));
    const onKey=(event:KeyboardEvent)=>{if(event.key!=='Escape' || result.current!=='playing')return; if(state.status==='paused')resume(); else game?.pause();};
    window.addEventListener('keydown',onKey);
    const practice=createPractice(value=>{if(active){result.current=value.result;setStatus(value);if(value.result!=='playing')game?.pause();}});
    try { game=new Game({...practice.options,container:host.current});instance.current=game;game.start();sync(); }
    catch {setError('3D graphics could not start. Try a WebGL-capable browser.');practice.dispose();game?.dispose();}
    return ()=>{active=false;instance.current=null;for(const off of offs)off();window.removeEventListener('keydown',onKey);practice.dispose();game?.dispose();};
  },[run]);
  return <section style={{position:'relative',height:'100dvh',minHeight:360,background:'#111827',color:'white',overflow:'hidden'}}>
    <div ref={host} style={{position:'absolute',inset:0}} />
    <div style={{position:'absolute',top:12,left:12,right:12,pointerEvents:'none',fontFamily:'system-ui',textShadow:'0 1px 3px black'}}>
      <strong>Offline Royale Practice · 2 bots</strong><br/>
      Health {status.health} · Bots {status.bots} · Safe radius {status.radius}m<br/>
      <small>Move: WASD / joystick · Aim: mouse / right drag · Attack: click / Attack · Door: E / Use</small>
    </div>
    <div aria-hidden="true" style={{position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-50%)',pointerEvents:'none',fontSize:24}}>+</div>
    <div aria-live="polite" style={{position:'absolute',top:100,left:12,pointerEvents:'none'}}>Shots fired: {status.shots}</div>
    {!error && status.result==='playing' && !paused && <button type="button" aria-label="Pause practice" onClick={()=>instance.current?.pause()} style={{position:'absolute',top:128,right:12,minWidth:48,minHeight:48}}>Pause</button>}
    {!error && status.result==='playing' && paused && <div role="dialog" aria-label="Practice paused" style={{position:'absolute',inset:0,display:'grid',placeItems:'center',background:'#0009',zIndex:20}}><button type="button" onClick={resume} style={{padding:'16px 28px',minHeight:48}}>Resume practice</button></div>}
    {(error || status.result!=='playing') && <div style={{position:'absolute',inset:0,display:'grid',placeItems:'center',background:'#0009',zIndex:20}}><div role="status" style={{padding:20,background:'#142032',borderRadius:12,textAlign:'center'}}>
      <p>{error || (status.result==='won'?'Practice complete!':'Round over')}</p>
      <button onClick={()=>setRun(n=>n+1)} style={{padding:'12px 24px'}}>Restart practice</button>
    </div></div>}
  </section>;
}
`;
export function generateGameRoyale() {
  const base = generateGameRoyaleFoundation();
  return { files: { ...base.files, 'src/game/royale/practice.ts': GAME_ROYALE_PRACTICE, 'src/game/RoyalePractice.tsx': GAME_ROYALE_COMPONENT }, dependencies: base.dependencies, instructions: [
    'Mount RoyalePractice inside the existing game kit. Original offline two-bot practice only: bounded flat procedural arena, one enterable house, shrinking zone, touch controls and full restart. Not multiplayer, not photorealism. No billing or external assets. Enable only for a new explicitly selected recipe; preserve existing projects.',
    'For a new explicitly selected project, render the supplied component from src/App.tsx. It owns Game creation, pause/restart, and teardown; do not start a second Game instance alongside it.',
    '```tsx',
    "import RoyalePractice from './game/RoyalePractice';",
    'export default function App() {',
    '  return <RoyalePractice />;',
    '}',
    '```',
  ].join('\n') };
}
