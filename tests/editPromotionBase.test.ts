import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { editBaseHydrationIsComplete, selectEditPromotionBase } from '../src/server/AgentV3/editPromotionBase';
import { assessEditCandidate } from '../src/server/AgentV3/editPromotionGate';
import { isKnownSeedVersion } from '../src/server/AgentV3/seedVersions';

// Captured before the Angular 22 scaffold repair, not regenerated from today's template.
const historical = JSON.parse(readFileSync('tests/fixtures/angular18-platform-starter.json', 'utf8')) as {
  sourceCommit: string;
  sourcePath: string;
  files: Record<string, string>;
};
const starter = historical.files;
const select = (base: Record<string, string> | null, verifiedHead = false, completeHydration = true) =>
  selectEditPromotionBase({ base, verifiedHead, completeHydration });

describe('cdffbb71: building over an untouched historical starter is not replacing an authored app', () => {
  it('recognizes the exact eight-file Angular 18 starter through recorded seed history', () => {
    expect(historical.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(historical.sourcePath).toBe('src/server/AgentV3/sandbox/AppMakerLab/generator/templates/AngularProvider.ts');
    expect(Object.keys(starter)).toHaveLength(8);
    expect(JSON.parse(starter['package.json']).dependencies['@angular/core']).toBe('^18.0.0');
    for (const [path, content] of Object.entries(starter)) {
      expect(isKnownSeedVersion(path, content, 'starter'), path).toBe(true);
    }
    expect(select(starter)).toBeNull();
  });

  it('excludes only the promotion gate’s existing platform metadata paths', () => {
    const base = { ...starter, '.gitignore': 'node_modules\n', 'package-lock.json': '{}', 'public/icon.svg': '<svg/>', 'README.md': 'Generated setup' };
    expect(select(base)).toBeNull();
  });

  it('preserves even one authored byte in a recognized source file', () => {
    const base = { ...starter, 'src/app/app.component.ts': starter['src/app/app.component.ts'].replace('Hello from Angular!', 'My colour game') };
    expect(base['src/app/app.component.ts']).not.toBe(starter['src/app/app.component.ts']);
    expect(select(base)).toBe(base);
  });

  it.each(['src/app/wallet.service.ts', 'custom-settings.json', 'unknown-entry.html'])('preserves an additional unknown file: %s', (path) => {
    const base = { ...starter, [path]: 'authored content' };
    expect(select(base)).toBe(base);
  });

  it('preserves a verified head even when all its bytes match a platform starter', () => {
    expect(select(starter, true)).toBe(starter);
  });

  it('does not infer that a partially read or unchecked base contains only starter files', () => {
    expect(select(starter, false, false)).toBe(starter);
    const unreadable = { ...starter, 'src/app/custom.ts': null } as unknown as Record<string, string>;
    expect(select(unreadable)).toBe(unreadable);
    expect(selectEditPromotionBase({ base: starter, verifiedHead: undefined as unknown as boolean, completeHydration: true })).toBe(starter);
    expect(selectEditPromotionBase({ base: starter, verifiedHead: false, completeHydration: undefined as unknown as boolean })).toBe(starter);
  });

  it('keeps a missing base missing and treats a completely read empty workspace as no authored base', () => {
    expect(select(null)).toBeNull();
    expect(select({})).toBeNull();
  });

  it('removes the false six-of-eight replacement rejection without bypassing protection for custom or verified apps', () => {
    const changedPaths = ['src/app/app.component.ts', 'src/styles.css', 'src/index.html', 'package.json', 'angular.json', 'src/main.ts'];
    const candidate = { ...starter };
    for (const path of changedPaths) candidate[path] = `${candidate[path]}\n/* app implementation changed */`;
    for (let i = 0; i < 12; i++) candidate[`src/app/feature-${i}.ts`] = `export const feature${i} = true;`;
    const before = assessEditCandidate({ base: starter, candidate });
    expect(before.verdict).toBe('reject');
    expect(before.stats).toEqual({ baseFiles: 8, candidateFiles: 20, unchanged: 2, changed: 6, added: 12, removed: 0, moved: 0 });
    expect(before.reasons.map(reason => reason.rule)).toContain('most-of-project-rewritten');
    expect(select(starter)).toBeNull();
    const custom = { ...starter, 'src/app/app.component.ts': 'export class ExistingApp {}' };
    expect(assessEditCandidate({ base: select(custom)!, candidate }).verdict).toBe('reject');
    expect(assessEditCandidate({ base: select(starter, true)!, candidate }).verdict).toBe('reject');
  });

  it('the route selects the comparison base with verified-head and successful-hydration evidence', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const start = route.indexOf('const editGateBase =');
    const end = route.indexOf('const editId =', start);
    const selector = route.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(selector).toContain('const base = editVerifiedBase ?? projectFilesAtTurnStart;');
    expect(selector).toMatch(/return selectEditPromotionBase\(\{\s*base,\s*verifiedHead:\s*editHeadAtStart !== null,\s*completeHydration:\s*editBaseHydrationComplete\s*\}\)/);
    expect(route).toContain('let editBaseHydrationComplete = false;');
    expect(route).toMatch(/editBaseHydrationComplete\s*=\s*editBaseHydrationIsComplete\(\s*durableFilePaths,\s*saved,\s*durable\.status,\s*baseResult\.finding\?\.code === 'EDIT_BASE_UNCHECKED'\s*\)/);
  });
});

