import { describe, it, expect } from 'vitest';
import { generatePaginationIntegration } from './PaginationGenerator';

describe('generatePaginationIntegration', () => {
  const c = generatePaginationIntegration();
  const server = c.files['server/lib/pagination.ts'];

  it('emits parsePagination + pageMeta, dependency-free and server-side', () => {
    expect(server).toContain('export function parsePagination(');
    expect(server).toContain('export function pageMeta(');
    expect(server).not.toContain('import ');
    expect(c.files['src/lib/pagination.ts']).toBeUndefined();
    expect((c as { dependency?: unknown }).dependency).toBeUndefined();
  });

  it('caps the limit (DoS guard) and floors page at 1', () => {
    expect(server).toContain('maxLimit');
    expect(server).toContain('Math.min(Math.max(toInt(query.limit, defaultLimit), 1), maxLimit)');
    expect(server).toContain('Math.max(toInt(query.page, 1), 1)');
  });

  it('computes a correct page envelope (pages/hasNext/hasPrev)', () => {
    expect(server).toContain('Math.ceil(safeTotal / params.limit)');
    expect(server).toContain('hasNext: params.page < pages');
    expect(server).toContain('hasPrev: params.page > 1');
  });

  it('never writes .env.example and only the server file', () => {
    expect(c.files['.env.example']).toBeUndefined();
    expect(Object.keys(c.files)).toEqual(['server/lib/pagination.ts']);
    expect(c.instructions.toLowerCase()).toContain('pagination');
  });
});
