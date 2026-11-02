import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createPolyHavenDiscovery, withDiscoveredAssetCache, isDiscoveredAsset } from './polyHavenDiscovery';
import { createDurableAssetCache } from './assetCache';
import { acquireGameAsset } from './assetEngine';
import { prepareGameAssets } from './assetSeed';
import { paddedSyntheticGlb } from '../../../../tests/fixtures/gameAssetFixtures';
function fixture() {
  const b=Buffer.from(paddedSyntheticGlb()),n=b.readUInt32LE(12),doc=JSON.parse(b.subarray(20,20+n).toString()),bin=b.subarray(28+n);
  doc.buffers[0].uri='model.bin';doc.animations=[];const source=Buffer.from(JSON.stringify(doc));
  const prefix='https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/sample_table/';
  const file=(name:string,bytes:Buffer)=>({url:prefix+name,size:bytes.length,md5:createHash('md5').update(bytes).digest('hex')});
  const info={type:2,name:'Simple Table',categories:['table'],authors:{'Synthetic fixture author':'All'},date_published:1,polycount:4,files_hash:'1'.repeat(40)};
  const files={gltf:{'1k':{gltf:{...file('sample_table.gltf',source),include:{'model.bin':file('model.bin',bin)}}}}};
  const get=vi.fn(async(url:string)=>url.includes('/search?')?{results:[{slug:'sample_table'}]}:url.includes('/info/')?info:files);
  const download=vi.fn(async(url:string)=>url.endsWith('.gltf')?source:bin);
  const objects=new Map<string,Uint8Array>();
  const write=vi.fn(async(key:string,bytes:Uint8Array)=>{objects.set(key,bytes)});
  const store={read:vi.fn(async(key:string,max:number)=>{const b=objects.get(key);if(b&&b.length>max)throw Error('budget');return b??null}),write};
  const cache=()=>withDiscoveredAssetCache(createDurableAssetCache(store,[]),store);
  const parse=vi.fn(async()=>{}),persist=vi.fn(async()=>{});
  const deps=()=>({cache:cache(),providers:[],download:vi.fn(async()=>{throw Error('curated download unexpected')}),discover:createPolyHavenDiscovery({get},download),parse,persist});
  return {get,download,info,files,source,bin,objects,store,cache,parse,persist,deps};
}
it('does no startup download; discovers only the requested object, persists it, then restores a warm cache without provider calls',async()=>{
  const f=fixture(),deps=f.deps(),signal=new AbortController().signal;
  expect(f.get).not.toHaveBeenCalled();expect(f.download).not.toHaveBeenCalled();
  const first=await acquireGameAsset({subject:'table'},deps,signal);expect(first.kind).toBe('model');
  expect(f.get.mock.calls[0][0]).toBe('https://api.polyhaven.com/search?q=table&t=models');expect(f.download).toHaveBeenCalledTimes(2);
  expect(f.parse).toHaveBeenCalledOnce();expect(f.persist).toHaveBeenCalledOnce();
  expect(f.persist.mock.invocationCallOrder[0]).toBeLessThan(f.store.write.mock.invocationCallOrder[0]);
  if(first.kind==='model'){expect(isDiscoveredAsset(first.entry.candidate)).toBe(true);expect(first.entry.candidate.license.spdx).toBe('CC0-1.0');}
  f.get.mockClear();f.download.mockClear();
  const second=await acquireGameAsset({subject:'table'},f.deps(),signal);
  expect(second).toMatchObject({kind:'model',cacheHit:true,downloadedBytes:0});expect(f.get).not.toHaveBeenCalled();expect(f.download).not.toHaveBeenCalled();
});
it('wires requested discovery through the actual build seed and persists visible service credit and local paths',async()=>{
  const f=fixture();const saveText=vi.fn(async()=>{});
  const workspace={writeFile:vi.fn(async()=>{}),writeBinaryFile:vi.fn(async()=>{}),runCommand:vi.fn(async()=>({exitCode:0,stdout:'',stderr:''}))};
  const result=await prepareGameAssets({prompt:'एक मेज बनाओ, private project notes',catalogue:[],workspaceId:'fixture',workspace,env:{AGENTV3_EXTERNAL_GAME_ASSETS:'on'},signal:new AbortController().signal,dependencies:f.deps(),persistence:{saveText,saveBinary:vi.fn(async()=>{}),readBinary:vi.fn(async()=>null)}});
  expect(result.status).toBe('prepared');expect(result.outcomes).toHaveLength(1);expect(saveText).toHaveBeenCalledOnce();
  expect(result.files['src/game/three/assetModels.ts']).toContain('Powered by Poly Haven');expect(result.files['public/game-assets/ATTRIBUTION.txt']).toContain('https://polyhaven.com/license');
  expect(f.get.mock.calls.every(([url])=>!url.includes('private')&&!url.includes('notes'))).toBe(true);
});
it('keeps feature-off, unsupported subjects and required animations network-free',async()=>{
  const f=fixture(),discover=f.deps().discover,signal=new AbortController().signal;
  expect(await discover({subject:'bird',animation:'fly'},signal)).toBeNull();expect(await discover({subject:'railway station'},signal)).toBeNull();
  await prepareGameAssets({prompt:'table',workspaceId:'fixture',workspace:{} as any,env:{},signal,dependencies:f.deps()});
  expect(f.get).not.toHaveBeenCalled();expect(f.download).not.toHaveBeenCalled();
});
it.each(['wrong-category','future','over-budget','foreign-origin','changed-revision','bad-md5','external-reference','parser-failure','persistence-failure'])('falls back without caching a failed admission: %s',async(reason)=>{
  const f=fixture(),deps=f.deps();
  if(reason==='wrong-category')f.info.categories=['chair'];
  if(reason==='future')f.info.date_published=Date.now()/1000+99999;
  if(reason==='over-budget')f.files.gltf['1k'].gltf.size=9*1024*1024;
  if(reason==='foreign-origin')f.files.gltf['1k'].gltf.url='https://unapproved.example/model.gltf';
  if(reason==='changed-revision'){let count=0;f.get.mockImplementation(async url=>url.includes('/search?')?{results:[{slug:'sample_table'}]}:url.includes('/info/')?{...f.info,files_hash:++count===1?'1'.repeat(40):'2'.repeat(40)}:f.files);}
  if(reason==='bad-md5')f.files.gltf['1k'].gltf.md5='0'.repeat(32);
  if(reason==='external-reference'){const doc=JSON.parse(f.source.toString());doc.buffers[0].uri='https://unapproved.example/x';const bytes=Buffer.from(JSON.stringify(doc));f.files.gltf['1k'].gltf.size=bytes.length;f.files.gltf['1k'].gltf.md5=createHash('md5').update(bytes).digest('hex');f.download.mockImplementation(async url=>url.endsWith('.gltf')?bytes:f.bin);}
  if(reason==='parser-failure')f.parse.mockRejectedValue(Error('decoder failed'));
  if(reason==='persistence-failure')f.persist.mockRejectedValue(Error('storage unavailable'));
  expect((await acquireGameAsset({subject:'table'},deps,new AbortController().signal)).kind).toBe('procedural');expect(f.store.write).not.toHaveBeenCalled();
  if(['wrong-category','future','over-budget','foreign-origin'].includes(reason))expect(f.download).not.toHaveBeenCalled();
});
it('coalesces concurrent same-subject admission and rejects tampered durable metadata/bytes',async()=>{
  const f=fixture(),deps=f.deps(),signal=new AbortController().signal;
  await Promise.all([acquireGameAsset({subject:'table'},deps,signal),acquireGameAsset({subject:'table'},deps,signal)]);expect(f.download).toHaveBeenCalledTimes(2);
  const key='game-assets-public-cc/discovered/v1/table.json';const c=JSON.parse(Buffer.from(f.objects.get(key)!).toString());
  c.license.spdx='CC-BY-NC-4.0';f.objects.set(key,Buffer.from(JSON.stringify(c)));expect(await f.cache().find({subject:'table'})).toEqual([]);
  c.license.spdx='CC0-1.0';f.objects.set(key,Buffer.from(JSON.stringify(c)));const cache=f.cache();expect(await cache.find({subject:'table'})).toHaveLength(1);
  f.objects.set('game-assets-public-cc/v1/'+c.sha256+'.glb',Buffer.from('corrupt'));expect(await cache.read(c.sha256)).toBeNull();
});
it('allows only canonical metadata search endpoints and retains the socket-level guard',async()=>{
  const {polyHavenTransport}=await import('./assetTransport');
  const fetch=vi.fn(async()=>new Response(JSON.stringify({results:[]})));vi.stubGlobal('fetch',fetch);
  try {
    await polyHavenTransport.get('https://api.polyhaven.com/search?q=table&t=models',new AbortController().signal);
    expect(fetch).toHaveBeenCalledWith('https://api.polyhaven.com/search?q=table&t=models',expect.objectContaining({redirect:'error',dispatcher:expect.anything(),headers:expect.objectContaining({'Accept-Encoding':'identity'})}));
    fetch.mockClear();
    for(const url of ['https://api.polyhaven.com/search?q=private-notes&t=models','https://api.polyhaven.com/search?q=table&t=all','https://api.polyhaven.com/search?q=table&t=models&token=secret','https://evil.example/search?q=table&t=models'])await expect(polyHavenTransport.get(url,new AbortController().signal)).rejects.toThrow('Unapproved');
    expect(fetch).not.toHaveBeenCalled();
  }finally{vi.unstubAllGlobals();}
});
