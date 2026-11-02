import { createHash } from 'node:crypto';
import { BoundedCache } from '../../lib/boundedCache';
import { ASSET_LIMITS, candidateMatches, validateGlb } from './assetPolicy';
import type { AssetCache, AssetEngineDependencies } from './assetEngine';
import type { AssetObjectStore } from './assetCache';
import { assetCacheKey } from './assetCache';
import { bundleGltf, safeGltfResourcePath } from './gltfBundle';
import { compactGlb } from './assetOptimize';
import { validateCatalogue, type ReviewedAsset, type ProviderJsonTransport } from './providers';

export const DISCOVERY_SUBJECTS: Readonly<Record<string, number>> = Object.freeze({ table: 0.8, chair: 1, bench: 0.9, rock: 1, tree: 4, plant: 0.5 });
const POLICY = 'polyhaven-cc0-v1';
const CREDIT = 'Powered by Poly Haven';
const digest = (b: Uint8Array, algorithm = 'sha256') => createHash(algorithm).update(b).digest('hex');
const object = (v: unknown): Record<string, any> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : null;
interface SourceFile { path: string; url: string; size: number; md5: string; sha256: string }
export interface DiscoveredAsset extends ReviewedAsset { discovery: { policy: typeof POLICY; files: SourceFile[] } }
function fileUrl(raw: unknown, id: string): string {
  if (typeof raw !== 'string') throw Error('Missing official file URL');
  const u = new URL(raw);
  if (u.origin !== 'https://dl.polyhaven.org' || u.search || u.hash || u.username || u.password
    || !new RegExp('^/file/ph-assets/Models/(gltf|jpg|png)/(1k|2k|4k)/'+id+'/[A-Za-z0-9_.-]+\\.(gltf|bin|jpg|png)$').test(u.pathname)) throw Error('Unapproved provider file');
  return raw;
}
/** Revalidate server-owned discovery cache records; never use user manifests as cache authority. */
export function isDiscoveredAsset(value: unknown, subject?: string): value is DiscoveredAsset {
  try {
    const c = value as DiscoveredAsset;
    if (!c || c.provider !== 'polyhaven' || !/^[a-z0-9_]{1,80}$/.test(c.id) || !/^[a-f0-9]{40}$/.test(c.revision)
      || c.subjects.length !== 1 || !Object.hasOwn(DISCOVERY_SUBJECTS,c.subjects[0]) || (subject && c.subjects[0] !== subject)
      || c.height !== DISCOVERY_SUBJECTS[c.subjects[0]] || c.yaw !== 0 || c.animations.length || Object.keys(c.animationRoles ?? {}).length
      || c.sourceUrl !== `https://polyhaven.com/a/${c.id}` || c.license.spdx !== 'CC0-1.0'
      || c.license.evidenceUrl !== 'https://polyhaven.com/license' || c.license.author.length > 256
      || c.serviceCredit !== CREDIT || c.review.reviewer !== POLICY || c.review.evidenceRevision !== c.revision
      || c.discovery?.policy !== POLICY || !Array.isArray(c.discovery.files) || !c.discovery.files.length || c.discovery.files.length > 17
      || c.format !== 'gltf' || c.optimization !== 'compact-v1') return false;
    validateCatalogue([c]);
    let size = 0;
    for (const f of c.discovery.files) {
      fileUrl(f.url,c.id);
      if (!safeGltfResourcePath(f.path) || !Number.isSafeInteger(f.size) || f.size <= 0 || !/^[a-f0-9]{32}$/.test(f.md5) || !/^[a-f0-9]{64}$/.test(f.sha256)) return false;
      size += f.size;
    }
    if (size > ASSET_LIMITS.bytes || c.discovery.files[0].url !== c.downloadUrl || c.sourceSha256 !== c.discovery.files[0].sha256
      || c.downloadOrigins.length !== 1 || c.downloadOrigins[0] !== 'https://dl.polyhaven.org' || c.resources?.length !== c.discovery.files.length-1) return false;
    return c.discovery.files.slice(1).every((f,i)=>c.resources![i].path===f.path && c.resources![i].url===f.url && c.resources![i].sha256===f.sha256);
  } catch { return false; }
}
/** Only called after an exact-object cache/catalogue miss. No crawling, startup or background download. */
export function createPolyHavenDiscovery(json: ProviderJsonTransport, download: (url: string, signal: AbortSignal) => Promise<Uint8Array>): NonNullable<AssetEngineDependencies['discover']> {
  const pending = new BoundedCache<string, Promise<{ candidate: DiscoveredAsset; bytes: Uint8Array } | null>>({ maxEntries: 4 });
  return async (requirement, signal) => {
    signal.throwIfAborted();
    if (requirement.animation || !Object.hasOwn(DISCOVERY_SUBJECTS,requirement.subject)) return null;
    let transfer = pending.get(requirement.subject);
    if (!transfer) {
      if (pending.size >= 4) return null;
      transfer = (async () => {
        const deadline = AbortSignal.timeout(25000), subject = requirement.subject;
        const search = object(await json.get(`https://api.polyhaven.com/search?q=${subject}&t=models`,deadline));
        if (!Array.isArray(search?.results) || search.results.length > 1024) return null;
        for (const hit of search.results.slice(0,3)) {
          const id = object(hit)?.slug;
          if (typeof id !== 'string' || !/^[a-z0-9_]{1,80}$/.test(id)) continue;
          const info = object(await json.get(`https://api.polyhaven.com/info/${id}`,deadline));
          // Similarity rank is not semantic evidence: require exact category and named-object token.
          if (info?.type !== 2 || !Array.isArray(info.categories) || !info.categories.includes(subject)
            || typeof info.name !== 'string' || !(` ${info.name.toLowerCase().replace(/[^a-z0-9]+/g,' ')} `).includes(` ${subject} `)
            || !Number.isFinite(info.date_published) || info.date_published <= 0 || info.date_published*1000 > Date.now()
            || info.staging || (info.license !== undefined && !['CC0','CC0-1.0'].includes(info.license)) || !/^[a-f0-9]{40}$/.test(info.files_hash) || !Number.isSafeInteger(info.polycount) || info.polycount <= 0 || info.polycount > ASSET_LIMITS.triangles) continue;
          const authors = object(info.authors); if (!authors || !Object.keys(authors).length) continue;
          const author = Object.keys(authors).join('; '); if (author.length > 256) continue;
          const files = object(await json.get(`https://api.polyhaven.com/files/${id}`,deadline));
          const gltf = object(object(object(files?.gltf)?.['1k'])?.gltf);
          const includes = object(gltf?.include);
          if (!gltf || !includes || !Object.keys(includes).length || Object.keys(includes).length > 16) continue;
          const descriptions: Array<Record<string,any>> = [{...gltf,path:`${id}.gltf`},...Object.entries(includes).map(([path,v])=>({...object(v),path}))];
          const sources: SourceFile[] = []; let size=0;
          for (const f of descriptions) {
            if (!safeGltfResourcePath(f.path) || !Number.isSafeInteger(f.size) || f.size <= 0 || !/^[a-f0-9]{32}$/.test(f.md5)) throw Error('Invalid provider file metadata');
            size += f.size; if(size > ASSET_LIMITS.bytes) throw Error('Provider package exceeds budget');
            sources.push({path:f.path,url:fileUrl(f.url,id),size:f.size,md5:f.md5,sha256:''});
          }
          if (!sources[0].url.endsWith('.gltf')) throw Error('Unsupported provider model');
          const resources = new Map<string,Uint8Array>(); let source: Uint8Array | undefined;
          for (const [i,f] of sources.entries()) {
            deadline.throwIfAborted(); const bytes = await download(f.url,deadline);
            // Provider MD5 is a transfer consistency check, NOT a cryptographic authenticity claim.
            if(bytes.length !== f.size || digest(bytes,'md5') !== f.md5) throw Error('Provider content changed');
            f.sha256=digest(bytes); if(i===0)source=bytes;else resources.set(f.path,bytes);
          }
          const after = object(await json.get(`https://api.polyhaven.com/info/${id}`,deadline));
          if(after?.files_hash !== info.files_hash) throw Error('Provider revision changed during admission');
          const bytes = compactGlb(bundleGltf(source!,resources)).bytes;validateGlb(bytes);
          const candidate: DiscoveredAsset = {
            provider:'polyhaven',id,revision:info.files_hash,sourceUrl:`https://polyhaven.com/a/${id}`,downloadUrl:sources[0].url,
            sha256:digest(bytes),sourceSha256:sources[0].sha256,subjects:[subject],animations:[],height:DISCOVERY_SUBJECTS[subject],yaw:0,
            format:'gltf',optimization:'compact-v1',downloadOrigins:['https://dl.polyhaven.org'],serviceCredit:CREDIT,
            resources:sources.slice(1).map(f=>({path:f.path,url:f.url,sha256:f.sha256})),
            review:{reviewer:POLICY,evidenceRevision:info.files_hash,freeDownload:true},
            license:{spdx:'CC0-1.0',evidenceUrl:'https://polyhaven.com/license',reviewedAt:new Date().toISOString(),author,
              attribution:`${author}; Poly Haven CC0 asset. Bundled/compacted; runtime scale, orientation and eligible static LOD geometry may change.`,commercial:true,redistributeInGame:true,redistributeSource:true},
            discovery:{policy:POLICY,files:sources},
          };
          if(!isDiscoveredAsset(candidate,subject))throw Error('Discovery admission policy failed');
          return {candidate,bytes};
        }
        return null;
      })();
      pending.set(requirement.subject,transfer);
      void transfer.finally(()=>pending.delete(requirement.subject)).catch(()=>{});
    }
    const result=await transfer;signal.throwIfAborted();return result;
  };
}
/** Small private server index per supported canonical subject; no listing or user-data cache keys. */
export function withDiscoveredAssetCache(base: AssetCache, store: AssetObjectStore): AssetCache {
  const known = new BoundedCache<string,DiscoveredAsset>({ maxEntries: 6 });
  return {
    async find(r) {
      const entries = [...await base.find(r)];
      if(r.animation || !Object.hasOwn(DISCOVERY_SUBJECTS,r.subject))return entries;
      try {
        const data=await store.read(`game-assets-public-cc/discovered/v1/${r.subject}.json`,65536);
        if(data && data.length<=65536){const c=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
          if(isDiscoveredAsset(c,r.subject) && candidateMatches(c,r)){known.set(c.sha256,c);entries.push({schema:1,candidate:c,sha256:c.sha256,path:`public/game-assets/${c.sha256}.glb`,model:{bytes:0,triangles:0,animations:[]}});}}
      } catch { /* A corrupt or unavailable index is a cache miss. */ }
      return entries;
    },
    async read(hash) {
      if(!known.has(hash))return base.read(hash);
      const bytes=await store.read(assetCacheKey(hash),ASSET_LIMITS.bytes);
      if(!bytes || bytes.length>ASSET_LIMITS.bytes || digest(bytes)!==hash)return null;validateGlb(bytes);return bytes;
    },
    async put(entry,bytes) {
      if(!isDiscoveredAsset(entry.candidate))return base.put(entry,bytes);
      if(entry.sha256!==entry.candidate.sha256 || digest(bytes)!==entry.sha256)throw Error('Discovery cache integrity');
      validateGlb(bytes);
      await store.write(assetCacheKey(entry.sha256),bytes,'model/gltf-binary');
      const record=Buffer.from(JSON.stringify(entry.candidate));if(record.length>65536)throw Error('Discovery record budget');
      await store.write(`game-assets-public-cc/discovered/v1/${entry.candidate.subjects[0]}.json`,record,'application/json');
    },
  };
}
