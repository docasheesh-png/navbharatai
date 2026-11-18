import {describe,it,expect} from 'vitest';
import {generateRequestedAthreeWorld,parseCompositionRequest} from './compositionRequest';
import {generateAthreeMap} from './AthreeMapGenerator';
import {generateGame3D} from '../Game3DGenerator';
import {composeAthreeRecipe} from './composeAthreeRecipe';
const request={seed:7,profile:'explore',widthKm:8,quality:'phone',rivers:false,vegetation:false,objects:[{kind:'human',count:1},{kind:'dog',count:2}]};
describe('requested world composition actual recipe pipeline',()=>{
 it('uses original generators and supplies runnable runtime bootstrap without mutating inputs',()=>{
  const world=generateAthreeMap(),models=generateGame3D(['objects','humanoid']);
  const before=JSON.stringify([world,models]),result=composeAthreeRecipe(world,models);
  expect(JSON.stringify([world,models])).toBe(before);
  for(const [path,source] of Object.entries(world.files))expect(result.files[path]).toBe(source);
  const generated=generateRequestedAthreeWorld(request);
  expect(generated.files['src/game/athree/requestedWorld.ts']).toContain('composition.add');
  expect(generated.files['src/game/three/objects.ts']).toContain('createObjectInstanceDisposer');
  expect(generated.files['src/game/athree/objectAdapter.ts']).toContain('createAnimal');
 });
 it.each([{include:[]},{include:['roads']},{include:['sky','plants']}])('preserves native selected module files without re-enabling omitted modules: %j',({include})=>{
  const generated=generateRequestedAthreeWorld(request,include),world=generateAthreeMap(include);
  for(const [file,source] of Object.entries(world.files))expect(generated.files[file]).toBe(source);
  for(const file of ['ocean','plants','riverwater','sky','roadmesh','vehicles','budget'])expect(Boolean(generated.files['src/game/athree/'+file+'.ts'])).toBe(Boolean(world.files['src/game/athree/'+file+'.ts']));
 });
 it('rejects conflicting explicit feature requests rather than enabling excluded modules',()=>{
  expect(()=>generateRequestedAthreeWorld({...request,vegetation:true},[])).toThrow(/plants module/);
  expect(()=>generateRequestedAthreeWorld({...request,rivers:true},['plants'])).toThrow(/rivers module/);
 });
 it('rejects visual vehicle adapters when user excluded vehicles',()=>{
  for(const kind of ['car','motorcycle'])expect(()=>generateRequestedAthreeWorld({...request,objects:[{kind,count:1}]},[],['vehicles'])).toThrow(/excluded vehicles/);
 });
 it.each([
  {...request,widthKm:1000},{...request,profile:['explore']},{...request,quality:['phone']},{...request,seed:2147483648},{...request,code:'eval'},
  {...request,objects:[{kind:'lion',count:1}]},{...request,objects:[{kind:'human',count:17}]},
  {...request,objects:[{kind:'dog',count:1},{kind:'dog',count:2}]},
  {...request,objects:[{kind:'dog',count:1,url:'https://external.invalid/model'}]},
 ])('rejects unsupported/over-budget structured request',bad=>expect(()=>parseCompositionRequest(bad)).toThrow());
 it('rejects conflicting source rather than overwrite a prior project module',()=>{
  const models=generateGame3D(['objects','humanoid']);
  models.files['src/game/athree/index.ts']='custom';
  expect(()=>composeAthreeRecipe(generateAthreeMap(),models)).toThrow(/Conflicting/);
 });
});
