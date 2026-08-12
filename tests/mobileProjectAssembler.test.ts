import { describe, it, expect } from 'vitest';
import {
  assembleMobileProject, detectProjectKind, detectWebDir, normaliseAppId,
  buildPackageJson, buildCapacitorConfig, parseImageDataUrl, capacitorMajorFromFiles,
} from '../src/server/lib/mobileProjectAssembler';

// This is what stands between "we pushed some files to GitHub" and "GitHub produced a real signed
// .aab". The generated workflow runs `npm ci || npm install` then `npm run build` then `npx cap sync`
// — so every one of those has to be genuinely satisfiable by what we push. The static-app case below
// is the one the old ship kit failed on outright: no package.json meant `npm run build` could not
// even start.

const SHIP_KIT = {
  '.github/workflows/android-aab.yml': 'name: Build Android App Bundle\n',
  'SHIPPING.md': '# How to publish\n',
  'capacitor.config.ts': 'const config = { webDir: "dist" };', // the kit's guess, must be overridden
};

const STATIC_APP = {
  'index.html': '<html><body><h1>Hi</h1></body></html>',
  'style.css': 'body{margin:0}',
  'app.js': 'console.log(1)',
};

const VITE_APP = {
  'package.json': JSON.stringify({ name: 'my-app', scripts: { build: 'vite build', dev: 'vite' }, dependencies: { react: '^19' } }),
  'index.html': '<html><body><div id="root"></div></body></html>',
  'src/main.tsx': 'render()',
  'vite.config.ts': 'export default { build: { outDir: "dist" } }',
};

describe('detectProjectKind — only a real build script counts', () => {
  it('a plain HTML app is static', () => {
    expect(detectProjectKind(STATIC_APP)).toBe('static');
  });

  it('a project with a build script builds itself', () => {
    expect(detectProjectKind(VITE_APP)).toBe('built');
  });

  it('a package.json with no build script is static, not "built and broken"', () => {
    expect(detectProjectKind({ 'package.json': '{"name":"x"}' })).toBe('static');
  });

  it('an unparseable package.json falls back to static rather than failing on the runner', () => {
    expect(detectProjectKind({ 'package.json': '{ this is not json' })).toBe('static');
  });
});

describe('detectWebDir', () => {
  it('a static app is served from www', () => {
    expect(detectWebDir(STATIC_APP, 'static')).toBe('www');
  });

  it('a built app defaults to dist', () => {
    expect(detectWebDir({}, 'built')).toBe('dist');
  });

  it('respects a custom outDir the project actually configured', () => {
    const files = { 'vite.config.ts': 'export default { build: { outDir: "public/out" } }' };
    expect(detectWebDir(files, 'built')).toBe('public/out');
  });
});

describe('normaliseAppId — Android rejects anything that is not reverse-domain', () => {
  it('keeps a valid id EXACTLY as typed — this id is the app’s permanent Play Store identity, and\n'
     + '     two ids differing by one letter are two different apps', () => {
    expect(normaliseAppId('com.acme.shop', 'Shop')).toBe('com.acme.shop');
    // Capitals are legal in a Java package name; silently lowercasing would change which app this is.
    expect(normaliseAppId('com.Acme.Shop', 'Shop')).toBe('com.Acme.Shop');
    expect(normaliseAppId('  com.acme.shop  ', 'Shop')).toBe('com.acme.shop');
  });

  it('replaces only ids Android would genuinely reject, deriving one from the app name', () => {
    for (const bad of ['', 'myapp', '1com.acme.x', 'com..x', 'com.acme.', 'com.acme shop', 'com.acme-shop']) {
      expect(normaliseAppId(bad, 'Chai Point'), bad).toBe('com.navbharat.chaipoint');
    }
  });

  it('repairs a lowercase Java reserved-word segment in place — the ship path, G8', () => {
    // com.new.shop is well-formed reverse-DNS but "new" is a Java keyword → cap add / AGP rejects it.
    expect(normaliseAppId('com.new.shop', 'Shop')).toBe('com.newx.shop');
    expect(normaliseAppId('com.acme.class', 'Shop')).toBe('com.acme.classx');
    // case-sensitive: "New" is a legal Java identifier (only lowercase "new" is reserved) — left as typed
    expect(normaliseAppId('com.New.Shop', 'Shop')).toBe('com.New.Shop');
    // a derived id can never carry a reserved segment either
    expect(normaliseAppId('', 'New')).toBe('com.navbharat.newx');
  });
});

