/** Explicit browser gate: npx tsx scripts/checks/gameAssetBrowser.check.ts <playwright-index.js> <chromium> */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { transformSync } from 'esbuild';
import { assetBrowserProofModule } from '../../src/server/AgentV3/gameAssets/assetBrowserProof';
import { generateGameAssetRuntime } from '../../src/server/lib/GameAssetRuntimeGenerator';
import { syntheticGlb, syntheticCandidate } from '../../src/server/AgentV3/gameAssets/assetFixtures.testSupport';

async function main() {
  const [playwrightPath, chromiumPath] = process.argv.slice(2);
  assert.ok(playwrightPath && chromiumPath, 'Supply existing Playwright module and Chromium executable paths; missing tooling is not a pass.');
  const { default: playwright } = await import(pathToFileURL(resolve(playwrightPath)).href);
  const dir = await mkdtemp(join(tmpdir(), 'nbai-asset-browser-'));
  const bytes = syntheticGlb(true, true); const candidate = syntheticCandidate(bytes);
  let browser: any; let server: ReturnType<typeof createServer> | undefined;
  try {
    await symlink(resolve('node_modules'), join(dir,'node_modules'));
    await writeFile(join(dir,`.nbai-asset-${candidate.sha256}.glb`),bytes);
    const importLine = `import playwright from ${JSON.stringify(pathToFileURL(resolve(playwrightPath)).href)}; const { chromium } = playwright;`;
    await writeFile(join(dir,'proof.mjs'),assetBrowserProofModule(candidate.sha256,'Move',importLine,resolve(chromiumPath)));
    const proof = execFileSync(process.execPath,['proof.mjs'],{cwd:dir,encoding:'utf8',timeout:30000});
    assert.match(proof,/"rendered":true/); assert.match(proof,/"animated":true/);
    console.log(proof.trim());
    const runtime = transformSync(generateGameAssetRuntime(),{loader:'ts',format:'esm',target:'es2022',define:{'import.meta.env.BASE_URL':'"/"'}}).code;
    const modules: Record<string,string> = {
      '/three.module.js':'node_modules/three/build/three.module.js', '/three.core.js':'node_modules/three/build/three.core.js',
      '/addons/loaders/GLTFLoader.js':'node_modules/three/examples/jsm/loaders/GLTFLoader.js',
      '/addons/utils/BufferGeometryUtils.js':'node_modules/three/examples/jsm/utils/BufferGeometryUtils.js',
    };
    const requests: string[] = [];
    server = createServer(async(req,res)=>{
      const path=req.url ?? ''; requests.push(path);
      try {
        if(path==='/') { res.setHeader('Content-Type','text/html');res.end('<html><head><script type="importmap">{"imports":{"three":"/three.module.js","three/addons/":"/addons/"}}</script></head><body></body></html>'); }
        else if(path==='/runtime.js') {res.setHeader('Content-Type','text/javascript');res.end(runtime);}
        else if(Object.hasOwn(modules,path)){res.setHeader('Content-Type','text/javascript');res.end(await readFile(modules[path]));}
        else if(path===`/game-assets/${candidate.sha256}.glb`){res.setHeader('Content-Type','model/gltf-binary');res.end(bytes);}
        else {res.statusCode=404;res.end();}
      } catch {res.statusCode=500;res.end();}
    });
    await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));
    const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    browser=await playwright.chromium.launch({executablePath:resolve(chromiumPath),headless:true,args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader']});
    const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
    const external:string[]=[];
    await page.route('**/*',(route:any)=>{ if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();} return route.continue();});
    for(let reload=0;reload<2;reload++){
      await page.goto(origin);
      const result=await page.evaluate(`(async(c)=>{
        const runtime=await import(/* @vite-ignore */ '/runtime.js');
        const THREE=await import(/* @vite-ignore */ '/three.module.js');
        let fallbackCalls=0;
        const fallback=()=>{fallbackCalls++;return {root:new THREE.Group(),source:'procedural',update(){},dispose(){}};};
        const model=await runtime.loadGameAsset({sha256:c.sha256,height:1.8,yaw:0,animation:'Move',serviceCredit:'Synthetic model test credit'},fallback);
        const box=new THREE.Box3().setFromObject(model.root); const before=box.min.y;
        model.update(.1); const moved=new THREE.Box3().setFromObject(model.root).min.y;
        const credit=document.body.textContent.includes('Synthetic model test credit');
        model.dispose(); model.dispose();
        const removed=!document.body.textContent.includes('Synthetic model test credit');
        const missing=await runtime.loadGameAsset({sha256:'f'.repeat(64),height:1,yaw:0},fallback);
        return {source:model.source,height:box.max.y-box.min.y,ground:before,moving:Math.abs(moved-before)>0.001,credit,removed,fallbackCalls,missing:missing.source};
      })(${JSON.stringify(candidate)})`);
      assert.equal(result.source,'model'); assert.ok(Math.abs(result.height-1.8)<0.001); assert.ok(Math.abs(result.ground)<0.001);
      assert.equal(result.moving,true);assert.equal(result.credit,true);assert.equal(result.removed,true);assert.equal(result.fallbackCalls,1);assert.equal(result.missing,'procedural');
    }
    assert.deepEqual(external,[]);assert.ok(requests.filter(p=>p===`/game-assets/${candidate.sha256}.glb`).length>=2);
    console.log('PASS: real Chromium/Three.js synthetic model rendered and animated; generated loader normalized scale/ground, emitted and removed credits, fell back on 404 and survived page reload using owned URLs only. Not real provider assets or published-user-game acceptance.');
  } finally {
    await browser?.close(); if(server) await new Promise<void>(r=>server!.close(()=>r()));
    await rm(dir,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
