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

/**
 * ONLINE ROYALE — the kit's side of a real online match (admin 2026-11-25). The match itself is decided on
 * NavBharatAI's server (src/server/lib/royaleOnline): movement is checked there, and shots, loot, the zone and the
 * winner are decided there. These files only connect, send what the player does, and draw what the server says.
 * Online works for a game opened from the NavBharatAI App Store; anywhere else the screen says so — it never
 * invents opponents. Kit code lives in String.raw templates: no backtick and no dollar-brace inside them.
 */
export const GAME_ROYALE_ONLINE_CLIENT = String.raw`export type OnlinePlayer = { id: string; name: string; bot: boolean };
export type SnapshotPlayer = { id: string; x: number; z: number; yaw: number; hp: number; armor: number; alive: boolean; place: number; ack: number };
export type Snapshot = { time: number; radius: number; players: SnapshotPlayer[]; crates: boolean[]; feed: string[] };
export type Placement = { id: string; name: string; bot: boolean; place: number; kills: number; damage: number; cause: string };
export type MatchEnd = { room: string; winner: string; places: Placement[]; you: Placement | null };
export type StartInfo = { room: string; you: string; arenaHalf: number; cover: number[][]; crates: { x: number; z: number; kind: string }[]; players: (OnlinePlayer & { x: number; z: number })[] };
export type OnlinePhase = 'connecting' | 'unavailable' | 'lobby' | 'queued' | 'playing' | 'reconnecting' | 'ended';
export type OnlineView = { phase: OnlinePhase; reason: string; waiting: number; busy: boolean; you: string; start: StartInfo | null; snapshot: Snapshot | null; result: MatchEnd | null; ping: number };
export type OnlineSocket = { readyState: number; send(data: string): void; close(): void; onmessage: ((e: { data: unknown }) => void) | null; onclose: ((e: { code: number }) => void) | null; onerror: ((e: unknown) => void) | null };

/**
 * The socket address for an API path. A store game runs inside the player's frame, whose base is the PARENT page:
 * on the web that is NavBharatAI itself, but in the Android/iOS app it is the app's local shell, and a socket built
 * from it would dial the phone. So the API origin the store wrote into the page wins; the page base is only the
 * fallback (the website, where the two are the same).
 */
export function resolveWebSocketUrl(path: string): URL {
  const w = window as unknown as { __NBAI_API_ORIGIN?: unknown };
  const api = typeof w.__NBAI_API_ORIGIN === 'string' && /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(w.__NBAI_API_ORIGIN) ? w.__NBAI_API_ORIGIN : '';
  const url = new URL(path, api || document.baseURI);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url;
}

/** Where the match service is. Only a game opened from the NavBharatAI App Store has one; null everywhere else. */
export function onlineEndpoint(): string | null {
  const w = window as unknown as { __NBAI_STORE_APP_ID?: unknown; __NBAI_NAVDATA_TOKEN?: unknown };
  const app = typeof w.__NBAI_STORE_APP_ID === 'string' ? w.__NBAI_STORE_APP_ID : '';
  if (!app) return null;
  const url = resolveWebSocketUrl('/api/royale-online/ws');
  url.searchParams.set('app', app);
  if (typeof w.__NBAI_NAVDATA_TOKEN === 'string') url.searchParams.set('access', w.__NBAI_NAVDATA_TOKEN);
  return url.toString();
}

export const NOT_ON_STORE = 'Online matches work when this game is opened from the NavBharatAI App Store. Publish it, open it there, and play real people. Practice works here.';
export const UNREACHABLE = 'The online match service could not be reached. Check your connection and try again, or play Practice.';
/** How far in the past remote players are drawn, so there are always two snapshots to move between. */
export const INTERPOLATION_MS = 100;
const RECONNECT_TRIES = 5;

export class OnlineClient {
  view: OnlineView = { phase: 'connecting', reason: '', waiting: 0, busy: false, you: '', start: null, snapshot: null, result: null, ping: 0 };
  private socket: OnlineSocket | null = null;
  private token = '';
  private seq = 0;
  private tries = 0;
  private closed = false;
  private pingSent = 0;
  private buffer: { at: number; snap: Snapshot }[] = [];
  private correction: { x: number; z: number } | null = null;
  constructor(private readonly endpoint: string | null, private readonly onChange: (view: OnlineView) => void,
    private readonly open: (url: string) => OnlineSocket = (url) => new WebSocket(url) as unknown as OnlineSocket,
    private readonly clock: () => number = () => performance.now()) {}

  connect(): void {
    if (!this.endpoint) { this.set({ phase: 'unavailable', reason: NOT_ON_STORE }); return; }
    if (this.closed) return;
    const url = this.token ? this.endpoint + '&resume=' + encodeURIComponent(this.token) : this.endpoint;
    let socket: OnlineSocket;
    try { socket = this.open(url); } catch { this.set({ phase: 'unavailable', reason: UNREACHABLE }); return; }
    this.socket = socket;
    let heard = false;
    socket.onmessage = (event) => { heard = true; this.receive(event.data); };
    socket.onerror = () => { /* onclose follows */ };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.closed || this.view.phase === 'unavailable') return; // a refusal the server explained is final
      // A dropped match is retried with the resume token, inside the server's grace window.
      if ((this.view.phase === 'playing' || this.view.phase === 'reconnecting') && this.token && this.tries < RECONNECT_TRIES) {
        this.tries++; this.set({ phase: 'reconnecting' });
        setTimeout(() => this.connect(), 1000 * this.tries);
        return;
      }
      if (event.code === 4429) return; // 'full' already said why
      this.set({ phase: 'unavailable', reason: heard ? 'The connection to the match was lost.' : UNREACHABLE });
    };
  }

  private set(change: Partial<OnlineView>): void { this.view = { ...this.view, ...change }; this.onChange(this.view); }
  private send(message: Record<string, unknown>): void { if (this.socket && this.socket.readyState === 1) this.socket.send(JSON.stringify(message)); }

  private receive(data: unknown): void {
    let m: Record<string, unknown>;
    try { m = JSON.parse(String(data)); } catch { return; }
    switch (m.t) {
      case 'welcome': this.token = String(m.token); this.tries = 0; this.set({ you: String(m.you), phase: m.resumed ? this.view.phase : 'lobby', reason: '' }); this.ping(); break;
      case 'queued': this.set({ phase: 'queued', waiting: Number(m.waiting) || 0, busy: m.busy === true, reason: '' }); break;
      case 'left': this.set({ phase: 'lobby' }); break;
      case 'start': this.buffer = []; this.correction = null; this.set({ phase: 'playing', start: m as unknown as StartInfo, result: null, snapshot: null }); break;
      case 'state': {
        const snap = m as unknown as Snapshot;
        this.buffer.push({ at: this.clock(), snap }); if (this.buffer.length > 10) this.buffer.shift();
        this.set({ snapshot: snap });
        break;
      }
      case 'correct': this.correction = { x: Number(m.x), z: Number(m.z) }; break;
      case 'end': this.set({ phase: 'ended', result: m as unknown as MatchEnd }); break;
      case 'full': this.set({ phase: this.view.phase === 'queued' ? 'lobby' : this.view.phase === 'connecting' ? 'unavailable' : this.view.phase, reason: String(m.reason) }); break;
      case 'unavailable': this.set({ phase: 'unavailable', reason: String(m.reason) }); break;
      case 'pong': this.set({ ping: Math.round(this.clock() - this.pingSent) }); break;
      default: break;
    }
  }

  ping(): void { this.pingSent = this.clock(); this.send({ t: 'ping', id: 1 }); }
  queue(): void { this.send({ t: 'queue' }); }
  leave(): void { this.send({ t: 'leave' }); }
  move(x: number, z: number, yaw: number): void { this.send({ t: 'move', x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, yaw: Math.round(yaw * 100) / 100, seq: ++this.seq }); }
  fire(yaw: number): void { this.send({ t: 'fire', yaw }); }
  /** The server refused a move: where it says the player really is. Read once. */
  takeCorrection(): { x: number; z: number } | null { const c = this.correction; this.correction = null; return c; }
  /** A remote player's position, drawn INTERPOLATION_MS in the past between the two snapshots around that moment. */
  remote(id: string, now: number = this.clock()): SnapshotPlayer | null {
    const at = now - INTERPOLATION_MS, b = this.buffer;
    if (!b.length) return null;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].at > at) i--;
    const later = b[i], earlier = b[Math.max(0, i - 1)];
    const p1 = later.snap.players.find((p) => p.id === id);
    const p0 = earlier.snap.players.find((p) => p.id === id);
    if (!p1) return null;
    if (!p0 || later === earlier || later.at <= earlier.at) return p1;
    const k = Math.min(1, Math.max(0, (at - earlier.at) / (later.at - earlier.at)));
    return { ...p1, x: p0.x + (p1.x - p0.x) * k, z: p0.z + (p1.z - p0.z) * k, yaw: p0.yaw + (p1.yaw - p0.yaw) * k };
  }
  close(): void { this.closed = true; const s = this.socket; this.socket = null; try { s?.close(); } catch { /* already closed */ } }
}
`;

