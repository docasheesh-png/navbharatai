/**
 * One derivation of "how does this project start", so three copies can never disagree again.
 *
 * The drift that motivated this was real: an app whose only script is `preview` got `npm run dev` from
 * the ToolDispatcher copy and the right answer from the WorkspaceLauncher copy — the same project
 * starting in one code path and failing in another.
 */

import { describe, it, expect } from 'vitest';
import { pickDevScript, devPortFlags, devServerCommand, parsePackageJson } from '../src/server/AgentV3/devScript';

describe('pickDevScript', () => {
  it('prefers dev, then start, then preview', () => {
    expect(pickDevScript({ dev: 'vite', start: 'node .', preview: 'vite preview' })).toBe('dev');
    expect(pickDevScript({ start: 'node .', preview: 'vite preview' })).toBe('start');
    expect(pickDevScript({ preview: 'vite preview' })).toBe('preview');
  });

  it('🔒 the drift case: a preview-only project is NOT told to run dev', () => {
    // This is the exact disagreement that made centralising worth doing.
    expect(pickDevScript({ preview: 'vite preview' })).not.toBe('dev');
  });

  it('falls back to start rather than refusing, and survives junk', () => {
    expect(pickDevScript({})).toBe('start');
    expect(pickDevScript(undefined)).toBe('start');
    expect(pickDevScript(null)).toBe('start');
    expect(pickDevScript({ dev: 42 } as never)).toBe('start');
  });
});

describe('devPortFlags', () => {
  it('pins Vite with --port/--host', () => {
    expect(devPortFlags({ devDependencies: { vite: '^5' }, scripts: { dev: 'vite' } }, 'dev', 5310))
      .toEqual(['--port', '5310', '--host', '0.0.0.0']);
  });

  it('pins Next with -p/-H', () => {
    expect(devPortFlags({ dependencies: { next: '14' }, scripts: { dev: 'next dev' } }, 'dev', 5310))
      .toEqual(['-p', '5310', '-H', '0.0.0.0']);
  });

  it('detects the framework from the script body when it is not a dependency', () => {
    expect(devPortFlags({ scripts: { dev: 'npx vite --open' } }, 'dev', 5311)).toContain('--port');
  });

  it('returns nothing for frameworks with no such flag — those honour PORT instead', () => {
    expect(devPortFlags({ dependencies: { express: '4' }, scripts: { start: 'node server.js' } }, 'start', 5310)).toEqual([]);
  });

  it('refuses a nonsense port instead of emitting a broken flag', () => {
    expect(devPortFlags({ devDependencies: { vite: '^5' } }, 'dev', 0)).toEqual([]);
    expect(devPortFlags({ devDependencies: { vite: '^5' } }, 'dev', -1)).toEqual([]);
    expect(devPortFlags({ devDependencies: { vite: '^5' } }, 'dev', 1.5)).toEqual([]);
  });

  it('survives a package.json with nothing in it', () => {
    expect(devPortFlags(null, 'dev', 5310)).toEqual([]);
    expect(devPortFlags(undefined, 'dev', 5310)).toEqual([]);
  });
});

describe('devServerCommand', () => {
  it('🔒 passes flags past npm with --, or they configure npm instead of the framework', () => {
    const cmd = devServerCommand({ devDependencies: { vite: '^5' }, scripts: { dev: 'vite' } }, 5310);
    expect(cmd).toContain('npm run dev -- --port 5310 --host 0.0.0.0');
  });

  it('🔒 sets PORT as well as the flags, never instead of them', () => {
    // Vite and Next ignore PORT — that is how a preview ends up aimed at a dead port. Frameworks with
    // no flags read PORT and nothing else. Both mechanisms, one command shape.
    const vite = devServerCommand({ devDependencies: { vite: '^5' }, scripts: { dev: 'vite' } }, 5310);
    expect(vite).toContain('PORT=5310');
    expect(vite).toContain('--port 5310');

    const express = devServerCommand({ dependencies: { express: '4' }, scripts: { start: 'node s.js' } }, 5310);
    expect(express).toContain('PORT=5310');
    expect(express).not.toContain(' -- ');
  });

  it('honours a non-npm package manager', () => {
    expect(devServerCommand({ scripts: { dev: 'vite' }, devDependencies: { vite: '5' } }, 5310, 'pnpm'))
      .toContain('pnpm run dev');
  });
});

describe('parsePackageJson', () => {
  it('parses, and yields null rather than throwing on junk', () => {
    expect(parsePackageJson('{"scripts":{"dev":"vite"}}')?.scripts?.dev).toBe('vite');
    expect(parsePackageJson('not json')).toBeNull();
    expect(parsePackageJson('')).toBeNull();
    expect(parsePackageJson(undefined)).toBeNull();
    expect(parsePackageJson('"a string"')).toBeNull();
  });
});
