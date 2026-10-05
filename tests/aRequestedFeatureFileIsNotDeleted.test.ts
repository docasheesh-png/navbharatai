// THE FILE THAT BUILDS A REQUESTED FEATURE IS NOT THE BUILD'S TO DELETE (Q-118, admin-approved (b) 2026-10-05).
//
// Every delete guard protected something structural (a tree, a bulk delete, a manifest, an imported module,
// a user's own file). A single feature component nothing imports — or that the model had just un-imported —
// passed them all. Option (b): refuse the delete of a file whose name builds a feature the user asked for,
// with the reason, and allow every other delete.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'glob';
import { singleSourceDeleteTargets, runtimeManifestDeletionTarget } from '../src/server/AgentV3/CommandGovernance';
import { shellRemovalTargets } from '../src/server/AgentV3/shellWriteTargets';
import { featureWordsOfPath, protectedFeatureFileDeletion, protectedFeatureFileMessage, featureFileGuardEnabled } from '../src/server/AgentV3/featureFileGuard';

const shop = 'Build a shoe shop with a product grid, a cart and a wishlist, and checkout with UPI.';

describe('featureWordsOfPath', () => {
  it('reads the feature out of the name, not the structure around it', () => {
    expect(featureWordsOfPath('src/components/ShoppingCart.tsx')).toEqual(['shopping', 'cart']);
    expect(featureWordsOfPath('src/pages/WishlistPage.tsx')).toEqual(['wishlist']);
    expect(featureWordsOfPath('src/components/Counter.tsx')).toEqual([]);
    expect(featureWordsOfPath('src/hooks/useStore.ts')).toEqual([]);
    expect(featureWordsOfPath('src/components/product-grid.jsx')).toEqual(['product', 'grid']);
    expect(featureWordsOfPath('src/components/Categories.tsx')).toEqual(['category']);
  });
});

describe('protectedFeatureFileDeletion', () => {
  it('refuses deleting the only file that builds a feature the user asked for', () => {
    const hit = protectedFeatureFileDeletion('src/components/Cart.tsx', [shop], ['src/App.tsx', 'src/components/Cart.tsx']);
    expect(hit?.word).toBe('cart');
    expect(protectedFeatureFileMessage('src/components/Cart.tsx', hit!)).toContain('the only file that builds "cart"');
  });

  it('allows a demo or stale file that names nothing the user asked for', () => {
    expect(protectedFeatureFileDeletion('src/components/Counter.tsx', [shop], [])).toBeNull();
    expect(protectedFeatureFileDeletion('src/components/OldHeader.tsx', [shop], [])).toBeNull();
  });

  it('allows the delete once a replacement carrying the feature already exists', () => {
    expect(protectedFeatureFileDeletion('src/components/Cart.tsx', [shop], ['src/components/Cart.tsx', 'src/pages/CartPage.tsx'])).toBeNull();
  });

  it('the current request asking to remove it wins over an earlier turn that asked for it', () => {
    const files = ['src/components/Wishlist.tsx'];
    expect(protectedFeatureFileDeletion('src/components/Wishlist.tsx', ['remove the wishlist, nobody uses it', shop], files)).toBeNull();
    expect(protectedFeatureFileDeletion('src/components/Wishlist.tsx', ['delete Wishlist.tsx', shop], files)).toBeNull();
  });

  it('an earlier turn still protects it when this turn is about something else', () => {
    const hit = protectedFeatureFileDeletion('src/components/Wishlist.tsx', ['make the header blue', shop], ['src/components/Wishlist.tsx']);
    expect(hit?.word).toBe('wishlist');
  });

  it('a feature the user declined is not protected', () => {
    expect(protectedFeatureFileDeletion('src/components/Login.tsx', ['A todo list, no login needed'], [])).toBeNull();
  });

  it('no request at all protects nothing', () => {
    expect(protectedFeatureFileDeletion('src/components/Cart.tsx', [null, ''], [])).toBeNull();
  });

  it('has a kill switch, default on', () => {
    expect(featureFileGuardEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(featureFileGuardEnabled({ AGENTV3_FEATURE_FILE_GUARD: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('the wiring', () => {
  it('the bash tool asks the guard for every single-file delete, after the imported-file check', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    const imported = src.indexOf('importedFileDeletionMessage(target, importers)');
    const feature = src.indexOf('protectedFeatureFileDeletion(target, requests, projectFiles)');
    expect(imported).toBeGreaterThan(0);
    expect(feature).toBeGreaterThan(imported);
    expect(src).toContain('[BLOCKED-FEATURE-FILE]');
  });
});

describe('every delete guard knows the same delete commands (the shred hole)', () => {
  it('shred is a delete to every parser: imported-file, feature, manifest and user-file guards', () => {
    expect(singleSourceDeleteTargets('shred -u src/components/Cart.tsx')).toEqual(['src/components/Cart.tsx']);
    expect(singleSourceDeleteTargets('shred src/components/Cart.tsx')).toEqual(['src/components/Cart.tsx']);
    expect(runtimeManifestDeletionTarget('shred -u package.json')).toBe('package.json');
    expect(shellRemovalTargets('shred -u notes.html').paths).toEqual(['notes.html']);
  });

  it('no guard spells the delete verbs itself — they come from fileRemovalCommands.ts', () => {
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    for (const f of globSync('src/server/**/*.ts', { cwd: root })) {
      if (/\.test\.ts$/.test(f) || f.endsWith('fileRemovalCommands.ts')) continue;
      const s = readFileSync(join(root, f), 'utf8');
      if (/\(\?:rm\|unlink/.test(s) || /name !== 'rm' && name !== 'unlink'/.test(s)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
