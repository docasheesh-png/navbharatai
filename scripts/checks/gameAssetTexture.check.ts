/** Actual browser decoding of original synthetic JPEG fixtures, including an unused corrupt texture. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { jpegFixtures } from '../../tests/fixtures/gameTextureJpeg';
import { paddedSyntheticGlb, encodeFixtureGlb } from '../../tests/fixtures/gameAssetFixtures';
import { validateGlb } from '../../src/server/AgentV3/gameAssets/assetPolicy';
import { assetBrowserProofModule } from '../../src/server/AgentV3/gameAssets/assetBrowserProof';
async function main() {
  const [output,playwrightPath,chromiumPath]=process.argv.slice(2);assert.ok(output&&playwrightPath&&chromiumPath);
  const dir=resolve(output);await mkdir(dir,{recursive:true});try{await symlink(resolve('node_modules'),join(dir,'node_modules'));}catch(e:any){if(e.code!=='EEXIST')throw e;}
  for (const kind of ['baseline','progressive','corrupt-unused'] as const) {
    let jpeg=Buffer.from(jpegFixtures[kind==='progressive'?'progressive':'baseline'],'base64');
    if(kind==='corrupt-unused') {
      // Remove quantization tables; marker/dimension inspection alone cannot establish decodability.
      for(;;){const at=jpeg.indexOf(Buffer.from([255,219]));if(at<0)break;const size=jpeg.readUInt16BE(at+2);jpeg=Buffer.concat([jpeg.subarray(0,at),jpeg.subarray(at+2+size)]);}
    }
    const source=Buffer.from(paddedSyntheticGlb()),n=source.readUInt32LE(12),doc=JSON.parse(source.subarray(20,20+n).toString());
    const bin=Buffer.concat([source.subarray(28+n),jpeg,Buffer.alloc((4-jpeg.length%4)%4)]);
    doc.buffers[0].byteLength=bin.length;
    const img={mimeType:'image/jpeg',bufferView:doc.bufferViews.length};
    doc.bufferViews.push({buffer:0,byteOffset:source.length-28-n,byteLength:jpeg.length});
    if(kind==='corrupt-unused')doc.images.push(img);else doc.images[0]=img;
    const glb=encodeFixtureGlb(doc,bin);validateGlb(glb);
    const hash=createHash('sha256').update(glb).digest('hex');await writeFile(join(dir,`.nbai-asset-${hash}.glb`),glb);
    await writeFile(join(dir,'proof.mjs'),assetBrowserProofModule(hash,undefined,`import { chromium } from ${JSON.stringify(pathToFileURL(resolve(playwrightPath)).href)};`,resolve(chromiumPath)));
    if(kind==='corrupt-unused')assert.throws(()=>execFileSync(process.execPath,['proof.mjs'],{cwd:dir,encoding:'utf8',timeout:30000,stdio:'pipe'}),/could not be decoded|InvalidStateError/);
    else assert.match(execFileSync(process.execPath,['proof.mjs'],{cwd:dir,encoding:'utf8',timeout:30000}),/"rendered":true/);
    console.log('PASS',kind,hash);
    assert.equal(createHash('sha256').update(await readFile(join(dir,`.nbai-asset-${hash}.glb`))).digest('hex'),hash);
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
