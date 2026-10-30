import { describe, it, expect } from 'vitest';
import { userDatabaseContext, firestorePerAppRulesGuidance } from '../src/server/AgentV3/userDatabaseContext';

describe('per-app Firestore rules guidance', () => {
  it('asks for app-specific rules, safe defaults, copy-not-deploy', () => {
    const g = firestorePerAppRulesGuidance();
    expect(g).toContain('firestore.rules');
    expect(g).toMatch(/THIS app/);
    expect(g).toContain('allow read, write: if false');
    expect(g).toMatch(/NEVER `allow read, write: if true`/);
    expect(g).toMatch(/do NOT claim you deployed/);
    expect(g).not.toMatch(/MUST match the user's security rules: private per-user data under `users/);
  });
});

describe('userDatabaseContext firebase', () => {
  it('injects per-app rules guidance only for firebase', () => {
    expect(userDatabaseContext({ ENGINEER_DB_PROVIDER: 'firebase', VITE_FIREBASE_PROJECT_ID: 'x' } as any)).toContain('FIRESTORE SECURITY RULES — PER APP');
    expect(userDatabaseContext({ ENGINEER_DB_PROVIDER: 'supabase' } as any)).not.toContain('FIRESTORE SECURITY RULES');
  });
});
