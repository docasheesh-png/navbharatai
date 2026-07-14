import { describe, it, expect } from 'vitest';
import { generateDesktopExport } from './DesktopExportGenerator';
import { isValidAppId } from './appId';

describe('generateDesktopExport', () => {
  it('emits electron main + electron-builder.yml + README + electron deps', () => {
    const r = generateDesktopExport({ appName: 'My Shop', webDir: 'dist' });
    expect(r.appId).toBe('com.navbharat.myshop');
    expect(r.mainEntry).toBe('electron/main.cjs');
    const main = r.files['electron/main.cjs'];
    expect(main).toContain('BrowserWindow');
    expect(main).toContain('"dist"');           // loads from the webDir
    const yml = r.files['electron-builder.yml'];
    expect(yml).toContain('appId: com.navbharat.myshop');
    expect(yml).toContain('target: nsis');       // windows .exe
    expect(yml).toContain('target: dmg');        // macOS
    expect(yml).toContain('target: AppImage');   // linux
    expect(r.dependencies.map((d) => d.name)).toEqual(['electron', 'electron-builder']);
    expect(Object.keys(r.scripts)).toContain('electron:build');
  });

  it('honors an explicit valid appId and defaults webDir to dist', () => {
    const r = generateDesktopExport({ appName: 'Thing', appId: 'com.acme.thing' });
    expect(r.appId).toBe('com.acme.thing');
    expect(r.files['electron/main.cjs']).toContain('"dist"');
  });

  it('replaces an INVALID explicit appId with a derived valid one', () => {
    const r = generateDesktopExport({ appName: 'Thing', appId: 'bad id!' });
    expect(isValidAppId(r.appId)).toBe(true);
    expect(r.appId).toBe('com.navbharat.thing');
  });

  it('is HONEST that installers are not produced here + warns about the relative base path', () => {
    const r = generateDesktopExport({ appName: 'Thing' });
    expect(r.files['DESKTOP_EXPORT.md']).toMatch(/NOT done here|not produced|Windows runner|matching OS/i);
    expect(r.files['DESKTOP_EXPORT.md']).toMatch(/base: '\.\/'|relative/i); // the file:// asset-path gotcha
    expect(r.instructions).toMatch(/NOT produced here/i);
  });
});
