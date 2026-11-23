import { gameAssetTextureVerifier } from '../../lib/GameAssetTextureVerifier';
import { SANDBOX_BROWSER_ARGS, playwrightImport, browserScriptRunLine } from '../sandboxBrowserScript';
import type { AssetRequirement } from './assetPolicy';
import type { GameAssetWorkspace } from './assetProject';
import { createHash, randomBytes } from 'node:crypto';
import { PLATFORM_SCRATCH_DIR } from '../../lib/generatedDirs';

export const ASSET_PROOF_MARKER = 'NBAI_ASSET_PROOF:';
/** Generated verifier uses only the already-installed sandbox Three.js and browser tooling. */
export function assetBrowserProofModule(hash: string, animation?: string, importLine = playwrightImport('/home/user/.e-tools'), executablePath?: string, modelPath = `.nbai-asset-${hash}.glb`): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid proof hash');
  // The default is the layout of the offline admission checks (scripts/checks), which stage the model in a
  // throwaway fixture directory. In a sandbox, proveAssetInSandbox always passes its scratch path.
  if (!isSafeProofPath(modelPath)) throw new Error('Invalid proof model path');
  return `${importLine}
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const cfg = ${JSON.stringify({ hash, animation, executablePath, modelPath })};
const bytes = await readFile(cfg.modelPath);
if (createHash('sha256').update(bytes).digest('hex') !== cfg.hash) throw Error('Staged asset hash mismatch');
const modules = {
  '/three.module.js': 'node_modules/three/build/three.module.js',
  '/three.core.js': 'node_modules/three/build/three.core.js',
  '/loaders/GLTFLoader.js': 'node_modules/three/examples/jsm/loaders/GLTFLoader.js',
  '/utils/BufferGeometryUtils.js': 'node_modules/three/examples/jsm/utils/BufferGeometryUtils.js',
};
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/model.glb') { res.setHeader('Content-Type', 'model/gltf-binary'); res.end(bytes); }
    else if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<html><head><script type="importmap">{"imports":{"three":"/three.module.js"}}</script></head><body></body></html>'); }
    else if (Object.hasOwn(modules, req.url)) { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(modules[req.url])); }
    else { res.statusCode = 404; res.end(); }
  } catch { res.statusCode = 500; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const watchdog = setTimeout(() => { console.error('Asset proof deadline exceeded'); process.exit(1); }, 20000);
try {
  browser = await chromium.launch({ headless: true, ...(cfg.executablePath ? { executablePath: cfg.executablePath } : {}), args: [...${JSON.stringify(SANDBOX_BROWSER_ARGS)}, '--use-gl=angle'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const origin = 'http://127.0.0.1:' + server.address().port;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin, { timeout: 5000 });
  const result = await page.evaluate(async cfg => {
    const THREE = await import('/three.module.js');
    const { GLTFLoader } = await import('/loaders/GLTFLoader.js');
    ${gameAssetTextureVerifier()}
    const bytes = new Uint8Array(await (await fetch('/model.glb')).arrayBuffer());
    await verifyGameAssetTextures(bytes);
    const manager = new THREE.LoadingManager();
    let textureFailed = false; manager.onError = () => { textureFailed = true; };
    manager.setURLModifier(url => { if (url.startsWith('blob:' + location.origin + '/')) return url; throw Error('External resource'); });
    const gltf = await new GLTFLoader(manager).parseAsync(bytes.buffer, '');
    if (textureFailed) throw Error('Texture load failed');
    const root = gltf.scene;
    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());
    if (bounds.isEmpty() || ![size.x, size.y, size.z].every(Number.isFinite) || size.length() <= 0) throw Error('Empty or non-finite model');
    const center = bounds.getCenter(new THREE.Vector3());
    const scene = new THREE.Scene(); scene.add(root);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 3));
    const light = new THREE.DirectionalLight(0xffffff, 4); light.position.set(3, 5, 7); scene.add(light);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.001, size.length() * 20 + 10);
    camera.position.copy(center).add(new THREE.Vector3(1, 0.7, 1.4).normalize().multiplyScalar(size.length() * 1.7)); camera.lookAt(center);
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: false });
    renderer.setSize(128, 128); renderer.setClearColor(0x15191f); document.body.appendChild(renderer.domElement);
    const clip = cfg.animation ? gltf.animations.find(c => c.name === cfg.animation) : undefined;
    if (cfg.animation && !clip) throw Error('Missing required clip');
    let animated = false;
    if (clip) {
      const mixer = new THREE.AnimationMixer(root); mixer.clipAction(clip).play();
      const pose = () => { root.updateMatrixWorld(true); const p = []; root.traverse(n => { p.push(...n.matrixWorld.elements, ...(n.morphTargetInfluences || [])); }); return p; };
      mixer.update(0); const before = pose();
      for (const fraction of [0.17, 0.31, 0.43]) { mixer.update(clip.duration * fraction); const after = pose(); if (after.some((v, i) => Math.abs(v - before[i]) > 1e-6)) animated = true; }
      if (!animated) throw Error('Animation has no observable motion');
    }
    renderer.render(scene, camera);
    const gl = renderer.getContext(); const pixels = new Uint8Array(128 * 128 * 4);
    gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let different = 0;
    for (let i = 4; i < pixels.length; i += 4) if (Math.abs(pixels[i] - pixels[0]) + Math.abs(pixels[i + 1] - pixels[1]) + Math.abs(pixels[i + 2] - pixels[2]) > 12) different++;
    const triangles = renderer.info.render.triangles;
    renderer.dispose();
    if (triangles < 1 || different < 8) throw Error('Model did not visibly render');
    return { rendered: true, animated, triangles, changedPixels: different };
  }, cfg);
  console.log('${ASSET_PROOF_MARKER}' + JSON.stringify({ hash: cfg.hash, ...result }));
} finally { clearTimeout(watchdog); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
`;
}

