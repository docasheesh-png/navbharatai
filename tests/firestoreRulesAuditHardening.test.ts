// Forensic audit 2026-10-04 — Firestore / Storage rules: what a client may write is only what the app writes.
// (Text assertions over the deployed rules files; CI does not run the emulator — see the open item on rules
// deployment in PROGRESS.md.)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const rules = readFileSync('firestore.rules', 'utf8');
const block = (name: string) => {
  const start = rules.indexOf(`match /${name}/`);
  if (start < 0) return '';
  const next = rules.indexOf('\n    match /', start + 10);
  return rules.slice(start, next < 0 ? rules.length : next);
};

describe('client writes are only the ones the app makes', () => {
  it('users/{uid} is server-written only', () => {
    expect(block('users')).toMatch(/allow create, update, delete: if false;/);
  });

  it('the dead template collections are gone (default deny covers them)', () => {
    expect(rules).not.toMatch(/match \/posts\//);
    expect(rules).not.toMatch(/match \/groups\//);
  });

  it('retired / unused collections refuse every client access', () => {
    expect(block('build_jobs')).toMatch(/allow read, write: if false;/);
    expect(block('chat_messages')).toMatch(/allow read, write: if false;/);
  });

  it('agent history is create-only, pinned to the caller', () => {
    const b = block('chat_agent_history');
    expect(b).toMatch(/allow create: if isSignedIn\(\) && request\.resource\.data\.userId == request\.auth\.uid;/);
    expect(b).toMatch(/allow update, delete: if false;/);
  });

  it('a collab comment update may only flip `resolved`', () => {
    const c = rules.slice(rules.indexOf('match /comments/{commentId}'), rules.indexOf('match /ai_chat/'));
    expect(c).toMatch(/affectedKeys\(\)\.hasOnly\(\['resolved'\]\)/);
  });
});

describe('Cloud Storage', () => {
  it('a deny-all rules file exists and firebase.json deploys it', () => {
    expect(readFileSync('storage.rules', 'utf8')).toMatch(/allow read, write: if false;/);
    expect(JSON.parse(readFileSync('firebase.json', 'utf8')).storage).toEqual({ rules: 'storage.rules' });
  });
});
