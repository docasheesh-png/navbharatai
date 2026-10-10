// A CLIENT WRITE READS THE SERVER'S ANSWER (2026-10-04).
//
// `fetch` resolves for a 401, a 403 and a 500 alike, so `await fetch(url, { method: 'POST' })` followed
// by a success message tells the user something happened whether or not it did. Found in one sweep:
// removing a team member said "Member removed" over a refusal (the member kept access), revoking a
// share link cleared it from the screen while it stayed live, the budget editor closed over a failed
// save, admin inbox rows vanished that the server still held, and a failed Stop left a build running
// under a screen that said it had stopped.
//
// THE CENSUS: every client `await fetch(…)` whose method writes (POST/PUT/PATCH/DELETE) and whose
// Response is thrown away is listed here with the reason losing the answer is safe. A NEW one fails
// this test until it either reads the answer (see `src/lib/serverAnswer.ts`) or is argued in here.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'glob';
import { writeFailure } from '../src/lib/serverAnswer';

const root = join(__dirname, '..');

/** file → URL fragment of the discarded call → why losing the answer is safe. */
const BEST_EFFORT: Record<string, Record<string, string>> = {
  'src/components/ReportSheet.tsx': { '/read': 'marks a reply as read; a lost mark brings the dot back next load' },
  'src/components/NotificationBell.tsx': { '/api/notifications/read': 'mark-read; a lost mark reappears on the next load' },
  'src/components/ide/MentionInbox.tsx': { '/api/mentions/read': 'mark-read; a lost mark reappears on the next load' },
  'src/components/ide/ShellTerminal.tsx': {
    '/api/agentv3/shell/close': "closing a terminal; the server's idle reaper ends it anyway",
    // Old entry: '/api/agentv3/shell/resize': 'terminal size; corrected by the next resize'
    // The resize POST now reads the response (409 SHELL_NOT_ON_THIS_INSTANCE reopens once).
  },
  'src/components/ide/StoreBuildPanel.tsx': { '/api/mobile-ship/cancel': "an abandoned store build; the workflow's own timeout stops it" },
  'src/components/agentv3/PreviewSurface.tsx': { '/api/agentv3/preview-error': 'error telemetry for the platform; nothing is shown or promised to the user' },
  'src/hooks/useAgentV3Build.ts': { '/api/agentv3/queue/complete': "queue bookkeeping; a stale 'running' item self-heals to 'failed' on next load" },
  'src/lib/zipProjectUpload.ts': { '/api/zip-upload/abort': 'cleanup of an abandoned upload; the server sweeps stale uploads' },
  'src/lib/referralClaim.ts': { '/claim-failed': 'a failure count for the server; nothing is shown or promised to the user' },
  // Not calls at all: code samples the user copies into their own app, held in template strings.
  'src/components/ide/PWANotifications.tsx': { '/api/notifications/subscribe': 'code sample text, not a call NavBharatAI makes' },
  'src/components/ide/PluginSystem.tsx': { '/api/verify': 'code sample text, not a call NavBharatAI makes' },
};

interface Discarded { file: string; line: number; url: string }

/** Statement-level `await fetch(` with a writing method, whose result is not assigned or returned. */
function discardedWrites(): Discarded[] {
  const files = globSync('src/**/*.{ts,tsx}', { cwd: root })
    .filter((f) => !f.startsWith('src/server/') && !/\.test\.tsx?$/.test(f));
  const out: Discarded[] = [];
  for (const file of files) {
    const s = readFileSync(join(root, file), 'utf8');
    // The URL is read as the call's own text, so a computed one (`claimPath.replace(…)`) is seen too.
    const re = /(^|[;{}]|\n)[ \t]*(?:try\s*\{\s*)?await fetch\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const after = s.slice(m.index, m.index + 500);
      if (!/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/.test(after)) continue;
      const call = s.slice(m.index + m[0].length, m.index + m[0].length + 200);
      out.push({ file, line: s.slice(0, m.index).split('\n').length + 1, url: call.split('\n')[0] });
    }
  }
  return out;
}

