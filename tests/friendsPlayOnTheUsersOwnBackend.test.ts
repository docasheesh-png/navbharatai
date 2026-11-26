/**
 * 🌐 Admin 2026-11-26 list #10: "multiplayer … user ka backend / hosting maange". Online play ran only on NavBharatAI's own
 * Royale servers. net/rooms.ts runs a room on the USER's own Supabase Realtime (the Phoenix channel protocol over a plain
 * websocket, no package): join by code, state and events between players, joins and leaves — and, without the keys, an honest
 * 'not-configured' with the RED line naming them (never a fake lobby). Runs the REAL emitted module against a websocket fake
 * that answers the way Supabase Realtime does.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D, GAME_3D_MODULES } from '../src/server/lib/Game3DGenerator';
import { GAME_ROOMS_PATH, ROOM_NOT_CONFIGURED, onlineMultiplayerWanted, ROOMS_HANDOFF } from '../src/server/lib/GameRoomsGenerator';
import { gameKitHandoffBlock } from '../src/server/AgentV3/gameKitSeed';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-rooms-${process.pid}`);
let R: any;
beforeAll(async () => {
  for (const [p, c] of Object.entries(generateGame3D(['rooms']).files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  R = await import(join(DIR, GAME_ROOMS_PATH));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** A Supabase Realtime stand-in: one "server" relays broadcasts between every socket joined to the same topic. */
function realtime() {
  const sockets: any[] = [];
  class FakeWS {
    readyState = 0; sent: any[] = []; url: string; topic = '';
    onopen: any; onmessage: any; onerror: any; onclose: any;
    constructor(url: string) { this.url = url; sockets.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
    send(raw: string) {
      const m = JSON.parse(raw); this.sent.push(m);
      if (m.event === 'phx_join') { this.topic = m.topic; queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ topic: m.topic, event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: m.ref }) })); }
      if (m.event === 'broadcast') for (const s of sockets) if (s !== this && s.topic === m.topic && s.readyState === 1) queueMicrotask(() => s.onmessage?.({ data: JSON.stringify({ topic: m.topic, event: 'broadcast', payload: m.payload }) }));
    }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  return { FakeWS, sockets };
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const KEYS = { url: 'https://abcd.supabase.co', anonKey: 'anon-key-0123456789abcdef' };