export const GAME_ROYALE_ONLINE_MATCH = String.raw`import * as THREE from 'three';
import type { GameContext, GameOptions } from '../Game';
import { createTerrain } from '../three/world';
import { createHumanoid, type Humanoid } from '../three/humanoid';
import type { OnlineClient } from './onlineClient';
/** How often the player's position goes to the server (the server checks every one of them). */
export const SEND_EVERY_S = 1 / 15;
export function createOnlineMatch(client: OnlineClient) {
  const start = client.view.start;
  if (!start) throw new Error('An online match starts only after the server says so.');
  const others: { id: string; body: Humanoid; holder: THREE.Group; last: { x: number; z: number } }[] = [];
  const crateMeshes: THREE.Mesh[] = [];
  const materials: THREE.Material[] = [];
  const solids: THREE.Object3D[] = [];
  let ring: THREE.Mesh | undefined, stopped = false, sendTimer = 0, lastSent = { x: NaN, z: NaN };
  const direction = new THREE.Vector3();
  const options: Omit<GameOptions, 'container'> = {
    camera: 'first-person', playerBody: false, gameId: 'original-royale-online', shadows: false,
    setup(ctx: GameContext) {
      const terrain = createTerrain({ size: start.arenaHalf * 2 + 6, segments: 24, flat: true }); ctx.scene.add(terrain); solids.push(terrain);
      const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x777e80, roughness: 0.9 }); materials.push(wallMaterial);
      const h = start.arenaHalf + 1;
      for (const [x, z, w, d] of [[0, -h, 2 * h, 2], [0, h, 2 * h, 2], [-h, 0, 2, 2 * h], [h, 0, 2, 2 * h]]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 4, d), wallMaterial); wall.position.set(x, 2, z); wall.userData.collider = true; ctx.scene.add(wall); solids.push(wall);
      }
      // COVER: the same blocks the server uses for movement and for every shot's line of fire.
      const coverMaterial = new THREE.MeshStandardMaterial({ color: 0x8b6f47, roughness: 0.8 }); materials.push(coverMaterial);
      for (const [a, b, c, d] of start.cover) {
        const block = new THREE.Mesh(new THREE.BoxGeometry(c - a, 2.4, d - b), coverMaterial); block.position.set((a + c) / 2, 1.2, (b + d) / 2); block.userData.collider = true; block.name = 'Cover'; ctx.scene.add(block); solids.push(block);
      }
      const crateLooks: Record<string, THREE.Material> = { medkit: new THREE.MeshStandardMaterial({ color: 0xf8fafc, emissive: 0x7f1d1d }), armor: new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x1e3a8a }) };
      materials.push(crateLooks.medkit, crateLooks.armor);
      for (const c of start.crates) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), crateLooks[c.kind] ?? crateLooks.medkit); m.position.set(c.x, 0.3, c.z); m.name = 'Loot crate'; ctx.scene.add(m); crateMeshes.push(m); }
      const zoneMaterial = new THREE.MeshBasicMaterial({ color: 0x54d9ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }); materials.push(zoneMaterial);
      ring = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 64), zoneMaterial); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; ctx.scene.add(ring);
      const shirts = [0x2563eb, 0xb24949, 0xc59d36, 0x16a34a];
      start.players.forEach((p, i) => {
        if (p.id === start.you) { ctx.player.reset(p.x, 0.2, p.z); return; }
        const holder = new THREE.Group(); holder.position.set(p.x, 0, p.z); holder.name = p.name; ctx.scene.add(holder);
        const body = createHumanoid({ shirt: shirts[i % shirts.length] }); holder.add(body.root);
        others.push({ id: p.id, body, holder, last: { x: p.x, z: p.z } });
      });
      return solids;
    },
    update(ctx: GameContext, delta: number) {
      if (stopped) return;
      const dt = Math.min(0.1, Math.max(0, Number.isFinite(delta) ? delta : 0));
      const snap = client.view.snapshot;
      const player = ctx.player.object.position;
      const me = snap?.players.find((p) => p.id === start.you);
      const fix = client.takeCorrection();
      if (fix) ctx.player.reset(fix.x, 0.2, fix.z);
      if (client.view.phase === 'playing' && me?.alive !== false) {
        player.x = THREE.MathUtils.clamp(player.x, -start.arenaHalf + 0.5, start.arenaHalf - 0.5);
        player.z = THREE.MathUtils.clamp(player.z, -start.arenaHalf + 0.5, start.arenaHalf - 0.5);
        ctx.camera.getWorldDirection(direction);
        const yaw = Math.atan2(direction.x, direction.z);
        sendTimer += dt;
        if (sendTimer >= SEND_EVERY_S && (player.x !== lastSent.x || player.z !== lastSent.z || sendTimer > 0.5)) {
          sendTimer = 0; lastSent = { x: player.x, z: player.z }; client.move(player.x, player.z, yaw);
        }
        if (ctx.input.wasPressed('attack')) client.fire(yaw);
      }
      for (const o of others) {
        const p = client.remote(o.id);
        if (!p) continue;
        o.holder.visible = p.alive;
        const speed = Math.hypot(p.x - o.last.x, p.z - o.last.z) / Math.max(dt, 1e-3);
        o.holder.position.set(p.x, 0, p.z); o.holder.rotation.y = p.yaw; o.last = { x: p.x, z: p.z };
        o.body.update(dt, Math.min(speed, 12), true);
      }
      if (snap) {
        snap.crates.forEach((up, i) => { if (crateMeshes[i]) crateMeshes[i].visible = up; });
        const r = Math.max(0.01, snap.radius); ring?.scale.set(r, r, 1);
      }
    },
  };
  return { options, dispose() { if (stopped) return; stopped = true; for (const o of others) o.body.dispose(); for (const m of materials) m.dispose(); } };
}
`;

