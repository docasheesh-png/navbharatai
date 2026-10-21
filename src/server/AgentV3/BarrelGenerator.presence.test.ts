import { describe, expect, it } from 'vitest';
import { generateMissingBarrels } from './BarrelGenerator';

const source = {
  'src/App.tsx': `import { Star } from './icons'; export default () => <Star />;`,
  'src/shared/Star.tsx': 'export const Star = () => null;',
  'src/icons/All.ts': `export * from '../shared/Star'; export * from '../unknown';`,
};

describe('barrel existence metadata is not source evidence', () => {
  it('keeps an unread transitive star target unknown, rather than pretending it is empty', async () => {
    expect(await generateMissingBarrels(source)).toEqual([]);
    expect(await generateMissingBarrels(source, ['src/unknown.ts'])).toEqual([]);
  });

  it('can prove a genuinely read empty module does not add an ambiguous export', async () => {
    const barrels = await generateMissingBarrels({ ...source, 'src/unknown.ts': '' });
    expect(barrels).toHaveLength(1);
    expect(barrels[0].content).toContain("export { Star } from './All';");
  });

  it('rejects actual conflicting star exports instead of guessing an owner', async () => {
    expect(await generateMissingBarrels({ ...source, 'src/unknown.ts': 'export const Star = () => null;' })).toEqual([]);
  });

  it.each(['src/icons.ts', 'src/icons/index.ts', 'src/icons/index.mjs'])(
    'preserves an unread existing module at %s', async existing => {
      const known = { ...source, 'src/unknown.ts': '' };
      expect(await generateMissingBarrels(known, [existing])).toEqual([]);
    },
  );

  it('does not infer an export solely from the filename of an unread leaf', async () => {
    expect(await generateMissingBarrels({ 'src/App.tsx': source['src/App.tsx'] }, ['src/icons/Star.tsx'])).toEqual([]);
  });
});
