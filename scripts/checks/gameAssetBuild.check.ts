/** Synthetic production-build acceptance. Uses existing Vite, Three.js, Playwright and Chromium. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { build } from 'vite';
import { generateGameAssetRuntime } from '../../src/server/lib/GameAssetRuntimeGenerator';
import { syntheticGlb, syntheticCandidate } from '../../src/server/AgentV3/gameAssets/assetFixtures.testSupport';

async function main() {
  const [playwrightPath, chromiumPath] = process.argv.slice(2);
  assert.ok(playwrightPath && chromiumPath, 'Existing browser tooling required');
  const { default: playwright } = await import(pathToFileURL(resolve(playwrightPath)).href);
  const dir = await mkdtemp(join(tmpdir(), 'nbai-asset-build-'));
  const bytes = syntheticGlb(true, true); const candidate = syntheticCandidate(bytes);
  let browser: any; let server: ReturnType<typeof createServer> | undefined;
  try {
    await symlink(resolve('node_modules'),join(dir,'node_modules'));
    await mkdir(join(dir,'public/game-assets'),{recursive:true});
    await writeFile(join(dir,'public/game-assets',candidate.sha256+'.glb'),bytes);
    await writeFile(join(dir,'public/game-assets/ATTRIBUTION.txt'),'Synthetic test fixture; no provider asset claim.');
    await writeFile(join(dir,'public/game-assets/manifest.json'),JSON.stringify({schema:1,assets:[candidate]}));
    await writeFile(join(dir,'index.html'),'<html><body><script type="module" src="/main.ts"></script></body></html>');
    await writeFile(join(dir,'runtime.ts'),generateGameAssetRuntime());
    await writeFile(join(dir,'main.ts'),`import * as THREE from 'three';
import { loadGameAsset } from './runtime';
const h = await loadGameAsset(${JSON.stringify({sha256:candidate.sha256,height:2,yaw:0,animation:'Move'})},()=>{throw Error('Unexpected procedural fallback')});
const scene=new THREE.Scene();scene.add(h.root);scene.add(new THREE.HemisphereLight(0xffffff,0x777777,3));
const camera=new THREE.PerspectiveCamera(45,1,0.01,100);camera.position.set(4,3,5);camera.lookAt(0,1,0);
const renderer=new THREE.WebGLRenderer({preserveDrawingBuffer:true});renderer.setSize(128,128);document.body.appendChild(renderer.domElement);
h.root.updateMatrixWorld(true);const before=[];h.root.traverse(o=>before.push(...o.matrixWorld.elements));h.update(0.1);h.root.updateMatrixWorld(true);const after=[];h.root.traverse(o=>after.push(...o.matrixWorld.elements));
renderer.render(scene,camera);const gl=renderer.getContext();const pixels=new Uint8Array(128*128*4);gl.readPixels(0,0,128,128,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let changed=0;for(let i=4;i<pixels.length;i+=4)if(pixels[i]!==pixels[0]||pixels[i+1]!==pixels[1]||pixels[i+2]!==pixels[2])changed++;
window.__assetBuildProof={source:h.source,triangles:renderer.info.render.triangles,animated:after.some((v,i)=>Math.abs(v-before[i])>1e-6),changed};`);
    await build({root:dir,configFile:false,base:'/published/',logLevel:'error',build:{target:'es2022'}});
    assert.equal(createHash('sha256').update(await readFile(join(dir,'dist/game-assets',candidate.sha256+'.glb'))).digest('hex'),candidate.sha256);
    assert.deepEqual(JSON.parse(await readFile(join(dir,'dist/game-assets/manifest.json'),'utf8')).assets[0],candidate);
    const requested: string[]=[];
    server=createServer(async(req,res)=>{
      try {
        const path=new URL(req.url ?? '/', 'http://localhost').pathname;
        assert.ok(path.startsWith('/published/') && !path.includes('..'));
        const relative=path.slice('/published/'.length) || 'index.html';
        res.setHeader('Content-Type',relative.endsWith('.js')?'text/javascript':relative.endsWith('.glb')?'model/gltf-binary':relative.endsWith('.html')?'text/html':'text/plain');
        res.end(await readFile(join(dir,'dist',relative)));
      } catch { res.statusCode=404;res.end(); }
    });
    await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    browser=await playwright.chromium.launch({executablePath:resolve(chromiumPath),headless:true,args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader']});
    const page=await browser.newPage({viewport:{width:390,height:844}});
    await page.route('**/*',(route:any)=>{const url=route.request().url();requested.push(url);return new URL(url).origin===origin?route.continue():route.abort();});
    const failures:string[]=[];page.on('pageerror',(e:Error)=>failures.push(e.message));
    for(let n=0;n<2;n++) {
      await page.goto(origin+'/published/');
      await page.waitForFunction('Boolean(window.__assetBuildProof)',{},{timeout:15000});
      const proof=await page.evaluate('window.__assetBuildProof');
      assert.equal(proof.source,'model');assert.equal(proof.animated,true);assert.ok(proof.triangles>0 && proof.changed>8);
    }
    assert.deepEqual(failures,[]);assert.ok(requested.some(url=>url.endsWith(candidate.sha256+'.glb')));
    assert.ok(requested.every(url=>new URL(url).origin===origin));
    console.log('PASS: actual Vite production bundle preserved synthetic GLB hash and manifest; Chromium rendered and animated the built runtime at a nested publish base after reload using owned URLs only. Not a live cloud publication or real provider asset.');
  } finally { await browser?.close();if(server)await new Promise<void>(r=>server!.close(()=>r()));await rm(dir,{recursive:true,force:true}); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
