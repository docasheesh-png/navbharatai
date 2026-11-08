import { describe, it, expect } from 'vitest';
import { groundShapeHalves, groundShapeFindings, handWrittenGroundNote } from './handWrittenGroundScan';

const idx = (files: Record<string, string>) => new Map(Object.entries(files).map(([p, c]) => [p, groundShapeHalves(p, c)]));

describe('handWrittenGroundScan — a hand-written road/rail/driven y on hilly terrain is flagged (never a failure)', () => {
  const hilly = "const terrain = createTerrain({ palette: 'indianVillage', size: 400 });";
  it('flags the be6aae96 shapes: flat road plane, pinned car y, own train', () => {
    const f = groundShapeFindings(idx({
      'src/game/racing/Scene.ts': `${hilly}\nconst road = new THREE.Mesh(new THREE.PlaneGeometry(8, 800), mat);\n`,
      'src/game/racing/RacingGame.tsx': 'car.position.z += speed * dt;\ncar.position.y = 0.03;\n',
      'src/game/racing/TrainSystem.ts': 'train.position.x += trainSpeed * dt;\n',
    }));
    expect(f.map((x) => x.kind).sort()).toEqual(['flat-road', 'own-train', 'pinned-vehicle-y']);
    const note = handWrittenGroundNote(f);
    expect(note).toContain('createRoad');
    expect(note).toContain('groundHeightAt');
  });
  it('says nothing for a flat world, or when the kit is used', () => {
    expect(groundShapeFindings(idx({ 'a.ts': "createTerrain({ flat: true });\nconst road = new THREE.Mesh(new THREE.PlaneGeometry(8, 80), m);\ncar.position.z += 1; car.position.y = 0.03;" }))).toEqual([]);
    expect(groundShapeFindings(idx({ 'a.ts': `${hilly}\nconst road = createRoad({ length: 400 });\ndrive = driveVehicle(car, drive, axis, dt);\nconst rail = createRailTrack(); train.position.x += 1; train.position.y = groundHeightAt(train.position.x, 0);` }))).toEqual([]);
  });
  it('a pinned y on a car that never moves is not a finding; the kit library is never read', () => {
    expect(groundShapeFindings(idx({ 'a.ts': `${hilly}\nparkedCar.position.y = 0.03;` }))).toEqual([]);
    expect(groundShapeFindings(idx({ 'src/game/three/objects.ts': `${hilly}\nconst road = new THREE.Mesh(new THREE.PlaneGeometry(8, 800), m);` }))).toEqual([]);
  });
  it('is cheap on a huge file and never throws on junk', () => {
    expect(() => groundShapeHalves('x.ts', 'a'.repeat(300_000))).not.toThrow();
    expect(handWrittenGroundNote([])).toBe('');
  });
});
