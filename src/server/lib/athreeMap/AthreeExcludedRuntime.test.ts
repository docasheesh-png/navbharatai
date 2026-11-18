import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {loadAthree} from '../../../../tests/helpers/loadAthree';
import {generateAthreeMap} from './AthreeMapGenerator';
import {athreeModulesFor} from './athreeMapIntent';
describe('explicit request exclusions reach actual generated world',()=>{
 it('no roads or rivers disables data, carving and rendered modules, not only file selection',()=>{
  const excluded=['roads','rivers'],files=generateAthreeMap(undefined,excluded).files;
  expect(files['src/game/athree/roadmesh.ts']).toBeUndefined();
  expect(files['src/game/athree/riverwater.ts']).toBeUndefined();
  const A=loadAthree([],excluded);
  const map=A.createAthreeMap({seed:7,profile:'racing',quality:'phone',three:THREE,roads:true,rivers:true});
  const expected=A.createAthreeWorld({seed:7,profile:'racing',roads:false,rivers:false});
  expect(map.world.homeRoads()).toEqual({roads:[],sites:[],circuit:null});
  expect(map.world.waterBodies()).toEqual({rivers:[],lakes:[]});
  for(const [x,z] of [[0,0],[100,200],[-900,450],[2500,-1500]]){
   expect(map.world.roadAt(x,z)).toBeNull();expect(map.world.waterAt(x,z)).toBeNull();
   expect(map.world.heightAt(x,z)).toBe(expected.heightAt(x,z));
  }
  map.update(0,0,1);expect(map.chunks.loadedCount()).toBeGreaterThan(0);map.dispose();
 });
 it('explicit no-sea also removes the fallback water plane without changing ordinary subsets',()=>{
  const A=loadAthree([],['sea']),map=A.createAthreeMap({seed:7,profile:'racing',quality:'phone',three:THREE});
  let waterPlane=false;map.chunks.group.traverse((o:any)=>{if(o.isMesh&&o.material?.transparent&&!o.material.isShaderMaterial)waterPlane=true;});
  expect(waterPlane).toBe(false);map.dispose();
  expect(generateAthreeMap([],['sea']).instructions).toContain('not a certified dry-land-only world');
 });
 it('ordinary include subset retains original default world data when there is no explicit exclusion',()=>{
  const A=loadAthree([]),map=A.createAthreeMap({seed:7,profile:'racing'});
  expect(map.world.homeRoads().circuit).not.toBeNull();map.dispose();
 });
 it('everything-except request produces no roads renderer or road data',()=>{
  const pick=athreeModulesFor('everything except roads');
  const A=loadAthree(pick.modules,pick.excluded),map=A.createAthreeMap({seed:7,profile:'racing'});
  expect(map.world.homeRoads().circuit).toBeNull();expect('roadMesh' in map).toBe(false);map.dispose();
 });
});
