import { describe, it, expect } from 'vitest';
import { generateSeedData, mockRows, mockValue } from './MockDataGenerator';

describe('mockValue / mockRows', () => {
  it('is deterministic and derives realistic values from field names/types', () => {
    expect(mockValue({ name: 'email' }, 0)).toBe('aarav0@example.com');
    expect(mockValue({ name: 'is_active' }, 0)).toBe(true);
    expect(mockValue({ name: 'price' }, 0)).toBe(9.99);
    expect(mockValue({ name: 'x', type: 'boolean' }, 1)).toBe(false);
    // same (field, index) → same value across runs
    expect(mockValue({ name: 'title' }, 3)).toBe(mockValue({ name: 'title' }, 3));
  });

  it('generates the requested number of rows', () => {
    expect(mockRows({ name: 'T', fields: [{ name: 'id' }, { name: 'name' }] }, 4)).toHaveLength(4);
  });
});

describe('generateSeedData — referential integrity', () => {
  const User = { name: 'User', fields: [{ name: 'id' }, { name: 'name' }] };
  const Post = { name: 'Post', fields: [{ name: 'id' }, { name: 'title' }, { name: 'user_id' }] };

  it('links a foreign key to REAL ids of the referenced entity', () => {
    const { data } = generateSeedData([User, Post], 5);
    const userIds = new Set(data.User.map((r) => r.id));
    // Every Post.user_id must be an actual User.id (loads under a FK constraint).
    for (const post of data.Post) expect(userIds.has(post.user_id)).toBe(true);
  });

  it('matches a plural entity name (Users) from a singular FK (user_id) and camelCase (userId)', () => {
    const Users = { name: 'Users', fields: [{ name: 'id' }] };
    const Comment = { name: 'Comment', fields: [{ name: 'id' }, { name: 'userId' }] };
    const { data } = generateSeedData([Users, Comment], 4);
    const ids = new Set(data.Users.map((r) => r.id));
    for (const c of data.Comment) expect(ids.has(c.userId)).toBe(true);
  });

  it('leaves an UNMATCHED foreign key as its generated value (no fake reference)', () => {
    const Post2 = { name: 'Post', fields: [{ name: 'id' }, { name: 'tag_id' }] }; // no Tag entity
    const { data } = generateSeedData([Post2], 3);
    // tag_id keeps its generated hex value (unchanged) — every row still has one, none nulled.
    for (const p of data.Post) expect(typeof p.tag_id).toBe('string');
  });

  it('never rewrites the primary key itself', () => {
    const { data } = generateSeedData([{ name: 'User', fields: [{ name: 'id' }] }], 3);
    const ids = data.User.map((r) => r.id);
    expect(new Set(ids).size).toBe(3); // all distinct — the id column is untouched
  });

  it('generates COLLISION-FREE ids at scale (regression: the old LCG hexId collided for small seeds)', () => {
    const { data } = generateSeedData([{ name: 'Row', fields: [{ name: 'id' }] }], 200);
    const ids = data.Row.map((r) => r.id);
    expect(new Set(ids).size).toBe(200); // 200 rows → 200 distinct primary keys, no duplicates
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}$/); // stable 8-hex-char id
  });

  it('is deterministic (same entities → identical json)', () => {
    const a = generateSeedData([User, Post], 5).json;
    const b = generateSeedData([User, Post], 5).json;
    expect(a).toBe(b);
  });

  it('never throws on malformed input', () => {
    // @ts-expect-error malformed
    expect(() => generateSeedData(null)).not.toThrow();
    expect(generateSeedData([]).summary).toContain('nothing to seed');
  });
});
