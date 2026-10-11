// THE FILES TAB SAYS WHY IT IS EMPTY (2026-10-11, Q-600 sweep of AgentV3Panel).
//
// `fileLoading` and `fileError` were SET and never shown, so a load in flight and a load that FAILED both read
// "No files shown." — the "sari file gone" look the admin had already complained about, with the reason sitting
// unread in state. And the old device-local report cache kept writing every build report (provider names
// included) to the user's device after the report became admin-only, with nothing left reading it.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const panel = readFileSync('src/components/agentv3/AgentV3Panel.tsx', 'utf8');
const emptyState = panel.slice(panel.indexOf('<Empty>{fileLoading'), panel.indexOf('<Empty>{fileLoading') + 400);

describe('the Files tab empty state', () => {
  it('🔒 says "loading" while files load and names the failure when they could not be read', () => {
    expect(emptyState).toContain("fileLoading ? 'Loading your files…'");
    expect(emptyState).toContain('fileError ? `Could not load your files (${fileError})');
    expect(emptyState).toContain("'No files shown.'");
  });

  it('the loader really drives both: loading set around the fetch, the error cleared on success', () => {
    const loader = panel.slice(panel.indexOf('const loadWorkspaceFiles = async'), panel.indexOf('const loadWorkspaceFiles = async') + 4000);
    expect(loader).toContain('setFileLoading(true);');
    expect(loader).toMatch(/finally \{\s*setFileLoading\(false\);/);
    expect(loader).toContain("setFileError('');");
  });
});

describe('the build report stays off the user\'s device', () => {
  it('🔒 the dormant report cache is gone, and what earlier versions stored is cleared', () => {
    expect(existsSync('src/components/agentv3/reportCache.ts')).toBe(false);
    expect(panel).not.toMatch(/saveLastReport|readLastReport/);
    expect(panel).toContain("localStorage.removeItem('nbv3:last-build-report')");
  });
});
