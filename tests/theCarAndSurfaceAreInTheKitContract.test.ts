// failedbr #1298 (2026-11-20): the builder wrote `createCar(...).root`, `createVehicleState(vehicle, tuning)`, a four-argument
// `driveVehicle` and a 'concrete' SurfaceKind — none of them real — 41 type errors, 2.5 minutes of fixes. The kit's type
// contract now hands over their exact declarations.
import { describe, expect, it } from 'vitest';
import { kitTypeContract, KIT_CONTRACT_NAMES } from '../src/server/lib/kitTypeContract';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';

describe('the car and the surface list are in the kit contract (failedbr #1298)', () => {
  it('names them, and quotes their real declarations', () => {
    for (const n of ['createCar', 'CarOptions', 'createVehicleState', 'driveVehicle', 'SurfaceKind']) expect(KIT_CONTRACT_NAMES).toContain(n);
    const block = kitTypeContract(generateGame3D().files);
    expect(block).toMatch(/export function createCar\(/);
    expect(block).toMatch(/export function createVehicleState\(/);
    expect(block).toMatch(/export function driveVehicle\(/);
    expect(block).toMatch(/export type SurfaceKind\b/);
  });
  it('the save/load names and the tune list are handed over too (failedbr #1277)', () => {
    for (const n of ['save', 'load', 'GameState', 'TUNES']) expect(KIT_CONTRACT_NAMES).toContain(n);
  });
});
