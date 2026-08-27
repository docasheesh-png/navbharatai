import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import {
  BUILD_OUTPUT_DIRS,
  buildOutputCandidates,
  buildOutputCensusCommand,
  readBuildOutputCensus,
  builtSiteRefusal,
  configDumpCommand,
  parseConfigDump,
  isNextWithoutStaticExport,
} from '../src/server/AgentV3/builtSiteCheck';

const ROOT = join(__dirname, '..');

describe('the census answers "is there a site", not "is there a folder"', () => {
  it('THE REPORTED FAILURE: a dist/ that exists but holds nothing is refused, with its own message', () => {
    // The old gate ran `ls -d dist` and passed this exact state, so the publish failed two steps later
    // with the vendor's raw "dist/ and out/ are empty or do not exist".
    const v = readBuildOutputCensus('NB_OUT=dist:0\n');
    expect(v.ok).toBe(false);
    expect(v.emptyDirs).toEqual(['dist']);

    const refusal = builtSiteRefusal(v, '');
    expect(refusal).not.toBeNull();
    // The user must be able to tell "empty folder" from "no folder" — different cause, different fix.
    expect(refusal!.error).toMatch(/empty/i);
    expect(refusal!.detail).toMatch(/earlier version of this app|did not finish writing/i);
  });

  it('a directory with files passes and names itself', () => {
    const v = readBuildOutputCensus('NB_OUT=dist:0\nNB_OUT=build:37\n');
    expect(v).toMatchObject({ ok: true, dir: 'build', files: 37 });
    expect(builtSiteRefusal(v, 'anything')).toBeNull();
  });

  it('no directory at all is still refused, and still says which were checked', () => {
    const v = readBuildOutputCensus('');
    expect(v.ok).toBe(false);
    expect(v.emptyDirs).toEqual([]);
    const refusal = builtSiteRefusal(v, 'vite v5 building...', { checked: ['dist', 'out'] });
    expect(refusal!.detail).toContain('dist/');
    expect(refusal!.detail).toContain('out/');
    // The build's own words travel with it — that is what made the last three reports diagnosable.
    expect(refusal!.detail).toContain('vite v5 building...');
  });

  it('FAILS OPEN on output it cannot parse — this gate may only ever refuse, so confusion must not block', () => {
    for (const junk of ['bash: find: command not found', 'NB_OUT=malformed', 'binary']) {
      expect(readBuildOutputCensus(junk).ok).toBe(true);
    }
    // ...but BLANK is not confusion: it is the command's real answer that no candidate dir exists.
    expect(readBuildOutputCensus('').ok).toBe(false);
    expect(readBuildOutputCensus('   \n ').ok).toBe(false);
  });

  it('END TO END: the command really runs, and the parser really reads what it prints', () => {
    // String-matching the command proves nothing about what a SHELL does with it — that is exactly how
    // the quoting hole below survived being written. So this executes the real command in a real
    // directory and feeds its real stdout to the real parser. A quoting mistake fails here.
    const dir = mkdtempSync(join(tmpdir(), 'nbcensus-'));
    try {
      mkdirSync(join(dir, 'dist', 'assets'), { recursive: true });     // a real build nests
      writeFileSync(join(dir, 'dist', 'index.html'), '<html></html>');
      writeFileSync(join(dir, 'dist', 'assets', 'app.js'), 'x');
      writeFileSync(join(dir, 'dist', 'assets', '.hidden'), 'x');       // hidden files ship too
      mkdirSync(join(dir, 'out'));                                      // exists, holds nothing
      const stdout = execFileSync('bash', ['-c', buildOutputCensusCommand(['dist', 'out', 'build'])], { cwd: dir }).toString();

      const v = readBuildOutputCensus(stdout);
      expect(v).toMatchObject({ ok: true, dir: 'dist', files: 3 });     // nested + hidden counted
      // 'out' exists and is empty; 'build' does not exist and printed nothing at all.
      expect(stdout).toContain('NB_OUT=out:0');
      expect(stdout).not.toContain('NB_OUT=build');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('END TO END: an empty dist/ produces exactly the reported failure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nbcensus-'));
    try {
      mkdirSync(join(dir, 'dist'));   // the leftover from a previous app in a reused workspace
      const stdout = execFileSync('bash', ['-c', buildOutputCensusCommand(['dist', 'out'])], { cwd: dir }).toString();
      const v = readBuildOutputCensus(stdout);
      expect(v.ok).toBe(false);
      expect(v.emptyDirs).toContain('dist');
      expect(builtSiteRefusal(v, '')!.error).toMatch(/empty/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('both sides of the publish search the SAME list', () => {
  it('never includes .next — a Next.js server build is not a static site', () => {
    // Including it is what made the old gate confirm a site existed for the one case where it did not.
    expect(BUILD_OUTPUT_DIRS as readonly string[]).not.toContain('.next');
    expect(buildOutputCandidates({})).not.toContain('.next');
  });

  it('with nothing readable, the candidates are exactly the safe defaults', () => {
    expect(buildOutputCandidates({})).toEqual([...BUILD_OUTPUT_DIRS]);
  });

  it.each([
    ['Create React App', { 'package.json': JSON.stringify({ dependencies: { 'react-scripts': '5' }, scripts: { build: 'react-scripts build' } }) }, 'build'],
    ['SvelteKit', { 'package.json': JSON.stringify({ devDependencies: { '@sveltejs/kit': '2' } }) }, 'build'],
    ['Nuxt', { 'package.json': JSON.stringify({ dependencies: { nuxt: '3' }, scripts: { build: 'nuxt generate' } }) }, '.output/public'],
    ['Remix', { 'package.json': JSON.stringify({ dependencies: { '@remix-run/react': '2' } }) }, 'build/client'],
  ])('%s is searched where it really builds, and FIRST', (_name, files, expected) => {
    const candidates = buildOutputCandidates(files as Record<string, string>);
    expect(candidates[0]).toBe(expected);
  });

  it('Angular is searched at its NESTED path before dist/ — dist/ holds server bundles with no index.html', () => {
    const candidates = buildOutputCandidates({
      'package.json': JSON.stringify({ dependencies: { '@angular/core': '18' }, scripts: { build: 'ng build' } }),
      'angular.json': JSON.stringify({ projects: { app: { architect: { build: { options: { outputPath: 'dist/app' } } } } } }),
    });
    expect(candidates[0]).toBe('dist/app/browser');
    expect(candidates.indexOf('dist/app/browser')).toBeLessThan(candidates.indexOf('dist'));
  });

  it('SECURITY: a hostile outDir cannot execute a command', () => {
    // I WROTE THIS HOLE AND FOUND IT BY RE-READING, NOT BY A TEST (2026-08-27). The first version used
    // JSON.stringify, which emits DOUBLE quotes — and a POSIX shell still expands $(…) and backticks
    // inside those. outDir comes from the user's own vite.config.ts, so `outDir: '$(cmd)'` ran cmd in
    // their sandbox during publish. Single quotes make every byte literal; this test is the proof.
    const evil = "$(id > /tmp/pwned)`whoami`;rm -rf /";
    const cmd = buildOutputCensusCommand([evil, 'dist']);
    expect(cmd).not.toContain('"');                 // no double-quoted interpolation anywhere
    // The dangerous text survives ONLY inside single quotes, where the shell cannot act on it.
    for (const piece of ['$(id', '`whoami`', 'rm -rf /']) {
      expect(cmd).toContain(piece);                 // it is passed through…
      const before = cmd.slice(0, cmd.indexOf(piece));
      expect((before.match(/'/g) || []).length % 2).toBe(1); // …and always inside an open quote
    }
  });

  it('SECURITY: the config dump is quoted the same way', () => {
    const cmd = configDumpCommand(['$(id)pkg.json']);
    expect(cmd).not.toContain('"');
  });

  it('a hostile outDir cannot escape the workspace', () => {
    const candidates = buildOutputCandidates({ 'vite.config.ts': "export default { build: { outDir: '../../etc' } }" });
    expect(candidates.some((c) => c.includes('..'))).toBe(false);
    expect(candidates.some((c) => c.startsWith('/'))).toBe(false);
  });
});

describe('a Next.js app with no static export gets the truth, not "you built nothing"', () => {
  const nextNoExport = { 'package.json': JSON.stringify({ dependencies: { next: '14' }, scripts: { build: 'next build' } }) };

  it('is recognised', () => {
    expect(isNextWithoutStaticExport(nextNoExport)).toBe(true);
    expect(isNextWithoutStaticExport({
      ...nextNoExport,
      'next.config.js': "module.exports = { output: 'export' }",
    })).toBe(false);
    expect(isNextWithoutStaticExport({ 'package.json': JSON.stringify({ dependencies: { vite: '5' } }) })).toBe(false);
  });

  it('is told what to change instead of being told its build produced nothing', () => {
    const refusal = builtSiteRefusal(readBuildOutputCensus(''), '', { files: nextNoExport });
    expect(refusal!.error).toMatch(/run on a server/i);
    expect(refusal!.detail).toContain("output: 'export'");
  });

  it('says NOTHING about frameworks when the build really did produce a site', () => {
    expect(builtSiteRefusal(readBuildOutputCensus('NB_OUT=out:12'), '', { files: nextNoExport })).toBeNull();
  });
});

describe('the config dump: one round trip, forgiving by design', () => {
  it('round-trips a file through the marker protocol', () => {
    const pkg = JSON.stringify({ name: 'x', dependencies: { vite: '5' } });
    const parsed = parseConfigDump(`@@NBCFG@@package.json\n${pkg}\n`);
    expect(parsed['package.json']).toBe(pkg);
  });

  it('ignores noise before the first marker (a shell banner is not a config file)', () => {
    const parsed = parseConfigDump(`Picked up JAVA_TOOL_OPTIONS\n@@NBCFG@@package.json\n{}\n`);
    expect(Object.keys(parsed)).toEqual(['package.json']);
  });

  it('asks for the files that decide the answer, and only small ones', () => {
    const cmd = configDumpCommand();
    for (const f of ['package.json', 'angular.json', 'vite.config.ts', 'next.config.js']) expect(cmd).toContain(f);
    expect(cmd).not.toContain('node_modules');
  });
});

describe('the wiring — because a correct module that nothing calls fixes nothing', () => {
  it('the publish route no longer proves a folder EXISTS with ls -d', () => {
    const route = readFileSync(join(ROOT, 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).not.toContain("ls -d dist out build .output .next");
    expect(route).toContain('buildOutputCensusCommand(outCandidates)');
    expect(route).toContain('builtSiteRefusal(');
  });

  it('the UPLOAD searches the same candidates the gate did', () => {
    const actuator = readFileSync(join(ROOT, 'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8');
    expect(actuator).toContain('buildOutputCandidates(projectFiles)');
    // The two hardcoded paths are what made the gate and the upload disagree.
    expect(actuator).not.toContain('JSON.stringify([distPath, outPath])');
  });
});