describe('buildPackageJson', () => {
  it('gives a static app a build script that succeeds and does nothing', () => {
    const pkg = JSON.parse(buildPackageJson(undefined, 'My App', 'static'));
    expect(pkg.scripts.build).toBeTruthy();
    expect(pkg.dependencies['@capacitor/core']).toBeTruthy();
    expect(pkg.devDependencies['@capacitor/cli']).toBeTruthy();
    expect(pkg.name).toBe('my-app');
  });

  it('MERGES into an existing package.json instead of replacing the user’s own build', () => {
    const pkg = JSON.parse(buildPackageJson(VITE_APP['package.json'], 'My App', 'built'));
    expect(pkg.scripts.build).toBe('vite build');   // untouched — replacing it would break their build
    expect(pkg.scripts.dev).toBe('vite');
    expect(pkg.dependencies.react).toBe('^19');
    expect(pkg.dependencies['@capacitor/core']).toBeTruthy();
  });

  it('never downgrades a Capacitor version the project already pins', () => {
    const existing = JSON.stringify({ dependencies: { '@capacitor/core': '^8.4.1' } });
    const pkg = JSON.parse(buildPackageJson(existing, 'X', 'built'));
    expect(pkg.dependencies['@capacitor/core']).toBe('^8.4.1');
  });

  it('reads the Capacitor major an app is built around, from its package.json (G2)', () => {
    expect(capacitorMajorFromFiles({ 'package.json': JSON.stringify({ dependencies: { '@capacitor/core': '^7.1.0' } }) })).toBe(7);
    // devDependencies count too, and core wins over a lagging plugin
    expect(capacitorMajorFromFiles({ 'package.json': JSON.stringify({ devDependencies: { '@capacitor/cli': '^6.2.0' } }) })).toBe(6);
    expect(capacitorMajorFromFiles({ 'package.json': JSON.stringify({ dependencies: { '@capacitor/core': '^8.0.0', '@capacitor/haptics': '^7.0.0' } }) })).toBe(8);
  });

  it('expresses NO preference (null) when the app declares no Capacitor or the file is missing/corrupt', () => {
    expect(capacitorMajorFromFiles({ 'package.json': JSON.stringify({ dependencies: { react: '^19' } }) })).toBeNull();
    expect(capacitorMajorFromFiles({})).toBeNull();
    expect(capacitorMajorFromFiles({ 'package.json': '{ not json' })).toBeNull();
  });

  it('survives a corrupt package.json rather than throwing', () => {
    expect(() => buildPackageJson('{ broken', 'X', 'static')).not.toThrow();
  });
});

describe('assembleMobileProject — a static app', () => {
  const out = assembleMobileProject(STATIC_APP, SHIP_KIT, { appName: 'My App', appId: 'com.me.myapp' });

  it('puts the web files where Capacitor will look for them', () => {
    expect(out.kind).toBe('static');
    expect(out.webDir).toBe('www');
    expect(out.files['www/index.html']).toContain('<h1>Hi</h1>');
    expect(out.files['www/style.css']).toBeTruthy();
  });

  it('ships a package.json so `npm run build` can run at all — the old kit had none', () => {
    expect(out.files['package.json']).toBeTruthy();
    expect(JSON.parse(out.files['package.json']).scripts.build).toBeTruthy();
  });

  it('points capacitor.config.ts at www, overriding the ship kit’s guess of dist', () => {
    expect(out.files['capacitor.config.ts']).toContain("webDir: 'www'");
    expect(out.files['capacitor.config.ts']).not.toContain('"dist"');
  });

  it('keeps the build workflow and the publishing guide', () => {
    expect(out.files['.github/workflows/android-aab.yml']).toBeTruthy();
    expect(out.files['SHIPPING.md']).toBeTruthy();
  });

  it('does not commit node_modules or a stale dist', () => {
    const withJunk = { ...STATIC_APP, 'node_modules/react/index.js': 'x', 'dist/old.js': 'y', '.git/config': 'z' };
    const r = assembleMobileProject(withJunk, SHIP_KIT, { appName: 'A', appId: 'com.a.b' });
    expect(Object.keys(r.files).some((p) => p.includes('node_modules'))).toBe(false);
    expect(Object.keys(r.files).some((p) => p.includes('dist/old.js'))).toBe(false);
    expect(Object.keys(r.files).some((p) => p.includes('.git/'))).toBe(false);
  });

  it('says so when there is no index.html, instead of shipping a blank app silently', () => {
    const r = assembleMobileProject({ 'style.css': 'a{}' }, SHIP_KIT, { appName: 'A', appId: 'com.a.b' });
    expect(r.notes.join(' ')).toMatch(/index\.html/i);
  });
});

