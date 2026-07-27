import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

// The Minifier's "Apply" is the only place in NavBharatAI where machine-generated output overwrites a
// user's own source. Minified code cannot be un-minified by hand, so every guard below is the
// difference between "you can undo that" and "your app is gone". They are tested as such.

const state = {
  uid: null as string | null,
  files: {} as Record<string, string>,
  merged: [] as Array<{ workspaceId: string; partial: Record<string, string> }>,
  /** When false, the merge is accepted but nothing actually changes — Firestore-unavailable. */
  mergeLands: true,
  /** When false, saving a restore point silently does nothing — exactly how the real store behaves. */
  historyLands: true,
  /** When true, the snapshot is stored but truncated past our file (Firestore doc-size cap). */
  historyTruncates: false,
  versions: [] as Array<{ id: string; files: Record<string, string> }>,
};

vi.mock('../src/server/lib/authMiddleware', () => ({
  verifyFirebaseToken: async () => state.uid,
}));

vi.mock('../src/server/AgentV3/WorkspaceFileStore', () => ({
  loadWorkspaceFiles: async () => ({ ...state.files }),
  mergeWorkspaceFiles: async (workspaceId: string, partial: Record<string, string>) => {
    state.merged.push({ workspaceId, partial });
    if (state.mergeLands) Object.assign(state.files, partial);
  },
}));

vi.mock('../src/server/project/BuildHistoryStore', () => ({
  buildHistoryStore: {
    save: async (sessionId: string, entry: { files: Record<string, string> }) => {
      if (!state.historyLands) return;
      const files = state.historyTruncates ? {} : { ...entry.files };
      state.versions.unshift({ id: `v_${state.versions.length + 1}`, files });
    },
    list: async () => state.versions.map((v) => ({ id: v.id })),
    get: async (_sessionId: string, id: string) => state.versions.find((v) => v.id === id) || null,
  },
}));

const { registerMinifyRoutes } = await import('../src/server/routes/minify');
const { sessionWorkspaceId } = await import('../src/server/lib/workspaceEdit');
const routes = captureRoutes(registerMinifyRoutes);

const apply = routes.get('POST /api/minify/apply')!;
const listFiles = routes.get('GET /api/minify/files')!;
const readFile = routes.get('GET /api/minify/file')!;
const minify = routes.get('POST /api/minify')!;

const UID = 'user123';
const SID = 'sess456';
const SRC = `// a comment
export function greet(personName) {
  const api = "https://navbharatai.com/api";
  console.log(personName, api);
  return "Hello " + personName + " — welcome to NavBharatAI";
}
`;

beforeEach(() => {
  state.uid = UID;
  state.files = { 'src/app.js': SRC, 'package.json': '{}', 'vendor.min.js': 'a=1' };
  state.merged = [];
  state.mergeLands = true;
  state.historyLands = true;
  state.historyTruncates = false;
  state.versions = [];
});

async function callApply(body: Record<string, unknown>) {
  const res = mockRes();
  await apply(mockReq({ body }), res);
  return res;
}

describe('sessionWorkspaceId — the workspace is derived, never accepted', () => {
  it('builds the real workspace id from the verified uid', () => {
    expect(sessionWorkspaceId('u1', 's1')).toBe('agentv3-u1-s1');
  });

  it('refuses ids that could reach outside this account', () => {
    // A path-ish or padded session id is the only lever a caller has here; it must not be one.
    for (const bad of ['', '../other', 'a b', 'x/y', 'a'.repeat(129)]) {
      expect(sessionWorkspaceId('u1', bad), bad).toBeNull();
    }
    expect(sessionWorkspaceId('', 's1')).toBeNull();
  });
});

describe('POST /api/minify/apply — the guards before anything is overwritten', () => {
  it('a signed-out caller cannot change anything', async () => {
    state.uid = null;
    const res = await callApply({ sessionId: SID, path: 'src/app.js' });
    expect(res.statusCode).toBe(401);
    expect(state.merged).toHaveLength(0);
  });

  it('refuses files the build tools read by hand — package.json is never minified', async () => {
    const res = await callApply({ sessionId: SID, path: 'package.json' });
    expect(res.statusCode).toBe(400);
    expect(state.merged).toHaveLength(0);
  });

  it('refuses an already-minified file instead of pointlessly rewriting it', async () => {
    const res = await callApply({ sessionId: SID, path: 'vendor.min.js' });
    expect(res.statusCode).toBe(400);
    expect(state.merged).toHaveLength(0);
  });

  it('a missing file is reported, not silently created', async () => {
    const res = await callApply({ sessionId: SID, path: 'src/gone.js' });
    expect(res.statusCode).toBe(404);
    expect(state.merged).toHaveLength(0);
  });

  it('refuses when no app is named', async () => {
    const res = await callApply({ path: 'src/app.js' });
    expect(res.statusCode).toBe(400);
    expect(state.merged).toHaveLength(0);
  });
});

