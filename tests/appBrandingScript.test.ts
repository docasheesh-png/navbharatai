import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { BRANDING_SCRIPT } from '../src/server/lib/appBrandingScript';
import { chooseMark, markLabel, markSvg } from '../src/lib/brandMark';

// ADMIN 2026-10-16: "A successful build must never expose the default Capacitor icon as the generated application's
// launcher icon." These tests run the REAL branding script, as a process, against fixture native projects shaped like
// what `cap add` produces — so "the default icon is gone" is checked on the files, not on a promise.

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
/** A valid solid-colour PNG. `tag` makes the bytes unique so two "different apps" never collide by accident. */
function solidPng(w: number, h: number, tag: string, alpha = false): Buffer {
  const rgb = crypto.createHash('sha256').update(tag).digest();
  const bpp = alpha ? 4 : 3, stride = w * bpp + 1, raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * stride + 1 + x * bpp; raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; if (alpha) raw[o + 3] = 255; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const DENS: Record<string, number> = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

let dir = '';
const w = (rel: string, data: string | Buffer) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
const r = (rel: string) => fs.readFileSync(path.join(dir, rel));
const has = (rel: string) => fs.existsSync(path.join(dir, rel));
const walk = (d: string): string[] => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : [];

function run(...args: string[]) {
  const res = spawnSync(process.execPath, ['scripts/nbai-branding.mjs', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}
const status = () => JSON.parse(r('assets/.nbai-branding.json').toString());

/** What `npx cap add android` leaves: Capacitor's default icons, splash and manifest — each file unique and "default". */
function defaultAndroid(tag = 'capacitor-default') {
  const res = 'android/app/src/main/res';
  for (const [d, s] of Object.entries(DENS)) {
    w(`${res}/mipmap-${d}/ic_launcher.png`, solidPng(Math.round(48 * s), Math.round(48 * s), `${tag}-l-${d}`));
    w(`${res}/mipmap-${d}/ic_launcher_round.png`, solidPng(Math.round(48 * s), Math.round(48 * s), `${tag}-r-${d}`));
    w(`${res}/mipmap-${d}/ic_launcher_foreground.png`, solidPng(Math.round(108 * s), Math.round(108 * s), `${tag}-f-${d}`));
  }
  w(`${res}/mipmap-anydpi-v26/ic_launcher.xml`, '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>');
  w(`${res}/drawable-v24/ic_launcher_foreground.xml`, '<vector>capacitor-logo</vector>');
  w(`${res}/drawable/splash.png`, solidPng(32, 48, `${tag}-splash`));
  w(`${res}/drawable-port-hdpi/splash.png`, solidPng(48, 80, `${tag}-splash-port`));
  w('android/app/src/main/AndroidManifest.xml', '<manifest package="com.shop.chai"><application android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher_round" android:label="Chai"></application></manifest>');
  w('android/app/build.gradle', 'applicationId "com.shop.chai"\nversionCode 7\n');
  w('capacitor.config.json', '{"appId":"com.shop.chai","appName":"Chai"}');
}
function defaultIos(tag = 'capacitor-default') {
  const ic = 'ios/App/App/Assets.xcassets/AppIcon.appiconset', sp = 'ios/App/App/Assets.xcassets/Splash.imageset';
  w(`${ic}/AppIcon-512@2x.png`, solidPng(1024, 1024, `${tag}-ios`));
  w(`${ic}/Contents.json`, JSON.stringify({ images: [{ filename: 'AppIcon-512@2x.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }] }));
  w(`${sp}/splash-2732x2732.png`, solidPng(64, 64, `${tag}-ios-splash`));
  w('ios/App/App/Info.plist', '<plist>CFBundleIdentifier com.shop.chai</plist>');
}
function project(opts: { declared?: 'user' | 'none'; icon?: Buffer; ext?: string; appName?: string; appId?: string } = {}) {
  const appName = opts.appName ?? 'Chai Shop', appId = opts.appId ?? 'com.shop.chai';
  w('scripts/nbai-branding.mjs', BRANDING_SCRIPT);
  const declared = opts.declared ?? 'none', ext = opts.ext ?? 'png';
  if (opts.icon) w(`resources/icon.${ext}`, opts.icon);
  const mark = chooseMark(appName);
  // The same files the server writes (appBranding.ts brandingTextFiles): the mark, already drawn.
  w('resources/brand-mark.svg', markSvg(mark, { size: 1024, tile: 'square' }));
  w('resources/brand-mark-fg.svg', markSvg(mark, { size: 1024, tile: 'none' }));
  w('resources/branding.json', JSON.stringify({ appName, appId, declared, iconFile: opts.icon ? `resources/icon.${ext}` : '', mark: markLabel(mark), seed: `${appId}|${appName}` }));
}
/** A stand-in for @capacitor/assets: writes launcher + splash files derived from the source icon, at the sizes it is asked for. */
function fakeGenerator(mode: 'ok' | 'fail' | 'nosplash' | 'noicons' = 'ok') {
  const body = `#!/usr/bin/env node
const fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto');
const mode=${JSON.stringify(mode)};
if(mode==='fail'){console.error('sharp: input file is missing');process.exit(1);}
const platform=process.argv.includes('--ios')?'ios':'android';
const src=fs.readFileSync('assets/icon.png');const tag=crypto.createHash('sha256').update(src).digest('hex');
const C=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc=(b)=>{let c=0xffffffff;for(const x of b)c=C[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);};
const png=(w,h,s)=>{const k=crypto.createHash('sha256').update(s).digest();const raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const o=y*(w*3+1)+1+x*3;raw[o]=k[0];raw[o+1]=k[1];raw[o+2]=k[2];}const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),ch('IHDR',ih),ch('IDAT',zlib.deflateSync(raw)),ch('IEND',Buffer.alloc(0))]);};
const put=(p,b)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b);};
if(platform==='android'){const res='android/app/src/main/res';
 if(mode!=='noicons'){const D={mdpi:1,hdpi:1.5,xhdpi:2,xxhdpi:3,xxxhdpi:4};
  for(const[d,s]of Object.entries(D)){for(const n of ['ic_launcher','ic_launcher_round'])put(res+'/mipmap-'+d+'/'+n+'.png',png(Math.round(48*s),Math.round(48*s),tag+n+d));put(res+'/mipmap-'+d+'/ic_launcher_foreground.png',png(Math.round(108*s),Math.round(108*s),tag+'fg'+d));}}
 if(mode!=='nosplash'){const walk=(d)=>fs.existsSync(d)?fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]):[];
  for(const f of walk(res).filter(f=>/splash\\.png$/.test(f))){const b=fs.readFileSync(f);put(f,png(b.readUInt32BE(16),b.readUInt32BE(20),tag+'splash'+f));}}
}else{const ic='ios/App/App/Assets.xcassets/AppIcon.appiconset';put(ic+'/AppIcon-512@2x.png',png(1024,1024,tag+'ios'));
 const sp='ios/App/App/Assets.xcassets/Splash.imageset';if(mode!=='nosplash'&&fs.existsSync(sp))for(const f of fs.readdirSync(sp).filter(f=>f.endsWith('.png'))){const b=fs.readFileSync(sp+'/'+f);put(sp+'/'+f,png(b.readUInt32BE(16),b.readUInt32BE(20),tag+'isplash'+f));}}
`;
  const bin = '.nbai-tools/node_modules/.bin/capacitor-assets';
  w(bin, body);
  fs.chmodSync(path.join(dir, bin), 0o755);
}
const prepareAndEnsure = (platform: 'android' | 'ios') => { run('snapshot', platform); const p = run('prepare'); const e = run('ensure', platform); return { p, e, v: run('verify', platform) }; };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbai-brand-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('branding script — it is valid JavaScript', () => {
  it('parses (a broken string in this file once made every ship fail on the runner)', () => {
    w('scripts/nbai-branding.mjs', BRANDING_SCRIPT);
    const res = spawnSync(process.execPath, ['--check', 'scripts/nbai-branding.mjs'], { cwd: dir, encoding: 'utf8' });
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
  });
});

describe('branding script — the logo choice', () => {
  it('a logo the user uploaded is the source, and the launcher icons are built from it', () => {
    defaultAndroid(); project({ declared: 'user', icon: solidPng(1024, 1024, 'users-own-logo') }); fakeGenerator('ok');
    const { e, v } = prepareAndEnsure('android');
    expect(e.code).toBe(0); expect(v.code).toBe(0);
    expect(status().source).toBe('user');
    expect(sha(r('assets/icon.png'))).toBe(sha(solidPng(1024, 1024, 'users-own-logo')));
    expect(status().emergency).toBeUndefined();
  });

  it('no logo chosen and no image library on the runner: an EXPLICIT app-specific pattern is used, never a default, and it is reported', () => {
    defaultAndroid(); project({ declared: 'none' });
    const { p, e, v } = prepareAndEnsure('android');
    expect(e.code).toBe(0); expect(v.code).toBe(0);
    expect(status().source).toBe('fallback');
    expect(status().reason).toContain("the app's own mark could not be drawn");
    expect(status().reason).toContain('sharp is not installed');
    expect(p.out).toContain('Branding source: fallback');
    expect(e.out).toContain('launcher icon and splash: fallback');
  });

  it.each([
    ['corrupt (cut off)', () => solidPng(1024, 1024, 'x').subarray(0, 300), /complete PNG/],
    ['too small', () => solidPng(256, 256, 'small'), /smaller than the 512x512/],
    ['not square', () => solidPng(1024, 600, 'wide'), /not square/],
    ['not an image at all', () => Buffer.from('<html>oops</html>'.repeat(10)), /complete PNG/],
  ])('an unsuitable logo (%s) is never used — the fallback is, and the reason says why', (_n, make, why) => {
    defaultAndroid(); project({ declared: 'user', icon: make() }); fakeGenerator('ok');
    const { e, v } = prepareAndEnsure('android');
    expect(e.code).toBe(0); expect(v.code).toBe(0);
    expect(status().source).toBe('fallback');
    expect(status().reason).toMatch(why);
  });

  it('a leftover resources/icon.* from an earlier ship is IGNORED when this ship declared no logo', () => {
    defaultAndroid(); project({ declared: 'none' }); w('resources/icon.png', solidPng(1024, 1024, 'previous-apps-logo')); fakeGenerator('ok');
    prepareAndEnsure('android');
    expect(status().source).toBe('fallback');
    expect(sha(r('assets/icon.png'))).not.toBe(sha(solidPng(1024, 1024, 'previous-apps-logo')));
  });
});

describe('branding script — the native project never keeps a default or stale icon', () => {
  it('a FRESH Capacitor project: before branding it is flagged as default; after, it verifies and no default byte survives', () => {
    defaultAndroid(); project({ declared: 'none' });
    const defaults = walk(path.join(dir, 'android')).filter((p) => /\.png$/.test(p)).map((p) => sha(fs.readFileSync(p)));
    run('snapshot', 'android'); run('prepare');
    expect(run('verify', 'android').code).toBe(1); // the default icons are still there
    expect(run('ensure', 'android').code).toBe(0);
    expect(run('verify', 'android').code).toBe(0);
    const after = new Set(walk(path.join(dir, 'android')).filter((p) => /\.png$/.test(p)).map((p) => sha(fs.readFileSync(p))));
    for (const d of defaults) expect(after.has(d)).toBe(false);
    expect(has('android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml')).toBe(false); // Capacitor's vector logo is gone
  });

  it('every density, the round icon, the adaptive layers and the manifest references are real files', () => {
    defaultAndroid(); project({ declared: 'none' }); prepareAndEnsure('android');
    const res = 'android/app/src/main/res';
    for (const [d, s] of Object.entries(DENS)) {
      for (const [n, size] of [['ic_launcher', 48 * s], ['ic_launcher_round', 48 * s], ['ic_launcher_foreground', 108 * s]] as const) {
        const b = r(`${res}/mipmap-${d}/${n}.png`);
        expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([Math.round(size), Math.round(size)]);
      }
    }
    expect(r(`${res}/mipmap-anydpi-v26/ic_launcher.xml`).toString()).toContain('@mipmap/ic_launcher_foreground');
    expect(r('android/app/src/main/AndroidManifest.xml').toString()).toMatch(/android:icon="@mipmap\/ic_launcher"[\s\S]*android:roundIcon="@mipmap\/ic_launcher_round"/);
  });

  it('a stale native project from ANOTHER app: its icons are replaced even though the generator fails', () => {
    defaultAndroid('other-apps-icons'); project({ declared: 'user', icon: solidPng(1024, 1024, 'my-logo') }); fakeGenerator('fail');
    const stale = new Set(walk(path.join(dir, 'android')).filter((p) => /\.png$/.test(p)).map((p) => sha(fs.readFileSync(p))));
    const { e, v } = prepareAndEnsure('android');
    expect(e.code).toBe(0); expect(v.code).toBe(0);
    expect(status().source).toBe('fallback');
    expect(status().reason).toContain('the icon generator failed');
    for (const p of walk(path.join(dir, 'android')).filter((f) => /\.png$/.test(f))) expect(stale.has(sha(fs.readFileSync(p)))).toBe(false);
  });

  it('the generator leaves a stale file behind: it is caught; only the SPLASH is replaced and the launcher keeps the user\'s logo', () => {
    defaultAndroid('other-apps-icons'); project({ declared: 'user', icon: solidPng(1024, 1024, 'my-logo') }); fakeGenerator('nosplash');
    const { e } = prepareAndEnsure('android');
    expect(e.code).toBe(0);
    expect(status().source).toBe('user'); // launcher icons came from the user's logo
    expect(status().splash).toContain('generated-mark');
    expect(status().reason).toContain('splash replaced');
  });

  it('the generator leaves the launcher icons stale: that is caught too and the fallback replaces them (reported)', () => {
    defaultAndroid(); project({ declared: 'user', icon: solidPng(1024, 1024, 'my-logo') }); fakeGenerator('noicons');
    const { e } = prepareAndEnsure('android');
    expect(e.code).toBe(0); expect(status().source).toBe('fallback'); expect(status().emergency).toBe(true);
  });

  it('an EXISTING project rebuilt from the SAME logo is accepted without touching the user\'s logo', () => {
    defaultAndroid(); project({ declared: 'user', icon: solidPng(1024, 1024, 'my-logo') }); fakeGenerator('ok');
    expect(prepareAndEnsure('android').e.code).toBe(0);
    // second ship: the project (with its stamp) is reused, the generator produces byte-identical output
    const second = prepareAndEnsure('android');
    expect(second.e.code).toBe(0);
    expect(status().source).toBe('user'); expect(status().emergency).toBeUndefined();
  });

  it('an existing project whose stamp belongs to a DIFFERENT logo gets new icons, never the old bytes', () => {
    defaultAndroid(); project({ declared: 'user', icon: solidPng(1024, 1024, 'logo-one') }); fakeGenerator('ok'); prepareAndEnsure('android');
    const oldBytes = new Set(walk(path.join(dir, 'android')).filter((p) => /ic_launcher.*\.png$/.test(p)).map((p) => sha(fs.readFileSync(p))));
    w('resources/icon.png', solidPng(1024, 1024, 'logo-two')); // the user changed the logo
    expect(prepareAndEnsure('android').e.code).toBe(0);
    for (const p of walk(path.join(dir, 'android')).filter((f) => /ic_launcher.*\.png$/.test(f))) expect(oldBytes.has(sha(fs.readFileSync(p)))).toBe(false);
  });

  it('a manifest that points at a launcher icon that does not exist fails verification', () => {
    defaultAndroid(); project({ declared: 'none' }); prepareAndEnsure('android');
    w('android/app/src/main/AndroidManifest.xml', '<manifest><application android:icon="@mipmap/does_not_exist" android:roundIcon="@mipmap/ic_launcher_round"></application></manifest>');
    const v = run('verify', 'android');
    expect(v.code).toBe(1); expect(v.out).toContain('@mipmap/does_not_exist');
  });
});

describe('branding script — iOS, PWA, and one source for all three', () => {
  it('iOS: a default AppIcon is replaced, Contents.json resolves, and a 1024 App Store icon exists', () => {
    defaultIos(); project({ declared: 'none' });
    const before = sha(r('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'));
    run('snapshot', 'ios'); run('prepare');
    expect(run('verify', 'ios').code).toBe(1); // still the default
    expect(run('ensure', 'ios').code).toBe(0); expect(run('verify', 'ios').code).toBe(0);
    const icon = r('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
    expect(sha(icon)).not.toBe(before);
    expect([icon.readUInt32BE(16), icon.readUInt32BE(20)]).toEqual([1024, 1024]);
    expect(icon[25]).toBe(2); // RGB, no alpha — the App Store refuses a transparent icon
  });

  it('iOS with a real logo and a working generator: source stays the user\'s, splash is replaced too', () => {
    defaultIos(); project({ declared: 'user', icon: solidPng(1024, 1024, 'my-logo') }); fakeGenerator('ok');
    expect(prepareAndEnsure('ios').e.code).toBe(0); expect(status().source).toBe('user');
  });

  it('a Contents.json that lists a file which is not there fails', () => {
    defaultIos(); project({ declared: 'none' }); prepareAndEnsure('ios');
    w('ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json', JSON.stringify({ images: [{ filename: 'gone.png', idiom: 'universal', size: '1024x1024' }] }));
    expect(run('verify', 'ios').out).toContain('gone.png');
  });

  it('Android, iOS and PWA are all built from the SAME branding source', () => {
    defaultAndroid(); defaultIos(); project({ declared: 'user', icon: solidPng(1024, 1024, 'shared-logo') }); fakeGenerator('ok');
    run('prepare');
    const src = sha(r('assets/icon.png'));
    run('snapshot', 'android'); run('snapshot', 'ios');
    expect(run('ensure', 'android').code).toBe(0); expect(run('ensure', 'ios').code).toBe(0);
    expect(JSON.parse(r('android/.nbai-branding.json').toString()).sourceSha256).toBe(src);
    expect(JSON.parse(r('ios/.nbai-branding.json').toString()).sourceSha256).toBe(src);
    expect(status().sourceSha256).toBe(src);
  });

  it('PWA: a manifest whose icon is missing, wrong-sized or a generic framework icon fails; a good one passes', () => {
    project({ declared: 'none' });
    expect(run('verify', 'pwa').code).toBe(0); // no manifest → nothing to check, said plainly
    w('dist/manifest.webmanifest', JSON.stringify({ icons: [{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }] }));
    expect(run('verify', 'pwa').out).toContain('does not exist');
    w('dist/icons/icon-512.png', solidPng(300, 300, 'p'));
    expect(run('verify', 'pwa').out).toContain('300x300 but the manifest says 512x512');
    w('dist/icons/icon-512.png', solidPng(512, 512, 'p'));
    expect(run('verify', 'pwa').code).toBe(0);
    w('dist/manifest.webmanifest', JSON.stringify({ icons: [{ src: '/vite.svg', sizes: 'any', type: 'image/svg+xml' }] })); w('dist/vite.svg', '<svg/>');
    expect(run('verify', 'pwa').out).toContain('generic framework icon');
  });

  it('a real PNG called favicon.png is not rejected as a framework icon', () => {
    project();
    w('dist/favicon.png', solidPng(512, 512, 'owner-real-artwork'));
    w('dist/manifest.webmanifest', JSON.stringify({ icons: [{ src: '/favicon.png', sizes: '512x512', type: 'image/png' }] }));
    const result = run('verify', 'pwa');
    expect(result.code).toBe(0);
    expect(result.out).not.toContain('generic framework icon');
  });

  it.each(['/icons/owner.png?v=2', './icons/owner.png#brand', '/icons/owner.png?v=2#brand'])('verifies the file path, not the URL query or fragment: %s', (src) => {
    project();
    w('dist/icons/owner.png', solidPng(512, 512, 'owner-versioned-artwork'));
    w('dist/manifest.webmanifest', JSON.stringify({ icons: [{ src, sizes: '512x512', type: 'image/png' }] }));
    expect(run('verify', 'pwa').code).toBe(0);
  });

  it('two different generated apps receive DISTINCT branding', () => {
    const outputs: string[][] = [];
    for (const [name, id] of [['Chai Shop', 'com.shop.chai'], ['Quran Reader', 'com.quran.reader']]) {
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      defaultAndroid(); project({ declared: 'none', appName: name, appId: id }); prepareAndEnsure('android');
      outputs.push(['assets/icon.png', 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 'android/app/src/main/res/drawable/splash.png'].map((f) => sha(r(f))));
    }
    for (let i = 0; i < 3; i++) expect(outputs[0][i]).not.toBe(outputs[1][i]);
  });

  it('the same app always gets the same fallback (deterministic), so a rebuild never changes its look', () => {
    const hashes: string[] = [];
    for (let i = 0; i < 2; i++) { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); defaultAndroid(); project({ declared: 'none' }); prepareAndEnsure('android'); hashes.push(sha(r('assets/icon.png'))); }
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('signing, package id, bundle id and app config are left exactly as they were', () => {
    defaultAndroid(); defaultIos(); project({ declared: 'none' });
    const keep = ['android/app/build.gradle', 'capacitor.config.json', 'ios/App/App/Info.plist'];
    const before = keep.map((f) => sha(r(f)));
    prepareAndEnsure('android'); prepareAndEnsure('ios');
    expect(keep.map((f) => sha(r(f)))).toEqual(before);
    expect(r('android/app/src/main/AndroidManifest.xml').toString()).toContain('package="com.shop.chai"');
    expect(r('android/app/src/main/AndroidManifest.xml').toString()).toContain('android:label="Chai"');
  });
});

// ───────────────────────── the app's own mark, the splash and the web install icons ─────────────────────────
// Admin 2026-10-21: a chosen logo first; else a Lucide symbol fitting the name; else the first letter. Never Capacitor's.
describe('web install icons — what needs no image library (runs everywhere)', () => {
  const manifest = (icons: unknown[]) => JSON.stringify({ name: 'Chai', icons });
  it('an app with no web manifest is left alone, and the run says why', () => {
    project({ declared: 'none' }); run('prepare');
    const r = run('pwa-apply');
    expect(r.code).toBe(0); expect(r.out).toContain('no web manifest');
    expect(has('public/icons')).toBe(false);
  });
  it('without an image library the chosen logo cannot be resized: the manifest is left UNCHANGED and the run warns (never half-applied)', () => {
    project({ declared: 'user', icon: solidPng(1024, 1024, 'my-logo') });
    w('public/manifest.webmanifest', manifest([{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }]));
    run('prepare');
    const before = r('public/manifest.webmanifest').toString();
    const out = run('pwa-apply');
    expect(out.out).toContain('could not be made from your logo');
    expect(r('public/manifest.webmanifest').toString()).toBe(before);
  });
});

const SHARP_DIR = process.env.NBAI_TEST_SHARP_DIR || '';
/** Makes the runner's `.nbai-tools/node_modules/sharp` resolvable in the fixture (CI installs it; here it is linked from NBAI_TEST_SHARP_DIR). */
function withSharp() {
  fs.mkdirSync(path.join(dir, '.nbai-tools'), { recursive: true });
  fs.symlinkSync(path.join(SHARP_DIR, 'node_modules'), path.join(dir, '.nbai-tools', 'node_modules'), 'dir');
}
const pngInfo = (rel: string) => { const b = r(rel); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colourType: b[25] }; };

describe.skipIf(!SHARP_DIR)('the mark is drawn for real (needs the image library: set NBAI_TEST_SHARP_DIR)', () => {
  it('no logo chosen → source "mark": a 1024 opaque PNG, not an emergency, labelled with the symbol or letter', () => {
    defaultAndroid(); project({ declared: 'none', appName: 'Chai Shop' }); withSharp();
    const p = run('prepare');
    expect(p.code).toBe(0);
    expect(status().source).toBe('mark'); expect(status().reason).toBe(''); expect(status().mark).toBe('lucide:coffee');
    expect(pngInfo('assets/icon.png')).toEqual({ w: 1024, h: 1024, colourType: 2 }); // RGB: the App Store refuses an alpha icon
    expect(p.out).toContain('(lucide:coffee)');
  });
  it('the splash carries the mark on the brand colour (2732 square), and the status says so', () => {
    defaultAndroid(); project({ declared: 'none' }); withSharp(); run('prepare');
    expect(pngInfo('assets/splash.png')).toMatchObject({ w: 2732, h: 2732 });
    expect(status().splash).toBe('mark-on-brand-colour');
  });
  it('a name with no fitting symbol gets its first LETTER', () => {
    defaultAndroid(); project({ declared: 'none', appName: 'Pixelyt' }); withSharp(); run('prepare');
    expect(status().mark).toBe('letter:P'); expect(status().source).toBe('mark');
  });
  it('the chosen logo still wins over the mark', () => {
    defaultAndroid(); project({ declared: 'user', icon: solidPng(1024, 1024, 'my-logo'), appName: 'Chai Shop' }); withSharp(); run('prepare');
    expect(status().source).toBe('user');
    expect(sha(r('assets/icon.png'))).toBe(sha(solidPng(1024, 1024, 'my-logo')));
  });
  it('an unusable chosen logo falls back to the MARK (not to blocks), and says why', () => {
    defaultAndroid(); project({ declared: 'user', icon: solidPng(256, 256, 'tiny'), appName: 'Chai Shop' }); withSharp(); run('prepare');
    expect(status().source).toBe('mark'); expect(status().reason).toMatch(/smaller than the 512x512/);
  });
  it('the whole Android path with the mark: generator ok → verified, source stays "mark", Capacitor default gone', () => {
    defaultAndroid(); project({ declared: 'none' }); withSharp(); fakeGenerator('ok');
    const defaults = walk(path.join(dir, 'android')).filter((f) => /\.png$/.test(f)).map((f) => sha(fs.readFileSync(f)));
    run('snapshot', 'android'); run('prepare');
    expect(run('ensure', 'android').code).toBe(0); expect(run('verify', 'android').code).toBe(0);
    expect(status().source).toBe('mark');
    const after = new Set(walk(path.join(dir, 'android')).filter((f) => /\.png$/.test(f)).map((f) => sha(fs.readFileSync(f))));
    for (const d of defaults) expect(after.has(d)).toBe(false);
  });
  it('two different apps get two different icons; the same app always gets the same one', () => {
    const icons: string[] = [];
    for (const name of ['Chai Shop', 'Pixelyt', 'Chai Shop']) {
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      project({ declared: 'none', appName: name }); withSharp(); run('prepare'); icons.push(sha(r('assets/icon.png')));
    }
    expect(icons[0]).not.toBe(icons[1]); expect(icons[0]).toBe(icons[2]);
  });

  describe('pwa-apply with the image library', () => {
    const setup = (declared: 'user' | 'none', icons: unknown[], opts: { html?: string } = {}) => {
      project({ declared, icon: declared === 'user' ? solidPng(1024, 1024, 'my-logo') : undefined, appName: 'Chai Shop' }); withSharp();
      w('public/manifest.webmanifest', JSON.stringify({ name: 'Chai', icons }));
      w('index.html', opts.html ?? '<html><head><link rel="icon" href="/icon.svg"></head><body></body></html>');
      w('public/logo.png', solidPng(64, 64, 'the-apps-own-picture'));
      run('prepare');
    };
    const manifestIcons = () => JSON.parse(r('public/manifest.webmanifest').toString()).icons as Array<{ src: string; sizes: string; purpose?: string }>;
    it('the chosen logo becomes the install icons: 192, 512 and a maskable 512 of the right sizes', () => {
      setup('user', [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }]);
      expect(run('pwa-apply').code).toBe(0);
      expect(manifestIcons().map((i) => i.sizes)).toEqual(['192x192', '512x512', '512x512']);
      expect(manifestIcons()[2].purpose).toBe('maskable');
      expect(pngInfo('public/icons/nbai-192.png')).toMatchObject({ w: 192, h: 192 });
      expect(pngInfo('public/icons/nbai-512.png')).toMatchObject({ w: 512, h: 512 });
      expect(pngInfo('public/icons/nbai-maskable-512.png')).toMatchObject({ w: 512, h: 512 });
      expect(run('verify', 'pwa').code).toBe(0);
    });
    it('the page favicon follows, and an apple-touch-icon is added', () => {
      setup('user', [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }]);
      run('pwa-apply');
      const html = r('index.html').toString();
      expect(html).toContain('href="/icons/nbai-192.png"'); expect(html).toContain('apple-touch-icon');
      expect(html).not.toContain('href="/icon.svg"');
    });
    it.each(['/vite.svg', '/vite.svg?v=2', '/react.svg#logo'])('with NO logo chosen, replaces explicit framework icon %s', (src) => {
      setup('none', [{ src, sizes: 'any', type: 'image/svg+xml' }], { html: `<html><head><link rel="icon" href="${src}"></head><body></body></html>` });
      run('pwa-apply');
      expect(manifestIcons()[0].src).toBe('/icons/nbai-192.png');
      expect(r('index.html').toString()).not.toContain(src);
      expect(status().pwa).toContain("the app's own mark");
    });
    it('with NO logo chosen, an app\'s own real icons are LEFT ALONE', () => {
      setup('none', [{ src: '/logo.png', sizes: '64x64', type: 'image/png' }]);
      run('pwa-apply');
      expect(manifestIcons().map((i) => i.src)).toEqual(['/logo.png']);
    });
    it.each(['/favicon.png', 'favicon.png', './favicon.png', '/icons/favicon.png'])('without a chosen logo preserves real owner artwork named %s in the manifest and page', (src) => {
      setup('none', [{ src, sizes: '512x512', type: 'image/png' }], { html: `<html><head><link rel="icon" href="${src}"></head><body></body></html>` });
      const file = 'public/' + src.replace(/^\//, '');
      w(file, solidPng(512, 512, 'owner-real-artwork'));
      const before = sha(r(file));
      expect(run('pwa-apply').code).toBe(0);
      expect(manifestIcons().map((i) => i.src)).toEqual([src]);
      expect(r('index.html').toString()).toContain(`href="${src}"`);
      expect(sha(r(file))).toBe(before);
      expect(run('verify', 'pwa').code).toBe(0);
    });
    it('nothing of the owner\'s is overwritten or removed: their own picture is byte-identical afterwards', () => {
      setup('user', [{ src: '/logo.png', sizes: '64x64', type: 'image/png' }]);
      const before = sha(r('public/logo.png'));
      run('pwa-apply');
      expect(sha(r('public/logo.png'))).toBe(before);
    });
  });
});
