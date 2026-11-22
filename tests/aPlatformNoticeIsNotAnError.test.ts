// failedbr #2497 → #2498 (2026-11-22): our own "your earlier build is still running" notice arrived in the stream,
// was shown as an error with "Fix with AI", and the press ran a 15-minute build on that sentence.
// The CLASS: a platform status notice is never an error in the app and never a build request.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  BUILD_RUNNING_ELSEWHERE_MESSAGE, PLATFORM_NOTICE_NOT_A_REQUEST_CODE, PLATFORM_NOTICE_NOT_A_REQUEST_MESSAGE,
  isPlatformAdmissionNotice,
} from '../src/lib/platformAdmissionNotices';
import { BUILD_RUNNING_ELSEWHERE_MESSAGE as LEASE_MESSAGE } from '../src/server/AgentV3/workspaceBuildLease';
import { BUILD_STILL_STOPPING_MESSAGE } from '../src/server/AgentV3/stoppingBuild';
import {
  errorCanBeFixedByEditingTheApp, fixErrorAndContinuePrompt, platformNoticeAsBuildRequest,
} from '../src/lib/platformFixRequest';
import { refusePlatformNoticeAsBuildRequest } from '../src/server/AgentV3/platformNoticePrompt';
import { createBuildPreflightStream } from '../src/server/AgentV3/BuildRequestCoordination';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

/** #2498's prompt, byte for byte as the build report recorded it. */
const REPORT_2498_PROMPT = 'Fix this error and continue building the app:\n\nYour earlier build for this app is still running — it keeps going even when the connection drops. Reopen this chat in a moment to see it, or press ⏹ Stop and then send your message again.';

/** Every sentence the build route (and the client, for the same refusals) writes to say "no build was started". */
const ROUTE = read('src/server/routes/agentv3.ts');
const HOOK = read('src/hooks/useAgentV3Build.ts');
const ADMISSION_REFUSALS: Array<{ text: string; source: string }> = [
  { text: BUILD_RUNNING_ELSEWHERE_MESSAGE, source: 'BUILD_RUNNING_ELSEWHERE_MESSAGE' },
  { text: BUILD_STILL_STOPPING_MESSAGE, source: 'BUILD_STILL_STOPPING_MESSAGE' },
  { text: 'This app is already building in another chat — connect to it (or stop it) instead of starting a second build.', source: ROUTE },
  { text: 'A build is already running for this account. Stop it before starting another.', source: ROUTE },
  { text: 'You have 3 builds running (max 3 at once). Let one finish, or stop it, then try again.', source: 'builds running (max ${capDecision.cap} at once)' },
  { text: 'Please sign in to build with NavBharatAI Pro — builds run on a real account so usage can be tracked.', source: ROUTE },
  { text: 'A build is still running on your account. Press ⏹ Stop to end it, then send your message again.', source: HOOK },
  { text: PLATFORM_NOTICE_NOT_A_REQUEST_MESSAGE, source: 'PLATFORM_NOTICE_NOT_A_REQUEST_MESSAGE' },
];

describe('a status notice is never offered "Fix with AI"', () => {
  it('the exact #2498 notice is recognised, on the client and through the lease module', () => {
    expect(LEASE_MESSAGE).toBe(BUILD_RUNNING_ELSEWHERE_MESSAGE);
    expect(isPlatformAdmissionNotice(BUILD_RUNNING_ELSEWHERE_MESSAGE)).toBe(true);
    // It arrived out of the STREAM, so `beforeBuildStarted` was false — the message itself must still stand the button down.
    expect(errorCanBeFixedByEditingTheApp({ beforeBuildStarted: false, message: BUILD_RUNNING_ELSEWHERE_MESSAGE })).toBe(false);
  });

  it.each(ADMISSION_REFUSALS)('census: "$text" is a notice, and the wording still exists where it is written', ({ text, source }) => {
    expect(isPlatformAdmissionNotice(text)).toBe(true);
    expect(errorCanBeFixedByEditingTheApp({ message: text })).toBe(false);
    expect(platformNoticeAsBuildRequest(fixErrorAndContinuePrompt(text))).toBe(true);
    // A reworded refusal must fail here, not drift silently out of the list.
    if (source === ROUTE || source === HOOK) expect(source).toContain(text.slice(0, 40));
    else expect(ROUTE + read('src/server/AgentV3/stoppingBuild.ts') + read('src/lib/platformAdmissionNotices.ts')).toContain(source);
  });

  it('a real error in the app keeps the button', () => {
    expect(errorCanBeFixedByEditingTheApp({ message: "TypeError: Cannot read properties of undefined (reading 'map')" })).toBe(true);
    expect(errorCanBeFixedByEditingTheApp({ message: 'Your earlier build failed with: x is not defined' })).toBe(true);
  });
});

