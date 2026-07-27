import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';

// This module is the ONLY path by which a NavBharatAI tool changes a user's real app. Five Design &
// Build tools now depend on it, so every abort path below is the difference between "you can undo
// that" and a user losing work they cannot recreate. Both underlying stores fail SILENTLY — the
// history store swallows its own errors and truncates big snapshots; the workspace store no-ops
// without a database and drops oversized files — so the tests exercise those exact silences.

const state = {
  uid: null as string | null,
  files: {} as Record<string, string>,
  merged: [] as Array<{ workspaceId: string; partial: Record<string, string> }>,
  mergeLands: true,
  /** Simulates the store's per-file size cap: content over this is accepted then silently dropped. */
  mergeDropsOver: Infinity,
  historyLands: true,
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
    if (!state.mergeLands) return;
    for (const [p, c] of Object.entries(partial)) {
      if (Buffer.byteLength(c, 'utf8') <= state.mergeDropsOver) state.files[p] = c;
    }
  },
  listUserWorkspaceApps: async () => [
    { workspaceId: 'agentv3-user123-sess456', fileCount: 3, savedAt: 1_760_000_000_000 },
    { workspaceId: 'agentv3-user123-other', fileCount: 1, savedAt: 0 },
  ],
}));

vi.mock('../src/server/project/BuildHistoryStore', () => ({
  buildHistoryStore: {
    save: async (_sessionId: string, entry: { files: Record<string, string> }) => {
      if (!state.historyLands) return;
      const files = state.historyTruncates ? {} : { ...entry.files };
      state.versions.unshift({ id: `v_${state.versions.length + 1}`, files });
    },
    list: async () => state.versions.map((v) => ({ id: v.id })),
    get: async (_sessionId: string, id: string) => state.versions.find((v) => v.id === id) || null,
  },
}));

const { sessionWorkspaceId, applyFilesToApp, saveVerifiedRestorePoint, writeFilesVerified } =
  await import('../src/server/lib/workspaceEdit');
const { registerWorkspaceFileRoutes, isWritablePath, validateWritePayload } =
  await import('../src/server/routes/workspaceFiles');

const routes = captureRoutes(registerWorkspaceFileRoutes);
const write = routes.get('POST /api/workspace/write')!;
const listApps = routes.get('GET /api/workspace/apps')!;
const listFiles = routes.get('GET /api/workspace/files')!;
const readFile = routes.get('GET /api/workspace/file')!;

const UID = 'user123';
const SID = 'sess456';
const WS = `agentv3-${UID}-${SID}`;

beforeEach(() => {
  state.uid = UID;
  state.files = { 'index.html': '<html><body>hi</body></html>', 'src/app.css': '.a{color:red}' };
  state.merged = [];
  state.mergeLands = true;
  state.mergeDropsOver = Infinity;
  state.historyLands = true;
  state.historyTruncates = false;
  state.versions = [];
});

describe('sessionWorkspaceId — the workspace is derived, never accepted', () => {
  it('builds the real id from the verified uid', () => {
    expect(sessionWorkspaceId('u1', 's1')).toBe('agentv3-u1-s1');
  });

  it('refuses anything that is not a plain id', () => {
    for (const bad of ['', '../other', 'a b', 'x/y', 'a'.repeat(129)]) {
      expect(sessionWorkspaceId('u1', bad), bad).toBeNull();
    }
    expect(sessionWorkspaceId('', 's1')).toBeNull();
  });
});

describe('isWritablePath — a tool has no business writing outside the project', () => {
  it('accepts ordinary source files', () => {
    for (const p of ['index.html', 'src/App.tsx', 'styles/main.css', 'pages/about.html', 'data.json', 'notes.md']) {
      expect(isWritablePath(p), p).toBe(true);
    }
  });

  it('refuses traversal, absolute paths and files a tool must never author', () => {
    for (const p of ['../secrets.js', '/etc/passwd', 'a/../../b.js', 'src//x.js', 'package-lock.json',
                     'logo.png', 'archive.zip', 'Makefile', 'C:\\x.js', '']) {
      expect(isWritablePath(p), p).toBe(false);
    }
  });
});

