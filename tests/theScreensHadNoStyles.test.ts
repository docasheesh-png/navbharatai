// AUTOPSY "Universal Remote" (2026-09-27): a build wrote eleven components using `app-shell`,
// `device-list`, `remote-header`… and not one CSS rule for them. tsc clean, preview "rendered",
// accessibility 100 — and the user's next message was "App made but not working", followed by a second
// paid build to have the styles written. Plus the smaller items the same report carried.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  findUndefinedClasses, cssConsistencyError, cssHealEnabled, undefinedClassesNote, isProjectStylesheet,
} from '../src/server/AgentV3/CssConsistency';
import { goldenBaseFiles } from '../src/server/AgentV3/goldenScaffolds/base';
import { userOwnedFileCount, workspaceHoldsUserApp, couldBeAppCode } from '../src/server/AgentV3/userProjectFiles';
import { isBinaryAsset } from '../src/server/AgentV3/fileClassification';
import { serverLaunchCommand, recordDevServerLaunch, lastDevServerLaunch, __resetDevServerLaunchLog } from '../src/server/AgentV3/devServerLaunchLog';
import { repeatedCommandNotice, commandKey, READ_LOOP_LIMIT } from '../src/server/AgentV3/repeatedReads';
import { globToRegExp } from '../src/server/AgentV3/ToolDispatcher';

const scaffoldCss = goldenBaseFiles('NavBharatAI App', '')['src/index.css'];
const components = {
  'src/App.tsx': '<div className="app-shell"><header className="remote-header" /><ul className="device-list" /><p className="signal-status" /></div>',
};

describe('1 · classes the stylesheet never defines are seen across the WHOLE project', () => {
  it('the reported shape: components written this turn, the scaffold stylesheet untouched', () => {
    expect(typeof scaffoldCss).toBe('string');
    const project = { 'src/index.css': scaffoldCss, ...components };
    expect(findUndefinedClasses(project)).toEqual(['app-shell', 'device-list', 'remote-header', 'signal-status']);
    expect(cssConsistencyError(project)).toMatch(/NOT defined in any CSS file/);
  });
  it('the old blind spot, kept as evidence: this turn\'s writes alone contain no CSS, so nothing was said', () => {
    expect(findUndefinedClasses(components)).toEqual([]);
  });
  it('a stylesheet that defines them is clean', () => {
    const css = `${scaffoldCss}\n.app-shell{}.remote-header{}.device-list{}.signal-status{}`;
    expect(cssConsistencyError({ 'src/index.css': css, ...components })).toBeNull();
  });
  it('scss and less define classes too', () => {
    expect(findUndefinedClasses({ 'src/app.scss': '.app-shell { .x {} } .remote-header{} .device-list{} .signal-status{}', ...components })).toEqual([]);
  });
  it('a CDN stylesheet we cannot read means we say nothing, never "missing"', () => {
    const html = '<link rel="stylesheet" href="https://cdn.example.com/theme.css">';
    expect(findUndefinedClasses({ 'index.html': html, 'src/index.css': scaffoldCss, ...components })).toEqual([]);
    expect(findUndefinedClasses({ 'src/index.css': `@import url("https://fonts.example/x.css");\n${scaffoldCss}`, ...components })).toEqual([]);
  });
  it('the project-stylesheet filter excludes dependencies and build output', () => {
    expect(isProjectStylesheet('src/index.css')).toBe(true);
    expect(isProjectStylesheet('./src/a.module.scss')).toBe(true);
    expect(isProjectStylesheet('node_modules/x/y.css')).toBe(false);
    expect(isProjectStylesheet('dist/assets/index-Bk.css')).toBe(false);
    expect(isProjectStylesheet('src/App.tsx')).toBe(false);
  });
  it('the admin line names the classes; the repair is on by default and has a kill switch', () => {
    expect(undefinedClassesNote(['app-shell', 'device-list'])).toMatch(/2 class name\(s\).*\.app-shell, \.device-list/);
    expect(cssHealEnabled({})).toBe(true);
    expect(cssHealEnabled({ AGENTV3_CSS_HEAL: 'off' })).toBe(false);
  });
});

