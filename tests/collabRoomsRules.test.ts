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

  it('only the owner can update room metadata, and the owner stamp is immutable', () => {
    expect(block).toMatch(/allow update: if collabOwner\(roomId\)[\s\S]*incoming\(\)\.createdBy == existing\(\)\.createdBy/);
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

describe('firestore.rules — collab_rooms OWNER APPROVAL + KICK (access control)', () => {
  it('defines the owner / approved-member access helpers', () => {
    expect(rules).toContain('function collabOwner(rid)');
    expect(rules).toContain('function collabApproved(rid)');
    expect(rules).toContain('function canAccessCollab(rid)');
    // approved = the caller has a members doc with status 'approved'
    expect(rules).toMatch(/collabApproved[\s\S]{0,240}status == 'approved'/);
  });

  it('the shared CODE lives in an approval-gated content subcollection (not readable while pending)', () => {
    const content = block.slice(block.indexOf('match /content/{docId}'));
    expect(block).toContain('match /content/{docId}');
    expect(content).toMatch(/allow read: if canAccessCollab\(roomId\)/);
    expect(content).toMatch(/allow write: if canAccessCollab\(roomId\)/);
  });

  it('a user may only create their OWN request as pending; only the owner can approve or kick', () => {
    const mem = block.slice(block.indexOf('match /members/{memberId}'));
    // create your own doc; a self-created 'approved' is only allowed for the owner
    expect(mem).toMatch(/allow create: if isSignedIn\(\) && memberId == request\.auth\.uid/);
    expect(mem).toMatch(/status == 'approved' \? collabOwner\(roomId\) : true/);
    // approve / change status → owner only
    expect(mem).toMatch(/allow update: if collabOwner\(roomId\)/);
    // kick (owner) or leave (self)
    expect(mem).toMatch(/allow delete: if collabOwner\(roomId\) \|\| memberId == request\.auth\.uid/);
  });

  it('code / chat / AI / presence reads are all approval-gated', () => {
    for (const sub of ['content', 'presence', 'chat', 'comments', 'ai_chat']) {
      const s = block.slice(block.indexOf(`match /${sub}/`));
      expect(s, sub).toMatch(/canAccessCollab\(roomId\)/);
    }
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

  it('has the AI-switcher tab layout (Free / Pro v5 / Professional / Team)', () => {
    expect(src).toContain("type RoomTab = 'free' | 'pro' | 'professional' | 'team'");
    expect(src).toContain('setRoomTab');
    // the shared Free AI thread now lives under the 'free' tab
    expect(src).toContain("roomTab === 'free'");
    // Pro v5 + Professional are present (coming soon), owner picks the professional
    expect(src).toContain("roomTab === 'pro'");
    expect(src).toContain("roomTab === 'professional'");
    expect(src).toContain('ROOM_PROFESSIONALS');
    expect(src).toContain('setSelectedProfessional');
  });

  it('a new room is a CLEAN scratchpad — content starts empty, never the app preview/boot dump', () => {
    expect(src).toContain("const [sharedCode, setSharedCode] = useState('')");
    expect(src).not.toContain('code: generatedCode');
    // createRoom seeds an EMPTY approval-gated content doc (not the room doc, not the preview HTML)
    expect(src).toMatch(/'content', 'shared'\), \{ code: '' \}/);
    // shared code is mirrored into the user's app only when non-empty (never blanks their app)
    expect(src).toContain('if (code) onCodeUpdate(code)');
  });
});

describe('LiveCollaboration — join needs OWNER APPROVAL, and the owner can KICK', () => {
  const src = readFileSync(join(__dirname, '../src/components/ide/LiveCollaboration.tsx'), 'utf8');

  it('the room creator is stored as an auto-approved member (the owner)', () => {
    const fn = src.slice(src.indexOf('createRoom = async'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toMatch(/'members', myId\)[\s\S]{0,120}status: 'approved'/);
  });

  it('a non-owner joiner creates a PENDING request and waits for approval (cannot self-approve)', () => {
    const fn = src.slice(src.indexOf('joinRoom = async'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toContain("status: 'pending'");
    expect(body).toContain("setStatus('pending')");
    // it watches its own request doc and only enters once approved
    expect(body).toContain('onSnapshot(meRef');
    expect(body).toMatch(/status === 'approved'[\s\S]{0,140}enterRoom\(id, ownerUid\)/);
  });

  it('the owner approves via a status change and kicks/rejects by deleting the member doc', () => {
    expect(src).toMatch(/approveMember = async[\s\S]{0,200}status: 'approved'/);
    expect(src).toMatch(/removeMember = async[\s\S]{0,260}deleteDoc\(doc\(db, 'collab_rooms', activeRoom, 'members', uid\)\)/);
    // owner-only guard on both
    expect(src).toMatch(/approveMember = async[\s\S]{0,120}myId !== roomOwner/);
    expect(src).toMatch(/removeMember = async[\s\S]{0,120}myId !== roomOwner/);
  });

  it('a kicked member is booted immediately when their approved membership disappears', () => {
    expect(src).toMatch(/if \(!me \|\| me\.status !== 'approved'\) handleBooted/);
    expect(src).toContain("handleBooted('You were removed from the room by the owner.')");
  });

  it('shows a pending-approval screen and an owner-only requests UI', () => {
    expect(src).toContain("status === 'pending' ?");
    expect(src).toContain('Waiting for approval');
    expect(src).toContain('Join requests');
    expect(src).toContain('isOwner && pendingMembers.length > 0');
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
