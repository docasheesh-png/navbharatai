// THE SHOOTER'S HUD SHOWS THE FIGHT (admin 2026-11-19 game-gap audit, P0 #7: no crosshair, no ammo count, no hit marker,
// no damage numbers, no enemy or boss health bars). The emitted kit is run for real: the Weapon's events carry the
// player's ammo and owner, health bars float over enemies and hide at full health, and the Hud's ShooterOverlay is
// bundled and mounted in a REAL Chromium, where the kit's own events drive it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { build } from 'esbuild';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { generateGameVfxAudio } from '../src/server/lib/GameVfxAudioGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';

const DIR = join(__dirname, `.tmp-shooter-hud-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let W: any; let P: any; let E: any; let HB: any;

beforeAll(async () => {
  for (const r of [generateGameRuntime(), generateGame3D(), generateGameController(), generateGameVfxAudio(), generateGameShell(), generateGameSystems()]) {
    for (const [p, c] of Object.entries(r.files)) { const f = join(DIR, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
  W = await import(join(DIR, 'src/game/systems/weapon.ts'));
  P = await import(join(DIR, 'src/game/systems/projectile.ts'));
  E = await import(join(DIR, 'src/game/core/events.ts'));
  HB = await import(join(DIR, 'src/game/three/healthbar.ts'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('the weapon tells the HUD what it needs', () => {
  it('a shot carries the ammo left and the magazine; a reload announces itself; an enemy\'s shot carries its id', () => {
    const seen: any[] = [];
    const offs = ['WEAPON_FIRED', 'WEAPON_RELOADING', 'WEAPON_RELOADED'].map((e) => E.events.on(e, (p: any) => seen.push([e, p])));
    const gun = new W.Weapon('pistol');
    const bullets = new P.ProjectileSystem();
    gun.update(1 / 60, true, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, bullets);
    const fired = seen.find(([e]) => e === 'WEAPON_FIRED')![1];
    expect(fired).toMatchObject({ ammo: gun.ammo, magazine: gun.spec.magazine });
    expect(fired.ownerId).toBeUndefined();
    gun.update(1 / 60, false, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, bullets);
    expect(gun.reload()).toBe(true);
    expect(seen.find(([e]) => e === 'WEAPON_RELOADING')![1]).toMatchObject({ magazine: gun.spec.magazine });
    for (let i = 0; i < 400; i++) gun.update(1 / 60, false, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, bullets);
    expect(seen.find(([e]) => e === 'WEAPON_RELOADED')![1]).toMatchObject({ ammo: gun.spec.magazine });
    const enemyGun = new W.Weapon('rifle');
    seen.length = 0;
    enemyGun.update(1 / 60, true, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, bullets, 'enemy-3');
    expect(seen.find(([e]) => e === 'WEAPON_FIRED')![1].ownerId).toBe('enemy-3');
    for (const off of offs) off();
  });
});

describe('🔴 health bars over enemies', () => {
  it('hidden at full health and at zero, shown when hurt, coloured by how hurt, removed on dispose', () => {
    const enemy = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1));
    const scene = new THREE.Scene(); scene.add(enemy);
    let hp = 1;
    const bar = HB.attachHealthBar(enemy, () => hp);
    const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 2, 6); camera.lookAt(0, 1, 0); camera.updateMatrixWorld();
    HB.updateHealthBars(camera);
    expect(bar.group.visible).toBe(false);
    hp = 0.4; HB.updateHealthBars(camera);
    expect(bar.group.visible).toBe(true);
    const fill = bar.group.children[1] as THREE.Mesh;
    expect(fill.scale.x).toBeCloseTo(0.94 * 0.4, 3);
    expect(((fill.material as THREE.MeshBasicMaterial).color.getHex())).toBe(0xfacc15);
    expect(bar.group.position.y).toBeGreaterThan(1);           // above the enemy's head
    hp = 0; HB.updateHealthBars(camera);
    expect(bar.group.visible).toBe(false);
    const before = HB.healthBarCount();
    bar.dispose();
    expect(HB.healthBarCount()).toBe(before - 1);
    expect(enemy.children).not.toContain(bar.group);
  });
});

const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const haveBrowser = existsSync(PW) && existsSync('/opt/pw-browsers');

describe.skipIf(!haveBrowser)('🔴 the overlay, mounted in a real browser and driven by the kit\'s events', () => {
  let page: any; let browser: any;
  beforeAll(async () => {
    const entry = join(DIR, 'entry.tsx');
    writeFileSync(entry, `import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { ShooterOverlay } from './src/game/ui/Hud';
import { events } from './src/game/core/events';
let boss: any = null;
const game: any = { crosshairOption: undefined, get bossBar() { return boss; }, worldToScreen: (p: any) => ({ x: 100 + p.x, y: 200 + p.y, visible: true }) };
(window as any).__ev = events;
(window as any).__setBoss = (b: any) => { boss = b; events.emit('BOSS_BAR', {}); };
createRoot(document.getElementById('root')!).render(createElement('div', { style: { position: 'relative', width: '800px', height: '450px' } }, createElement(ShooterOverlay, { game, playing: true })));
`);
    const out = join(DIR, 'bundle.js');
    await build({ entryPoints: [entry], bundle: true, outfile: out, format: 'iife', jsx: 'automatic', nodePaths: [join(__dirname, '..', 'node_modules')], logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' } });
    writeFileSync(join(DIR, 'index.html'), '<!doctype html><html><body><div id="root"></div><script src="bundle.js"></script></body></html>');
    const { chromium } = (await import(PW)).default;
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.goto('file://' + join(DIR, 'index.html'));
    await page.waitForFunction(() => (window as any).__ev);
  }, 120_000);
  afterAll(async () => { await browser?.close(); });

  it('no crosshair before a shot; the player\'s first shot shows it and the ammo; an enemy\'s shot changes nothing', async () => {
    expect(await page.$('svg path[d^="M14 3"]')).toBeNull();
    await page.evaluate(() => (window as any).__ev.emit('WEAPON_FIRED', { ownerId: 'enemy-1', ammo: 3, magazine: 30 }));
    expect(await page.$('svg path[d^="M14 3"]')).toBeNull();
    await page.evaluate(() => (window as any).__ev.emit('WEAPON_FIRED', { ammo: 11, magazine: 12 }));
    await page.waitForSelector('svg path[d^="M14 3"]');
    expect(await page.textContent('[role=status]')).toContain('11');
    expect(await page.getAttribute('[role=status]', 'aria-label')).toBe('Ammo 11 of 12');
    await page.evaluate(() => (window as any).__ev.emit('WEAPON_RELOADING', { ammo: 0, magazine: 12 }));
    expect(await page.textContent('[role=status]')).toContain('⟳');
  });
  it('a hit flashes the marker and raises a damage number where the enemy was hit; a kill shows ✖', async () => {
    await page.evaluate(() => (window as any).__ev.emit('ENEMY_DAMAGED', { amount: 25, position: { x: 50, y: 10, z: 0 } }));
    await page.waitForSelector('svg path[d^="M7 7"]');
    const num = await page.waitForSelector('text=-25');
    const box = await num.boundingBox();
    expect(Math.round(box.x + box.width / 2)).toBeGreaterThan(130);
    await page.evaluate(() => (window as any).__ev.emit('ENEMY_DIED', { position: { x: 0, y: 0, z: 0 } }));
    await page.waitForSelector('text=✖');
    await page.waitForTimeout(900);
    expect(await page.$('text=-25')).toBeNull();               // the numbers fade away
  });
  it('the boss bar shows the name and follows its health', async () => {
    await page.evaluate(() => (window as any).__setBoss({ name: 'Raavan', fraction: 0.5 }));
    await page.waitForSelector('[role=progressbar][aria-label=Raavan]');
    expect(await page.getAttribute('[role=progressbar]', 'aria-valuenow')).toBe('50');
    await page.evaluate(() => (window as any).__setBoss(null));
    await page.waitForTimeout(150);
    expect(await page.$('[role=progressbar]')).toBeNull();
  });
});
