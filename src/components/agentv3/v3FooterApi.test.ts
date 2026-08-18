import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { footerSection, v3MobileFooterActive , previewReadySignal } from './v3FooterApi';

describe('footerSection (v5.0 mobile footer — active-item highlight from real surface state)', () => {
  it('chat when the workspace is collapsed (chat is full-width), whatever tab is remembered', () => {
    expect(footerSection(false, 'preview')).toBe('chat');
    expect(footerSection(false, 'files')).toBe('chat');
  });
  it('maps each open workspace surface to its section', () => {
    expect(footerSection(true, 'preview')).toBe('preview');
    expect(footerSection(true, 'files')).toBe('files');
    expect(footerSection(true, 'diff')).toBe('diff');
    expect(footerSection(true, 'terminal')).toBe('terminal');
    expect(footerSection(true, 'history')).toBe('history');
  });
  it('falls back to chat for an unknown tab value (never a dead highlight)', () => {
    expect(footerSection(true, 'bogus')).toBe('chat');
  });
});

describe('v3MobileFooterActive (must mirror the App.tsx bottom-nav visibility gate exactly)', () => {
  it('active on MOBILE only, outside focus mode (tablet & desktop use the side rail — no bottom nav)', () => {
    expect(v3MobileFooterActive('mobile', false)).toBe(true);
    expect(v3MobileFooterActive('tablet', false)).toBe(false);
  });
  it('inactive on tablet/desktop and in focus mode — the header keeps its controls there', () => {
    expect(v3MobileFooterActive('desktop', false)).toBe(false);
    expect(v3MobileFooterActive('mobile', true)).toBe(false);
    expect(v3MobileFooterActive('desktop', true)).toBe(false);
  });
});

describe('previewReadySignal — the footer green dot fires only on a genuinely viewable app', () => {
  it('fires when a live preview URL exists (server booted the app)', () => {
    expect(previewReadySignal(true, false, undefined, 0)).toBe(true);
  });
  it('fires when the build finished OK with real files (in-browser preview renders them)', () => {
    expect(previewReadySignal(false, true, true, 12)).toBe(true);
    expect(previewReadySignal(false, true, undefined, 3)).toBe(true);
  });
  it('never fires mid-build, on a failed build, or with zero files (no fake green)', () => {
    expect(previewReadySignal(false, false, undefined, 12)).toBe(false);
    expect(previewReadySignal(false, true, false, 12)).toBe(false);
    expect(previewReadySignal(false, true, true, 0)).toBe(false);
  });
});

// Admin 2026-08-04: the footer's 5th slot was "Report" — the SAME action already in the More sheet,
// so one slot was a duplicate while Code Studio (which edits the very files v5.0 builds) had no
// direct route on mobile. Source contract: the footer opens Code Studio, Report lives only in More,
// and the dead buildReport/reportBusy API surface is gone (no orphan fields left behind).
describe('v5.0 mobile footer wiring (admin 2026-08-04)', () => {
  const APP = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8');
  const API = readFileSync(fileURLToPath(new URL('./v3FooterApi.ts', import.meta.url)), 'utf8');
  const PANEL = readFileSync(fileURLToPath(new URL('./AgentV3Panel.tsx', import.meta.url)), 'utf8');

  it('the footer slot opens Code Studio', () => {
    expect(APP).toContain("label: 'Code Studio'");
    expect(APP).toContain("toggleTab('studio')");
  });

  it('the footer no longer carries a Report item', () => {
    expect(APP).not.toContain("key: 'report'");
    expect(APP).not.toContain('v3FooterApi.buildReport');
  });

  it('the retired footer-report API fields are removed, not left dangling', () => {
    expect(API).not.toContain('buildReport');
    expect(API).not.toContain('reportBusy');
    expect(PANEL).not.toContain('reportBusy:');
  });

  it('Report still exists inside the panel (the More sheet), with its send count', () => {
    expect(PANEL).toContain('sendReportToAdmin');
    expect(PANEL).toContain('reportButtonLabel');
    expect(PANEL).toContain('bumpReportSendCount');
  });
});

describe('previewReadySignal — restoredIdle (the remix-arrival green dot, 2026-08-17)', () => {
  it('an idle session with rehydrated files is genuinely viewable', () => {
    // A remixed workspace never built HERE, so done stays false — but the in-browser preview
    // compiles the restored files fine. The dot saying "nothing to see" was one more reason a
    // fresh remix felt like nothing had happened.
    expect(previewReadySignal(false, false, undefined, 24, true)).toBe(true);
  });

  it('restoredIdle with ZERO files still says no — an empty copy must not get a green dot', () => {
    expect(previewReadySignal(false, false, undefined, 0, true)).toBe(false);
  });

  it('the flag absent preserves every historical verdict', () => {
    expect(previewReadySignal(false, false, undefined, 24)).toBe(false); // mid-build: not yet
    expect(previewReadySignal(false, true, true, 24)).toBe(true);       // finished OK
    expect(previewReadySignal(false, true, false, 24)).toBe(false);     // finished broken
    expect(previewReadySignal(true, false, undefined, 0)).toBe(true);   // live URL always wins
  });
});
