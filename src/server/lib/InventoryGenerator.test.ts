import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateInventoryIntegration, INVENTORY_SERVICE_SOURCE } from './InventoryGenerator';

const here = dirname(fileURLToPath(import.meta.url));

describe('generateInventoryIntegration (wiring)', () => {
  it('emits the inventory service, routes and README', () => {
    const out = generateInventoryIntegration();
    const paths = Object.keys(out.files);
    expect(paths).toContain('server/inventory/inventoryService.ts');
    expect(paths).toContain('server/inventory/routes.ts');
    expect(paths).toContain('server/inventory/README.md');
    expect(out.dependencies.map((d) => d.name)).toContain('express');
    expect(out.files['server/inventory/routes.ts']).toContain('409');
    expect(out.files['server/inventory/routes.ts']).toContain('export const inventoryRouter');
  });
});

// Materialize + execute the emitted domain logic — "no overselling" is a real business rule, verified
// against the actual emitted code.
describe('emitted InventoryService — no overselling (real logic)', () => {
  const artifact = join(here, `._inventory_emitted_${process.pid}.ts`);
  writeFileSync(artifact, INVENTORY_SERVICE_SOURCE);
  afterAll(() => {
    try { unlinkSync(artifact); } catch { /* already gone */ }
  });

  interface Service {
    setStock(sku: string, quantity: number): void;
    getStock(sku: string): number;
    restock(sku: string, quantity: number): number;
    reserve(sku: string, quantity: number): number;
    release(sku: string, quantity: number): number;
    isLowStock(sku: string, threshold: number): boolean;
    list(): Array<{ sku: string; quantity: number }>;
  }
  interface Emitted { InventoryService: new () => Service }
  async function load(): Promise<Emitted> {
    return (await import(/* @vite-ignore */ pathToFileURL(artifact).href)) as unknown as Emitted;
  }

  it('reserve decrements stock and REJECTS reserving more than on hand (never negative)', async () => {
    const { InventoryService } = await load();
    const inv = new InventoryService();
    inv.setStock('sku-1', 5);
    expect(inv.reserve('sku-1', 3)).toBe(2);
    expect(inv.getStock('sku-1')).toBe(2);
    // Only 2 left — reserving 3 must fail and NOT change the quantity.
    expect(() => inv.reserve('sku-1', 3)).toThrow(/insufficient stock/);
    expect(inv.getStock('sku-1')).toBe(2);
    // Exhaust exactly, then any further reserve fails.
    expect(inv.reserve('sku-1', 2)).toBe(0);
    expect(() => inv.reserve('sku-1', 1)).toThrow(/insufficient stock/);
    expect(inv.getStock('sku-1')).toBe(0);
  });

  it('release / restock put stock back', async () => {
    const { InventoryService } = await load();
    const inv = new InventoryService();
    inv.setStock('sku-2', 1);
    inv.reserve('sku-2', 1);
    expect(inv.getStock('sku-2')).toBe(0);
    expect(inv.release('sku-2', 1)).toBe(1); // order cancelled → back on hand
    expect(inv.reserve('sku-2', 1)).toBe(0); // now allowed again
    expect(inv.restock('sku-2', 10)).toBe(10);
  });

  it('setStock clamps negatives to 0 and validates input', async () => {
    const { InventoryService } = await load();
    const inv = new InventoryService();
    inv.setStock('sku-3', -5);
    expect(inv.getStock('sku-3')).toBe(0);
    expect(() => inv.reserve('sku-3', 0)).toThrow(/positive/);
    expect(() => inv.restock('sku-3', -1)).toThrow(/positive/);
    expect(() => inv.setStock('', 1)).toThrow(/sku is required/);
  });

  it('isLowStock and list reflect real state', async () => {
    const { InventoryService } = await load();
    const inv = new InventoryService();
    inv.setStock('a', 2);
    inv.setStock('b', 10);
    expect(inv.isLowStock('a', 3)).toBe(true);
    expect(inv.isLowStock('b', 3)).toBe(false);
    expect(inv.list()).toEqual([{ sku: 'a', quantity: 2 }, { sku: 'b', quantity: 10 }]);
  });
});
