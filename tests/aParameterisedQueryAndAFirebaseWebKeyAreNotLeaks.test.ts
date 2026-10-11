// A PARAMETERISED QUERY AND A FIREBASE WEB KEY ARE NOT LEAKS (autopsy d0b2fcd6, 2026-10-07, Q-742).
//
// Two false build-breakers drove a repair on a read-only turn:
//   • `db.execute(sqlExpr\`UPDATE profiles SET name = ${cleanName} WHERE id = ${row.profile_id}\`)` — drizzle's
//     tagged `sql` template, which sends the values as parameters — was reported as SQL injection;
//   • the app's Firebase WEB config `apiKey` — public by design, as this repository's own secret census
//     says — was reported twice as a hardcoded secret, and the repair replaced the user's `firebaseConfig`.
// The same shapes stay flagged where they ARE a risk: an untagged template, a `raw`/`unsafe` tag, and an
// `AIza…` key outside a Firebase config (a Gemini or server-side Maps key is a real secret).

import { describe, it, expect } from 'vitest';
import { scanSecurity, isSafeTaggedTemplate } from '../src/server/AgentV3/SecurityAnalysis';
import { isFirebaseWebConfigKey } from '../src/server/lib/firebaseWebConfig';
import { analyzeThreatModel } from '../src/server/AgentV3/threatModelAnalysis';
import { scanFileStatic } from '../src/server/lib/appStaticScan';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY = 'AIzaSyD3xampleKeyValue1234567890abcdEFG'; // AIza + 35, the real length
const FIREBASE = `import { initializeApp } from "firebase/app";
const firebaseConfig = {
  apiKey: "${KEY}",
  authDomain: "mitrify.firebaseapp.com",
  projectId: "mitrify",
  storageBucket: "mitrify.appspot.com",
  appId: "1:123456789:web:abcdef123456",
};
export const app = initializeApp(firebaseConfig);`;
const GEMINI = `const GEMINI_API_KEY = "${KEY}";\nexport async function ask(q) { return fetch(url + GEMINI_API_KEY); }`;
const rules = (file: string, src: string) => scanSecurity(file, src).map((f) => f.rule);

describe('SQL: the tag decides', () => {
  it('🔒 a tagged template is parameterised — drizzle, Prisma, $queryRaw — exactly the line from the report', () => {
    expect(rules('server/routes.ts', 'await db.execute(sqlExpr`UPDATE profiles SET name = ${cleanName} WHERE id = ${row.profile_id}`);')).not.toContain('sql-injection');
    expect(rules('server/a.ts', 'await db.execute(sql`SELECT * FROM users WHERE id = ${id}`);')).not.toContain('sql-injection');
    expect(rules('server/a.ts', 'await prisma.$queryRaw`SELECT * FROM users WHERE id = ${id}`;')).not.toContain('sql-injection');
    expect(rules('server/a.ts', 'const q = Prisma.sql`DELETE FROM t WHERE id = ${id}`;')).not.toContain('sql-injection');
  });

  it('🔒 string building stays flagged: untagged, a call argument, raw/unsafe tags, return', () => {
    expect(rules('server/a.ts', "await db.query(`UPDATE profiles SET name = '${n}' WHERE id = ${id}`);")).toContain('sql-injection');
    expect(rules('server/a.ts', 'await db.execute(sql.raw(`SELECT * FROM users WHERE id = ${id}`));')).toContain('sql-injection');
    expect(rules('server/a.ts', 'await db.execute(sql.unsafe`SELECT * FROM users WHERE id = ${id}`);')).toContain('sql-injection');
    expect(rules('server/a.ts', 'return `SELECT * FROM users WHERE id = ${id}`;')).toContain('sql-injection');
  });

  it('isSafeTaggedTemplate reads only the identifier right before the backtick', () => {
    expect(isSafeTaggedTemplate('x = sql`a`', 7)).toBe(true);
    expect(isSafeTaggedTemplate('x = (`a`', 5)).toBe(false);
    expect(isSafeTaggedTemplate('return `a`', 7)).toBe(false);
  });
});

describe('Firebase: the config decides, not the prefix', () => {
  it('🔒 a Firebase WEB config key is not a hardcoded secret in any detector', () => {
    expect(rules('client/src/lib/firebase.ts', FIREBASE).filter((r) => /hardcoded/.test(r))).toEqual([]);
    expect(analyzeThreatModel([{ path: 'client/src/lib/firebase.ts', content: FIREBASE }]).filter((f) => f.kind === 'client-secret')).toEqual([]);
    expect(scanFileStatic('assets/index.js', FIREBASE).some((f) => /Google API key/.test(JSON.stringify(f)))).toBe(false);
  });

  it('🔒 the same AIza shape OUTSIDE a Firebase config is still a real secret', () => {
    expect(rules('server/gemini.ts', GEMINI)).toContain('hardcoded-provider-token');
    expect(analyzeThreatModel([{ path: 'client/src/gemini.ts', content: GEMINI }]).some((f) => f.kind === 'client-secret')).toBe(true);
    expect(scanFileStatic('assets/index.js', GEMINI).some((f) => /Google API key/.test(JSON.stringify(f)))).toBe(true);
  });

  it('needs two of the config\'s own fields — one stray word is not a config', () => {
    expect(isFirebaseWebConfigKey(FIREBASE)).toBe(true);
    expect(isFirebaseWebConfigKey(`const k = "${KEY}"; // projectId`)).toBe(false);
    expect(isFirebaseWebConfigKey(undefined)).toBe(false);
  });

  it('🔒 the native shapes a Capacitor app ships — google-services.json and GoogleService-Info.plist — are the same public config', () => {
    for (const f of ['android/app/google-services.json', 'ios-config/GoogleService-Info.plist']) {
      const content = readFileSync(join(__dirname, '..', f), 'utf8');
      expect(rules(f, content).filter((r) => /hardcoded/.test(r)), f).toEqual([]);
    }
  });
});
