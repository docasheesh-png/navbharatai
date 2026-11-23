import { describe, it, expect } from 'vitest';
import { groundShapeHalves, groundShapeFindings, handWrittenGroundNote, ownLandFindings, ownLandNote, LAND_METRES } from './handWrittenGroundScan';

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

// 🌱 failedbr #2495/#2501 autopsy — a feature that lays its own MAP-SCALE flat land in an open world (synthetic fixtures).
describe('handWrittenGroundScan — a feature that lays its own map-scale land is its own note (never a failure)', () => {
  const F = 'src/game/features/meadow.ts';
  const grassField = [
    "import * as THREE from 'three';",
    'const size = 2000;',
    'const geometry = new THREE.PlaneGeometry(size, size);',
    'const field = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x4caf50 }));',
    'field.rotation.x = -Math.PI / 2;',
    'field.position.set(0, -0.1, 0);',
    'ctx.scene.add(field);',
  ].join('\n');
  it('flags the #2495 shape in an open world only, with its own note', () => {
    const f = ownLandFindings(idx({ [F]: grassField }), true);
    expect(f.map((x) => x.kind)).toEqual(['own-land']);
    expect(f[0].path).toBe(F);
    const note = ownLandNote(f);
    expect(note).toContain('A FEATURE LAYS ITS OWN LAND');
    expect(note).toContain('world.place(object, x, z)');
    expect(note).toContain('LAND region');
    expect(note).toContain('not an error');
    // A features-only game (no src/game/world.ts) is never told.
    expect(ownLandFindings(idx({ [F]: grassField }), false)).toEqual([]);
    // And it never enters the road / rail note's findings.
    expect(groundShapeFindings(idx({ [F]: grassField }))).toEqual([]);
  });
  it('flags literal map-scale sizes, a rotateX-laid plane and a big disc', () => {
    expect(ownLandFindings(idx({ [F]: 'const g = new THREE.PlaneGeometry(400, 350);\ng.rotateX(-Math.PI / 2);' }), true).length).toBe(1);
    expect(ownLandFindings(idx({ [F]: 'const lake = new THREE.Mesh(new THREE.CircleGeometry(200, 48), water);\nlake.rotation.x = -Math.PI/2;' }), true).length).toBe(1);
    expect(LAND_METRES).toBe(300);
  });
  it('sized ground objects and false positives stay silent', () => {
    const quiet: Record<string, string> = {
      // sized ground objects (re-review 2026-11-23): a pitch, a court, a pool, a parking lot, a race-track strip
      'src/game/features/stadium.ts': 'const pitch = new THREE.Mesh(new THREE.PlaneGeometry(105, 68), grass);\npitch.rotation.x = -Math.PI / 2;',
      'src/game/features/cricket.ts': 'const ground = new THREE.Mesh(new THREE.CircleGeometry(75, 64), grass);\nground.rotation.x = -Math.PI / 2;',
      'src/game/features/court.ts': 'const court = new THREE.Mesh(new THREE.PlaneGeometry(28, 15), mat);\ncourt.rotation.x = -Math.PI / 2;',
      'src/game/features/pool.ts': 'const pool = new THREE.Mesh(new THREE.PlaneGeometry(50, 25), water);\npool.rotation.x = -Math.PI / 2;',
      'src/game/features/parking.ts': 'const lot = new THREE.Mesh(new THREE.PlaneGeometry(120, 80), tarmac);\nlot.rotation.x = -Math.PI / 2;',
      'src/game/features/raceTrack.ts': 'const strip = new THREE.Mesh(new THREE.PlaneGeometry(8, 800), tarmac);\nstrip.rotation.x = -Math.PI / 2;',
      'src/game/features/oneArg.ts': 'const g = new THREE.PlaneGeometry(900);\ng.rotateX(-Math.PI / 2);',
      // a small flat decal / marker on the ground
      'src/game/features/skidMarks.ts': 'const decal = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.4), mat);\ndecal.rotation.x = -Math.PI / 2;',
      'src/game/features/waypoint.ts': 'const ring = new THREE.Mesh(new THREE.CircleGeometry(3, 32), mat);\nring.rotation.x = -Math.PI / 2;',
      // a big UPRIGHT sign / screen (never laid flat)
      'src/game/features/billboard.ts': 'const sign = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat);\nsign.position.y = 30;',
      'src/game/features/cinemaScreen.ts': 'const screen = new THREE.PlaneGeometry(500, 300);',
      // a size the scan cannot read is never guessed
      'src/game/features/unknownSize.ts': 'const g = new THREE.PlaneGeometry(opts.width, opts.depth);\nm.rotation.x = -Math.PI / 2;',
      // a HUD or UI quad, and the kit's own files, are not feature files
      'src/game/ui/hudOverlay.ts': 'const quad = new THREE.PlaneGeometry(2000, 2000);\nquad.rotation.x = -Math.PI / 2;',
      'src/components/Background.tsx': 'const bg = new THREE.PlaneGeometry(500, 500);\nbg.rotation.x = -Math.PI / 2;',
      'src/game/play/openWorld.ts': 'const geometry = new THREE.PlaneGeometry(patchSize, patchSize, 32, 32);\ngeometry.rotateX(-Math.PI / 2);\nconst patchSize = 960;',
    };
    expect(ownLandFindings(idx(quiet), true)).toEqual([]);
    expect(ownLandNote([])).toBe('');
  });
  it('the road / rail note is unchanged byte for byte, and never carries a land line', () => {
    const hilly = "const terrain = createTerrain({ palette: 'indianVillage', size: 400 });";
    const files = { 'src/game/racing/Scene.ts': `${hilly}\nconst road = new THREE.Mesh(new THREE.PlaneGeometry(8, 800), mat);\n`, [F]: grassField };
    const f = groundShapeFindings(idx(files));
    expect(f.map((x) => x.kind)).toEqual(['flat-road']);
    expect(handWrittenGroundNote(f).startsWith('\n\n⛰️ HAND-WRITTEN GROUND — this will sink into the hills')).toBe(true);
    expect(handWrittenGroundNote(f)).not.toContain('OWN LAND');
  });
  it('never throws on junk feature files', () => {
    expect(() => groundShapeHalves(F, 'new THREE.PlaneGeometry($$, ' + 'x'.repeat(5000))).not.toThrow();
    expect(() => groundShapeHalves(F, 'rotation.x = -Math.PI / 2;\nnew PlaneGeometry(a$b, 1e9)')).not.toThrow();
  });
});
