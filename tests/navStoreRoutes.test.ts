import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { readFileSync } from 'fs';
import { join } from 'path';

// This store hands one person's Android app to other people's phones. The single most important
// property, tested from several angles below, is that NOTHING can make an app public except an
// admin explicitly approving it — not a clean scan, not a request parameter, not a status the
// uploader supplies.
//
// SOURCE (admin 2026-08-16): the store carries ONLY apps NavBharatAI built. There is no device-upload
// route anymore — the ONLY way bytes reach the ingest pipeline is publish-from-build, which pulls a
// NavBharatAI build artifact from the user's own GitHub Actions server-side. These tests therefore
// exercise the ingest guarantees THROUGH that path (fetchBuildArtifact is mocked to hand over bytes).

const state = {
  uid: null as string | null,
  email: null as string | null,
  storage: true,
  scanning: true,
  scanVerdict: 'clean' as string,
  scanMalicious: 0,
  saved: [] as Array<Record<string, unknown>>,
  updated: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  apps: {} as Record<string, Record<string, unknown>>,
  putCalls: 0,
  deleted: [] as string[],
  // The build artifact the (mocked) GitHub fetch hands back.
  artifactOk: true,
  artifactBytes: Buffer.alloc(0) as Buffer,
  artifactFailure: 'expired' as string,
};

vi.mock('../src/server/lib/authMiddleware', () => ({
  verifyFirebaseIdentity: async () => (state.uid ? { uid: state.uid, email: state.email } : null),
  verifyFirebaseToken: async () => state.uid,
  // The shared-data routes register through the real rateLimiter; a mock module missing an export the
  // route imports crashes REGISTRATION (undefined is not a function) and takes the whole suite red
  // while production is fine. Pass-through here — the limiter has its own tests.
  rateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../src/server/lib/malwareScan', () => ({
  // The store's ADVERTISED limit is derived from this (publishableApkLimitBytes), so the mock must
  // carry it or the route silently loses the scanner half of the cap.
  MAX_SCANNABLE_BYTES: 32 * 1024 * 1024,
  isScanningConfigured: () => state.scanning,
  scanFile: async () => ({
    verdict: state.scanVerdict,
    malicious: state.scanMalicious,
    suspicious: 0,
    enginesTotal: state.scanVerdict === 'unavailable' ? 0 : 70,
    flaggedBy: state.scanMalicious ? ['EngineA', 'EngineB'] : [],
    reportUrl: 'https://virustotal.example/report',
    reason: state.scanVerdict === 'unavailable' ? 'Scanner offline.' : undefined,
    scannedAt: 1,
  }),
}));

// The ONLY way bytes enter the store now: a NavBharatAI build artifact, fetched server-side. Mocked so
// the ingest guarantees can be tested without a real GitHub call.
vi.mock('../src/server/lib/buildArtifact', () => ({
  fetchBuildArtifact: async () => (state.artifactOk
    ? { ok: true, bytes: state.artifactBytes }
    : { ok: false, failure: state.artifactFailure, message: 'The build artifact could not be fetched.' }),
}));

vi.mock('../src/server/lib/navStoreStore', () => ({
  isStorageConfigured: () => state.storage,
  putApk: async (sha: string) => { state.putCalls++; return `nav-store/apk/${sha}.apk`; },
  getApk: async () => Buffer.from('apk-bytes'),
  deleteApk: async (p: string) => { state.deleted.push(p); },
  saveApp: async (a: Record<string, unknown>) => { state.saved.push(a); state.apps[a.id as string] = a; },
  getApp: async (id: string) => state.apps[id] || null,
  updateApp: async (id: string, patch: Record<string, unknown>) => {
    state.updated.push({ id, patch });
    if (state.apps[id]) Object.assign(state.apps[id], patch);
  },
  listApps: async (status: string) => Object.values(state.apps).filter((a) => a.status === status),
  listAppsByUid: async (uid: string) => Object.values(state.apps).filter((a) => a.uid === uid),
  toPublic: (a: Record<string, unknown>) => ({ id: a.id, appName: a.appName, developerName: 'dev' }),
}));

const { registerNavStoreRoutes, validateSubmission, isStoreAdmin, UPLOAD_FEE_INR } =
  await import('../src/server/routes/navStore');

const routes = captureRoutes(registerNavStoreRoutes);
const publishFromBuild = routes.get('POST /api/nav-store/publish-from-build')!;
const status = routes.get('GET /api/nav-store/status')!;
const publicList = routes.get('GET /api/nav-store/apps')!;
const download = routes.get('GET /api/nav-store/download/:id')!;
const queue = routes.get('GET /api/nav-store/admin/queue')!;
const review = routes.get('POST /api/nav-store/admin/review')!;

