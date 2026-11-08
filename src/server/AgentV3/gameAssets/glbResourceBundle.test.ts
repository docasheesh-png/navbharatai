import {expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {bundleGlbResources} from './glbResourceBundle';
import {validateGlb} from './assetPolicy';
import {validateCatalogue} from './providers';
import {paddedSyntheticGlb,encodeFixtureGlb,syntheticCandidate} from '../../../../tests/fixtures/gameAssetFixtures';
function fixture(){
 const b=Buffer.from(paddedSyntheticGlb());const n=b.readUInt32LE(12);const doc=JSON.parse(b.subarray(20,20+n).toString());const bin=b.subarray(28+n);
 const v=doc.bufferViews[doc.images[0].bufferView];const png=bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);
 delete doc.images[0].bufferView;doc.images[0].uri='Textures/atlas.png';
 doc.materials[0].pbrMetallicRoughness.baseColorTexture.extensions={KHR_texture_transform:{texCoord:0}};
 doc.extensionsUsed=['KHR_texture_transform'];return{doc,bin,png};
}
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
it('embeds only reviewed relative PNG resources and removes a strictly identity texture transform',()=>{
 const{doc,bin,png}=fixture();const out=bundleGlbResources(encodeFixtureGlb(doc,bin),new Map([['Textures/atlas.png',png]]));
 expect(validateGlb(out)).toMatchObject({triangles:4,animations:['Move']});
 const b=Buffer.from(out),n=b.readUInt32LE(12),after=JSON.parse(b.subarray(20,20+n).toString());
 expect(after.extensionsUsed).toBeUndefined();expect(after.images[0].uri).toBeUndefined();
 expect(after.materials[0].pbrMetallicRoughness.baseColorTexture.extensions).toBeUndefined();
});
it.each([{rotation:1},{texCoord:1},{offset:[1,0]},{scale:[2,1]},{unknown:true}])('rejects a transform that is not a reviewed no-op: %s',transform=>{
 const{doc,bin,png}=fixture();doc.materials[0].pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform=transform;
 expect(()=>bundleGlbResources(encodeFixtureGlb(doc,bin),new Map([['Textures/atlas.png',png]]))).toThrow();
});
it('rejects unknown extensions, missing resources, external URIs, source buffer references and malformed chunk lengths',()=>{
 const{doc,bin,png}=fixture();const resources=new Map([['Textures/atlas.png',png]]);
 expect(()=>bundleGlbResources(encodeFixtureGlb(doc,bin),new Map())).toThrow();
 doc.extensionsUsed.push('KHR_draco_mesh_compression');expect(()=>bundleGlbResources(encodeFixtureGlb(doc,bin),resources)).toThrow();doc.extensionsUsed.pop();
 doc.buffers[0].uri='https://example.com/data';expect(()=>bundleGlbResources(encodeFixtureGlb(doc,bin),resources)).toThrow();delete doc.buffers[0].uri;
 doc.images[0].uri='../atlas.png';expect(()=>bundleGlbResources(encodeFixtureGlb(doc,bin),resources)).toThrow();doc.images[0].uri='Textures/atlas.png';
 const b=Buffer.from(encodeFixtureGlb(doc,bin));b.writeUInt32LE(0xffffffff,12);expect(()=>bundleGlbResources(b,resources)).toThrow();
});
it('enforces source and resource hashes in the actual resource transport',async()=>{
 const{doc,bin,png}=fixture(),source=encodeFixtureGlb(doc,bin);const expected=bundleGlbResources(source,new Map([['Textures/atlas.png',png]]));
 const c={...syntheticCandidate(expected),format:'glb-resources' as const,sourceSha256:hash(source),resources:[{path:'Textures/atlas.png',url:'https://models.example/atlas.png',sha256:hash(png)}]};
 validateCatalogue([c]);expect(()=>validateCatalogue([{...c,sourceSha256:undefined}])).toThrow();
 vi.resetModules();const{downloadReviewedAsset}=await import('./assetTransport');vi.stubGlobal('fetch',vi.fn(async(url:string|URL)=>new Response(String(url).endsWith('.png')?png:source)));
 try{expect(await downloadReviewedAsset(c,new AbortController().signal)).toEqual(expected);
 await expect(downloadReviewedAsset({...c,resources:[{...c.resources[0],sha256:'0'.repeat(64)}]},new AbortController().signal)).rejects.toThrow('hash/budget mismatch');}
 finally{vi.unstubAllGlobals();}
});
