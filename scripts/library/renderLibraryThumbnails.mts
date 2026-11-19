/**
 * Maintainer-only: render one small picture of every reviewed library model, for the in-app Game library (2026-11-19).
 * For each entry it acquires the pinned bytes through the production engine (hash + licence + GLB checks, with a
 * durable cache so a re-run downloads nothing), then renders all of them in ONE Chromium page and writes
 *   assets/game-models/thumbs/<sha256>.webp   (160x160, transparent background)
 * The production image already copies assets/game-models, and the server serves only files named by a catalogue hash.
 * Usage: node --import tsx scripts/library/renderLibraryThumbnails.mts <work dir> <playwright index.mjs> [chromium path] [only ids,comma]
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAssetProviders, validateCatalogue, REVIEWED_GAME_ASSETS } from '../../src/server/AgentV3/gameAssets/providers';
import { downloadReviewedAsset } from '../../src/server/AgentV3/gameAssets/assetTransport';
import { createDurableAssetCache } from '../../src/server/AgentV3/gameAssets/assetCache';
import { acquireGameAsset } from '../../src/server/AgentV3/gameAssets/assetEngine';
import { LIBRARY_THUMB_DIR, LIBRARY_THUMB_SIZE, thumbnailAllowed } from '../../src/server/AgentV3/gameAssets/libraryThumbnails';

const [workArg, playwrightArg, chromiumArg, onlyArg] = process.argv.slice(2);
assert.ok(workArg && playwrightArg, 'Supply a work directory and the Playwright module path');
validateCatalogue(REVIEWED_GAME_ASSETS);
const { chromium } = await import(pathToFileURL(resolve(playwrightArg)).href);
const work = resolve(workArg);
const save = async (p: string, b: Uint8Array | string) => { await mkdir(dirname(p), { recursive: true }); await writeFile(p, b); };
const store = {
  async read(key: string, max: number) { try { const p = join(work, 'cache', key); assert.ok((await stat(p)).size <= max); return await readFile(p); } catch { return null; } },
  async write(key: string, bytes: Uint8Array) { await save(join(work, 'cache', key), bytes); },
};
const only = onlyArg ? new Set(onlyArg.split(',')) : null;
const out = resolve(LIBRARY_THUMB_DIR);
const bytesByHash = new Map<string, Uint8Array>();
const failures: string[] = [];
const seen = new Set<string>();
for (const c of REVIEWED_GAME_ASSETS) {
  if ((only && !only.has(c.id)) || seen.has(c.sha256) || !thumbnailAllowed(c)) continue;
  seen.add(c.sha256);
  try { await stat(join(out, `${c.sha256}.webp`)); if (!only) continue; } catch { /* not rendered yet */ }
  let captured: Uint8Array | null = null;
  const outcome = await acquireGameAsset({ subject: c.subjects[0] }, {
    cache: createDurableAssetCache(store, [c]), providers: createAssetProviders([c]),
    parse: async (bytes: Uint8Array) => { captured = bytes; },
    download: (candidate: typeof c, signal: AbortSignal) => downloadReviewedAsset(candidate, signal),
    persist: async () => {},
  }, new AbortController().signal).catch((e: Error) => ({ kind: 'procedural' as const, reason: e.message }));
  if (outcome.kind !== 'model' || !captured) { failures.push(`${c.id}: ${outcome.kind === 'procedural' ? outcome.reason : 'no bytes'}`); continue; }
  bytesByHash.set(c.sha256, captured);
  console.log('acquired', c.id);
}

const modules: Record<string, string> = {
  '/three.module.js': 'node_modules/three/build/three.module.js',
  '/three.core.js': 'node_modules/three/build/three.core.js',
  '/loaders/GLTFLoader.js': 'node_modules/three/examples/jsm/loaders/GLTFLoader.js',
  '/utils/BufferGeometryUtils.js': 'node_modules/three/examples/jsm/utils/BufferGeometryUtils.js',
  '/utils/SkeletonUtils.js': 'node_modules/three/examples/jsm/utils/SkeletonUtils.js',
};
const server = createServer(async (req, res) => {
  const url = req.url ?? '';
  const m = /^\/model\/([a-f0-9]{64})\.glb$/.exec(url);
  if (m && bytesByHash.has(m[1])) { res.setHeader('Content-Type', 'model/gltf-binary'); res.end(bytesByHash.get(m[1])); return; }
  if (url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<html><head><script type="importmap">{"imports":{"three":"/three.module.js"}}</script></head><body style="margin:0;background:transparent"></body></html>'); return; }
  if (Object.hasOwn(modules, url)) { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(modules[url])); return; }
  res.statusCode = 404; res.end();
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const browser = await chromium.launch({ headless: true, ...(chromiumArg ? { executablePath: resolve(chromiumArg) } : {}), args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 400, height: 400 }, deviceScaleFactor: 1 });
await page.goto(origin);
await page.evaluate(async (size: number) => {
  const THREE = await import('/three.module.js' as string);
  const { GLTFLoader } = await import('/loaders/GLTFLoader.js' as string);
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: true, alpha: true });
  renderer.setPixelRatio(2); renderer.setSize(size, size); renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);
  (window as unknown as { nbThumb: (hash: string) => Promise<string> }).nbThumb = async (hash: string) => {
    const buf = await (await fetch(`/model/${hash}.glb`)).arrayBuffer();
    const gltf = await new GLTFLoader().parseAsync(buf, '');
    const root = gltf.scene;
    // A rigged character is shown in its first frame of idle when it has one, never in a T-pose if avoidable.
    const idle = gltf.animations.find((a: { name: string }) => /idle/i.test(a.name)) ?? null;
    if (idle) { const mixer = new THREE.AnimationMixer(root); mixer.clipAction(idle).play(); mixer.update(0.01); }
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const scene = new THREE.Scene(); scene.add(root);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(3, 5, 4); scene.add(key);
    const camera = new THREE.PerspectiveCamera(30, 1, Math.max(sphere.radius / 100, 0.001), sphere.radius * 20);
    const dir = new THREE.Vector3(0.9, 0.55, 1.3).normalize();
    camera.position.copy(sphere.center).addScaledVector(dir, sphere.radius / Math.sin((30 / 2) * Math.PI / 180) * 1.02);
    camera.lookAt(sphere.center);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/webp', 0.82);
    scene.remove(root);
    root.traverse((n: { geometry?: { dispose(): void }; material?: { dispose(): void } | { dispose(): void }[] }) => {
      n.geometry?.dispose(); const mats = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
      for (const mat of mats) mat.dispose();
    });
    return url;
  };
}, LIBRARY_THUMB_SIZE / 2);
let written = 0;
for (const [hash] of bytesByHash) {
  try {
    const dataUrl: string = await page.evaluate((h: string) => (window as unknown as { nbThumb: (h: string) => Promise<string> }).nbThumb(h), hash);
    assert.ok(dataUrl.startsWith('data:image/webp;base64,'), 'not a webp');
    const bytes = Buffer.from(dataUrl.slice('data:image/webp;base64,'.length), 'base64');
    assert.ok(bytes.length > 400, 'blank picture');
    await save(join(out, `${hash}.webp`), bytes); written++;
  } catch (e) { failures.push(`${hash}: ${(e as Error).message.slice(0, 200)}`); }
}
await browser.close(); server.close();
console.log(`${written} pictures written to ${LIBRARY_THUMB_DIR}; ${failures.length} failed`);
for (const f of failures) console.log('FAIL', f);
process.exit(failures.length ? 1 : 0);
