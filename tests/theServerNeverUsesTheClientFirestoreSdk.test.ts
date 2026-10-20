/**
 * THE SERVER NEVER READS OR WRITES THROUGH THE CLIENT FIRESTORE SDK (performance audit 2026-10-11, F9).
 *
 * `server.ts` started the browser SDK (`firebase/firestore`) and shared its handle with route modules through
 * `lib/db.ts`. On a server that handle has no signed-in user, so it runs as an anonymous browser against the
 * security rules — and it is not the admin API: the zip import's workspace lease called `.collection()` and
 * `.runTransaction()` on it, threw, failed OPEN, and an import could overwrite a workspace a build on another
 * instance was writing. The SBOM store wrote through it too, was refused by the rules, and stored nothing.
 *
 * The class: two Firestore SDKs with different authority, both reachable from server code. The fix leaves one.
 * This census fails if a server file imports the client SDK again, or if the shared client handle comes back.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(__dirname, '..');

/**
 * Files that contain the client SDK's import lines only as TEXT they generate for a USER's app — never as an
 * import of their own. Each is listed with that reason; a new entry needs the same.
 */
const GENERATES_USER_APP_CODE: Record<string, string> = {
  'src/server/lib/DbConfigGenerator.ts': 'emits a Bring-Your-Own-Firebase client module into the user app',
  'src/server/AppMakerLab/generator/AuthCodeGenerator.ts': "emits the user app's sign-in code",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const CLIENT_SDK_IMPORT = /^\s*import\b[^;]*?from\s+['"]firebase\/(firestore|app)['"]|import\(\s*['"]firebase\/(firestore|app)['"]\s*\)/m;

describe('the server has one Firestore SDK — the admin one', () => {
  it('🔒 no server file imports the client SDK', () => {
    const files = [join(root, 'server.ts'), ...walk(join(root, 'src/server'))];
    const offenders = files
      .map((f) => relative(root, f).split('\\').join('/'))
      .filter((rel) => !GENERATES_USER_APP_CODE[rel])
      .filter((rel) => CLIENT_SDK_IMPORT.test(readFileSync(join(root, rel), 'utf8')));
    expect(offenders, 'server code must use getServerDb() (the admin SDK), never the client SDK').toEqual([]);
  });

  it('🔒 the shared client handle is gone, and nothing asks for it', () => {
    expect(existsSync(join(root, 'src/server/lib/db.ts'))).toBe(false);
    const files = [join(root, 'server.ts'), ...walk(join(root, 'src/server'))];
    const askers = files.filter((f) => !GENERATES_USER_APP_CODE[relative(root, f).split('\\').join('/')]).filter((f) => /from\s+['"](\.\.?\/)+(lib\/)?db['"]|import\(\s*['"](\.\.?\/)+(lib\/)?db['"]\s*\)|src\/server\/lib\/db['"]/.test(readFileSync(f, 'utf8')));
    expect(askers.map((f) => relative(root, f))).toEqual([]);
  });

  it('the zip import lease and the SBOM store use the admin handle', () => {
    const zip = readFileSync(join(root, 'src/server/routes/zipUpload.ts'), 'utf8');
    expect(zip).toMatch(/import\s*\{\s*getServerDb\s*\}\s*from\s*['"]\.\.\/lib\/serverDb['"]/);
    const leaseStoreInitializer = zip.match(/const\s+store\s*=\s*([^;]+);/)?.[1];
    expect(leaseStoreInitializer, 'ZIP lease must obtain its enabled store from the admin initializer').toBeDefined();
    // A disabled lease deliberately selects null and refuses admission; it never substitutes a client handle.
    expect(leaseStoreInitializer).toMatch(/getServerDb\(\)/);
    expect(leaseStoreInitializer).toMatch(/as unknown as BuildLeaseStore \| null/);
    expect(zip).toMatch(/await claimWorkspaceBuild\(store,\s*\{/);
    const sbom = readFileSync(join(root, 'src/server/routes/sbom.ts'), 'utf8');
    expect(sbom).toMatch(/getServerDb\(\)/);
    expect(sbom).toMatch(/collection\('sboms'\)\.doc\(ownedWorkspaceId\)\.collection\('builds'\)/);
  });

  it('every generator on the allowlist still exists — a stale entry would hide nothing but mislead', () => {
    for (const rel of Object.keys(GENERATES_USER_APP_CODE)) expect(existsSync(join(root, rel)), rel).toBe(true);
  });
});