/**
 * Where one proof stages its model and script: NavBharatAI's scratch directory, never the user's project.
 *
 * 🔴 failedbr #2496 (2026-11-22). These used to be `.nbai-asset-<sha>.mjs` / `.glb` at the PROJECT ROOT, removed in
 * `finally` with `rm -f`. The rm ran — but the script had been written through the dispatcher's recorded write door,
 * which notes every text write for the durable save, and an rm is not a write. So the script was saved into the
 * user's project, restored into every later sandbox, listed in the build manifest as a file the build wrote, and
 * graded by readiness as the app's own "hardcoded localhost URL" and "hardcoded server port". Under
 * PLATFORM_SCRATCH_DIR (inside node_modules) no store, listing, analyzer, git commit or archive can see it.
 *
 * The nonce keeps two proofs of the same bytes (one model asked for with two animations) from deleting each other's
 * files. The script still runs with the project root as its working directory, so it reads the project's own
 * `node_modules/three`; Playwright is imported by absolute path. PURE.
 */
export function assetProofFiles(hash: string, nonce: string): { model: string; script: string; log: string } {
  const stem = `${PLATFORM_SCRATCH_DIR}/asset-${hash}-${nonce}`;
  return { model: `${stem}.glb`, script: `${stem}.mjs`, log: `${stem}.mjs.log` };
}

/** A relative path a shell line and a JSON literal can both carry unquoted and unescaped. PURE. */
function isSafeProofPath(path: string): boolean {
  return /^[A-Za-z0-9._/-]+$/.test(path) && !path.startsWith('/') && !path.split('/').includes('..');
}

/** A browser/tooling failure rejects L3 so the existing procedural model remains available. */
export async function proveAssetInSandbox(workspace: GameAssetWorkspace, workspaceId: string, bytes: Uint8Array, requirement: AssetRequirement): Promise<void> {
  const hash = createHash('sha256').update(bytes).digest('hex');
  const files = assetProofFiles(hash, randomBytes(6).toString('hex'));
  try {
    await workspace.writeBinaryFile(workspaceId, files.model, Buffer.from(bytes).toString('base64'));
    await workspace.writeFile(workspaceId, files.script, assetBrowserProofModule(hash, requirement.animation, undefined, undefined, files.model));
    const run = browserScriptRunLine({ toolsDir: '/home/user/.e-tools', scriptPath: files.script, marker: ASSET_PROOF_MARKER });
    const result = await workspace.runCommand(workspaceId, run);
    const line = result.stdout.split('\n').find(l => l.startsWith(ASSET_PROOF_MARKER));
    const proof = line ? JSON.parse(line.slice(ASSET_PROOF_MARKER.length)) : null;
    if (proof?.hash !== hash || proof.rendered !== true || (requirement.animation && proof.animated !== true)) throw new Error('Model render/animation proof unavailable');
  } finally {
    // The run line's log goes too — it used to be left behind beside the script.
    await workspace.runCommand(workspaceId, `rm -f -- ${files.model} ${files.script} ${files.log}`).catch(() => {});
  }
}
