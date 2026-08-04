import { describe, it, expect } from 'vitest';
import { generateAdmin } from './AdminGenerator';

const entity = { name: 'Post', fields: [
  { name: 'id' },
  { name: 'title', type: 'string' },
  { name: 'views', type: 'int' },
  { name: 'created_at' },
] };

describe('generateAdmin', () => {
  it('emits a single React admin page at src/admin/<Model>Admin.tsx (dependency-free)', () => {
    const out = generateAdmin(entity);
    expect(Object.keys(out.files)).toEqual(['src/admin/PostAdmin.tsx']);
    expect(out.dependencies).toEqual([]);
  });

  it('binds to the generate_crud endpoints and shows id + writable fields + createdAt columns', () => {
    const page = generateAdmin(entity).files['src/admin/PostAdmin.tsx'];
    expect(page).toContain("const API = '/api/posts'");
    expect(page).toContain('const COLUMNS: string[] = ["id","title","views","createdAt"]');
    expect(page).toContain('export default function PostAdmin()');
    expect(page).toContain("method: 'DELETE'");                        // per-row delete
    expect(page).toContain('Page {pageData.page} of {pageData.totalPages}'); // pagination
  });

  it('renders honest loading / error / empty states', () => {
    const page = generateAdmin(entity).files['src/admin/PostAdmin.tsx'];
    expect(page).toContain('Loading…');
    expect(page).toContain('No posts yet.');
    expect(page).toContain('setError');
  });

  it('never throws on a malformed entity', () => {
    // @ts-expect-error — malformed input must not throw
    expect(() => generateAdmin({})).not.toThrow();
    expect(() => generateAdmin({ name: 'X', fields: [] })).not.toThrow();
  });
});
