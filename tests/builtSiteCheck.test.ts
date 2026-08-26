import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
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

  it('counts FILES at any depth, so a nested real build counts and an empty shell does not', () => {
    const cmd = buildOutputCensusCommand(['dist']);
    expect(cmd).toContain('-type f');
    expect(cmd).toContain('wc -l');
    expect(cmd).toContain('NB_OUT=dist:');
    // Absent directories print nothing: absent and empty are different facts.
    expect(cmd).toContain('[ -d "dist" ]');
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
