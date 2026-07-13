import { describe, it, expect } from 'vitest';
import { generateMissingBarrels } from './BarrelGenerator';

describe('generateMissingBarrels — a folder barrel the generator forgot to create (Kanban autopsy)', () => {
  it('creates index.ts re-exporting named + default leaves for the imported names', async () => {
    const files = {
      'src/App.tsx': `import { CalendarIcon, StarIcon } from './components/Icons';\n<CalendarIcon/>;<StarIcon/>;`,
      'src/components/Icons/CalendarIcon.tsx': `export default function CalendarIcon() { return null; }`,
      'src/components/Icons/StarIcon.tsx': `export const StarIcon = () => null;`,
    };
    const stubs = await generateMissingBarrels(files);
    expect(stubs).toHaveLength(1);
    expect(stubs[0].path).toBe('src/components/Icons/index.ts');
    expect(stubs[0].exports).toEqual(['CalendarIcon', 'StarIcon']);
    expect(stubs[0].content).toContain(`export { default as CalendarIcon } from './CalendarIcon';`);
    expect(stubs[0].content).toContain(`export { StarIcon } from './StarIcon';`);
  });

  it('does NOT create a barrel when an index already exists (no overwrite)', async () => {
    const files = {
      'src/App.tsx': `import { A } from './lib';\nA;`,
      'src/lib/index.ts': `export const A = 1;`,
      'src/lib/a.ts': `export const A = 1;`,
    };
    expect(await generateMissingBarrels(files)).toEqual([]);
  });

  it('does NOT create a barrel when a name is exported by 2+ leaves (ambiguous → never guess)', async () => {
    const files = {
      'src/App.tsx': `import { Widget } from './ui';\n<Widget/>;`,
      'src/ui/a.tsx': `export const Widget = () => null;`,
      'src/ui/b.tsx': `export const Widget = () => null;`,
    };
    expect(await generateMissingBarrels(files)).toEqual([]);
  });

  it('skips the whole barrel if ANY imported name is unresolved (a partial barrel still breaks the build)', async () => {
    const files = {
      'src/App.tsx': `import { Present, Absent } from './icons';\nPresent; Absent;`,
      'src/icons/Present.tsx': `export const Present = () => null;`,
    };
    expect(await generateMissingBarrels(files)).toEqual([]);
  });

  it('does NOT treat a genuinely-missing single file as a barrel (no leaves under the path)', async () => {
    const files = { 'src/App.tsx': `import { X } from './nowhere';\nX;` };
    expect(await generateMissingBarrels(files)).toEqual([]);
  });

  it('ignores default/namespace imports (only named barrels are deterministic)', async () => {
    const files = {
      'src/App.tsx': `import Icons from './components/Icons';\nimport * as All from './lib';\nIcons; All;`,
      'src/components/Icons/A.tsx': `export const A = 1;`,
      'src/lib/b.ts': `export const b = 1;`,
    };
    expect(await generateMissingBarrels(files)).toEqual([]);
  });

  it('resolves the @/ alias to a src-rooted folder', async () => {
    const files = {
      'src/pages/Home.tsx': `import { Button } from '@/components/ui';\n<Button/>;`,
      'src/components/ui/Button.tsx': `export const Button = () => null;`,
    };
    const stubs = await generateMissingBarrels(files);
    expect(stubs).toHaveLength(1);
    expect(stubs[0].path).toBe('src/components/ui/index.ts');
    expect(stubs[0].exports).toEqual(['Button']);
  });

  it('never throws on malformed input', async () => {
    // @ts-expect-error malformed
    expect(await generateMissingBarrels(null)).toEqual([]);
    expect(await generateMissingBarrels({})).toEqual([]);
  });
});
