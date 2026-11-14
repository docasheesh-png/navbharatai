// A BUILD SCRIPT THAT ONLY PRINTS IS A STATIC APP (single-file game autopsy, 2026-11-14).
// After the preview fix wrote a static-runner package.json for the admin's one-page game, the APK build ended
// "The build stopped without leaving a reason": `detectProjectKind` compared the build script with ONE exact sentence, so the
// `echo "Static site — no build step needed"` of the static template and of the static-site foundation read as `built` and the
// assembler packaged a `dist/` that nothing produces. Same class as 2026-09-22 (a classifier must recognise its own hand).
import { describe, it, expect } from 'vitest';
import { detectProjectKind, detectWebDir, isNoOpBuildScript, assembleMobileProject, buildPackageJson } from '../src/server/lib/mobileProjectAssembler';
import { ensureStaticSiteFoundation } from '../src/server/AgentV3/FrameworkFoundation';
import { StaticProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/StaticProvider';

const PAGE = '<!doctype html><html><body><canvas></canvas><script>var a=1;</script></body></html>';

describe('every package.json OUR code writes for a static site reads back as static', () => {
  it('the static-site foundation (what the preview boot writes for a one-page project)', () => {
    const pkg = ensureStaticSiteFoundation({ 'index.html': PAGE }).files['package.json'];
    expect(detectProjectKind({ 'package.json': pkg })).toBe('static');
  });
  it('the static template', () => {
    const pkg = new StaticProvider().getFiles([])['package.json'];
    expect(detectProjectKind({ 'package.json': pkg })).toBe('static');
  });
  it('the assembler\'s own output (the 2026-09-22 case still holds)', () => {
    expect(detectProjectKind({ 'package.json': buildPackageJson(undefined, 'A', 'static') })).toBe('static');
  });
});

describe('isNoOpBuildScript', () => {
  it('a lone echo is a no-op', () => {
    for (const b of ['echo done', 'echo "Static site — no build step needed"', "echo 'nothing to build'", 'echo']) expect(isNoOpBuildScript(b), b).toBe(true);
  });
  it('anything real is not — including an echo that chains a real command', () => {
    for (const b of ['vite build', 'tsc && vite build', 'echo start && vite build', 'echo x; npm run bundle', 'echo x | tee y', 'echo $(vite build)', 'next build', '', 'node build.js']) expect(isNoOpBuildScript(b), b).toBe(false);
  });
});

describe('what that means for the APK', () => {
  const pkg = ensureStaticSiteFoundation({ 'index.html': PAGE }).files['package.json'];
  it('the web folder is www, never dist', () => {
    expect(detectWebDir({ 'package.json': pkg, 'index.html': PAGE }, detectProjectKind({ 'package.json': pkg }))).toBe('www');
  });
  it('a real build script is still `built`', () => {
    expect(detectProjectKind({ 'package.json': '{"scripts":{"build":"vite build"}}' })).toBe('built');
  });
  it('assembling the game as the preview boot left it: the page and its media land under www/, no dist/ build is announced', () => {
    const r = assembleMobileProject(
      { 'index.html': PAGE, 'package.json': pkg },
      {},
      { appName: 'Studio Walk', appId: 'com.example.studiowalk', appAssets: { 'assets/media/video-1.mp4': 'data:video/mp4;base64,AAAA', 'assets/media/image-1.png': 'data:image/png;base64,AAAA' } },
    );
    expect(r.kind).toBe('static');
    expect(r.webDir).toBe('www');
    expect(Object.keys(r.files)).toContain('www/index.html');
    expect(r.notes.join(' ')).not.toMatch(/npm run build/);
    expect(Object.keys(r.binaryFiles)).toEqual(expect.arrayContaining(['www/assets/media/video-1.mp4', 'www/assets/media/image-1.png']));
  });
});
