import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The mask must be wired so it cannot be walked around (incident 2026-08-06).
 */
const panel = readFileSync(join(__dirname, '..', 'src/components/panels/FilesPanel.tsx'), 'utf8');

describe('FilesPanel hides secret values by default', () => {
  it('renders the masked text, not the raw file', () => {
    expect(panel).toContain("from '../../lib/secretMask'");
    expect(panel).toContain('maskSecretContent(viewPath, viewerRaw)');
    expect(panel).toContain('{viewerText.length > 0 ? viewerText');
  });

  it('COPY uses the same text as the screen', () => {
    // A copy button that hands over what the screen hides would make the mask decorative.
    expect(panel).toContain("copyToClipboard(viewerText, 'File')");
    expect(panel).not.toContain("copyToClipboard(typeof files[viewPath] === 'string' ? files[viewPath] : '', 'File')");
  });

  it('revealing is a deliberate tap, and re-arms for the next file', () => {
    // A Reveal on one file must never carry into the next one the user opens.
    expect(panel).toContain('setRevealSecret((v) => !v)');
    expect(panel).toContain('const setViewPath = (p: string | null): void => { setRevealSecret(false); setViewPathRaw(p); };');
  });

  it('says where the values went', () => {
    expect(panel).toContain('maskNotice(viewPath)');
  });
});
