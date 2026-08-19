import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * Polish campaign — Collaboration (4) + Settings/Connections (16), rock-solid verification.
 *
 * Fixes: share_for_review pointed at "Deploy panel → Deploy tab". ShareForReview was later PROMOTED
 * (2026-08-19) to its own Home tool tile — its one discoverable doorway. And ~13 KB
 * entries said "Secrets & Keys" while the real tile is labelled "Secrets & API Keys". The rest of the
 * App Settings hub (built this session) is verified against the real SettingsPanel tiles.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const settings = read('src/components/panels/SettingsPanel.tsx');
const teamCollab = read('src/components/ide/TeamCollaboration.tsx');
const mentionInbox = read('src/components/ide/MentionInbox.tsx');
const shareForReview = read('src/components/ide/ShareForReview.tsx');
const topnav = read('src/components/panels/TopNav.tsx');
const kb = (id: string) => APP_KNOWLEDGE_BASE.find((f) => f.id === id);

describe('Collaboration', () => {
  it('Share for Review points at its REAL location — the Home tool tile — not the old buried Deploy panel', () => {
    // Promoted 2026-08-19 (E1 trust sprint) from Settings → Deploy (three levels deep, undiscoverable)
    // to its own Home tool tile, with the duplicate removed from MultiCloudDeploy — one doorway.
    const e = kb('share_for_review')!;
    expect(e.path).not.toMatch(/Deploy panel/);
    expect(e.path).toMatch(/Share for Review/);      // the Home tool tile is now the one doorway
    expect(shareForReview).toContain('Create review link'); // the real control
  });
  it('Team Collaboration, @Mentions (bell), and Team Library are real', () => {
    expect(kb('team_collaboration')!.path).toMatch(/Other AI → Team/);
    expect(teamCollab).toContain('MentionInbox');
    expect(teamCollab).toContain('TeamLibraryPanel');
    expect(mentionInbox).toContain('Bell'); // @mentions delivered to the top-right bell inbox
  });
});

describe('Settings — Secrets tile label is consistent', () => {
  it('the KB uses the REAL tile label "Secrets & API Keys" (never bare "Secrets & Keys")', () => {
    const secrets = kb('settings_secrets')!;
    expect(secrets.name).toBe('Secrets & API Keys');
    expect(secrets.path).toMatch(/Secrets & API Keys/);
    // No KB entry should reference the old bare label anywhere (the real tile is "Secrets & API Keys",
    // which does NOT contain the substring "Secrets & Keys").
    const stale = APP_KNOWLEDGE_BASE.filter((f) =>
      [f.name, f.path, f.description, f.howToUse].some(
        (s) => typeof s === 'string' && s.includes('Secrets & Keys'),
      ),
    );
    expect(stale.map((f) => f.id)).toEqual([]);
  });
  it('the real "Secrets & API Keys" tile exists in App Settings', () => {
    expect(settings).toContain("label: 'Secrets & API Keys'");
  });
});

describe('Settings — App Settings hub tiles are real', () => {
  it.each([
    ['domain', 'Domain'],
    ['cloudeploy', 'Hosting & Deploy'],
    ['database', 'Database'],
    ['auth', 'Authentication'],
    ['storage', 'Storage'],
    ['general', 'General'],
    ['logs', 'Logs'],
  ])('the %s tile ("%s") exists', (id, label) => {
    expect(settings).toContain(`label: '${label}'`);
  });

  it('🔒 the Terminal tile is GONE — Code Studio already has that exact terminal', () => {
    // Removed 2026-08-11 (admin: "ide ke andar already hai"). It mounted the same TerminalPanel on the
    // same workspace as Code Studio, so it was a second doorway to one room — the same duplication the
    // 'database' tile was removed from Home for. Asserted as absent so it cannot quietly return.
    // Comments are stripped first: the code legitimately EXPLAINS the removal, and matching a bare
    // word against prose is how a test starts failing on its own explanation.
    const code = settings.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain("label: 'Terminal'");
    expect(code).not.toContain("id: 'shell'");
    expect(code).not.toContain('TerminalPanel');       // the component is no longer mounted here
    expect(code).not.toContain("settingsScreen === 'shell'");
  });
  it('Notifications bell is mounted in the top bar', () => {
    expect(topnav).toContain('NotificationBell');
  });
});
