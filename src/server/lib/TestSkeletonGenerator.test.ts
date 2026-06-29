import { describe, it, expect } from 'vitest';
import {
  generateUnitTest, generateIntegrationTest, generateMock, generateTests,
} from './TestSkeletonGenerator';

describe('TestSkeletonGenerator (P-CGE.4)', () => {
  describe('generateUnitTest', () => {
    it('scaffolds a Vitest unit test with imports + smoke assertion + TODO', () => {
      const out = generateUnitTest({ modulePath: './math', functions: [{ name: 'add', params: ['a', 'b'] }] });
      expect(out).toContain("import { describe, it, expect } from 'vitest';");
      expect(out).toContain("import { add } from './math';");
      expect(out).toContain("describe('add', () => {");
      expect(out).toContain('const result = add(');
      expect(out).toContain('expect(result).toBeDefined();');
      expect(out).toContain('// TODO: assert real behaviour');
    });
    it('awaits async functions', () => {
      const out = generateUnitTest({ modulePath: './svc', functions: [{ name: 'fetchUser', async: true }] });
      expect(out).toContain('async () => {');
      expect(out).toContain('const result = await fetchUser(');
    });
    it('emits an it.todo for a module with no functions', () => {
      const out = generateUnitTest({ modulePath: './empty', functions: [] });
      expect(out).toContain("it.todo('add tests');");
    });
  });

  describe('generateIntegrationTest', () => {
    it('scaffolds supertest cases per route', () => {
      const out = generateIntegrationTest({ routes: [{ method: 'get', path: '/health', expectStatus: 200 }] });
      expect(out).toContain("import request from 'supertest';");
      expect(out).toContain("await request(app).get('/health')");
      expect(out).toContain('expect(res.status).toBe(200);');
      expect(out).toContain('// TODO: assert the response body');
    });
  });

  describe('generateMock', () => {
    it('builds a vi.fn mock object', () => {
      const out = generateMock({ name: 'db', methods: ['get', 'set'] });
      expect(out).toContain("import { vi } from 'vitest';");
      expect(out).toContain('export const dbMock = {');
      expect(out).toContain('get: vi.fn(),');
      expect(out).toContain('set: vi.fn(),');
    });
    it('emits a TODO when no methods are given', () => {
      expect(generateMock({ name: 'svc' })).toContain('// TODO: add mocked methods');
    });
  });

  describe('generateTests', () => {
    it('returns only the scaffolds the input supports', () => {
      const out = generateTests({ unit: { modulePath: './m', functions: [{ name: 'f' }] }, mock: { name: 'd' } });
      expect(out.unit).toBeTruthy();
      expect(out.mock).toBeTruthy();
      expect(out.integration).toBeUndefined();
    });
    it('sanitises identifiers (no code injection from names)', () => {
      const out = generateUnitTest({ modulePath: './m', functions: [{ name: 'evil(); doBad' }] });
      expect(out).not.toContain('evil(); doBad');
      expect(out).toContain('evildoBad'); // stripped to a safe identifier
    });
  });
});
