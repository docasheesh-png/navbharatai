// The user's own words on a build report — SERVER half.
//
// Deliberately a plain .ts file under tests/ rather than beside the dialog: the frontend tsconfig
// excludes src/server, so a .tsx test under src/ that imports the store drags server-only types
// (firebase-admin) into the frontend typecheck and breaks it. Splitting by which side the code runs
// on keeps both typechecks honest. The dialog's own render test lives in
// src/components/agentv3/ReportNoteDialog.test.tsx.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { sanitizeUserNote, USER_NOTE_MAX, buildAdminReportRecord } from '../src/server/AgentV3/AdminBuildReportStore';
import { REPORT_NOTE_MAX } from '../src/components/agentv3/ReportNoteDialog';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const panel = read('src/components/agentv3/AgentV3Panel.tsx');
const route = read('src/server/routes/agentv3.ts');
const admin = read('src/components/AdminDashboard.tsx');

const NUL = String.fromCharCode(0);
const BELL = String.fromCharCode(7);

describe('sanitizeUserNote — make it safe to store, never rewrite it', () => {
  it('keeps the user’s words exactly as typed', () => {
    expect(sanitizeUserNote('The Save button does nothing')).toBe('The Save button does nothing');
  });

  it('keeps newlines, because a user listing three problems writes a list', () => {
    // Flattening this would destroy the structure of their own report.
    expect(sanitizeUserNote('one\ntwo\nthree')).toBe('one\ntwo\nthree');
  });

  it('strips control characters that would corrupt the admin table', () => {
    expect(sanitizeUserNote('bad' + NUL + 'null' + BELL + 'bell')).toBe('badnullbell');
  });

  it('normalises Windows newlines and collapses long blank runs', () => {
    expect(sanitizeUserNote('a\r\nb')).toBe('a\nb');
    expect(sanitizeUserNote('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('treats an empty or whitespace-only note as no note at all', () => {
    // An empty box must produce null, not '', so "the user said nothing" and "the user said
    // something blank" cannot be confused downstream.
    expect(sanitizeUserNote('')).toBeNull();
    expect(sanitizeUserNote('   \n  ')).toBeNull();
    expect(sanitizeUserNote(undefined)).toBeNull();
    expect(sanitizeUserNote(null)).toBeNull();
    expect(sanitizeUserNote(42)).toBeNull();
    expect(sanitizeUserNote({ note: 'x' })).toBeNull();
  });

  it('caps a crafted oversized note instead of writing it whole', () => {
    const huge = 'x'.repeat(USER_NOTE_MAX + 500);
    const out = sanitizeUserNote(huge)!;
    expect(out.length).toBe(USER_NOTE_MAX + 1); // the cap plus the ellipsis
    expect(out.endsWith('…')).toBe(true);
  });

  it('does not truncate a note that is exactly at the limit', () => {
    const exact = 'y'.repeat(USER_NOTE_MAX);
    expect(sanitizeUserNote(exact)).toBe(exact);
  });
});

describe('the UI limit and the server limit are the same number', () => {
  it('REPORT_NOTE_MAX === USER_NOTE_MAX', () => {
    // If these drift, a user writes a long careful description, sees no warning, and silently loses
    // the end of it — the one outcome worse than sending no note at all.
    expect(REPORT_NOTE_MAX).toBe(USER_NOTE_MAX);
  });
});

describe('the note reaches the stored record', () => {
  const base = { startedAt: 1786030000000, endedAt: 1786030600000, ok: true, prompt: 'a shop app' } as never;
  const ctx = { userId: 'u1', email: 'a@b.com', name: 'A', workspaceId: 'w1', buildId: 'b1', reportedAt: 1786031000000 };

  it('lands in META, so the inbox list can show it without opening the report', () => {
    const rec = buildAdminReportRecord(base, { ...ctx, userNote: 'the Save button does nothing' });
    expect(rec.meta.userNote).toBe('the Save button does nothing');
  });

  it('is null when the user sent the report without typing — allowed on purpose', () => {
    // A compulsory box produces reports that say "." to get past it, and a forced full stop is worse
    // evidence than an honest blank.
    expect(buildAdminReportRecord(base, ctx).meta.userNote).toBeNull();
    expect(buildAdminReportRecord(base, { ...ctx, userNote: '  ' }).meta.userNote).toBeNull();
  });

  it('is sanitised again at the store, not only at the route', () => {
    const rec = buildAdminReportRecord(base, { ...ctx, userNote: 'x' + NUL + 'y' });
    expect(rec.meta.userNote).toBe('xy');
  });

  it('never overwrites fixedNote — one is the problem, the other is the response', () => {
    const rec = buildAdminReportRecord(base, { ...ctx, userNote: 'it is broken' });
    expect(rec.meta.userNote).toBe('it is broken');
    expect(rec.meta.fixedNote ?? null).toBeNull();
  });
});

describe('the wiring, which is where this breaks silently', () => {
  it('EVERY path to Report goes through the one funnel', () => {
    // Report is reachable three ways: straight through (a single-build chat), the desktop popover and
    // the mobile sheet. Prompting at each call site would leave one to be missed, and that path would
    // send reports with no description while looking completely fine.
    expect(panel).toContain('askForReportNote');
    expect(panel).toContain('if (builds.length < 2) { askForReportNote(); return; }');
    expect(panel).toContain('reportPickerRows((b) => askForReportNote(b), false)');
    expect(panel).toContain('askForReportNote(b); }, true)');
    // …and no path may still call the sender directly.
    expect(panel).not.toContain('void sendReportToAdmin(b)');
    expect(panel).not.toContain('{ void sendReportToAdmin(); return; }');
  });

  it('the note is actually put in the request body', () => {
    // Without this line the dialog collects a description, the user presses Send, everything looks
    // successful, and nothing they wrote ever leaves the browser.
    expect(panel).toContain('body.note = note');
  });

  it('the server reads it and stores it', () => {
    expect(route).toContain('userNote: sanitizeUserNote(body.note)');
    expect(route).toMatch(/note\?: string/);
  });

  it('the admin can actually SEE it — list, detail, and search', () => {
    // A field that is stored and never shown is not a feature.
    expect(admin).toContain('r.userNote');
    expect(admin).toContain('selectedReport.meta.userNote');
    expect(admin).toContain('What the user said');
    expect(admin).toContain("${r.userNote ?? ''}");
  });

  it('renders the note as text, never as markup', () => {
    // It is untrusted user input shown on an admin screen; a whitespace-pre-wrap paragraph is the
    // whole defence and it must stay one.
    expect(admin).not.toContain('dangerouslySetInnerHTML={{ __html: selectedReport');
  });
});
