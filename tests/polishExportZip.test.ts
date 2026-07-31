import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * Polish campaign — App Builder #1: Export project (.zip). The feature works end-to-end (server packages
 * the ZIP, the browser downloads it, a failure shows an honest toast), but the KB path pointed to a
 * non-existent "header tab row → Export .zip button". The real control is Files tab → "ZIP". This locks
 * the corrected discoverability + the honest wiring so it stays rock-solid.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const app = read('src/App.tsx');
const filesPanel = read('src/components/panels/FilesPanel.tsx');

describe('Export .zip — rock-solid', () => {
  it('the KB points at the REAL location (Files tab → ZIP), not the stale header button', () => {
    const e = APP_KNOWLEDGE_BASE.find((f) => f.id === 'agentv3_export');
    expect(e).toBeTruthy();
    expect(e!.path).toMatch(/Files tab/);
    expect(e!.path).not.toMatch(/header tab row/);
    expect(e!.howToUse).toMatch(/ZIP/);
  });

  it('the download handler is real: posts to /api/download-zip and reports an HONEST failure', () => {
    const i = app.indexOf('const downloadAppZip');
    expect(i).toBeGreaterThan(-1);
    const block = app.slice(i, i + 900);
    expect(block).toContain("'/api/download-zip'");
    expect(block).toContain("a.click()"); // triggers the real browser download
    expect(block).toMatch(/Download failed/); // honest failure, never a silent stall
  });

  it('the ZIP button is wired in the Files panel and gated on there being a project', () => {
    expect(filesPanel).toContain('onClick={onDownloadZip}');
    expect(filesPanel).toContain('hasGeneratedCode &&'); // only shown once files exist (no dead button)
  });
});

describe('Publish/Deploy — rock-solid discoverability', () => {
  it('the KB names the REAL "Publish" button (not the stale "Deploy" label)', () => {
    const e = APP_KNOWLEDGE_BASE.find((f) => f.id === 'agentv3_deploy');
    expect(e).toBeTruthy();
    expect(e!.path).toMatch(/"Publish"/);
    expect(e!.path).not.toMatch(/"Deploy" button/);
    // The real control opens the Hosting chooser.
    const panel = read('src/components/agentv3/AgentV3Panel.tsx');
    expect(panel).toContain('setShowHostingChooser(true)');
  });
});
