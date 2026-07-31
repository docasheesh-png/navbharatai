import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * IDE keyboard shortcuts (admin 2026-07-31): they "did not work" for two root causes —
 *  1) CodeStudio had NO global keydown listener, so physical Ctrl+S/B/J/P never fired;
 *  2) the keys-fallback ran even when a command was already handled, so a tapped Ctrl+B toggled
 *     twice (dead no-op) and Ctrl+D selected twice.
 * Plus several commands were fake console.log stubs. These tests lock the fixes at source level.
 */
const src = readFileSync(join(__dirname, '../src/components/ide/CodeStudio.tsx'), 'utf8');

describe('IDE — physical keyboard shortcuts are wired', () => {
  it('a global keydown listener maps the workbench shortcuts', () => {
    expect(src).toContain("window.addEventListener('keydown', onKeyDown)");
    expect(src).toContain("window.removeEventListener('keydown', onKeyDown)");
    // Handles save / save-all / palette / sidebar / panel.
    expect(src).toContain("'base.action.save'");
    expect(src).toContain("'workbench.action.files.saveAll'");
  });

  it('the keys-fallback only runs when no command was handled (no more double-fire)', () => {
    // The fallback block is now guarded so a tapped shortcut (command given) fires exactly once.
    expect(src).toMatch(/if \(!command\) \{[\s\S]*ctrl\+b[\s\S]*ctrl\+d/);
  });
});

describe('IDE — no fake stub commands', () => {
  it('Save All, Markdown Preview, Debug and Split no longer console.log a fake "triggered"', () => {
    expect(src).not.toContain("console.log('Save All Files Triggered')");
    expect(src).not.toContain("console.log('Markdown Preview Triggered')");
    expect(src).not.toContain("console.log('Debug Started')");
    expect(src).not.toContain("console.log('Split Editor Triggered')");
  });

  it('Save All really saves every dirty tab', () => {
    expect(src).toContain("case 'workbench.action.files.saveAll'");
    expect(src).toContain('dirtyTabs.forEach');
    expect(src).toContain('onFilesChange(next)');
    expect(src).toContain('setDirtyTabs(new Set())');
  });

  it('Markdown Preview opens the real preview and Debug opens the debug panel', () => {
    expect(src).toContain("case 'markdown.showPreview':");
    expect(src).toMatch(/markdown\.showPreview':[\s\S]{0,200}setActiveScreen\('preview'\)/);
    expect(src).toMatch(/debug\.start':[\s\S]{0,200}setIsDebugPanelOpen\(true\)/);
  });

  it('New File (Ctrl+N) is now a real handler, not a dead shortcut', () => {
    expect(src).toContain("case 'explorer.newFile'");
    const i = src.indexOf("case 'explorer.newFile'");
    expect(src.slice(i, i + 400)).toContain('handleCreateFile(name)');
  });
});