describe('POST /api/minify/apply — the restore point is a precondition, not a courtesy', () => {
  it('writes the minified file and reports the real saving once a restore point is verified', async () => {
    const res = await callApply({ sessionId: SID, path: 'src/app.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body.applied).toBe(true);
    expect(res.body.savedBytes).toBeGreaterThan(0);
    expect(res.body.versionId).toBeTruthy();
    // The workspace is derived server-side — the client never named it.
    expect(state.merged[0].workspaceId).toBe(`agentv3-${UID}-${SID}`);
    // The URL inside the string survived; the regex minifier this replaced cut it at "//".
    expect(state.files['src/app.js']).toContain('https://navbharatai.com/api');
    expect(state.files['src/app.js'].length).toBeLessThan(SRC.length);
  });

  it('the restore point holds the ORIGINAL bytes, so the undo it promises actually works', async () => {
    await callApply({ sessionId: SID, path: 'src/app.js' });
    expect(state.versions[0].files['src/app.js']).toBe(SRC);
  });

  it('NOTHING is written when the restore point cannot be saved', async () => {
    // buildHistoryStore.save() swallows its own errors and returns void, so a resolved save proves
    // nothing. This is the case that would silently destroy a user's file.
    state.historyLands = false;
    const res = await callApply({ sessionId: SID, path: 'src/app.js' });
    expect(res.statusCode).toBe(503);
    expect(state.merged).toHaveLength(0);
    expect(state.files['src/app.js']).toBe(SRC);
  });

  it('NOTHING is written when the snapshot was truncated past this file', async () => {
    // The store caps snapshots to fit Firestore's document limit, so a big app's restore point can
    // exist yet not contain the file being overwritten. That is not a restore point.
    state.historyTruncates = true;
    const res = await callApply({ sessionId: SID, path: 'src/app.js' });
    expect(res.statusCode).toBe(503);
    expect(state.merged).toHaveLength(0);
    expect(state.files['src/app.js']).toBe(SRC);
  });

  it('does not claim success when the write did not land', async () => {
    // mergeWorkspaceFiles resolves happily with no database. Reporting off that would be a fake success.
    state.mergeLands = false;
    const res = await callApply({ sessionId: SID, path: 'src/app.js' });
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/unchanged/i);
  });

  it('says so honestly when there is nothing left to save, and leaves the file alone', async () => {
    state.files['src/tiny.js'] = 'a';
    const res = await callApply({ sessionId: SID, path: 'src/tiny.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body.applied).toBe(false);
    expect(state.merged).toHaveLength(0);
    expect(state.files['src/tiny.js']).toBe('a');
  });

  it('a file with a syntax error is reported, never half-written', async () => {
    state.files['src/broken.js'] = 'function oops( { return 1;';
    const res = await callApply({ sessionId: SID, path: 'src/broken.js' });
    expect(res.statusCode).toBe(422);
    expect(state.merged).toHaveLength(0);
    expect(state.files['src/broken.js']).toBe('function oops( { return 1;');
  });

  it('keeps console.log when the user asks to keep it', async () => {
    await callApply({ sessionId: SID, path: 'src/app.js', keepConsole: true });
    expect(state.files['src/app.js']).toContain('console.log');
  });
});

describe('the read-only routes', () => {
  it('lists only the files that are safe to optimise', async () => {
    const res = mockRes();
    await listFiles(mockReq({ query: { sessionId: SID } }), res);
    expect(res.body.files.map((f: { path: string }) => f.path)).toEqual(['src/app.js']);
    expect(res.body.files[0].bytes).toBe(Buffer.byteLength(SRC, 'utf8'));
  });

  it('will not list another account’s app', async () => {
    state.uid = null;
    const res = mockRes();
    await listFiles(mockReq({ query: { sessionId: SID } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('returns the file’s real current source', async () => {
    const res = mockRes();
    await readFile(mockReq({ query: { sessionId: SID, path: 'src/app.js' } }), res);
    expect(res.body.code).toBe(SRC);
    expect(res.body.language).toBe('js');
  });

  it('minifies pasted code without touching any app', async () => {
    const res = mockRes();
    await minify(mockReq({ body: { code: SRC, filename: 'x.js' } }), res);
    expect(res.body.ok).toBe(true);
    expect(res.body.savedBytes).toBeGreaterThan(0);
    expect(state.merged).toHaveLength(0);
  });

  it('rejects an empty paste rather than reporting a 0-byte saving', async () => {
    const res = mockRes();
    await minify(mockReq({ body: { code: '   ' } }), res);
    expect(res.statusCode).toBe(400);
  });
});
