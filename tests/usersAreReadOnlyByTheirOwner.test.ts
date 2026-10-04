// Q-142 (2026-10-01) — `firestore.rules` let ANY signed-in user read (and list) every `/users/{userId}`
// document, including the server-managed `role`. Owner-only now. String-level, like collabRoomsRules.test.ts:
// the rules can only be exercised end to end against the emulator, which CI does not run.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const rules = readFileSync('firestore.rules', 'utf8');
const usersBlock = rules.slice(rules.indexOf('match /users/{userId}'), rules.indexOf('match /posts/{postId}'));

describe('a user document is read only by its owner', () => {
  it('the read rule is owner-only, never any signed-in user', () => {
    expect(usersBlock).toMatch(/allow read: if isOwner\(userId\);/);
    expect(usersBlock).not.toMatch(/allow read: if isSignedIn\(\);/);
  });

  it('no client code reads the users collection directly (so owner-only cannot break a screen)', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== 'server' && name !== 'node_modules') walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\./.test(name)) continue;
        const src = readFileSync(p, 'utf8');
        // APIMarketplace holds sample code for USERS' apps inside template strings — not our client.
        if (p.endsWith('APIMarketplace.tsx')) continue;
        if (/(?:doc|collection)\(\s*(?:db|firestore)\s*,\s*['"]users['"]/.test(src)) hits.push(p);
      }
    };
    walk('src');
    expect(hits).toEqual([]);
  });
});