const ADMIN = 'admin@navbharatai.com';

async function realApkBytes(perms = 'android.permission.INTERNET'): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('AndroidManifest.xml', Buffer.from(perms, 'utf16le'));
  zip.file('classes.dex', 'dex');
  zip.file('META-INF/CERT.RSA', 'cert');
  return zip.generateAsync({ type: 'nodebuffer' });
}

const FORM = {
  developerName: 'Ravi Kumar',
  developerEmail: 'ravi@example.com',
  appName: 'Chai Point',
  versionName: '1.0.0',
  shortDescription: 'Order chai near you',
  description: 'A simple app to order chai from nearby shops, with delivery tracking.',
  category: 'Food & Drink',
  acceptedTerms: true,
};

// The build the publish-from-build route pulls its bytes from.
const BUILD = { owner: 'ravi', repo: 'chai-app', artifactId: '999', githubToken: 'ghtok' };

beforeEach(async () => {
  process.env.NAV_STORE_ADMINS = ADMIN;
  state.uid = 'user123';
  state.email = 'ravi@example.com';
  state.storage = true;
  state.scanning = true;
  state.scanVerdict = 'clean';
  state.scanMalicious = 0;
  state.saved = [];
  state.updated = [];
  state.apps = {};
  state.putCalls = 0;
  state.deleted = [];
  state.artifactOk = true;
  state.artifactBytes = await realApkBytes();
});

async function post(handler: (r: unknown, s: unknown) => unknown, body: Record<string, unknown>) {
  const res = mockRes();
  await handler(mockReq({ body }), res);
  return res;
}

/** Publish through the ONLY door: a NavBharatAI build. */
async function postBuild(overrides: Record<string, unknown> = {}) {
  return post(publishFromBuild, { ...FORM, ...BUILD, ...overrides });
}

describe('there is no device-upload door — the store carries only NavBharatAI builds', () => {
  it('the old POST /api/nav-store/submit route no longer exists', () => {
    expect(routes.get('POST /api/nav-store/submit')).toBeUndefined();
  });
});

