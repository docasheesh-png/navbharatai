import { describe, it, expect } from 'vitest';
import { isBinaryAsset, isEditableSourceFile, countEditableSourceFiles } from './fileClassification';

describe('isBinaryAsset', () => {
  it('flags images / fonts / media / archives / compiled artefacts', () => {
    for (const p of ['attached_assets/IMG_4787.png', 'a/photo.jpeg', 'public/font.woff2', 'x/intro.mp4', 'y/data.zip', 'z/app.wasm', 'q/local.sqlite']) {
      expect(isBinaryAsset(p)).toBe(true);
    }
  });
  it('does NOT flag editable source (incl. .svg — editable text)', () => {
    for (const p of ['src/App.tsx', 'server/routes.ts', 'shared/schema.ts', 'package.json', 'README.md', 'styles.css', 'index.html', 'src/logo.svg', '.env.example', 'vite.config.ts']) {
      expect(isBinaryAsset(p)).toBe(false);
    }
  });
  it('is case-insensitive and safe on junk input', () => {
    expect(isBinaryAsset('A/B.PNG')).toBe(true);
    expect(isBinaryAsset('')).toBe(false);
    expect(isBinaryAsset(undefined as unknown as string)).toBe(false);
  });
});

describe('isEditableSourceFile', () => {
  it('is the inverse of isBinaryAsset for non-empty paths', () => {
    expect(isEditableSourceFile('src/App.tsx')).toBe(true);
    expect(isEditableSourceFile('a.png')).toBe(false);
    expect(isEditableSourceFile('   ')).toBe(false);
  });
});

describe('countEditableSourceFiles (autopsy #2 — one honest project size)', () => {
  it('THE regression: a Mitrify-shaped tree counts source files, not the ~150 binary assets', () => {
    // 165 real source files + 152 binary assets = 317 total (the raw listFiles length the edit banner
    // used to show, contradicting the import banner's "165 files" for the SAME project).
    const source = Array.from({ length: 165 }, (_, i) => `client/src/f${i}.tsx`);
    const assets = Array.from({ length: 150 }, (_, i) => `attached_assets/IMG_${i}.png`);
    const lockAndConfig = ['package.json', 'README.md']; // non-binary → counted as source
    const tree = [...source, ...assets, ...lockAndConfig];
    expect(tree.length).toBe(317);
    expect(countEditableSourceFiles(tree)).toBe(167); // 165 + package.json + README, assets excluded
  });
  it('handles empty / non-array input safely', () => {
    expect(countEditableSourceFiles([])).toBe(0);
    expect(countEditableSourceFiles(undefined as unknown as string[])).toBe(0);
  });
});