describe('assembleMobileProject — a project that builds itself', () => {
  const out = assembleMobileProject(VITE_APP, SHIP_KIT, { appName: 'My App', appId: 'com.me.myapp' });

  it('keeps the project layout instead of burying it in www/', () => {
    expect(out.kind).toBe('built');
    expect(out.files['src/main.tsx']).toBeTruthy();
    expect(out.files['www/index.html']).toBeUndefined();
  });

  it('packages the build output', () => {
    expect(out.webDir).toBe('dist');
    expect(out.files['capacitor.config.ts']).toContain("webDir: 'dist'");
  });

  it('leaves the user’s own build command alone', () => {
    expect(JSON.parse(out.files['package.json']).scripts.build).toBe('vite build');
  });
});

describe('the icon', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

  it('is carried through as real bytes, not text', () => {
    const out = assembleMobileProject(STATIC_APP, SHIP_KIT, { appName: 'A', appId: 'com.a.b', iconDataUrl: PNG });
    expect(out.binaryFiles['resources/icon.png']).toBe('iVBORw0KGgoAAAANSUhEUg==');
    expect(out.notes.join(' ')).toMatch(/icon/i);
  });

  it('says the default will be used rather than failing, when the icon is unreadable', () => {
    const out = assembleMobileProject(STATIC_APP, SHIP_KIT, { appName: 'A', appId: 'com.a.b', iconDataUrl: 'not-an-image' });
    expect(Object.keys(out.binaryFiles)).toHaveLength(0);
    expect(out.notes.join(' ')).toMatch(/default icon/i);
  });

  it('parseImageDataUrl accepts real images and refuses anything else', () => {
    expect(parseImageDataUrl(PNG)?.ext).toBe('png');
    expect(parseImageDataUrl('data:image/jpeg;base64,/9j/4AA=')?.ext).toBe('jpg');
    expect(parseImageDataUrl('data:text/html;base64,PGh0bWw+')).toBeNull();
    expect(parseImageDataUrl('https://example.com/x.png')).toBeNull();
    expect(parseImageDataUrl('data:image/png;base64,')).toBeNull();
  });
});

describe('buildCapacitorConfig', () => {
  it('quotes a name containing an apostrophe safely', () => {
    const cfg = buildCapacitorConfig('com.a.b', "Ravi's Shop", 'www');
    expect(cfg).toContain('"Ravi\'s Shop"');
    expect(cfg).toContain("appId: 'com.a.b'");
  });

  it('injects a validated background colour into the android + splash config', () => {
    const cfg = buildCapacitorConfig('com.a.b', 'Shop', 'dist', '#6366F1');
    expect(cfg).toContain("android: { backgroundColor: '#6366f1' }"); // canonical lowercase
    expect(cfg).toContain("SplashScreen: { backgroundColor: '#6366f1' }");
  });

  it('expands a 3-digit hex and accepts a hash-less colour', () => {
    expect(buildCapacitorConfig('com.a.b', 'Shop', 'dist', 'f0a')).toContain("backgroundColor: '#ff00aa'");
    expect(buildCapacitorConfig('com.a.b', 'Shop', 'dist', '00ff88')).toContain("backgroundColor: '#00ff88'");
  });

  it('DROPS anything that is not a hex colour — never interpolates raw input (injection guard)', () => {
    for (const bad of ['red', "'; process.exit(1); //", 'rgb(1,2,3)', '#12', '#zzzzzz', '']) {
      const cfg = buildCapacitorConfig('com.a.b', 'Shop', 'dist', bad);
      expect(cfg).not.toContain('backgroundColor');
      // byte-identical to the no-colour config
      expect(cfg).toBe(buildCapacitorConfig('com.a.b', 'Shop', 'dist'));
    }
  });

  it('is byte-identical to before when no colour is supplied', () => {
    const cfg = buildCapacitorConfig('com.a.b', 'Shop', 'dist');
    expect(cfg).not.toContain('android:');
    expect(cfg).toContain("webDir: 'dist'");
  });
});