describe('a successful durable read is not proof every indexed document was hydrated', () => {
  it('keeps a starter-shaped partial read protected when the ninth authored document is absent', () => {
    const expected = [...Object.keys(starter), 'src/app/wallet.service.ts'];
    const completeHydration = editBaseHydrationIsComplete(expected, starter, 'ok', false);
    expect(completeHydration).toBe(false);
    expect(selectEditPromotionBase({ base: starter, verifiedHead: false, completeHydration })).toBe(starter);
  });

  it('requires exact inventory equality, including extra hydrated files', () => {
    expect(editBaseHydrationIsComplete(Object.keys(starter), starter, 'ok', false)).toBe(true);
    expect(editBaseHydrationIsComplete(Object.keys(starter), { ...starter, 'custom.md': 'authored' }, 'ok', false)).toBe(false);
    expect(editBaseHydrationIsComplete([], starter, 'ok', false)).toBe(false);
  });

  it('uses the durable store normalizer for equivalent path forms', () => {
    expect(editBaseHydrationIsComplete(['/home/user/workspace/src/app/app.component.ts'], { './src/app/app.component.ts': 'content' }, 'ok', false)).toBe(true);
    expect(editBaseHydrationIsComplete(['src\\app\\app.component.ts'], { 'src/app/app.component.ts': 'content' }, 'ok', false)).toBe(true);
  });

  it.each(['unreadable', 'readfailed', 'unknown', undefined, null])('does not turn %s status into a complete hydration', (status) => {
    expect(editBaseHydrationIsComplete(Object.keys(starter), starter, status, false)).toBe(false);
  });

  it('rejects missing inventories, unchecked reads, unreadable content and ambiguous keys', () => {
    expect(editBaseHydrationIsComplete(null, starter, 'ok', false)).toBe(false);
    expect(editBaseHydrationIsComplete(Object.keys(starter), null, 'ok', false)).toBe(false);
    expect(editBaseHydrationIsComplete(Object.keys(starter), starter, 'ok', true)).toBe(false);
    expect(editBaseHydrationIsComplete(Object.keys(starter), starter, 'ok', undefined as unknown as boolean)).toBe(false);
    expect(editBaseHydrationIsComplete(['a.ts'], { 'a.ts': null } as unknown as Record<string, string>, 'ok', false)).toBe(false);
    expect(editBaseHydrationIsComplete(['a.ts', './a.ts'], { 'a.ts': 'content' }, 'ok', false)).toBe(false);
    expect(editBaseHydrationIsComplete(['a.ts'], { 'a.ts': 'content', './a.ts': 'other' }, 'ok', false)).toBe(false);
    expect(editBaseHydrationIsComplete(['.env'], { '.env': 'secret' }, 'ok', false)).toBe(false);
  });

  it('accepts an explicitly empty matching inventory without trusting a contradictory empty status', () => {
    expect(editBaseHydrationIsComplete([], {}, 'empty', false)).toBe(true);
    expect(editBaseHydrationIsComplete(Object.keys(starter), starter, 'empty', false)).toBe(false);
  });
});
