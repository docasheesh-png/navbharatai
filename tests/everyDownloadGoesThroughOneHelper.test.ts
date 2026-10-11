// EVERY DOWNLOAD GOES THROUGH ONE HELPER (2026-10-11, Q-790).
//
// About twenty buttons built their own `<a download>` + Blob URL. iOS ignores that attribute, so on an iPhone
// each of them saved nothing; many also revoked the URL right after `click()` or never attached the link. Inside
// the phone apps it was worse: neither Capacitor shell handles a download at all, and the Android WebView has no
// share sheet, so in the Android app no generated file had ever saved. THE CLASS: a save path built per button.
// The census fails on any raw `a.download` outside src/lib/downloadFile.ts; the behaviour tests pin each platform.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const nativeState = { native: false };
const writeFile = vi.fn(async () => ({ uri: 'file:///Documents/NavBharatAI/x' }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => nativeState.native, getPlatform: () => (nativeState.native ? 'android' : 'web') } }));
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { writeFile }, Directory: { Documents: 'DOCUMENTS', Cache: 'CACHE' } }));

const { deliverFile, deliveryMessage, pickFileDeliveryStrategy, safeDeviceFilename, NATIVE_SAVE_FOLDER } = await import('../src/lib/downloadFile');

function clientFiles(dir = 'src'): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'server' && name !== 'node_modules') out.push(...clientFiles(p)); }
    else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the census', () => {
  it('🔒 no client file saves a file with its own `a.download` — only src/lib/downloadFile.ts may', () => {
    const offenders = clientFiles()
      .filter((f) => f !== join('src', 'lib', 'downloadFile.ts'))
      .filter((f) => /\.download\s*=(?!=)/.test(stripComments(readFileSync(f, 'utf8'))));
    expect(offenders).toEqual([]);
  });
});

describe('the strategy and the words', () => {
  it('share when a file can be shared; otherwise an anchor on the web and a device write in the app', () => {
    expect(pickFileDeliveryStrategy({ canShareFiles: true, isNative: true })).toBe('share');
    expect(pickFileDeliveryStrategy({ canShareFiles: false })).toBe('anchor-download');
    expect(pickFileDeliveryStrategy({ canShareFiles: false, isNative: true })).toBe('native-save');
  });

  it('every outcome has an honest sentence; "saved" names the folder; nothing claims a download it did not do', () => {
    expect(deliveryMessage('saved', 'a.csv')).toBe(`Saved a.csv to Documents/${NATIVE_SAVE_FOLDER} on this device.`);
    expect(deliveryMessage('failed', 'a.csv')).toMatch(/^Could not save a\.csv/);
    expect(deliveryMessage('cancelled', 'a.csv')).toMatch(/^Not saved/);
  });

  it('a device filename never carries a path or control character', () => {
    expect(safeDeviceFilename('../../etc/x.json')).toBe('-..-etc-x.json'); // no separator survives, no leading dot
    expect(safeDeviceFilename('a/b\\c:d.txt')).toBe('a-b-c-d.txt');
    expect(safeDeviceFilename('')).toBe('download');
  });
});

describe('deliverFile on each platform', () => {
  const clicks: string[] = [];
  let appended = 0;
  let revoked = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    clicks.length = 0; appended = 0; revoked = 0; writeFile.mockClear(); nativeState.native = false;
    const anchor = { href: '', download: '', rel: '', click() { clicks.push(this.download); }, remove() {} };
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: () => { appended++; } } });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => { revoked++; } });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('🔒 iPhone (share can take a file): the share sheet opens with a real File, no anchor', async () => {
    const share = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { canShare: () => true, share });
    expect(await deliverFile('r.json', '{}', 'application/json')).toBe('shared');
    expect((share.mock.calls[0] as unknown as [{ files: File[] }])[0].files[0].name).toBe('r.json');
    expect(clicks).toEqual([]);
  });

  it('closing the share sheet is "cancelled" — no second prompt, no anchor', async () => {
    vi.stubGlobal('navigator', { canShare: () => true, share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } });
    expect(await deliverFile('r.json', '{}')).toBe('cancelled');
    expect(clicks).toEqual([]);
  });

  it('🔒 desktop: the anchor is attached, clicked, and its URL revoked only after the click', async () => {
    vi.stubGlobal('navigator', {});
    expect(await deliverFile('app.zip', new Blob(['zip'], { type: 'application/zip' }))).toBe('downloaded');
    expect(clicks).toEqual(['app.zip']);
    expect(appended).toBe(1);
    expect(revoked).toBe(0); // not revoked synchronously — that can cancel the download
    vi.advanceTimersByTime(5000);
    expect(revoked).toBe(1);
  });

  it('🔒 the Android app (no share sheet): the file is WRITTEN to Documents/NavBharatAI, never the inert anchor', async () => {
    nativeState.native = true;
    vi.stubGlobal('navigator', {});
    expect(await deliverFile('report.csv', 'a,b', 'text/csv')).toBe('saved');
    expect(writeFile).toHaveBeenCalledTimes(1);
    const arg = (writeFile.mock.calls[0] as unknown as [{ path: string; directory: string; data: string; recursive: boolean }])[0];
    expect(arg).toMatchObject({ path: `${NATIVE_SAVE_FOLDER}/report.csv`, directory: 'DOCUMENTS', recursive: true });
    expect(Buffer.from(arg.data, 'base64').toString()).toBe('a,b');
    expect(clicks).toEqual([]);
  });

  it('a device that refuses the write is "failed" — never a claimed download', async () => {
    nativeState.native = true;
    vi.stubGlobal('navigator', {});
    writeFile.mockRejectedValueOnce(new Error('denied'));
    expect(await deliverFile('report.csv', 'a,b')).toBe('failed');
    expect(clicks).toEqual([]);
  });
});
