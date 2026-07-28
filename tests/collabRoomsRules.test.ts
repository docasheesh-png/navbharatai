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

  it('the shared AI thread (Phase 1a) is authored by the sender, size-bounded, and immutable', () => {
    const ai = block.slice(block.indexOf('match /ai_chat/{msgId}'));
    expect(block).toContain('match /ai_chat/{msgId}');
    expect(ai).toMatch(/incoming\(\)\.authorId == request\.auth\.uid/);
    expect(ai).toMatch(/text\.size\(\) <= 20000/);
    expect(ai).toMatch(/allow update, delete: if false/);
  });
});

describe('LiveCollaboration — shared in-room AI (Phase 1a) is REAL and billed to the sender', () => {
  const src = readFileSync(join(__dirname, '../src/components/ide/LiveCollaboration.tsx'), 'utf8');

  it('calls the real Free chat engine (not a stub)', () => {
    expect(src).toContain("fetch('/api/chat/navbharat'");
    expect(src).toContain("agent: 'navbharatai'");
  });

  it('bills the triggering member (their own identity headers)', () => {
    expect(src).toContain("'x-user-id': myId");
    expect(src).toContain("'x-user-email': userEmail");
  });

  it('publishes BOTH the prompt and the reply to the shared ai_chat thread so all members see them', () => {
    const fn = src.slice(src.indexOf('sendAiPrompt = async'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain("'ai_chat'");
    expect(body).toContain("role: 'user'");
    expect(body).toContain("role: 'assistant'");
  });

  it('surfaces a real error instead of a fake reply when the AI fails', () => {
    const fn = src.slice(src.indexOf('sendAiPrompt = async'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain('setAiError');
    // The reply is only trusted when the response is ok AND non-empty — never a fabricated answer.
    expect(body).toMatch(/if \(!res\.ok \|\| !reply\)/);
    expect(body).toContain('throw new Error');
  });

  it('has a mobile-friendly tab layout (Code / AI / Team)', () => {
    expect(src).toContain("type RoomTab = 'code' | 'ai' | 'team'");
    expect(src).toContain('setRoomTab');
  });

  it('a new room is a CLEAN scratchpad — it never seeds the app preview/boot document', () => {
    // createRoom must seed empty code, and the shared editor starts blank.
    expect(src).toMatch(/code: '',\s*\/\/ clean scratchpad/);
    expect(src).toContain("const [sharedCode, setSharedCode] = useState('')");
    expect(src).not.toContain('code: generatedCode');
    // the shared code is only mirrored into the user's app when non-empty (never blanks their app)
    expect(src).toContain('if (d.code) onCodeUpdate(d.code)');
    expect(src).toContain('if (data.code) onCodeUpdate(data.code)');
    expect(src).toContain('if (code) onCodeUpdate(code)');
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
