import { COMPOSITION } from './athreeCompositionSource';
import { HUMAN_ADAPTER } from './athreeHumanAdapterSource';
import { OBJECT_ADAPTER, OBJECT_DISPOSAL } from './athreeObjectAdapterSource';

interface Recipe {
 files: Record<string,string>;
 dependencies: Array<{name:string;version:string}>;
 instructions:string;
}
/** Pure, additive recipe integration. Caller must retain the existing feature flag, intent,
 * verified project lifecycle and guarded writer. This function never writes project files.
 * Pass the real Athree recipe and generateGame3D(['objects','humanoid']) result.
 */
export function composeAthreeRecipe(world: Recipe, models: Recipe): Recipe {
 const files: Record<string,string> = Object.create(null);
 for(const recipe of [world,models])for(const [path,source] of Object.entries(recipe.files)) {
  if(!path.startsWith('src/game/') || path.split('/').some(p=>p==='..'||p==='.'||!p) || path.includes('\\')) throw new Error('Unsafe recipe path.');
  if(path in files && files[path]!==source)throw new Error('Conflicting recipe source: '+path);
  files[path]=source;
 }
 for(const path of ['src/game/athree/index.ts','src/game/three/objects.ts','src/game/three/humanoid.ts','src/game/three/surfaces.ts','src/game/three/collision.ts','src/game/three/buildings.ts','src/game/three/materials.ts']) {
  if(!files[path])throw new Error('Required original recipe dependency missing: '+path);
 }
 const additions:Record<string,string>={
  'src/game/athree/composition.ts':COMPOSITION,
  'src/game/athree/humanAdapter.ts':HUMAN_ADAPTER,
  'src/game/athree/objectAdapter.ts':OBJECT_ADAPTER,
 };
 for(const [path,source] of Object.entries(additions)) {
  if(path in files)throw new Error('Composition already supplied; do not replace it.');
  files[path]=source;
 }
 if(files['src/game/three/objects.ts'].includes('export function createObjectInstanceDisposer('))throw new Error('Instance disposer already supplied; review integration.');
 files['src/game/three/objects.ts']+=OBJECT_DISPOSAL;
 const deps=new Map<string,string>();
 for(const recipe of [world,models])for(const d of recipe.dependencies) {
  const previous=deps.get(d.name);
  if(previous && previous!==d.version) {
    // Both shipped generators target the same Three release; pin their shared lower bound.
    if(d.name==='three' && [previous,d.version].every(v=>v==='0.180.0'||v==='^0.180.0')) {
      deps.set(d.name,'0.180.0'); continue;
    }
    throw new Error('Conflicting dependency version: '+d.name);
  }
  deps.set(d.name,d.version);
 }
 return { files,dependencies:[...deps].map(([name,version])=>({name,version})),
 instructions:world.instructions+'\nComposition clarification: the Athree-only NOT built list above does not exclude the additional original visual models installed by this composition; the additional visual adapters do not provide driving, NPC AI or physics; independently selected native Athree road/vehicle modules retain their own documented capabilities.\nOptional composition: import createComposedWorld from ./game/athree/composition and createOriginalModuleAdapter from ./game/athree/objectAdapter. Supply a validated explicit seed/profile/widthKm/quality/rivers/vegetation spec. Use the returned map and call composition.update/dispose instead of updating/disposing the map separately. Object placements must be dry and gently sloped; no automatic placement is promised. These modules are procedural visual objects, not NPC AI or vehicle physics. No changes to existing projects, no 1000 km runtime or mobile performance guarantees.' };
}
