import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
const fixture = join(__dirname, `.tmp-enterable-${process.pid}`);
// Generated module types are checked separately with the emitted project.
/* eslint-disable @typescript-eslint/no-explicit-any */
let buildings: any, collision: any, character: any, camera: any, objects: any, materials: any;
beforeAll(async () => {
  vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 });
  for (const { files } of [generateGameRuntime(), generateGame3D(), generateGameController()]) for (const [path, source] of Object.entries(files)) {
    const file = join(fixture, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, source);
  }
  buildings = await import(join(fixture, 'src/game/three/buildings.ts'));
  collision = await import(join(fixture, 'src/game/three/collision.ts'));
  character = await import(join(fixture, 'src/game/play/character.ts'));
  camera = await import(join(fixture, 'src/game/three/camera.ts'));
  objects = await import(join(fixture, 'src/game/three/objects.ts'));
  materials = await import(join(fixture, 'src/game/three/materials.ts'));
});
afterAll(() => rmSync(fixture, { recursive: true, force: true }));
const still = { moveX: 0, moveZ: 0, sprint: false, jumpPressed: false, jumpHeld: false };
const walk = (p: any, frames: number, z: number) => { for (let i=0;i<frames;i++) p.update(1/60, {...still, moveZ:z}); };
function setup(storeys = 1) {
  const scene = new THREE.Scene(); const house = buildings.createEnterableHouse({width:8,depth:10,storeys}); scene.add(house);
  const ground = new THREE.Mesh(new THREE.BoxGeometry(60,.2,60)); ground.position.y=-.1; scene.add(collision.markWorldCollider(ground));
  const player = new character.CharacterController(); scene.add(player.object);
  return {scene,house,player,door:buildings.houseDoor(house)};
}
describe('enterable houses',()=>{
  it('blocks closed entrance, admits through open doorway, stops at rear wall',()=>{
    const {house,player,door}=setup(); player.reset(0,0,7); walk(player,90,-1); expect(player.object.position.z).toBeGreaterThan(5);
    door.setOpen(true); for(let i=0;i<50;i++) door.update(1/60); expect(door.isOpen).toBe(true);
    walk(player,140,-1); expect(player.object.position.z).toBeLessThan(3); expect(player.object.position.y).toBeGreaterThan(.1);
    walk(player,200,-1); expect(player.object.position.z).toBeGreaterThan(-5); expect(house.children.length).toBeGreaterThan(5);
  });
  it('walks upstairs onto the second floor',()=>{
    const {player}=setup(2); player.reset(3.175,.15,3.2); walk(player,180,-1);
    expect(player.object.position.y).toBeGreaterThan(3.05); expect(player.object.position.z).toBeLessThan(-3.3);
  });
  it('blocks occupied swings and resumes once clear without invalid-dt motion',()=>{
    const {door}=setup(); door.setOpen(true); for(let i=0;i<50;i++) door.update(1/60);
    door.setOpen(false); const actor={feet:new THREE.Vector3(0,.15,5.1),radius:.4,height:1.8};
    for(let i=0;i<60;i++) door.update(1/60,[actor]); expect(door.blocked).toBe(true); expect(door.hinge.rotation.y).toBeLessThan(0);
    const angle=door.hinge.rotation.y; door.update(NaN); expect(door.hinge.rotation.y).toBe(angle);
    for(let i=0;i<60;i++) door.update(1/60); expect(door.hinge.rotation.y).toBe(0);
  });
  it('requires range and line of sight and isolates instances',()=>{
    const {scene,house,door}=setup(); const other=buildings.createEnterableHouse(); other.position.x=20; scene.add(other);
    expect(buildings.interactHouseDoor(scene,{feet:new THREE.Vector3(0,.15,6),radius:.4,height:1.8})).toBe(true);
    expect(door.targetOpen).toBe(true); expect(buildings.houseDoor(other).targetOpen).toBe(false);
    expect(buildings.interactHouseDoor(scene,{feet:new THREE.Vector3(0,.15,-6),radius:.4,height:1.8})).toBe(false);
    scene.remove(house); buildings.updateHouseDoors(scene, .1); expect(door.hinge.rotation.y).toBe(0);
  });
  it('constrains the damped camera from an old exterior position',()=>{
    const {scene}=setup(); const rig=new camera.CameraRig({kind:'third-person',height:1.5,distance:6}); rig.setCollisionScene(scene);
    rig.camera.position.set(0,2,8); rig.update(new THREE.Vector3(0,.15,3),1/60);
    expect(rig.camera.position.z).toBeLessThan(4.8);
  });
  it('keeps exact fractional stair top triangles in Octree subdivisions',()=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(1.25,11/6,.25)); mesh.position.set(2.695,.15+11/12,-.745);
    const scene=new THREE.Scene(); scene.add(collision.markWorldCollider(mesh));
    const hit=collision.worldFloorAt(new THREE.Vector3(2.695,2.150307271798452,-.6461953125),.352,collision.worldColliders(scene));
    expect(hit).not.toBeNull(); expect(hit.y).toBeCloseTo(.15+11/6,6);
  });
  it('does not invent an infinite ground plane outside an elevated standalone house',()=>{
    const scene=new THREE.Scene(), house=buildings.createEnterableHouse(); house.position.y=5; scene.add(house);
    expect(collision.hasWorldGround(collision.worldColliders(scene),scene)).toBe(true);
    const player=new character.CharacterController(); scene.add(player.object); player.reset(10,5,0);
    walk(player,40,0); expect(player.object.position.y).toBeLessThan(0);
  });
  it('releases stair support when walking sideways or resetting beyond the real floor',()=>{
    const {scene,house,player}=setup(2); player.reset(3.175,.15,3.2); walk(player,25,-1); walk(player,30,0);
    expect(player.object.position.y).toBeGreaterThan(.2);
    const prior=player.object.position.y;
    for(let i=0;i<70;i++) player.update(1/60,{...still,moveX:-1});
    walk(player,90,0);
    expect(player.object.position.x).toBeLessThan(2.5);
    expect(player.object.position.y).toBeGreaterThanOrEqual(.14);
    expect(player.object.position.y).toBeLessThan(.3);
    player.reset(10,5,0); walk(player,50,0); expect(player.object.position.y).toBeLessThan(1);
    expect(prior).toBeLessThan(3.2); expect(scene.children).toContain(house);
  });
  it('descends and jumps away without retaining stair support',()=>{
    const {player}=setup(2); player.reset(3.175,.15,3.2); walk(player,40,-1);
    const height=player.object.position.y; expect(height).toBeGreaterThan(.8);
    player.update(1/60,{...still,jumpPressed:true,jumpHeld:true});
    expect(player.object.position.y).toBeGreaterThan(height);
    for(let i=0;i<130;i++) player.update(1/60,{...still,moveZ:1});
    expect(player.object.position.z).toBeGreaterThan(2);
    expect(player.object.position.y).toBeLessThan(.3);
    expect(player.stepSupport.lengthSq()).toBe(0);
  });
  it('keeps transformed floor boundaries exact without inventing support outside',()=>{
    const scene=new THREE.Scene(); const box=new THREE.Mesh(new THREE.BoxGeometry(2,.2,2));
    box.scale.x=-1; box.rotation.y=.3; box.position.set(7,1.1,-4); scene.add(collision.markWorldCollider(box,'ground'));
    const inside=box.localToWorld(new THREE.Vector3(.999,.3,.4));
    const outside=box.localToWorld(new THREE.Vector3(1.001,.3,.4));
    const colliders=collision.worldColliders(scene);
    expect(collision.worldFloorAt(inside,.5,colliders)?.y).toBeCloseTo(1.2,6);
    expect(collision.worldFloorAt(outside,.5,colliders)).toBeNull();
  });
  it('uses shared default materials without owning caller materials',()=>{
    const a=buildings.createEnterableHouse(),b=buildings.createEnterableHouse(); expect(a.children[0].material).toBe(b.children[0].material);
    let disposed=0; const custom=new THREE.MeshStandardMaterial(); custom.addEventListener('dispose',()=>disposed++);
    buildings.createEnterableHouse({wallMaterial:custom}); materials.disposeMaterials(); expect(disposed).toBe(0);
  });
  it('preserves legacy scenery and closes generated dependency and mobile interaction paths',()=>{
    expect(buildings.houseDoor(objects.createHouse({detail:'lite'}))).toBeUndefined(); expect(buildings.houseDoor(objects.createHouse({enterable:true}))).toBeDefined();
    const files=generateGame3D(['objects']).files; expect(files['src/game/three/buildings.ts']).toBeTruthy(); expect(files['src/game/three/collision.ts']).toBeTruthy();
    const shell=Object.values(generateGameShell().files).join('\n'); expect(shell).toContain("wasPressed('interact')"); expect(shell).toContain('updateHouseDoors(this.scene');
  });
});
