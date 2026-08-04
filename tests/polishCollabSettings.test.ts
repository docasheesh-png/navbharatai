import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * Polish campaign — Collaboration (4) + Settings/Connections (16), rock-solid verification.
 *
 * Fixes: share_for_review pointed at "Deploy panel → Deploy tab" but ShareForReview lives inside
 * MultiCloudDeploy, which moved to Settings → App Settings → Hosting & Deploy this session. And ~13 KB
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
  it('Share for Review points at the REAL location (Hosting & Deploy), not the old Deploy panel', () => {
    const e = kb('share_for_review')!;
    expect(e.path).not.toMatch(/Deploy panel/);
    expect(e.path).toMatch(/Hosting & Deploy/);
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
    ['shell', 'Terminal'],
    ['logs', 'Logs'],
  ])('the %s tile ("%s") exists', (id, label) => {
    expect(settings).toContain(`label: '${label}'`);
  });
  it('Notifications bell is mounted in the top bar', () => {
    expect(topnav).toContain('NotificationBell');
  });
});
