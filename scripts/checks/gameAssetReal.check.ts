/** Explicit real-asset admission and local production artifact acceptance; never publishes a user game. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat, symlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { build } from 'vite';
import { REVIEWED_GAME_ASSETS, createAssetProviders } from '../../src/server/AgentV3/gameAssets/providers';
import { downloadReviewedAsset } from '../../src/server/AgentV3/gameAssets/assetTransport';
import { createDurableAssetCache } from '../../src/server/AgentV3/gameAssets/assetCache';
import { acquireGameAsset } from '../../src/server/AgentV3/gameAssets/assetEngine';
import { assetBrowserProofModule } from '../../src/server/AgentV3/gameAssets/assetBrowserProof';
import { generateGameAssetRuntime } from '../../src/server/lib/GameAssetRuntimeGenerator';

const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
async function main() {
  const [evidencePath, playwrightPath, chromiumPath, mode, admittedPath] = process.argv.slice(2);
  assert.ok(evidencePath && playwrightPath && chromiumPath, 'Supply evidence directory, existing Playwright module and Chromium paths');
  const dir = resolve(evidencePath); await mkdir(dir, { recursive: true });
  const write = async (path: string, data: Uint8Array | string) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, data); };
  const cache = createDurableAssetCache({
    async read(key, max) { try { const p = join(dir, 'cache', key); assert.ok((await stat(p)).size <= max); return await readFile(p); } catch { return null; } },
    async write(key, bytes) { await write(join(dir, 'cache', key), bytes); },
  }, REVIEWED_GAME_ASSETS);
  // Fresh process restores and rehashes the exact production cache format. No network provider in this branch.
  if (mode === 'cache-probe') {
    for (const c of REVIEWED_GAME_ASSETS) assert.equal(hash((await cache.read(c.sha256))!), c.sha256);
    console.log('PASS fresh-process disk object-store cache restore (not a cloud bucket)'); return;
  }
  const fixture = join(dir, 'fixture'); await mkdir(fixture, { recursive: true });
  try { await symlink(resolve('node_modules'), join(fixture, 'node_modules')); } catch (e: any) { if (e.code !== 'EEXIST') throw e; }
  const imports = `import { chromium } from ${JSON.stringify(pathToFileURL(resolve(playwrightPath)).href)};`;
  const outcomes = [];
  for (const c of REVIEWED_GAME_ASSETS) {
    const role = c.animationRoles?.walk ? 'walk' : c.animationRoles?.fly ? 'fly' : undefined;
    const clip = role ? c.animationRoles?.[role] : undefined;
    const requirement = { subject: c.subjects[0], ...(role ? { animation: role } : {}) };
    let downloads = 0;
    const dependencies = {
      cache, providers: createAssetProviders(REVIEWED_GAME_ASSETS),
      async download() {
        downloads++;
        // Explicit offline mode uses already-reviewed final bytes. It does not claim live transport proof.
        if (mode === 'offline-reviewed') { assert.ok(admittedPath); const bytes = await readFile(join(resolve(admittedPath), c.sha256 + '.glb')); assert.equal(hash(bytes), c.sha256); return bytes; }
        try { return await downloadReviewedAsset(c, new AbortController().signal); } catch (e) { console.error(c.id, 'admission transfer failed', e); throw e; }
      },
      async parse(bytes: Uint8Array) {
        await write(join(fixture, `.nbai-asset-${c.sha256}.glb`), bytes);
        await write(join(fixture, 'proof.mjs'), assetBrowserProofModule(c.sha256, clip, imports, resolve(chromiumPath)));
        const result = execFileSync(process.execPath, ['proof.mjs'], { cwd: fixture, encoding: 'utf8', timeout: 30000 });
        assert.match(result, /"rendered":true/); if (requirement.animation) assert.match(result, /"animated":true/);
        console.log(c.id, result.trim());
      },
      async persist(entry: { path: string }, bytes: Uint8Array) { await write(join(fixture, entry.path), bytes); assert.equal(hash(await readFile(join(fixture, entry.path))), c.sha256); },
    };
    const first = await acquireGameAsset(requirement, dependencies, new AbortController().signal);
    assert.equal(first.kind, 'model', `${c.id}: acquisition failed`);
    const again = await acquireGameAsset(requirement, dependencies, new AbortController().signal);
    assert.equal(again.kind, 'model'); if (again.kind === 'model') { assert.equal(again.cacheHit, true); assert.equal(again.downloadedBytes, 0); }
    assert.ok(downloads <= 1);
    outcomes.push({ id: c.id, outcome: first, downloads, transport: c.packaged ? 'packaged licensed derivative (no network)' : mode === 'offline-reviewed' ? 'offline-reviewed' : 'secure live download' });
  }
  execFileSync(process.execPath, ['--import', resolve('node_modules/tsx/dist/loader.mjs'), resolve('scripts/checks/gameAssetReal.check.ts'), dir, resolve(playwrightPath), resolve(chromiumPath), 'cache-probe'], { encoding: 'utf8', stdio: 'inherit' });
  const assets = REVIEWED_GAME_ASSETS.map(c => ({ sha256: c.sha256, height: c.height, yaw: c.yaw,
    ...((c.animationRoles?.walk ?? c.animationRoles?.fly) ? { animation: c.animationRoles?.walk ?? c.animationRoles?.fly } : {}),
    ...(c.license.spdx === 'CC-BY-4.0' ? { attributionCredit: c.license.author + ' — CC BY 4.0' } : {}) }));
  await write(join(fixture, 'public/game-assets/manifest.json'), JSON.stringify(REVIEWED_GAME_ASSETS, null, 2));
  await write(join(fixture, 'public/game-assets/ATTRIBUTION.txt'), REVIEWED_GAME_ASSETS.map(c => `${c.id}\n${c.license.attribution}\n${c.license.evidenceUrl}\nSource: ${c.sourceUrl}\nProcessing: ${c.optimization ?? 'none'}\n`).join('\n'));
  await write(join(fixture, 'runtime.ts'), generateGameAssetRuntime());
  await write(join(fixture, 'index.html'), '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}canvas{display:block}button{position:fixed;top:8px;left:8px}</style></head><body><button id="move">Move car</button><script type="module" src="/main.ts"></script></body></html>');
  await write(join(fixture, 'main.ts'), `import * as THREE from 'three'; import { loadGameAsset } from './runtime';
const configs=${JSON.stringify(assets)};
const handles=await Promise.all(configs.map(c=>loadGameAsset(c,()=>{throw Error('Unexpected fallback')})));
const scene=new THREE.Scene();scene.background=new THREE.Color(0x18222b);scene.add(new THREE.HemisphereLight(0xffffff,0x777777,3));
handles.forEach((h,i)=>{h.root.position.x=(i-1.5)*5;scene.add(h.root)});
const camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.01,200);camera.position.set(18,14,27);camera.lookAt(0,3,0);
const renderer=new THREE.WebGLRenderer({preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight);document.body.appendChild(renderer.domElement);
const pose=()=>{scene.updateMatrixWorld(true);const p=[];handles[0].root.traverse(o=>p.push(...o.matrixWorld.elements));return p};const before=pose();
for(let i=0;i<5;i++)handles.forEach(h=>h.update(.1));const after=pose();
let moves=0;const move=()=>{handles[1].root.position.z+=.5;moves++;};addEventListener('keydown',e=>{if(e.key==='ArrowUp')move()});document.querySelector('#move').addEventListener('click',move);
function tick(){handles.forEach(h=>h.update(.016));renderer.render(scene,camera);requestAnimationFrame(tick)}tick();
window.__realProof=()=>({sources:handles.map(h=>h.source),animated:after.some((v,i)=>Math.abs(v-before[i])>1e-6),triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,moves,z:handles[1].root.position.z,width:renderer.domElement.clientWidth,viewport:innerWidth});
`);
  await build({ root: fixture, configFile: false, base: '/published/', logLevel: 'error', build: { target: 'es2022' } });
  for (const c of REVIEWED_GAME_ASSETS) assert.equal(hash(await readFile(join(fixture, 'dist/game-assets', c.sha256 + '.glb'))), c.sha256);
  const server = createServer(async (req, res) => {
    try {
      const p = new URL(req.url ?? '/', 'http://localhost').pathname;
      assert.ok(p.startsWith('/published/') && !p.includes('..'));
      const relative = p.slice(11) || 'index.html';
      res.setHeader('Content-Type', relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.glb') ? 'model/gltf-binary' : relative.endsWith('.html') ? 'text/html' : 'text/plain');
      res.end(await readFile(join(fixture, 'dist', relative)));
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const { chromium } = await import(pathToFileURL(resolve(playwrightPath)).href);
  let browser: any;
  try {
    browser = await chromium.launch({ executablePath: resolve(chromiumPath), headless: true, args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const external: string[] = []; const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.route('**/*', (route: any) => { if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
    for (let i = 0; i < 2; i++) {
      await page.goto(origin + '/published/'); await page.waitForFunction('Boolean(window.__realProof)');
      await page.keyboard.press('ArrowUp'); await page.locator('#move').click();
      const proof = await page.evaluate('window.__realProof()');
      assert.deepEqual(proof.sources, REVIEWED_GAME_ASSETS.map(() => 'model'));  assert.equal(proof.animated, true);
      assert.equal(proof.moves, 2); assert.equal(proof.z, 1); assert.equal(proof.width, proof.viewport);
      assert.ok(proof.triangles > 0 && proof.triangles < 60000 && proof.drawCalls < 32);
      console.log('production artifact', proof);
    }
    await page.screenshot({ path: join(dir, 'real-assets-mobile.png') });
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    await write(join(dir, 'acceptance.json'), JSON.stringify({ transport: mode === 'offline-reviewed' ? 'offline reviewed bytes; production DNS transport not verified' : 'live guarded downloader', outcomes, browser: 'Chromium software renderer, 390x844 viewport; not physical mobile hardware', publication: 'local production artifact only' }, null, 2));
    console.log('PASS real reviewed assets, cache reuse/fresh-process restore, production build, keyboard/touch movement, animation and reload. Transport mode:', mode === 'offline-reviewed' ? 'OFFLINE: live downloader not verified' : 'live guarded downloader', '. No live publication.');
  } finally { await browser?.close(); await new Promise<void>(r => server.close(() => r())); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
