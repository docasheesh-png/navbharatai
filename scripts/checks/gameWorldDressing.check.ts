/**
 * L3 step 4 acceptance: a DRESSED WORLD, from real admitted models, in a real browser.
 * Builds a fixture game with the production asset runtime, assetModels manifest and worldDressing module, for the
 * racing (roadside), village and shooting (range) layouts; serves the Vite production build at /published/ and
 * checks in Chromium at 390×844: models placed, none on the road / in the play space, pixels and triangles drawn.
 * Usage: tsx scripts/checks/gameWorldDressing.check.ts OUT_DIR ADMITTED_GLB_DIR PLAYWRIGHT_MODULE CHROMIUM
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, copyFile, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { REVIEWED_GAME_ASSETS } from '../../src/server/AgentV3/gameAssets/providers';
import { generateGameAssetRuntime } from '../../src/server/lib/Game3DGenerator';
import { generateWorldDressingModule, sceneryFor, type DressingLayout } from '../../src/server/AgentV3/gameAssets/worldDressing';

const SCENES: Array<{ name: string; prompt: string; boxer?: true }> = [
  { name: 'racing', prompt: 'make a car racing game' },
  { name: 'village', prompt: 'गाँव वाला खेल बनाओ' },
  { name: 'shooting', prompt: 'a 3D shooting game' },
  // The boxer: hidden weapons really gone, play('punch') really changes the pose.
  { name: 'boxer', prompt: '3D boxing game', boxer: true },
];

async function main() {
  const [out, admitted, playwrightPath, chromiumPath] = process.argv.slice(2);
  assert.ok(out && admitted && playwrightPath && chromiumPath, 'usage: OUT ADMITTED PLAYWRIGHT CHROMIUM');
  const root = resolve(out); await mkdir(root, { recursive: true });
  const results: unknown[] = [];
  for (const s of SCENES) {
    const plan = s.boxer ? { layout: 'village' as const, subjects: ['boxer'] } : sceneryFor(s.prompt); assert.ok(plan, `${s.name}: no scenery plan`);
    const fixture = join(root, s.name); await mkdir(join(fixture, 'src/game/three'), { recursive: true }); await mkdir(join(fixture, 'public/game-assets'), { recursive: true });
    try { await symlink(resolve('node_modules'), join(fixture, 'node_modules')); } catch (e: any) { if (e.code !== 'EEXIST') throw e; }
    const local: Record<string, { sha256: string; height: number; yaw: number; lod: boolean }> = {};
    for (const subject of plan.subjects) {
      const c = REVIEWED_GAME_ASSETS.find((a) => a.subjects.includes(subject)); assert.ok(c, `${s.name}: no reviewed model for ${subject}`);
      await copyFile(join(resolve(admitted), c.sha256 + '.glb'), join(fixture, 'public/game-assets', c.sha256 + '.glb'));
      local[subject] = { sha256: c.sha256, height: c.height, yaw: c.yaw, lod: false,
        ...(c.hiddenNodes ? { hidden: [...c.hiddenNodes] } : {}), ...(c.animationRoles ? { roles: { ...c.animationRoles } } : {}) } as any;
    }
    await writeFile(join(fixture, 'src/game/three/externalAssets.ts'), generateGameAssetRuntime());
    await writeFile(join(fixture, 'src/game/three/assetModels.ts'), `import { loadGameAsset, type GameAssetHandle, type LocalGameAsset } from './externalAssets';\nconst assets: Record<string, LocalGameAsset> = ${JSON.stringify(local)};\nexport function loadRequestedAsset(subject: string, fallback: () => GameAssetHandle, signal?: AbortSignal): Promise<GameAssetHandle> {\n  return assets[subject] ? loadGameAsset(assets[subject], fallback, signal) : Promise.resolve(fallback());\n}\n`);
    await writeFile(join(fixture, 'src/game/three/worldDressing.ts'), generateWorldDressingModule(plan.subjects, plan.layout as DressingLayout));
    // The game itself: ground, a road along Z (racing), a player spot at the origin — then ONE dressWorld call.
    await writeFile(join(fixture, 'main.ts'), `import * as THREE from 'three';
import { dressWorld } from './src/game/three/worldDressing';
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight); document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9fd3ff);
scene.add(new THREE.HemisphereLight(0xffffff, 0x556644, 2.2)); const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(20, 40, 10); scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x5f9a45 })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
const heightAt = (x: number, z: number) => 0.02 * Math.sin(x * 0.1) * Math.cos(z * 0.1);
const layout = ${JSON.stringify(plan.layout)};
if (layout === 'roadside') { const road = new THREE.Mesh(new THREE.PlaneGeometry(10, 400), new THREE.MeshLambertMaterial({ color: 0x3a3c40 })); road.rotation.x = -Math.PI / 2; road.position.y = 0.01; scene.add(road); }
const accept = (x: number, z: number) => layout === 'roadside' ? Math.abs(x) > 7 : layout === 'village' ? Math.hypot(x, z) > 12 : Math.abs(x) > 2 || z < -15;
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 600);
camera.position.set(0, layout === 'range' ? 3 : 18, layout === 'range' ? 6 : 40); camera.lookAt(0, 0, layout === 'range' ? -25 : 0);
const BOXER = ${JSON.stringify(!!s.boxer)};
let boxer: any = null;
if (BOXER) {
  const { loadRequestedAsset } = await import('./src/game/three/assetModels');
  boxer = await loadRequestedAsset('boxer', () => { throw new Error('boxer did not load'); });
  scene.add(boxer.root); camera.position.set(0, 1.5, 4); camera.lookAt(0, 1, 0);
  const names: string[] = []; boxer.root.traverse((o: any) => names.push(o.name));
  const pose = () => { const v: number[] = []; boxer.root.traverse((o: any) => { if (o.isBone) v.push(o.quaternion.x, o.quaternion.y, o.quaternion.z); }); return v; };
  const idle = boxer.play('idle'); boxer.update(0.3); const a = pose();
  const punch = boxer.play('punch', 0); boxer.update(0.25); const b = pose();
  (window as any).__boxer = { source: boxer.source, idle, punch, unknown: boxer.play('nope'),
    weaponsLeft: names.filter((n) => /Sword|Shield|Cape|Helmet/.test(n)), poseChanged: a.some((x, i) => Math.abs(x - b[i]) > 1e-4), bones: a.length / 3 };
}
const placed = BOXER ? 0 : await dressWorld(scene, { heightAt, accept, roadHalfWidth: 5, count: 48 });
renderer.render(scene, camera);
const world = scene.getObjectByName('world-dressing') ?? new THREE.Group();
const onRoad = layout === 'roadside' ? world.children.filter((c) => Math.abs(c.position.x) < 5).length : 0;
const offGround = world.children.filter((c) => Math.abs(c.position.y - heightAt(c.position.x, c.position.z)) > 1e-6).length;
(window as any).__dress = { layout, placed, onRoad, offGround, triangles: renderer.info.render.triangles, calls: renderer.info.render.calls };
`);
    await writeFile(join(fixture, 'index.html'), '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;overflow:hidden}</style></head><body><script type="module" src="/main.ts"></script></body></html>');
    execFileSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build', '--base=/published/', '--target=es2022', '--logLevel=error'], { cwd: fixture, stdio: 'inherit', timeout: 120000 });
    const server = createServer(async (req, res) => {
      try {
        const p = new URL(req.url ?? '/', 'http://localhost').pathname; assert.ok(p.startsWith('/published/'));
        const file = join(fixture, 'dist', p.slice(11) || 'index.html');
        const body = await readFile(file);
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.glb') ? 'model/gltf-binary' : file.endsWith('.json') ? 'application/json' : 'text/html');
        res.end(body);
      } catch { res.statusCode = 404; res.end(); }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const origin = 'http://127.0.0.1:' + (server.address() as any).port;
    const { chromium } = await import(pathToFileURL(resolve(playwrightPath)).href);
    const browser = await chromium.launch({ executablePath: resolve(chromiumPath), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const external: string[] = []; const errors: string[] = [];
      page.on('pageerror', (e: Error) => errors.push(e.message));
      await page.route('**/*', (route: any) => { if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
      await page.goto(origin + '/published/');
      await page.waitForFunction(() => (window as any).__dress, null, { timeout: 60000 });
      const r = await page.evaluate(() => (window as any).__dress);
      await page.screenshot({ path: join(root, `${s.name}.png`) });
      assert.deepEqual(errors, [], `${s.name}: page errors`); assert.deepEqual(external, [], `${s.name}: external requests`);
      if (s.boxer) {
        const b = await page.evaluate(() => (window as any).__boxer);
        assert.equal(b.source, 'model'); assert.equal(b.idle, true); assert.equal(b.punch, true); assert.equal(b.unknown, false);
        assert.deepEqual(b.weaponsLeft, [], 'boxer still holds weapons'); assert.equal(b.poseChanged, true, 'punch did not change the pose');
        results.push({ scene: s.name, ...b }); console.log('PASS', s.name, JSON.stringify(b)); continue;
      }
      assert.ok(r.placed >= 30, `${s.name}: only ${r.placed} placed`);
      assert.equal(r.onRoad, 0, `${s.name}: ${r.onRoad} on the road`); assert.equal(r.offGround, 0, `${s.name}: ${r.offGround} off the ground`);
      assert.ok(r.triangles > 1000, `${s.name}: ${r.triangles} triangles drawn`);
      results.push({ scene: s.name, subjects: plan.subjects, ...r });
      console.log('PASS', s.name, JSON.stringify(r));
    } finally { await browser.close(); await new Promise<void>((r) => server.close(() => r())); }
  }
  console.log(JSON.stringify(results));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
