import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * T0-3 REGRESSION LOCK — the whole class, not one store.
 *
 * ROOT CAUSE this guards: every server-side Firestore store used to obtain its handle from the ONE
 * process-wide default instance via `admin.firestore()`, and the ~20 that needed the named database
 * called `.settings({ databaseId })` on it. But `Firestore.settings()` may be called only ONCE per
 * instance — the first store won, every later store's `.settings()` THREW, its try/catch demoted it to
 * null/in-memory, and stores that never called settings piggybacked on whoever configured the singleton
 * first (nondeterministic → often the `(default)` DB the client can't even read). Symptoms: "No build
 * report yet" (DiagnosticsStore died), chat history vanishing after a reload (FirestoreConversationStore
 * demoted to RAM), wallet/cost/profile data invisible to the client (written to the wrong DB).
 *
 * THE FIX: one shared, collision-free accessor `getServerDb()` (serverDb.ts, `getFirestore(app, dbId)` —
 * a per-databaseId cached instance configured exactly once, centrally). Every store must use it.
 *
 * THIS TEST enforces the invariant statically: NO server source file (except serverDb.ts itself) may
 * call `admin.firestore()` for a handle or `.settings({ databaseId })`. Either reintroduces the class.
 */
function collectServerFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules') continue;
      collectServerFiles(full, out);
    } else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const SERVER_DIR = join(process.cwd(), 'src', 'server');
// serverDb.ts is the ONE allowed owner of the real Firestore binding (getFirestore(app, dbId)).
const ALLOWED = new Set([join(SERVER_DIR, 'lib', 'serverDb.ts')]);

describe('T0-3 — server Firestore access is centralized on getServerDb()', () => {
  const files = collectServerFiles(SERVER_DIR).filter((f) => !ALLOWED.has(f));

  it('no server file uses admin.firestore() as its PRIMARY handle (must use getServerDb)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // The ONE permitted form is a documented last-resort fallback AFTER getServerDb() on a store whose
      // field is non-nullable: `getServerDb() ?? admin.firestore()` (getServerDb is primary; the fallback
      // only fires in a total-infra-failure that would break every store anyway). Strip that form, then
      // any remaining `admin.firestore()` is a store using it as its PRIMARY handle — the banned pattern.
      // (`admin.firestore.FieldValue` / `.Firestore` type refs have a dot, not `()`, so never match.)
      const cleaned = src.replace(/\?\?\s*admin\.firestore\(\)/g, '');
      if (/\badmin\.firestore\(\)/.test(cleaned)) offenders.push(f.replace(process.cwd() + '/', ''));
    }
    expect(offenders, `these files use admin.firestore() as a primary handle:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no server file calls the collision-prone .settings({ databaseId }) pattern', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (/\.settings\(\{\s*databaseId/.test(src)) offenders.push(f.replace(process.cwd() + '/', ''));
    }
    expect(offenders, `these files still call .settings({ databaseId ... }):\n${offenders.join('\n')}`).toEqual([]);
  });
});
