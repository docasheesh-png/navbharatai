import { describe, it, expect } from 'vitest';
import { mockValue, mockRows, generateSeedData } from '../src/server/AppMakerLab/generator/MockDataGenerator';

/** P-CGE.13 — seed / mock data generator (pure, deterministic). */

describe('mockValue', () => {
  it('honours explicit type hints', () => {
    expect(typeof mockValue({ name: 'x', type: 'boolean' }, 0)).toBe('boolean');
    expect(typeof mockValue({ name: 'x', type: 'number' }, 0)).toBe('number');
    expect(mockValue({ name: 'x', type: 'date' }, 0)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(mockValue({ name: 'x', type: 'email' }, 1)).toContain('@example.com');
  });
  it('infers realistic values from field names', () => {
    expect(String(mockValue({ name: 'email' }, 0))).toContain('@example.com');
    expect(String(mockValue({ name: 'fullName' }, 0))).toMatch(/\w+ \w+/);
    expect(typeof mockValue({ name: 'price' }, 2)).toBe('number');
    expect(mockValue({ name: 'isActive' }, 0)).toBe(true);
    expect(mockValue({ name: 'createdAt' }, 0)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(['active', 'pending', 'inactive', 'archived']).toContain(mockValue({ name: 'status' }, 1));
  });
  it('is deterministic for the same field + index', () => {
    expect(mockValue({ name: 'name' }, 3)).toBe(mockValue({ name: 'name' }, 3));
  });
  it('falls back to a stable readable string', () => {
    expect(mockValue({ name: 'weirdField' }, 4)).toBe('weirdField_5');
  });
});

describe('mockRows', () => {
  it('produces the requested number of rows with all fields', () => {
    const rows = mockRows({ name: 'User', fields: [{ name: 'id' }, { name: 'email' }] }, 3);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('email');
    }
  });
});

describe('generateSeedData', () => {
  it('builds a JSON map keyed by entity with default 10 rows', () => {
    const { data, json, summary } = generateSeedData([
      { name: 'User', fields: [{ name: 'id' }, { name: 'name' }] },
    ]);
    expect(data.User).toHaveLength(10);
    expect(JSON.parse(json).User).toHaveLength(10);
    expect(summary).toContain('User');
  });
  it('respects count and clamps to a sane max', () => {
    expect(generateSeedData([{ name: 'A', fields: [{ name: 'id' }] }], 3).data.A).toHaveLength(3);
    expect(generateSeedData([{ name: 'A', fields: [{ name: 'id' }] }], 99999).data.A).toHaveLength(1000);
  });
  it('tolerates no entities', () => {
    const { data, summary } = generateSeedData([]);
    expect(data).toEqual({});
    expect(summary).toContain('No entities');
  });
});