describe('validateSubmission — a contactable developer is what makes a takedown possible', () => {
  it('accepts a complete form', () => {
    expect(validateSubmission(FORM).ok).toBe(true);
  });

  it('requires a real contact email, and says why', () => {
    const r = validateSubmission({ ...FORM, developerEmail: 'not-an-email' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/reports a problem/i);
  });

  it('requires the developer to confirm they may publish it', () => {
    expect(validateSubmission({ ...FORM, acceptedTerms: false }).ok).toBe(false);
  });

  it('requires a real description and a known category', () => {
    expect(validateSubmission({ ...FORM, description: 'short' }).ok).toBe(false);
    expect(validateSubmission({ ...FORM, category: 'Malware' }).ok).toBe(false);
  });

  it('refuses a website that is not a web address', () => {
    expect(validateSubmission({ ...FORM, developerWebsite: 'javascript:alert(1)' }).ok).toBe(false);
    expect(validateSubmission({ ...FORM, developerWebsite: 'https://ravi.example' }).ok).toBe(true);
  });
});

describe('uploads are free, and the store says so', () => {
  it('costs nothing today', async () => {
    const res = mockRes();
    await status(mockReq({}), res);
    expect(res.body.uploadFeeInr).toBe(0);
    expect(UPLOAD_FEE_INR).toBe(0);
  });

  it('says plainly what is missing rather than showing a dead button', async () => {
    state.storage = false;
    state.scanning = false;
    const res = mockRes();
    await status(mockReq({}), res);
    expect(res.body.acceptingUploads).toBe(false);
    expect(res.body.missing.join(' ')).toMatch(/VIRUSTOTAL_API_KEY/);
    expect(res.body.missing.join(' ')).toMatch(/NAV_STORE_BUCKET/);
  });
});

describe('THE RULE: nothing reaches the public without an admin', () => {
  it('a clean scan still only produces "pending"', async () => {
    const res = await postBuild();
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(state.saved[0].status).toBe('pending');
  });

  it('a build-sourced app records its provenance for the reviewer', async () => {
    await postBuild();
    expect(state.saved[0].provenance).toMatchObject({ source: 'navbharatai-build', repo: 'ravi/chai-app', artifactId: '999' });
  });

  it('a publisher cannot smuggle in their own status', async () => {
    await postBuild({ status: 'approved' });
    expect(state.saved[0].status).toBe('pending');
  });

  it('the public listing only ever returns approved apps', async () => {
    state.apps.a = { id: 'a', status: 'pending', appName: 'Pending app' };
    state.apps.b = { id: 'b', status: 'approved', appName: 'Live app' };
    state.apps.c = { id: 'c', status: 'removed', appName: 'Gone app' };
    const res = mockRes();
    await publicList(mockReq({ query: {} }), res);
    expect(res.body.apps.map((a: { id: string }) => a.id)).toEqual(['b']);
  });

  it('a pending app cannot be downloaded, even with its exact id', async () => {
    state.apps.a = { id: 'a', status: 'pending', appName: 'X', storagePath: 'p', versionName: '1' };
    const res = mockRes();
    await download(mockReq({ params: { id: 'a' } }), res);
    expect(res.statusCode).toBe(404);
  });

  it('only an admin can review, and only an admin can approve', async () => {
    state.apps.a = { id: 'a', status: 'pending', storagePath: 'p' };
    state.email = 'ravi@example.com';           // an ordinary signed-in user
    const denied = await post(review, { id: 'a', decision: 'approved' });
    expect(denied.statusCode).toBe(403);
    expect(state.apps.a.status).toBe('pending');

    state.email = ADMIN;
    const ok = await post(review, { id: 'a', decision: 'approved' });
    expect(ok.statusCode).toBe(200);
    expect(state.apps.a.status).toBe('approved');
  });

  it('an ordinary user cannot read the review queue', async () => {
    state.email = 'ravi@example.com';
    const res = mockRes();
    await queue(mockReq({ query: {} }), res);
    expect(res.statusCode).toBe(403);
  });
});

describe('what the store refuses to accept', () => {
  it('a signed-out visitor cannot publish', async () => {
    state.uid = null;
    const res = await postBuild();
    expect(res.statusCode).toBe(401);
    expect(state.putCalls).toBe(0);
  });

  it('accepts nothing at all while scanning is switched off', async () => {
    state.scanning = false;
    const res = await postBuild();
    expect(res.statusCode).toBe(503);
    expect(state.putCalls).toBe(0);
    expect(state.saved).toHaveLength(0);
  });

  it('a MALICIOUS verdict is refused and the file is never stored', async () => {
    state.scanVerdict = 'malicious';
    state.scanMalicious = 7;
    const res = await postBuild();
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toMatch(/malicious/i);
    expect(state.putCalls).toBe(0);
    expect(state.saved).toHaveLength(0);
  });

  it('an UNAVAILABLE scan means no upload — never a silent pass', async () => {
    state.scanVerdict = 'unavailable';
    const res = await postBuild();
    expect(res.statusCode).toBe(503);
    expect(state.putCalls).toBe(0);
  });

  it('a suspicious verdict is stored but flagged for the reviewer, not published', async () => {
    state.scanVerdict = 'suspicious';
    const res = await postBuild();
    expect(res.statusCode).toBe(200);
    expect(state.saved[0].status).toBe('pending');
    expect(res.body.message).toMatch(/flagged/i);
  });

  it('a file that is not an Android app is refused', async () => {
    state.artifactBytes = Buffer.from('just text');
    const res = await postBuild();
    expect(res.statusCode).toBe(422);
    expect(state.putCalls).toBe(0);
  });

  it('an incomplete form is refused before the file is even looked at', async () => {
    const res = await postBuild({ developerEmail: '' });
    expect(res.statusCode).toBe(400);
    expect(state.putCalls).toBe(0);
  });

  it('an expired build artifact is a 404 the user can act on, not a silent store', async () => {
    state.artifactOk = false;
    state.artifactFailure = 'expired';
    const res = await postBuild();
    expect(res.statusCode).toBe(404);
    expect(state.putCalls).toBe(0);
    expect(state.saved).toHaveLength(0);
  });
});

describe('the record kept for every upload', () => {
  it('records the hash, the uploader and the permissions — what a takedown needs', async () => {
    state.artifactBytes = await realApkBytes('android.permission.READ_SMS');
    await postBuild();
    const rec = state.saved[0];
    expect(String(rec.sha256)).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.uid).toBe('user123');
    expect((rec.developer as { email: string }).email).toBe('ravi@example.com');
    expect(rec.permissions).toContain('android.permission.READ_SMS');
  });

  it('surfaces high-risk permissions to the uploader too, so nothing is hidden', async () => {
    state.artifactBytes = await realApkBytes('android.permission.READ_SMS');
    const res = await postBuild();
    expect(res.body.highRisk.map((h: { permission: string }) => h.permission)).toContain('android.permission.READ_SMS');
  });
});