export const GAME_ROYALE_ONLINE_COMPONENT = String.raw`import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Game } from './Game';
import { resetRun } from './core/state';
import { OnlineClient, onlineEndpoint, type OnlineView } from './royale/onlineClient';
import { createOnlineMatch } from './royale/onlineMatch';
const panel = { padding: 20, background: '#142032', borderRadius: 12, textAlign: 'center' as const, maxWidth: 420 };
const button = { padding: '12px 24px', minHeight: 48, margin: 6 };
export default function RoyaleOnline({ onPractice }: { onPractice?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const client = useRef<OnlineClient | null>(null);
  const [view, setView] = useState<OnlineView>({ phase: 'connecting', reason: '', waiting: 0, busy: false, you: '', start: null, snapshot: null, result: null, ping: 0 });
  const [error, setError] = useState('');
  useEffect(() => {
    const c = new OnlineClient(onlineEndpoint(), (v) => setView(v));
    client.current = c; c.connect();
    return () => { client.current = null; c.close(); };
  }, []);
  // One Game per match: built when the server starts a room, torn down when the room changes or this screen goes.
  const room = view.start?.room ?? '';
  useEffect(() => {
    const c = client.current;
    if (!room || !c || !host.current) return;
    let game: Game | undefined;
    const match = createOnlineMatch(c);
    setError(''); resetRun();
    try { game = new Game({ ...match.options, container: host.current }); game.start(); }
    catch { setError('3D graphics could not start. Try a WebGL-capable browser.'); }
    return () => { match.dispose(); game?.dispose(); };
  }, [room]);
  const snap = view.snapshot, start = view.start;
  const me = snap?.players.find((p) => p.id === view.you);
  const humans = start ? start.players.filter((p) => !p.bot).length : 0, bots = start ? start.players.length - humans : 0;
  const left = snap ? snap.players.filter((p) => p.alive).length : 0;
  const nameOf = (id: string) => start?.players.find((p) => p.id === id)?.name ?? 'Player';
  const queueAgain = () => client.current?.queue();
  const overlay = (children: ReactNode) => <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: '#000a', zIndex: 20 }}><div role="status" style={panel}>{children}</div></div>;
  return <section style={{ position: 'relative', height: '100dvh', minHeight: 360, background: '#111827', color: 'white', overflow: 'hidden', fontFamily: 'system-ui' }}>
    <div ref={host} style={{ position: 'absolute', inset: 0 }} />
    {view.phase === 'playing' && start && <div style={{ position: 'absolute', top: 12, left: 12, right: 180, pointerEvents: 'none', textShadow: '0 1px 3px black' }}>
      <strong>Online Royale · {humans} {humans === 1 ? 'player' : 'players'}{bots ? ' · ' + bots + (bots === 1 ? ' bot' : ' bots') : ''}</strong><br />
      Health {me?.hp ?? 100}{me?.armor ? ' · Armour ' + me.armor : ''} · Left {left} · Safe radius {Math.ceil(snap?.radius ?? 38)}m · {view.ping}ms<br />
      <small>Move: WASD / joystick · Aim: mouse / right drag · Attack: click / Attack</small>
    </div>}
    {view.phase === 'playing' && <div aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none', fontSize: 24 }}>+</div>}
    {view.phase === 'playing' && snap && <div aria-hidden="true" style={{ position: 'absolute', right: 12, bottom: 12, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, pointerEvents: 'none' }}>
      {snap.feed.map((line, i) => <span key={i} style={{ background: '#0009', padding: '2px 8px', borderRadius: 6, fontSize: 13 }}>{line}</span>)}
    </div>}
    {view.phase === 'playing' && me && !me.alive && overlay(<>
      <p>You are out · #{me.place} of {start?.players.length ?? 4}</p>
      <button type="button" onClick={queueAgain} style={button}>Queue again</button>
    </>)}
    {view.phase === 'connecting' && overlay(<p>Connecting to online matches…</p>)}
    {view.phase === 'reconnecting' && overlay(<p>Connection lost — reconnecting. Your place in the match is kept for a few seconds.</p>)}
    {view.phase === 'unavailable' && overlay(<>
      <p>Online is not available</p><p style={{ fontSize: 14, opacity: 0.9 }}>{view.reason}</p>
      {onPractice && <button type="button" onClick={onPractice} style={button}>Play Practice</button>}
    </>)}
    {view.phase === 'lobby' && overlay(<>
      <p>Online Royale · up to 4 players</p>
      {view.reason && <p role="alert" style={{ fontSize: 14 }}>{view.reason}</p>}
      <button type="button" onClick={queueAgain} style={button}>Find a match</button>
      {onPractice && <button type="button" onClick={onPractice} style={button}>Practice instead</button>}
    </>)}
    {view.phase === 'queued' && overlay(<>
      <p>Waiting for players · {view.waiting} of 4</p>
      <p style={{ fontSize: 14, opacity: 0.9 }}>{view.busy ? 'Every match for this game is busy — you are next.' : 'The match starts when 4 join, or after a short wait. Empty seats are filled by bots, shown as bots.'}</p>
      <button type="button" onClick={() => client.current?.leave()} style={button}>Cancel</button>
    </>)}
    {view.phase === 'ended' && view.result && overlay(<>
      <p>{view.result.winner === view.you ? 'You won the match!' : nameOf(view.result.winner) + ' won the match'}</p>
      <ol style={{ textAlign: 'left', fontSize: 14 }}>{view.result.places.map((p) => <li key={p.id}>{p.name}{p.bot ? ' (bot)' : ''}{p.id === view.you ? ' — you' : ''} · Kills {p.kills} · Damage {p.damage}</li>)}</ol>
      <button type="button" onClick={queueAgain} style={button}>Queue again</button>
    </>)}
    {error && overlay(<p>{error}</p>)}
  </section>;
}
`;