describe('every client write either reads the answer or is argued safe', () => {
  const found = discardedWrites();

  it('finds the known best-effort calls (the census is looking at the right shape)', () => {
    expect(found.length).toBeGreaterThanOrEqual(8);
  });

  it('has no discarded write outside the argued list', () => {
    const unexplained = found.filter((d) => {
      const allowed = BEST_EFFORT[d.file];
      return !allowed || !Object.keys(allowed).some((frag) => d.url.includes(frag));
    });
    expect(unexplained.map((d) => `${d.file}:${d.line} ${d.url}`)).toEqual([]);
  });

  it('keeps no stale entry: every argued call still exists', () => {
    const stale: string[] = [];
    for (const [file, frags] of Object.entries(BEST_EFFORT)) {
      for (const frag of Object.keys(frags)) {
        if (!found.some((d) => d.file === file && d.url.includes(frag))) stale.push(`${file} ${frag}`);
      }
    }
    expect(stale).toEqual([]);
  });

  it('covers the writes this sweep fixed — none of them may go back to discarding the answer', () => {
    const fixed = [
      ['src/components/ide/TeamCollaboration.tsx', '/api/team/member/remove'],
      ['src/components/ide/TeamCollaboration.tsx', '/api/team/member/role'],
      ['src/components/ide/TeamCollaboration.tsx', '/revoke'],
      ['src/components/ide/ShareForReview.tsx', '/revoke'],
      ['src/components/profile/ProfilePage.tsx', '/api/profile/budget'],
      ['src/components/AdminDashboard.tsx', '/api/admin/apk-reports'],
      ['src/components/AdminDashboard.tsx', '/api/admin/reports/'],
      ['src/hooks/useAgentV3Build.ts', '/api/agentv3/stop'],
      ['src/hooks/useAgentV3Build.ts', '/api/agentv3/respond'],
      ['src/hooks/useSessionManager.ts', '/api/agentv3/conversations/'],
      ['src/App.tsx', '/api/agentv3/delete-files'],
      ['src/components/ide/NavAppStore.tsx', '/api/nav-store/web/app/'],
      ['src/components/ide/MyBuiltApps.tsx', '/api/mobile-ship/my-apps/'],
      ['src/components/panels/ProjectInsightsPanel.tsx', '/api/webhooks/'],
      ['src/components/panels/ProjectInsightsPanel.tsx', '/review/'],
    ];
    const back = fixed.filter(([file, frag]) => found.some((d) => d.file === file && d.url.includes(frag)));
    expect(back).toEqual([]);
  });
});

describe('writeFailure', () => {
  const res = (status: number, body: unknown) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

  it('is null for an accepted write', async () => {
    expect(await writeFailure(res(200, { ok: true }), 'x')).toBeNull();
    expect(await writeFailure(new Response(null, { status: 204 }), 'x')).toBeNull();
  });

  it("gives the server's own sentence for a refusal", async () => {
    expect(await writeFailure(res(403, { error: 'Only the share owner can revoke it.' }), 'fallback'))
      .toBe('Only the share owner can revoke it.');
  });

  it('falls back when the refusal carries no sentence', async () => {
    expect(await writeFailure(res(500, 'Internal Server Error'), 'The limit could not be saved.')).toBe('The limit could not be saved.');
    expect(await writeFailure(res(401, { error: '   ' }), 'fallback')).toBe('fallback');
    expect(await writeFailure(res(400, { error: 42 }), 'fallback')).toBe('fallback');
  });

  it('bounds a long server sentence', async () => {
    expect((await writeFailure(res(500, { error: 'x'.repeat(1000) }), 'f'))!.length).toBe(300);
  });
});

describe('Q-113: the wallet load fetches nothing nobody reads', () => {
  it('no longer requests the usage log or threads it into the billing panel', () => {
    const engine = readFileSync(join(root, 'src/hooks/usePaymentEngine.ts'), 'utf8');
    expect(engine).not.toMatch(/\/logs`/);
    for (const f of ['src/hooks/usePaymentEngine.ts', 'src/App.tsx', 'src/components/panels/BillingPanel.tsx']) {
      expect(readFileSync(join(root, f), 'utf8'), f).not.toMatch(/\bbillingLogs\b/);
    }
  });
});