describe('a takedown is real, not a hidden flag', () => {
  it('removing an app deletes its bytes', async () => {
    state.email = ADMIN;
    state.apps.a = { id: 'a', status: 'approved', storagePath: 'nav-store/apk/x.apk' };
    await post(review, { id: 'a', decision: 'removed', note: 'Reported by a user' });
    expect(state.apps.a.status).toBe('removed');
    expect(state.deleted).toContain('nav-store/apk/x.apk');
  });

  it('a rejected app is not kept around either', async () => {
    state.email = ADMIN;
    state.apps.b = { id: 'b', status: 'pending', storagePath: 'nav-store/apk/y.apk' };
    await post(review, { id: 'b', decision: 'rejected' });
    expect(state.deleted).toContain('nav-store/apk/y.apk');
  });

  it('records who decided and when', async () => {
    state.email = ADMIN;
    state.apps.c = { id: 'c', status: 'pending', storagePath: 'p' };
    await post(review, { id: 'c', decision: 'approved', note: 'Looks fine' });
    const patch = state.updated.find((u) => u.id === 'c')!.patch;
    expect(patch.reviewedBy).toBe(ADMIN);
    expect(patch.reviewNote).toBe('Looks fine');
    expect(typeof patch.reviewedAt).toBe('number');
  });

  it('refuses a decision that is not one of the three', async () => {
    state.email = ADMIN;
    state.apps.d = { id: 'd', status: 'pending', storagePath: 'p' };
    const res = await post(review, { id: 'd', decision: 'published' });
    expect(res.statusCode).toBe(400);
    expect(state.apps.d.status).toBe('pending');
  });
});

describe('isStoreAdmin', () => {
  it('matches the configured list, case-insensitively', () => {
    process.env.NAV_STORE_ADMINS = 'A@x.com, b@y.com';
    expect(isStoreAdmin('a@x.com')).toBe(true);
    expect(isStoreAdmin('B@Y.COM')).toBe(true);
    expect(isStoreAdmin('c@z.com')).toBe(false);
    expect(isStoreAdmin(null)).toBe(false);
  });
});

// ── APK DOWNLOAD (admin report 2026-08-19: "app mart se apk download hi nahi hoti") ──────────────
//
// Source guards, because the two defects were both about WIRING — a link pointing at the wrong origin
// and a whole file buffered into memory. Neither can be caught by testing the pieces in isolation:
// every function involved worked perfectly on its own the entire time the button was dead.
describe('App Mart download — the button has to reach the server, and the file has to flow', () => {
  const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const store = codeOnly(readFileSync(join(process.cwd(), 'src/components/ide/NavAppStore.tsx'), 'utf8'));
  const route = codeOnly(readFileSync(join(process.cwd(), 'src/server/routes/navStore.ts'), 'utf8'));

  it('the download link is resolved for the app, not left as a bare /api path', () => {
    // A relative /api URL inside the bundled shell points at the shell itself, where nothing answers.
    expect(store).toContain('resolveApiHref');
    expect(store).not.toMatch(/href=\{`\/api\/nav-store\/download/);
  });

  it('inside the app the download is handed to the system browser', () => {
    // A WebView has no download manager: an <a> to an attachment does nothing at all, which is
    // precisely what the user reported seeing.
    const at = store.indexOf('nav-store/download');
    expect(at).toBeGreaterThan(-1);
    const button = store.slice(at, at + 600);
    expect(button).toContain('isNativeApp()');
    expect(button).toContain("window.open");
  });

  it('the route STREAMS the apk instead of holding 5–50 MB in memory first', () => {
    const at = route.indexOf("'/api/nav-store/download/:id'");
    expect(at).toBeGreaterThan(-1);
    const handler = route.slice(at, route.indexOf('app.get(', at + 10));
    expect(handler).toContain('getApkStream');
    expect(handler).toContain('.pipe(res)');
    expect(handler).not.toContain('res.send(bytes)');
  });

  it('a failure answers a BROWSER in words — this URL is opened by navigation, not by fetch', () => {
    const at = route.indexOf("'/api/nav-store/download/:id'");
    const handler = route.slice(at, route.indexOf('app.get(', at + 10));
    expect(handler).toContain('text/html'.slice(5)); // .type('html')
    expect(handler).toMatch(/not available/);
  });
});