export const GAME_ROYALE_MODES = String.raw`import { useState } from 'react';
import RoyalePractice from './RoyalePractice';
import RoyaleOnline from './RoyaleOnline';
/** Practice (offline, two bots) or Online (a real match decided on the server). One game runs at a time. */
export default function RoyaleGame() {
  const [mode, setMode] = useState<'practice' | 'online'>('practice');
  const tab = (value: 'practice' | 'online', label: string) => <button type="button" role="tab" aria-selected={mode === value} onClick={() => setMode(value)}
    style={{ minHeight: 40, padding: '6px 14px', borderRadius: 8, border: 'none', fontWeight: 700, background: mode === value ? '#facc15' : '#1f2937', color: mode === value ? '#111827' : 'white' }}>{label}</button>;
  return <div style={{ position: 'relative' }}>
    {mode === 'practice' ? <RoyalePractice key="practice" /> : <RoyaleOnline key="online" onPractice={() => setMode('practice')} />}
    <div role="tablist" aria-label="Game mode" style={{ position: 'absolute', top: 12, right: 12, zIndex: 30, display: 'flex', gap: 6 }}>
      {tab('practice', 'Practice')}{tab('online', 'Online')}
    </div>
  </div>;
}
`;

export function generateGameRoyale() {
  const base = generateGameRoyaleFoundation();
  return { files: { ...base.files, 'src/game/royale/practice.ts': GAME_ROYALE_PRACTICE, 'src/game/RoyalePractice.tsx': GAME_ROYALE_COMPONENT,
    'src/game/royale/onlineClient.ts': GAME_ROYALE_ONLINE_CLIENT, 'src/game/royale/onlineMatch.ts': GAME_ROYALE_ONLINE_MATCH,
    'src/game/RoyaleOnline.tsx': GAME_ROYALE_ONLINE_COMPONENT, 'src/game/RoyaleGame.tsx': GAME_ROYALE_MODES }, dependencies: base.dependencies, instructions: [
    'Mount RoyaleGame inside the existing game kit. Two modes. Practice: original offline two-bot practice — bounded flat procedural arena, one enterable house, shrinking zone, a drop plane, loot crates (medkits, armour) that bots also loot, a zone warning, a map, a kill feed and an end summary, touch controls and full restart. Online: a real 2–4 player match decided on NavBharatAI\'s match server (movement, shots, loot, zone and the winner are all server-side; empty seats are filled by bots that are labelled as bots). Online works only when the game is opened from the NavBharatAI App Store and the platform has online matches switched on; anywhere else the Online tab says so honestly. Never fake online opponents, never add a second network layer. Not photorealism. No billing or external assets. Enable only for a new explicitly selected recipe; preserve existing projects.',
    'For a new explicitly selected project, render the supplied component from src/App.tsx. It owns Game creation, pause/restart, mode switching and teardown; do not start a second Game instance alongside it.',
    '```tsx',
    "import RoyaleGame from './game/RoyaleGame';",
    'export default function App() {',
    '  return <RoyaleGame />;',
    '}',
    '```',
  ].join('\n') };
}
