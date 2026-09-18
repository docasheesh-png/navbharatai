import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 A STATUS IS NEVER THE FIRST WORD WRITTEN ABOUT A RECORD (the sibling hunt after #3101, 2026-09-18).
 *
 * `set(…, { merge: true })` CREATES the document when it is absent. Used to CREATE-OR-UPDATE a whole
 * record that is the right tool. Used to PATCH a status, a flag or a stamp onto a record that must
 * already exist, it mints a document holding only that patch — no identity, no owner, no content —
 * which then surfaces as a blank row in whichever list reads the collection. The admin's own screenshot
 * showed exactly that in the published-app list (DeploymentStore.setStatus); rule 3 says hunt the
 * siblings, and these are them. Each is now an `update()`, which refuses a missing document.
 *
 * Read from the SOURCE with comments stripped, per method body, so a comment cannot satisfy it and a
 * revert to `set(…, { merge: true })` in any one of them turns this file red.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The body of a top-level or class method named `name`: from its signature to the next line that is a lone `}` at its indent. */
function methodBody(src: string, name: string): string {
  const re = new RegExp(`(?:async\\s+)?(?:function\\s+)?${name}\\s*\\(`);
  const m = re.exec(src);
  expect(m, `method ${name} not found`).not.toBeNull();
  const start = m!.index;
  // The method ends at the first "\n}" (top-level function) or "\n  }" (class method) after it.
  const endClass = src.indexOf('\n  }\n', start);
  const endTop = src.indexOf('\n}\n', start);
  const candidates = [endClass, endTop].filter((i) => i > start);
  const end = candidates.length ? Math.min(...candidates) : src.length;
  return src.slice(start, end);
}

const PATCHERS: Array<[file: string, method: string]> = [
  ['src/server/AgentV3/DeploymentStore.ts', 'setStatus'],
  ['src/server/AgentV3/DeploymentStore.ts', 'markOrphaned'],
  ['src/server/AgentV3/DeploymentStore.ts', 'setOutboundVerdict'],
  ['src/server/AgentV3/SandboxStore.ts', 'markPaused'],
  ['src/server/AgentV3/CheckpointStore.ts', 'setCheckpointLabel'],
  ['src/server/AgentV3/HostingBillingStore.ts', 'markDebited'],
  ['src/server/lib/AdminApkReportStore.ts', 'markApkReportFixed'],
  ['src/server/lib/userReportStore.ts', 'setReportStatus'],
  ['src/server/lib/TeamStore.ts', 'setInviteStatus'],
  ['src/server/lib/TeamStore.ts', 'removeMember'],
  ['src/server/lib/TeamStore.ts', 'updateMemberRole'],
  ['src/server/lib/MentionNotificationStore.ts', 'markRead'],
  ['src/server/lib/ShareStore.ts', 'revokeShare'],
  ['src/server/lib/AppBuildStore.ts', 'setLatestRun'],
  ['src/server/lib/AppBuildStore.ts', 'setOutcome'],
  ['src/server/lib/zipUploadStore.ts', 'noteSharedProgress'],
];

describe('every patch-style writer updates an existing record and never mints one', () => {
  for (const [file, method] of PATCHERS) {
    it(`${file.split('/').pop()} → ${method}`, () => {
      const body = methodBody(stripComments(read(file)), method);
      expect(body, `${method} must use update()`).toContain('.update(');
      expect(body, `${method} must not merge-set`).not.toMatch(/merge:\s*true/);
    });
  }
});

describe('the CREATE-OR-UPDATE writers keep their merge — a first write must still be able to land', () => {
  // These write the whole record with its identity; a merge-set is the right tool for them, and
  // converting them would break the very first save of a new record.
  const KEEP: Array<[string, string]> = [
    ['src/server/AgentV3/DeploymentStore.ts', 'record'],
    ['src/server/AgentV3/SandboxStore.ts', 'record'],
    ['src/server/AgentV3/SandboxStore.ts', 'saveSnapshot'],
    ['src/server/AgentV3/SandboxStore.ts', 'touch'],
  ];
  for (const [file, method] of KEEP) {
    it(`${file.split('/').pop()} → ${method} still merges`, () => {
      expect(methodBody(stripComments(read(file)), method)).toMatch(/merge:\s*true/);
    });
  }
});

describe('the honesty half — a missing record is reported, never invented', () => {
  it('revokeShare returns before writing when the share does not exist', () => {
    const body = methodBody(stripComments(read('src/server/lib/ShareStore.ts')), 'revokeShare');
    expect(body.indexOf('if (!snap.exists) return;')).toBeLessThan(body.indexOf(".update({ status: 'revoked' })"));
  });
  it('markRead swallows NOT_FOUND per id — one stale id must not fail the whole batch', () => {
    const body = methodBody(stripComments(read('src/server/lib/MentionNotificationStore.ts')), 'markRead');
    expect(body).toContain(".update({ read: true }).catch(() => undefined)");
  });
  it('the two admin lists that read a whole collection skip a row with no timestamp — an old ghost never renders blank', () => {
    const reports = stripComments(read('src/server/lib/userReportStore.ts'));
    expect(methodBody(reports, 'listReports')).toContain("typeof (doc.data() as UserReport)?.at === 'number'");
    const inbox = stripComments(read('src/server/lib/MentionNotificationStore.ts'));
    expect(inbox).toContain("typeof n.createdAt === 'number'");
  });
});