describe('2 · a .gitignore and an empty .apk are not "your existing app"', () => {
  it('the reported workspace counts as no app of the user\'s own', () => {
    expect(userOwnedFileCount(['.gitignore', 'Minecraft.apk'])).toBe(0);
    expect(workspaceHoldsUserApp(['.gitignore', 'Minecraft.apk'])).toBe(false);
  });
  it('real app code still counts, and an unreadable listing still means "yes"', () => {
    expect(userOwnedFileCount(['.gitignore', 'src/pages/Home.tsx'])).toBe(1);
    expect(workspaceHoldsUserApp(null)).toBe(true);
  });
  it('binary packages, git internals, dependencies and build output are never app code', () => {
    for (const p of ['app.apk', 'x.aab', 'x.ipa', 'LICENSE', '.gitattributes', '.git/config', 'node_modules/a/b.js', 'dist/index.html']) {
      expect(couldBeAppCode(p)).toBe(false);
    }
    expect(isBinaryAsset('Minecraft.apk')).toBe(true);
    expect(couldBeAppCode('README.md')).toBe(true);
  });
});

describe('3 · the stored preview command is the server, not the model\'s whole line', () => {
  it('the reported line keeps only the dev server, without the pipe into head', () => {
    expect(serverLaunchCommand(': > /tmp/empty.css && echo done && npm run dev -- --host 0.0.0.0 --port 5173 2>&1 | head -40'))
      .toBe('npm run dev -- --host 0.0.0.0 --port 5173');
  });
  it('environment set-up is kept; a build is not a server; an unrecognised command is kept as it was', () => {
    expect(serverLaunchCommand('cd app && export PORT=3000 && npm start')).toBe('cd app && export PORT=3000 && npm start');
    expect(serverLaunchCommand('vite build && vite preview --port 4173')).toBe('vite preview --port 4173');
    expect(serverLaunchCommand('./run-my-thing.sh')).toBe('./run-my-thing.sh');
  });
  it('a server backgrounded with & and a probe on the next line (build 75ea6136) keeps only the server', () => {
    expect(serverLaunchCommand("npm run dev -- --host 0.0.0.0 --port 5173 2>&1 | head -20 &\nsleep 4 && node -e 'probe'"))
      .toBe('npm run dev -- --host 0.0.0.0 --port 5173');
    expect(serverLaunchCommand('npm run dev -- --port 5173 --host 2>&1 &\nsleep 3\necho "dev server started"'))
      .toBe('npm run dev -- --port 5173 --host');
  });
  it('the one door that records a launch cleans it', () => {
    __resetDevServerLaunchLog();
    recordDevServerLaunch('ws', 'echo hi && npm run dev | tail -5', 5173);
    expect(lastDevServerLaunch('ws')?.command).toBe('npm run dev');
  });
});

describe('4 · the same shell command, again, with nothing changed', () => {
  it('advice escalates to a stop at the read breaker\'s own threshold', () => {
    expect(repeatedCommandNotice(READ_LOOP_LIMIT - 1)).toBe('');
    expect(repeatedCommandNotice(READ_LOOP_LIMIT)).toMatch(/^\[STOP — you have run this exact command/);
    expect(commandKey('  wc  -l   x ')).toBe('wc -l x');
  });
  it('is wired into the bash tool, before the output reaches the model', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    expect(src).toMatch(/const notice = repeatedCommandNotice\(stalled\);[\s\S]{0,120}out = `\$\{notice\}\$\{out\}`/);
    expect(src).toMatch(/prior\.writeSeq === this\._writeSeq/);
  });
});

describe('5 · a glob with braces finds files', () => {
  it('the reviewer\'s own pattern', () => {
    expect(globToRegExp('src/**/*.{ts,tsx,css}').test('src/components/DeviceList.tsx')).toBe(true);
    expect(globToRegExp('**/*.{ts,tsx,js,jsx,css,html,json}').test('index.html')).toBe(true);
    expect(globToRegExp('**/*.{ts,tsx}').test('src/a.css')).toBe(false);
    expect(globToRegExp('a{b').test('a{b')).toBe(true);
  });
});

describe('6 · the wiring (source guards — tsc cannot see which lane runs a check)', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  it('the architect lane checks the WHOLE project and repairs a real mismatch', () => {
    expect(route).toMatch(/const projectForCss = \{ \.\.\.integrityFiles, \.\.\.designFiles \};/);
    expect(route).toMatch(/code: 'CSS_CLASSES_UNDEFINED'/);
    expect(route).toMatch(/if \(designRepair \|\| cssRepair\)/);
    expect(route).toMatch(/CSS_CLASSES_HEALED/);
  });
  it('the fast lane reads the project\'s stylesheets, not only this turn\'s writes', () => {
    expect(route).toMatch(/filter\(isProjectStylesheet\)[\s\S]{0,300}cssConsistencyError\(\{ \.\.\.sheets, \.\.\.written \}\)/);
  });
});
