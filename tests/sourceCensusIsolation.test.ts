import { it, expect } from 'vitest';
import { writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tempDir';
import { sourceCensusFiles } from './helpers/sourceCensus';

it('source censuses never inspect disappearing generated fixtures but retain real source errors', () => {
  const root = makeTempDir('nbai-census-isolation-');
  writeFileSync(join(root, 'real.ts'), 'export const real = true;');
  symlinkSync(join(root, 'already-removed'), join(root, '.tmp-fixture'));
  expect(sourceCensusFiles(root, p => p.endsWith('.ts'))).toEqual([join(root, 'real.ts')]);
  symlinkSync(join(root, 'missing-real-source'), join(root, 'broken.ts'));
  expect(() => sourceCensusFiles(root, p => p.endsWith('.ts'))).toThrow(/ENOENT/);
});
