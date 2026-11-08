import { expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
const m=vi.hoisted(()=>({save:vi.fn(async()=>{}),stream:vi.fn(),file:vi.fn(),bucket:vi.fn()}));
vi.mock('firebase-admin',()=>({storage:()=>({bucket:m.bucket})}));
vi.mock('../../lib/workspaceAssetStorage',()=>({workspaceAssetBucketName:()=> 'private-fixture-bucket'}));
import { gameAssetObjectStore } from './objectStore';
it('keeps the six discovery pointers private/mutable and model bytes private/immutable',async()=>{
  m.file.mockReturnValue({save:m.save,createReadStream:m.stream});m.bucket.mockReturnValue({file:m.file});m.stream.mockImplementation(()=>Readable.from([Buffer.from('{}')]));
  const store=gameAssetObjectStore(),key='game-assets-public-cc/discovered/v1/table.json';
  await store.write(key,Buffer.from('{}'),'application/json');expect(m.save).toHaveBeenLastCalledWith(expect.any(Buffer),expect.objectContaining({validation:'crc32c',metadata:{cacheControl:'private, no-store'}}));
  expect(await store.read(key,65536)).toEqual(Buffer.from('{}'));expect(m.stream).toHaveBeenCalledWith({validation:'crc32c'});
  await store.write('game-assets-public-cc/v1/'+'a'.repeat(64)+'.glb',Buffer.from('fixture'),'model/gltf-binary');expect(m.save).toHaveBeenLastCalledWith(expect.any(Buffer),expect.objectContaining({metadata:{cacheControl:'private, max-age=31536000, immutable'}}));
  await expect(store.write(key,Buffer.alloc(65537),'application/json')).rejects.toThrow('budget/type');
  await expect(store.write(key,Buffer.from('{}'),'text/html')).rejects.toThrow('budget/type');
  for(const bad of ['../table.json','game-assets-public-cc/discovered/v1/private-user.json','game-assets-public-cc/discovered/v1/../table.json'])await expect(store.read(bad,65536)).rejects.toThrow('unavailable');
  m.stream.mockImplementation(()=>Readable.from([Buffer.alloc(65537)]));await expect(store.read(key,5*1024*1024)).rejects.toThrow('exceeds budget');
});
