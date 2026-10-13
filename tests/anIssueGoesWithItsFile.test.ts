/**
 * AN ISSUE GOES WITH ITS FILE (autopsy 303e8a6f, Q-969, 2026-10-12).
 *
 * The issue queue closes an issue only on a clean pass of a check that could have found it, and a security
 * finding can only be cleared by a scan of its own file. A file the user's edit DELETED is never scanned
 * again — so the issue about it stayed open forever: shown to the user, handed to every later edit, about
 * code that no longer exists. The 303e8a6f fix retired the old app's issues when a NEW app replaced it;
 * this is the same class inside an edit.
 *
 * What may retire it is AUTHORITATIVE absence only: the files the build deleted that the durable forget
 * step also removed from the saved project. A scan's file list is never used — a cold graph omits files, and
 * reading "not scanned" as "gone" would close real issues.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { foldBuildFindings, retireIssuesInRemovedFiles, isOpenIssue, type IssueQueue } from '../src/server/AgentV3/changeEngine/issueQueue';
import { foldSettle } from '../src/server/AgentV3/changeEngine/changeSession';
import { emptyMemory } from '../src/server/AgentV3/changeEngine/changeLog';
import { classifyChange } from '../src/server/AgentV3/changeEngine/changeClassifier';
import { codeOnly } from './helpers/sourceSlice';

const queueWith = (findings: Array<{ code: string; message: string; file?: string }>): IssueQueue =>
  foldBuildFindings({ issues: [], nextIss: 1 }, {
    findings: findings.map((f) => ({ ...f, severity: 'error' as const })), changeId: 'C1', now: 1, checksRan: true,
  }).queue;

describe('retireIssuesInRemovedFiles', () => {
  const q = queueWith([
    { code: 'SECURITY:xss', message: 'innerHTML in old', file: 'src/old.ts' },
    { code: 'SECURITY:xss', message: 'innerHTML in kept', file: 'src/kept.ts' },
    { code: 'A11Y_LABEL', message: 'a field has no label' },
  ]);

  it('retires the open issue whose file was removed — and nothing else', () => {
    const { queue, retired } = retireIssuesInRemovedFiles(q, ['./src/old.ts']);
    expect(retired.map((i) => i.file)).toEqual(['src/old.ts']);
    expect(queue.issues.filter(isOpenIssue).map((i) => i.message)).toEqual(['innerHTML in kept', 'a field has no label']);
    expect(queue.issues.find((i) => i.file === 'src/old.ts')!.status).toBe('retired'); // marked, kept for history
  });

  it('no removed files, no change', () => {
    expect(retireIssuesInRemovedFiles(q, []).queue).toBe(q);
  });

  it('the file coming back with the same finding brings the issue straight back as triaged', () => {
    const { queue } = retireIssuesInRemovedFiles(q, ['src/old.ts']);
    const again = foldBuildFindings(queue, {
      findings: [{ code: 'SECURITY:xss', severity: 'warning', message: 'innerHTML in old', file: 'src/old.ts' }],
      changeId: 'C3', now: 3, checksRan: true,
    });
    expect(again.queue.issues.find((i) => i.file === 'src/old.ts')!.status).toBe('triaged');
  });
});

describe('the settle of an EDIT that deleted the file', () => {
  const mem = { ...emptyMemory(), queue: queueWith([{ code: 'SECURITY:xss', message: 'innerHTML in old', file: 'src/old.ts' }]) };
  const session = {
    workspaceId: 'ws-q969', isEdit: true, requested: [], probes: new Map(), assignedIssueIds: [],
    summary: 'remove the old page', classification: classifyChange('remove the old page'),
  } as never;
  const input = { ok: true, stopped: false, gate: 'green' as const, files: [], issues: [], security: [], securityScanned: ['src/App.tsx'] };

  it('🔴 before: an unscanned deleted file kept its issue open forever', () => {
    const out = foldSettle(mem, session, input, 2);
    expect(out.mem.queue.issues.filter(isOpenIssue).map((i) => i.file)).toEqual(['src/old.ts']);
  });

  it('with the authoritative removal, the issue is retired, counted on the report line, and on the change record', () => {
    const out = foldSettle(mem, session, { ...input, removedFiles: ['src/old.ts'] }, 2);
    expect(out.mem.queue.issues.filter(isOpenIssue)).toEqual([]);
    expect(out.result.reportLines.join('\n')).toContain('1 retired with their removed file(s)');
    expect(out.result.record.issues).toContain('ISS-001');
  });
});

describe('🔒 the wiring — only the durable removal is authoritative', () => {
  const route = codeOnly(readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8'));
  it('set inside the durable forget step, only after the removal really ran, and handed to settle', () => {
    expect(route).toMatch(/if \(forgotten > 0\) \{\s*removedFromApp = forgetDurably;/);
    expect(route.split('removedFromApp =').length - 1).toBe(1);
    expect(route).toContain('removedFiles: removedFromApp,');
  });
});