describe('validateWritePayload — one clear reason, never a guess', () => {
  it('accepts a real patch', () => {
    const r = validateWritePayload({ 'index.html': '<p>hi</p>' });
    expect(r.ok).toBe(true);
  });

  it('names the offending file instead of failing vaguely', () => {
    const r = validateWritePayload({ '../evil.js': 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('../evil.js');
  });

  it('rejects non-text content and empty payloads', () => {
    expect(validateWritePayload({ 'a.js': 42 }).ok).toBe(false);
    expect(validateWritePayload({}).ok).toBe(false);
    expect(validateWritePayload(null).ok).toBe(false);
    expect(validateWritePayload(['a.js']).ok).toBe(false);
  });

  it('refuses a payload too large to save in one go', () => {
    const r = validateWritePayload({ 'big.js': 'x'.repeat(5 * 1024 * 1024) });
    expect(r.ok).toBe(false);
  });
});

describe('saveVerifiedRestorePoint — proof, not a promise that resolved', () => {
  it('confirms the snapshot holds the exact bytes of what is being overwritten', async () => {
    const r = await saveVerifiedRestorePoint(SID, state.files, ['index.html'], 'test');
    expect(r.ok).toBe(true);
    expect(r.versionId).toBeTruthy();
    expect(state.versions[0].files['index.html']).toBe(state.files['index.html']);
  });

  it('fails when the store silently saved nothing', async () => {
    state.historyLands = false;
    const r = await saveVerifiedRestorePoint(SID, state.files, ['index.html'], 'test');
    expect(r.ok).toBe(false);
  });

  it('fails when the snapshot was truncated past the protected file', async () => {
    state.historyTruncates = true;
    const r = await saveVerifiedRestorePoint(SID, state.files, ['index.html'], 'test');
    expect(r.ok).toBe(false);
  });

  it('an app with no files needs no restore point, and says so instead of inventing an id', async () => {
    const r = await saveVerifiedRestorePoint(SID, {}, [], 'test');
    expect(r.ok).toBe(true);
    expect(r.versionId).toBeNull();
    expect(r.reason).toBe('nothing-to-protect');
  });

  it('a brand-new file needs no original, but the snapshot must still exist', async () => {
    const r = await saveVerifiedRestorePoint(SID, state.files, ['pages/new.html'], 'test');
    expect(r.ok).toBe(true);
    expect(r.versionId).toBeTruthy();
  });
});

describe('writeFilesVerified — reads the write back', () => {
  it('confirms every file landed', async () => {
    const r = await writeFilesVerified(WS, { 'index.html': '<p>new</p>' });
    expect(r.ok).toBe(true);
    expect(r.written).toEqual(['index.html']);
  });

  it('does not report success when the store silently did nothing', async () => {
    state.mergeLands = false;
    const r = await writeFilesVerified(WS, { 'index.html': '<p>new</p>' });
    expect(r.ok).toBe(false);
    expect(r.failed).toEqual(['index.html']);
  });

  it('rejects an oversized file up front rather than letting the store drop it', async () => {
    const r = await writeFilesVerified(WS, { 'big.js': 'x'.repeat(1024 * 1024) });
    expect(r.ok).toBe(false);
    expect(r.failed).toEqual(['big.js']);
    expect(state.merged).toHaveLength(0);
  });

  it('a partial landing is a failure with the paths named, never "saved"', async () => {
    state.mergeDropsOver = 20; // the store keeps the small file and drops the big one
    const r = await writeFilesVerified(WS, { 'a.js': 'tiny', 'b.js': 'y'.repeat(500) });
    expect(r.ok).toBe(false);
    expect(r.written).toEqual(['a.js']);
    expect(r.failed).toEqual(['b.js']);
  });
});

describe('applyFilesToApp — the sequence every tool shares', () => {
  it('protects, writes, and reports an undo hint', async () => {
    const r = await applyFilesToApp(WS, SID, { 'index.html': '<p>changed</p>' }, 'test change');
    expect(r.ok).toBe(true);
    expect(r.written).toEqual(['index.html']);
    expect(r.undoHint).toMatch(/Versioning/);
    expect(state.files['index.html']).toBe('<p>changed</p>');
  });

  it('writes NOTHING when the restore point cannot be proven', async () => {
    state.historyLands = false;
    const before = state.files['index.html'];
    const r = await applyFilesToApp(WS, SID, { 'index.html': '<p>changed</p>' }, 'test');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
    expect(state.merged).toHaveLength(0);
    expect(state.files['index.html']).toBe(before);
  });

  it('skips files whose content is already identical — no pointless restore point', async () => {
    const r = await applyFilesToApp(WS, SID, { 'index.html': state.files['index.html'] }, 'test');
    expect(r.ok).toBe(true);
    expect(r.written).toEqual([]);
    expect(state.versions).toHaveLength(0);
    expect(state.merged).toHaveLength(0);
  });

  it('writes several files under ONE restore point', async () => {
    const r = await applyFilesToApp(
      WS, SID,
      { 'pages/about.html': '<p>about</p>', 'pages/contact.html': '<p>contact</p>' },
      'Add pages',
    );
    expect(r.ok).toBe(true);
    expect(r.written.sort()).toEqual(['pages/about.html', 'pages/contact.html']);
    expect(state.versions).toHaveLength(1);
  });

  it('creates the first file of an empty app without pretending a restore point exists', async () => {
    state.files = {};
    const r = await applyFilesToApp(WS, SID, { 'index.html': '<p>first</p>' }, 'first file');
    expect(r.ok).toBe(true);
    expect(r.versionId).toBeNull();
    expect(r.undoHint).toBeUndefined();
    expect(state.files['index.html']).toBe('<p>first</p>');
  });
});

describe('the routes', () => {
  it('a signed-out caller can neither read nor write', async () => {
    state.uid = null;
    for (const [handler, req] of [
      [listApps, mockReq({})],
      [listFiles, mockReq({ query: { sessionId: SID } })],
      [readFile, mockReq({ query: { sessionId: SID, path: 'index.html' } })],
      [write, mockReq({ body: { sessionId: SID, files: { 'index.html': 'x' } } })],
    ] as const) {
      const res = mockRes();
      await handler(req, res);
      expect(res.statusCode).toBe(401);
    }
    expect(state.merged).toHaveLength(0);
  });

  it('lists the user’s apps by sessionId, not by internal workspace id', async () => {
    const res = mockRes();
    await listApps(mockReq({}), res);
    expect(res.body.apps.map((a: { sessionId: string }) => a.sessionId)).toEqual([SID, 'other']);
  });

  it('lists files and marks which of them a tool may write', async () => {
    state.files['logo.png'] = 'binary';
    const res = mockRes();
    await listFiles(mockReq({ query: { sessionId: SID } }), res);
    const byPath = Object.fromEntries(res.body.files.map((f: { path: string; writable: boolean }) => [f.path, f.writable]));
    expect(byPath['index.html']).toBe(true);
    expect(byPath['logo.png']).toBe(false);
  });

  it('returns a file’s real current source', async () => {
    const res = mockRes();
    await readFile(mockReq({ query: { sessionId: SID, path: 'src/app.css' } }), res);
    expect(res.body.code).toBe('.a{color:red}');
  });

  it('writes a real change and reports the version it can be undone from', async () => {
    const res = mockRes();
    await write(mockReq({ body: { sessionId: SID, files: { 'index.html': '<p>new</p>' }, label: 'Dark mode' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.versionId).toBeTruthy();
    expect(state.merged[0].workspaceId).toBe(WS);
    expect(state.files['index.html']).toBe('<p>new</p>');
  });

  it('refuses a path that tries to leave the project, and writes nothing', async () => {
    const res = mockRes();
    await write(mockReq({ body: { sessionId: SID, files: { '../escape.js': 'x' } } }), res);
    expect(res.statusCode).toBe(400);
    expect(state.merged).toHaveLength(0);
  });

  it('refuses when no app is named', async () => {
    const res = mockRes();
    await write(mockReq({ body: { files: { 'index.html': 'x' } } }), res);
    expect(res.statusCode).toBe(400);
    expect(state.merged).toHaveLength(0);
  });
});
