import { generateGameRoyaleFoundation } from './GameRoyaleFoundationGenerator';

export const GAME_ROYALE_PRACTICE = `import * as THREE from 'three';
import type { GameContext, GameOptions } from '../Game';
import { createTerrain } from '../three/world';
import { createEnterableHouse } from '../three/buildings';
import { createHumanoid, type Humanoid } from '../three/humanoid';
import { CharacterController } from '../play/character';
import { ARENA_HALF, initialMatch, stepMatch, zoneRadius, fire, hitPlayer, pickUp, nearestCrate, outsideBy, placement, planeX, DROP_HEIGHT, DROP_LINE_Z, DROP_SECONDS, FALL_SPEED } from './rules';
export type PracticeStatus = {
  health: number; bots: number; radius: number; result: string; shots: number;
  // EXTRAS (template round R6): armour, kills, the zone warning, the drop, crates for the map, the feed and the end summary.
  armor?: number; kills?: number; outside?: number; phase?: 'plane' | 'falling' | 'ground'; place?: number; cause?: string;
  feed?: string[]; damage?: number; time?: number; x?: number; z?: number; crates?: { x: number; z: number; kind: string }[];
};
export type PracticeOptions = {
  /** Start in the drop plane: jump (Space / Attack / Use) to leave it and steer the fall. Default false: start on the ground. */
  drop?: boolean;
};
export function createPractice(report: (status: PracticeStatus) => void, practiceOptions: PracticeOptions = {}) {
  const match = initialMatch();
  let phase: 'plane' | 'falling' | 'ground' = practiceOptions.drop ? 'plane' : 'ground', planeT = 0, fallY = DROP_HEIGHT;
  const crateMeshes: THREE.Mesh[] = [];
  let plane: THREE.Mesh | undefined;
  const bots: { controller: CharacterController; body: Humanoid; target: THREE.Mesh; timer: number }[] = [];
  const solids: THREE.Object3D[] = [];
  const materials: THREE.Material[] = [];
  let ring: THREE.Mesh | undefined, stopped = false, lastReport = '', shots = 0;
  const ray = new THREE.Raycaster(), direction = new THREE.Vector3();
  const lastPlayer = { x: 0, z: 18 };
  const emit = () => {
    const at = lastPlayer;
    const status: PracticeStatus = { health: Math.ceil(match.health), bots: match.bots.filter(h => h > 0).length, radius: Math.ceil(zoneRadius(match.elapsed)), result: match.result, shots,
      armor: Math.ceil(match.armor), kills: match.kills, outside: Math.ceil(outsideBy(match, Math.hypot(at.x, at.z))), phase, place: placement(match), cause: match.cause,
      feed: match.feed, damage: Math.round(match.damageDealt), time: Math.floor(match.elapsed), x: Math.round(at.x), z: Math.round(at.z),
      crates: match.loot.filter(c => !c.taken).map(c => ({ x: c.x, z: c.z, kind: c.kind })) };
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
      ring = new THREE.Mesh(new THREE.RingGeometry(0.985,1,64),zoneMaterial); ring.rotation.x=-Math.PI/2; ring.position.y=0.04; ctx.scene.add(ring);
      // LOOT CRATES: white medkits, blue armour. Walk over one to take it.
      const crateLooks = { medkit: new THREE.MeshStandardMaterial({ color: 0xf8fafc, emissive: 0x7f1d1d }), armor: new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x1e3a8a }) };
      materials.push(crateLooks.medkit, crateLooks.armor);
      for (const c of match.loot) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.6,0.8), crateLooks[c.kind]); m.position.set(c.x,0.3,c.z); m.name='Loot crate'; ctx.scene.add(m); crateMeshes.push(m); }
      if (phase === 'plane') {
        const planeMaterial = new THREE.MeshStandardMaterial({ color: 0xe5e7eb }); materials.push(planeMaterial);
        plane = new THREE.Mesh(new THREE.BoxGeometry(6,1.2,1.6), planeMaterial); plane.name = 'Drop plane'; ctx.scene.add(plane);
      }
      emit(); return solids;
    },
    update(ctx: GameContext, delta: number) {
      if (stopped || match.result !== 'playing') return;
      const dt = Math.min(0.1, Math.max(0, Number.isFinite(delta) ? delta : 0));
      const player = ctx.player.object.position;
      // THE DROP: ride the plane, jump, then fall (steering as you go) and land; the match starts when you touch down.
      if (phase === 'plane') {
        planeT += dt; const x = planeX(planeT);
        player.set(x, DROP_HEIGHT, DROP_LINE_Z); plane?.position.set(x, DROP_HEIGHT + 2, DROP_LINE_Z);
        if (ctx.input.wasPressed('jump') || ctx.input.wasPressed('attack') || ctx.input.wasPressed('use') || planeT >= DROP_SECONDS) { phase = 'falling'; fallY = DROP_HEIGHT; if (plane) plane.visible = false; }
        lastPlayer.x = player.x; lastPlayer.z = player.z; emit(); return;
      }
      if (phase === 'falling') {
        fallY -= FALL_SPEED * dt;
        player.x = THREE.MathUtils.clamp(player.x,-ARENA_HALF+0.5,ARENA_HALF-0.5); player.z = THREE.MathUtils.clamp(player.z,-ARENA_HALF+0.5,ARENA_HALF-0.5);
        if (fallY <= 0.2) { phase = 'ground'; ctx.player.reset(player.x, 0.2, player.z); } else player.y = fallY;
        lastPlayer.x = player.x; lastPlayer.z = player.z; emit(); return;
      }
      // Keep the bounded arena contract even after a large external impulse.
      player.x = THREE.MathUtils.clamp(player.x,-ARENA_HALF+0.5,ARENA_HALF-0.5); player.z = THREE.MathUtils.clamp(player.z,-ARENA_HALF+0.5,ARENA_HALF-0.5);
      lastPlayer.x = player.x; lastPlayer.z = player.z;
      if (pickUp(match, -1, player.x, player.z)) syncCrates();
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
        // Bots go looting when you are far away, and come for you when you are close.
        const far = Math.hypot(player.x-p.x,player.z-p.z)>12, crate = !outside && far ? nearestCrate(match,p.x,p.z) : null;
        const goal = outside ? { x: 0, z: 0 } : crate ?? player;
        const dx = goal.x-p.x, dz=goal.z-p.z;
        const distance=Math.hypot(dx,dz), move=outside||!!crate||distance>12;
        if (pickUp(match, i, p.x, p.z)) syncCrates();
        b.controller.update(dt,{moveX:move?dx/Math.max(1,distance):0,moveZ:move?dz/Math.max(1,distance):0,sprint:false,jumpPressed:false,jumpHeld:false});
        b.body.root.rotation.y=Math.atan2(dx,dz); b.body.update(dt,b.controller.speed,b.controller.isGrounded);
        if(Math.hypot(p.x,p.z)>zoneRadius(match.elapsed)) match.bots[i]=Math.max(0,match.bots[i]-12*dt);
        b.timer-=dt;
        if(b.timer<=0){ b.timer=1.4; const origin=p.clone().add(new THREE.Vector3(0,1.4,0)); direction.copy(player).add(new THREE.Vector3(0,1.2,0)).sub(origin); const range=direction.length(); ray.set(origin,direction.normalize()); ray.far=range;
          if(range<26 && ray.intersectObjects(solids,true).length===0) hitPlayer(match,7,i);
        }
      }
      stepMatch(match,dt,Math.hypot(player.x,player.z)); const radius=zoneRadius(match.elapsed); ring?.scale.set(radius,radius,1); emit();
    },
  };
  function syncCrates() { match.loot.forEach((c, i) => { if (crateMeshes[i]) crateMeshes[i].visible = !c.taken; }); }
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
    const practice=createPractice(value=>{if(active){result.current=value.result;setStatus(value);if(value.result!=='playing')game?.pause();}},{drop:true});
    try { game=new Game({...practice.options,container:host.current});instance.current=game;game.start();sync(); }
    catch {setError('3D graphics could not start. Try a WebGL-capable browser.');practice.dispose();game?.dispose();}
    return ()=>{active=false;instance.current=null;for(const off of offs)off();window.removeEventListener('keydown',onKey);practice.dispose();game?.dispose();};
  },[run]);
  // THE MAP — the safe zone, crates and you, top-down. Size and colours here.
  const MAP=96, scale=MAP/84, mx=(x:number)=>MAP/2+x*scale, mz=(z:number)=>MAP/2+z*scale;
  const outside=status.outside ?? 0, feed=status.feed ?? [];
  return <section style={{position:'relative',height:'100dvh',minHeight:360,background:'#111827',color:'white',overflow:'hidden'}}>
    <div ref={host} style={{position:'absolute',inset:0}} />
    <div style={{position:'absolute',top:12,left:12,right:12,pointerEvents:'none',fontFamily:'system-ui',textShadow:'0 1px 3px black'}}>
      <strong>Offline Royale Practice · 2 bots</strong><br/>
      Health {status.health}{status.armor ? ' · Armour ' + status.armor : ''} · Bots {status.bots} · Kills {status.kills ?? 0} · Safe radius {status.radius}m<br/>
      <small>Move: WASD / joystick · Aim: mouse / right drag · Attack: click / Attack · Door: E / Use</small>
    </div>
    <div aria-hidden="true" style={{position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-50%)',pointerEvents:'none',fontSize:24}}>+</div>
    <div aria-live="polite" style={{position:'absolute',top:100,left:12,pointerEvents:'none'}}>Shots fired: {status.shots}</div>
    {status.phase==='plane' && <div role="status" style={{position:'absolute',top:'30%',left:0,right:0,textAlign:'center',fontSize:20,pointerEvents:'none',textShadow:'0 1px 3px black'}}>✈ In the plane — press Space, Attack or Use to jump</div>}
    {status.phase==='falling' && <div role="status" style={{position:'absolute',top:'30%',left:0,right:0,textAlign:'center',fontSize:18,pointerEvents:'none',textShadow:'0 1px 3px black'}}>🪂 Steer with WASD / joystick to where you want to land</div>}
    {outside>0 && status.result==='playing' && <div role="alert" style={{position:'absolute',inset:0,pointerEvents:'none',boxShadow:'inset 0 0 80px 20px #dc2626aa'}}>
      <div style={{position:'absolute',top:150,left:0,right:0,textAlign:'center',fontWeight:700,textShadow:'0 1px 3px black'}}>Outside the zone — move {outside} m toward the centre</div>
    </div>}
    <div aria-hidden="true" style={{position:'absolute',right:12,bottom:12,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6,pointerEvents:'none'}}>
      {feed.map((line,i)=><span key={i} style={{background:'#0009',padding:'2px 8px',borderRadius:6,fontSize:13}}>{line}</span>)}
      <svg width={MAP} height={MAP} style={{background:'#14532dcc',borderRadius:8}}>
        <circle cx={MAP/2} cy={MAP/2} r={status.radius*scale} fill="none" stroke="#54d9ff" strokeWidth={2} />
        {(status.crates ?? []).map((c,i)=><rect key={i} x={mx(c.x)-2} y={mz(c.z)-2} width={4} height={4} fill={c.kind==='medkit'?'#f8fafc':'#3b82f6'} />)}
        {status.x!==undefined && status.z!==undefined && <circle cx={mx(status.x)} cy={mz(status.z)} r={3} fill="#facc15" />}
      </svg>
    </div>
    {!error && status.result==='playing' && !paused && <button type="button" aria-label="Pause practice" onClick={()=>instance.current?.pause()} style={{position:'absolute',top:128,right:12,minWidth:48,minHeight:48}}>Pause</button>}
    {!error && status.result==='playing' && paused && <div role="dialog" aria-label="Practice paused" style={{position:'absolute',inset:0,display:'grid',placeItems:'center',background:'#0009',zIndex:20}}><button type="button" onClick={resume} style={{padding:'16px 28px',minHeight:48}}>Resume practice</button></div>}
    {(error || status.result!=='playing') && <div style={{position:'absolute',inset:0,display:'grid',placeItems:'center',background:'#0009',zIndex:20}}><div role="status" style={{padding:20,background:'#142032',borderRadius:12,textAlign:'center'}}>
      <p>{error || (status.result==='won'?'Practice complete!':'Round over')}</p>
      {!error && status.place!==undefined && <p style={{fontSize:14,opacity:0.9}}>
        #{status.place} of 3 · Kills {status.kills ?? 0} · Damage {status.damage ?? 0} · {status.time ?? 0}s
        {status.cause ? ' · Out by ' + (status.cause==='zone' ? 'the zone' : status.cause) : ''}
      </p>}
      <button onClick={()=>setRun(n=>n+1)} style={{padding:'12px 24px'}}>Restart practice</button>
    </div></div>}
  </section>;
}
`;
export function generateGameRoyale() {
  const base = generateGameRoyaleFoundation();
  return { files: { ...base.files, 'src/game/royale/practice.ts': GAME_ROYALE_PRACTICE, 'src/game/RoyalePractice.tsx': GAME_ROYALE_COMPONENT }, dependencies: base.dependencies, instructions: [
    'Mount RoyalePractice inside the existing game kit. Original offline two-bot practice only: bounded flat procedural arena, one enterable house, shrinking zone, a drop plane, loot crates (medkits, armour) that bots also loot, a zone warning, a map, a kill feed and an end summary, touch controls and full restart. Not multiplayer, not photorealism. No billing or external assets. Enable only for a new explicitly selected recipe; preserve existing projects.',
    'For a new explicitly selected project, render the supplied component from src/App.tsx. It owns Game creation, pause/restart, and teardown; do not start a second Game instance alongside it.',
    '```tsx',
    "import RoyalePractice from './game/RoyalePractice';",
    'export default function App() {',
    '  return <RoyalePractice />;',
    '}',
    '```',
  ].join('\n') };
}
