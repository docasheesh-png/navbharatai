import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Locks the security invariants of the Live Collaboration (collab_rooms) Firestore rules.
 * These are string-level assertions on firestore.rules — the rules can only be exercised end to
 * end against the Firestore emulator, but this guards the critical guarantees from silently
 * regressing (a lost `isOwner`/`isSignedIn` clause is a real security hole).
 */
const rules = readFileSync(join(__dirname, '../firestore.rules'), 'utf8');

// Isolate the collab_rooms match block so assertions are scoped to it.
const start = rules.indexOf('match /collab_rooms/{roomId}');
const block = rules.slice(start, rules.indexOf('\n    }\n  }\n}', start));

describe('firestore.rules — collab_rooms (Live Collaboration) security invariants', () => {
  it('has a collab_rooms match block', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain('match /presence/{memberId}');
    expect(block).toContain('match /chat/{msgId}');
    expect(block).toContain('match /comments/{commentId}');
  });

  it('rooms cannot be enumerated (list denied) but a signed-in user can get one by ID', () => {
    expect(block).toContain('allow get: if isSignedIn();');
    expect(block).toContain('allow list: if false;');
  });

  it('creating a room requires the creator to stamp themselves as owner', () => {
    expect(block).toMatch(/allow create: if isSignedIn\(\)[\s\S]*incoming\(\)\.createdBy == request\.auth\.uid/);
  });

  it('updates keep the owner stamp immutable', () => {
    expect(block).toMatch(/allow update: if isSignedIn\(\)[\s\S]*incoming\(\)\.createdBy == existing\(\)\.createdBy/);
  });

  it('clients can never delete a room', () => {
    expect(block).toContain('allow delete: if false;');
  });

  it('a member may only write their OWN presence doc', () => {
    const presence = block.slice(block.indexOf('match /presence/{memberId}'));
    expect(presence).toMatch(/allow write: if isOwner\(memberId\)/);
  });

  it('chat messages are authored by the sender only and immutable', () => {
    const chat = block.slice(block.indexOf('match /chat/{msgId}'));
    expect(chat).toMatch(/incoming\(\)\.authorId == request\.auth\.uid/);
    expect(chat).toMatch(/allow update, delete: if false/);
  });

  it('the shared code field is size-bounded (stays under Firestore 1 MB doc limit)', () => {
    expect(rules).toContain('function isValidRoomCode(data)');
    expect(rules).toMatch(/data\.code\.size\(\) <= 700000/);
    expect(block).toContain('isValidRoomCode(incoming())');
  });
});

describe('LiveCollaboration — signed-in gate (no anonymous writes that the rules would deny)', () => {
  const src = readFileSync(join(__dirname, '../src/components/ide/LiveCollaboration.tsx'), 'utf8');
  it('gates create/join on a signed-in identity', () => {
    expect(src).toContain('const signedIn = !!userId;');
    expect(src).toMatch(/createRoom = async[\s\S]{0,120}if \(!signedIn\)/);
    expect(src).toMatch(/joinRoom = async[\s\S]{0,140}if \(!signedIn\)/);
  });
});
