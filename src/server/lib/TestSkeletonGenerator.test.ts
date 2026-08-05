import { describe, it, expect } from 'vitest';
import {
  generateUnitTest, generateIntegrationTest, generateMock, generateTests,
} from './TestSkeletonGenerator';

describe('TestSkeletonGenerator (P-CGE.4)', () => {
  describe('generateUnitTest', () => {
    // UPDATED (Phase 4.4). These used to lock in the generator CALLING each function with `undefined`
    // for every argument and asserting `toBeDefined()`. That shipped a RED suite for correct code — a
    // function needing arguments throws, a void function returns undefined — and a suite the user
    // cannot trust is worse than no suite. The assertions below encode the replacement contract.
    it('asserts only what is true by construction — the export exists and is callable', () => {
      const out = generateUnitTest({ modulePath: './math', functions: [{ name: 'add', params: ['a', 'b'] }] });
      expect(out).toContain("import { describe, it, expect } from 'vitest';");
      expect(out).toContain("import { add } from './math';");
      expect(out).toContain("describe('add', () => {");
      // Small, but genuinely true — and it is what goes red when someone renames or drops the export.
      expect(out).toContain("expect(typeof add).toBe('function');");
    });

    it('NEVER invents arguments, so a generated test cannot fail on correct code', () => {
      const out = generateUnitTest({ modulePath: './math', functions: [{ name: 'add', params: ['a', 'b'] }] });
      expect(out).not.toContain('undefined');
      expect(out).not.toContain('expect(result).toBeDefined()');
    });

    it('marks the real behaviour as PENDING, which is neither passing nor failing', () => {
      // vitest reports it.todo as pending, so an unwritten test can never be mistaken for a passing one.
      const out = generateUnitTest({ modulePath: './svc', functions: [{ name: 'fetchUser', async: true }] });
      expect(out).toContain("it.todo('fetchUser — assert real behaviour with real arguments');");
    });
    it('emits an it.todo for a module with no functions', () => {
      const out = generateUnitTest({ modulePath: './empty', functions: [] });
      expect(out).toContain("it.todo('add tests');");
    });
  });

  describe('generateIntegrationTest', () => {
    it('honours an explicit expected status when the caller gives one', () => {
      const out = generateIntegrationTest({ routes: [{ method: 'get', path: '/health', expectStatus: 200 }] });
      expect(out).toContain("import request from 'supertest';");
      expect(out).toContain("await request(app).get('/health')");
      expect(out).toContain('expect(res.status).toBe(200);');
    });

    it('without one, asserts only that the route is MOUNTED', () => {
      // Demanding 200 fails a guarded route (401) or one that wants a query (400) — correct code,
      // red test. "not 404" is true for any mounted route and catches the bug worth catching.
      const out = generateIntegrationTest({ routes: [{ method: 'get', path: '/health' }] });
      expect(out).toContain('expect(res.status).not.toBe(404);');
    });

    it('never RUNS a mutating route — a scaffold must not touch the user\'s data', () => {
      // Someone running their suite against a dev database would have this create or delete real
      // rows they never asked to touch.
      const out = generateIntegrationTest({ routes: [{ method: 'post', path: '/orders' }, { method: 'delete', path: '/orders' }] });
      expect(out).not.toContain('request(app).post');
      expect(out).not.toContain('request(app).delete');
      expect(out).toContain("it.todo('POST /orders — write this one yourself: it changes data');");
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
