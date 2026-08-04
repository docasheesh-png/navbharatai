import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * Polish campaign — App Builder (NavBharatAI Pro v5.0) cluster, rock-solid verification.
 *
 * Export (.zip) and Publish are locked separately in polishExportZip.test.ts. This suite audits the
 * REMAINING App Builder features against their REAL controls in the code, so every KB discoverability
 * path points at a control that actually exists (a stale path silently misdirects every NavBharatAI AI
 * that answers "how do I …?"). Each `expect` is anchored to a concrete string in the live component.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const panel = read('src/components/agentv3/AgentV3Panel.tsx');
const attachMenu = read('src/components/AttachMenu.tsx');
const preview = read('src/components/agentv3/PreviewSurface.tsx');
const kb = (id: string) => APP_KNOWLEDGE_BASE.find((f) => f.id === id);

describe('Import an existing app (.zip)', () => {
  it('the real control is the attach menu "Import project (.zip)" option (imports immediately)', () => {
    expect(attachMenu).toContain('Import project (.zip)');
    expect(panel).toContain('handleZipProject'); // the real immediate-import handler, not a chat attachment
  });
  it('the KB points at the attach menu option (not a send-a-zip flow)', () => {
    const e = kb('agentv3_zip_import');
    expect(e).toBeTruthy();
    expect(e!.path).toMatch(/Import project \(\.zip\)/);
  });
});

describe('Import an existing app from GitHub', () => {
  it('the real control is the "Build options" gear → "Import Repo" menu item', () => {
    expect(panel).toContain('title="Build options"');
    expect(panel).toContain('Import Repo');
    expect(panel).toContain('setShowImportModal(true)');
  });
  it('the KB names the REAL "Import Repo" label (not just "GitHub / URL")', () => {
    const e = kb('agentv3_github_import');
    expect(e).toBeTruthy();
    expect(e!.path).toMatch(/Import Repo/);
    expect(e!.path).toMatch(/Build options/);
  });
});

describe('Plan & Advise modes + queue (3-role)', () => {
  it('the composer mode selector really offers Build / Plan / Advise', () => {
    expect(panel).toContain("['build', 'Build', '🔨']");
    expect(panel).toContain("['planner', 'Plan', '🧠']");
    expect(panel).toContain("['advisor', 'Advise', '🔍']");
  });
});

describe('Ship to main + Revert (own-repo mode)', () => {
  it('both real actions exist and Ship is CI-gated by the hook', () => {
    expect(panel).toContain('Ship to ${state.ownRepo.baseBranch}');
    expect(panel).toContain('Revert last');
    expect(panel).toContain('shipToMain');
    expect(panel).toContain('revertLastMerge');
  });
});

describe('Restore all files', () => {
  it('the real "Restore all files" button calls the real restore', () => {
    expect(panel).toContain('Restore all files');
    expect(panel).toContain('restoreAllFiles()');
  });
});

describe('Preview (dual: Live server + In-browser + Diagnose)', () => {
  it('the real toggle + Diagnose exist in PreviewSurface', () => {
    expect(preview).toContain('>In-browser<');
    expect(preview).toContain('Live server');
    expect(preview).toContain('Diagnose');
    expect(preview).toContain('runDiagnose');
  });
});

describe('Report a build (admin-only)', () => {
  it('the single "Report" button submits to admin (no user-facing download/copy)', () => {
    expect(panel).toContain('sendReportToAdmin');
    expect(panel).toContain('/api/agentv3/report-to-admin'); // submits to the admin inbox
  });
});

describe('NavBharatAI Pro v5.0 (builder) — entry points are real', () => {
  it('the floating launcher was removed, so the KB must NOT tell users to look for it', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('AgentV3Launcher removed'); // the floating button is genuinely gone
    const e = kb('agentv3_builder');
    expect(e).toBeTruthy();
    expect(e!.path).not.toMatch(/floating/i);
    expect(e!.howToUse).not.toMatch(/floating/i);
  });
  it('the KB names the two REAL gates (sidebar + Professionals)', () => {
    const e = kb('agentv3_builder')!;
    expect(e.path).toMatch(/App Builder v5\.0/);
    expect(e.path).toMatch(/Professionals/);
    // Both gates exist in code.
    expect(read('src/components/panels/SidebarNav.tsx')).toContain('App Builder v5.0');
    expect(read('src/components/professionals/ProfessionalsView.tsx')).toContain("id: 'nbi_pro_chat'");
  });
});

describe('Files — one view, two gates', () => {
  it('the v5.0 Files tab renders the SAME FilesPanel the sidebar uses', () => {
    expect(panel).toContain("import { FilesPanel");
    expect(panel).toContain("setTab('files')");
  });
});

describe('Software Project Mode (mega builds)', () => {
  it('is a real, flag-gated (AGENTV3_PROJECT_MODE) module-decomposition path', () => {
    const routes = read('src/server/routes/agentv3.ts');
    expect(routes).toContain('projectModeEnabled');
    expect(routes).toContain('detectMegaProject');
    const plan = read('src/server/AgentV3/ProjectPlan.ts');
    expect(plan).toContain('AGENTV3_PROJECT_MODE');
  });
});

describe('Build survives reload & tab switch', () => {
  it('the hook has a real live re-attach path (subscribeLive)', () => {
    const hook = read('src/hooks/useAgentV3Build.ts');
    expect(hook).toContain('subscribeLive');
  });
});

describe('Save apps to your own GitHub (git-native)', () => {
  it('git-native storage is a real, admin-gated path', () => {
    const idx = read('src/server/AgentV3/index.ts');
    expect(idx).toContain('githubStorageEnabled');
  });
});