describe('a notice sent back as a build request is refused before any work (server-side net)', () => {
  it('the real #2498 prompt is refused with a clean 400 and an honest message', () => {
    expect(platformNoticeAsBuildRequest(REPORT_2498_PROMPT)).toBe(true);
    let status = 0; let body: Record<string, unknown> = {};
    const res = { headersSent: false, status: (s: number) => { status = s; return { json: (b: unknown) => { body = b as Record<string, unknown>; } }; } };
    expect(refusePlatformNoticeAsBuildRequest(res, REPORT_2498_PROMPT)).toBe(true);
    expect(status).toBe(400);
    expect(body).toEqual({ error: PLATFORM_NOTICE_NOT_A_REQUEST_MESSAGE, code: PLATFORM_NOTICE_NOT_A_REQUEST_CODE });
    expect(PLATFORM_NOTICE_NOT_A_REQUEST_MESSAGE).not.toMatch(/claude|glm|kimi|firestore|cloud run|instance/i);
  });

  it('the bare notice, our template around nothing, and every stop notice are refused too', () => {
    expect(platformNoticeAsBuildRequest(BUILD_RUNNING_ELSEWHERE_MESSAGE)).toBe(true);
    expect(platformNoticeAsBuildRequest('Fix this error and continue building the app:')).toBe(true);
    expect(platformNoticeAsBuildRequest(fixErrorAndContinuePrompt('Your balance is not enough for this build, please recharge!'))).toBe(true);
    expect(platformNoticeAsBuildRequest(fixErrorAndContinuePrompt('Failed to fetch'))).toBe(true);
  });

  it('the user\'s own words are never refused', () => {
    const req = (p: string) => platformNoticeAsBuildRequest(p);
    expect(req('ek bahut bada map par bubg jaisa game banao!!')).toBe(false);
    expect(req(fixErrorAndContinuePrompt("TypeError: Cannot read properties of undefined (reading 'map')"))).toBe(false);
    // quoting the notice mid-message, or adding a paragraph of their own after it, is talking to us
    expect(req(`Why do I keep seeing "${BUILD_RUNNING_ELSEWHERE_MESSAGE}"?`)).toBe(false);
    expect(req(`${REPORT_2498_PROMPT}\n\nAlso add a pause button.`)).toBe(false);
    // a bare "network error" may describe the user's own app; only our template proves it is ours
    expect(req('network error')).toBe(false);
  });

  it('the route asks before any lock, lease, sandbox or model call', () => {
    const at = ROUTE.indexOf('if (refusePlatformNoticeAsBuildRequest(res, prompt)) return;');
    expect(at).toBeGreaterThan(ROUTE.indexOf('Prompt is too long (max'));
    expect(at).toBeLessThan(ROUTE.indexOf("await import('../AgentV3/AbuseDetector')"));
    expect(at).toBeLessThan(ROUTE.indexOf('const buildLeaseToken = randomUUID();'));
  });
});

describe('an admission refusal inside an open stream says no build started', () => {
  it('both events carry beforeBuildStarted once the preflight has opened the stream', () => {
    const writes: string[] = [];
    const res = {
      headersSent: false, writableEnded: false,
      setHeader: () => undefined, flushHeaders() { this.headersSent = true; }, write: (v: string) => { writes.push(v); },
      status: () => ({ json: () => undefined }), end() { this.writableEnded = true; },
    };
    const preflight = createBuildPreflightStream(res, (event, forward) => forward(event));
    preflight.open();
    preflight.reject(409, { error: BUILD_RUNNING_ELSEWHERE_MESSAGE, code: 'BUILD_RUNNING_ELSEWHERE', resumable: false });
    const events = writes.map((w) => JSON.parse(w));
    expect(events.map((e) => e.type)).toEqual(['error', 'result']);
    expect(events.every((e) => e.beforeBuildStarted === true)).toBe(true);
  });

  it('the client reads it: no fix button, and the real Stop while the other build holds the app', () => {
    expect(HOOK).toMatch(/beforeBuildStarted\?: unknown \}\)\.beforeBuildStarted === true\) \{\s*setErrorBeforeBuildStarted\(true\);\s*if \(\(event as \{ code\?: unknown \}\)\.code === 'BUILD_RUNNING_ELSEWHERE'\) setServerBuildRunning\(true\);/);
    expect(HOOK).toContain("if ((event as { beforeBuildStarted?: unknown }).beforeBuildStarted !== true) setServerBuildRunning(false);");
  });
});
