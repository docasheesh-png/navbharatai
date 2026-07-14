import { describe, it, expect } from 'vitest';
import { generateExtensionExport } from './ExtensionExportGenerator';

describe('generateExtensionExport', () => {
  it('emits a valid Manifest V3 manifest + runbook', () => {
    const r = generateExtensionExport({ appName: 'My Shop', webDir: 'dist' });
    const manifest = JSON.parse(r.files['manifest.json']);
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('My Shop');
    expect(manifest.action.default_popup).toBe('index.html');
    expect(manifest.permissions).toEqual([]); // minimal by design
    expect(r.files['EXTENSION_EXPORT.md']).toContain('My Shop');
  });

  it('defaults webDir to dist and derives a description', () => {
    const r = generateExtensionExport({ appName: 'Thing' });
    expect(r.files['EXTENSION_EXPORT.md']).toContain('dist/');
    expect(JSON.parse(r.files['manifest.json']).description).toContain('Thing');
  });

  it('is HONEST that publishing needs a store account + warns about the relative base path', () => {
    const r = generateExtensionExport({ appName: 'Thing' });
    expect(r.files['EXTENSION_EXPORT.md']).toMatch(/developer account|NOT done here|Web Store/i);
    expect(r.files['EXTENSION_EXPORT.md']).toMatch(/base: '\.\/'|relative/i);
    expect(r.instructions).toMatch(/NOT done here/i);
  });

  it('produces parseable JSON with a trailing newline', () => {
    const raw = generateExtensionExport({ appName: 'X' }).files['manifest.json'];
    expect(raw.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