describe('#10 a room on the user\'s own Supabase', () => {
  it('ships in the 3D kit with nothing to install', () => {
    expect(GAME_3D_MODULES).toContain('rooms');
    const src = generateGame3D(['rooms']).files[GAME_ROOMS_PATH];
    expect(src).not.toMatch(/@supabase\/supabase-js/);
  });

  it('without the keys it never pretends: not-configured, the honest RED line, nothing sent', () => {
    const room = R.joinRoom({ room: 'abc', url: '', anonKey: '' });
    expect(room.status).toBe('not-configured');
    expect(room.reason).toBe(ROOM_NOT_CONFIGURED);
    expect(ROOM_NOT_CONFIGURED).toMatch(/VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY/);
    room.sendState({ x: 1 }); room.send('shot', {});
    expect(room.peers.size).toBe(0);
  });

  it('two friends with the same code: join over the Realtime protocol, see each other, get state and events, and see a leave', async () => {
    const rt = realtime();
    const a = R.joinRoom({ room: 'ab12cd', name: 'Asha', ...KEYS, WebSocketImpl: rt.FakeWS });
    const b = R.joinRoom({ room: 'AB12CD', name: 'Ravi', ...KEYS, WebSocketImpl: rt.FakeWS });
    await flush();
    expect(rt.sockets[0].url).toBe('wss://abcd.supabase.co/realtime/v1/websocket?apikey=anon-key-0123456789abcdef&vsn=1.0.0');
    expect(rt.sockets[0].sent[0]).toMatchObject({ topic: 'realtime:nb-room-AB12CD', event: 'phx_join', payload: { access_token: KEYS.anonKey } });
    expect(a.status).toBe('open'); expect(b.status).toBe('open');
    await flush();
    expect([...a.peers.values()].map((p: any) => p.name)).toEqual(['Ravi']);
    expect([...b.peers.values()].map((p: any) => p.name)).toEqual(['Asha']);
    a.sendState({ x: 5, z: -3, heading: 1.2 });
    await flush();
    expect([...b.peers.values()][0].state).toEqual({ x: 5, z: -3, heading: 1.2 });
    const shots: any[] = [];
    b.on('shot', (p: any, from: any) => shots.push([p, from.name]));
    a.send('shot', { power: 3 });
    await flush();
    expect(shots).toEqual([[{ power: 3 }, 'Asha']]);
    const left: string[] = [];
    b.on('leave', (p: any) => left.push(p.name));
    a.leave();
    await flush();
    expect(left).toEqual(['Asha']);
    expect(b.peers.size).toBe(0);
  });

  it('state is throttled to sendRate, and a silent player times out', async () => {
    const rt = realtime();
    let t = 0;
    const a = R.joinRoom({ room: 'x', ...KEYS, WebSocketImpl: rt.FakeWS, now: () => t, sendRate: 10 });
    const b = R.joinRoom({ room: 'x', ...KEYS, WebSocketImpl: rt.FakeWS, now: () => t, timeout: 5 });
    await flush(); await flush();
    const before = rt.sockets[0].sent.filter((m: any) => m.payload?.event === 'state').length;
    for (let i = 0; i < 10; i++) { t += 10; a.sendState({ x: i }); }   // 100 ms in all at 10/s: one more send at most
    expect(rt.sockets[0].sent.filter((m: any) => m.payload?.event === 'state').length - before).toBeLessThanOrEqual(1);
    await flush();
    expect(b.peers.size).toBe(1);
    t += 6000; b.tick();
    expect(b.peers.size).toBe(0);
  });

  it('remotePlayers draws a body for each friend and moves it to where they are', async () => {
    const rt = realtime();
    const a = R.joinRoom({ room: 'y', ...KEYS, WebSocketImpl: rt.FakeWS });
    const b = R.joinRoom({ room: 'y', ...KEYS, WebSocketImpl: rt.FakeWS });
    await flush(); await flush();
    const scene = new THREE.Scene();
    const others = R.remotePlayers(b, scene, () => new THREE.Object3D());
    a.sendState({ x: 10, y: 0, z: 4, heading: 0.5 });
    await flush();
    for (let i = 0; i < 120; i++) others.update(1 / 60);
    const body = [...others.bodies.values()][0];
    expect(body.position.x).toBeCloseTo(10, 1); expect(body.position.z).toBeCloseTo(4, 1); expect(body.rotation.y).toBe(0.5);
    others.dispose();
    expect(scene.children.length).toBe(0);
  });
});

describe('#10 the builder is told, only for an online request', () => {
  it('reads online play, not two players on one phone, and a refusal', () => {
    for (const p of ['multiplayer game banao', 'dosto ke saath online khelna hai', 'room code se friends join kare', 'मल्टीप्लेयर गेम']) expect(onlineMultiplayerWanted(p), p).toBe(true);
    for (const p of ['ek 3D race game', 'ek hi phone par 2 players multiplayer', 'multiplayer nahi chahiye', 'split screen multiplayer']) expect(onlineMultiplayerWanted(p), p).toBe(false);
  });
  it('the 3D handoff names the module, the two keys and the honest notice', () => {
    const block = gameKitHandoffBlock([{ recipe: 'generate_game_3d', ok: true, content: '' } as any], { request: 'dosto ke saath online multiplayer race' });
    expect(block).toContain(ROOMS_HANDOFF);
    expect(ROOMS_HANDOFF).toMatch(/request_secrets for VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY/);
    expect(gameKitHandoffBlock([{ recipe: 'generate_game_3d', ok: true, content: '' } as any], { request: 'ek race game' })).not.toContain('ONLINE MULTIPLAYER');
  });
});
