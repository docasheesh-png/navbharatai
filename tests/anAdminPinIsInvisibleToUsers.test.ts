// AN ADMIN'S PIN IS INVISIBLE TO USERS (admin 2026-11-26, phone screenshot of App Mart with a "Pinned by NavBharatAI" shelf:
// "admin jis app ko pin kare users ko pata bhi nahi lage, ki yeh app pin ki gayi hai, user ko naturally woh app top par show
// ho").
//
// The server already listed pinned apps first, and then ALSO said so: every public row carried pinned / pinOrder, and the
// store drew those rows in their own amber-bordered "Pinned by NavBharatAI" shelf. Now the ORDER is the only trace — the
// public lists send no pin field at all, and a pinned app is simply the first tile of its own list, the same tile as every
// app. The admin's Pin / Unpin still works from its own admin route.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const store = read('src/components/ide/NavAppStore.tsx');
const routes = read('src/server/routes/navStore.ts');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

describe('📌 what a user can see', () => {
  it('no "Pinned by NavBharatAI" shelf, no pinned badge, and no row is told apart by a pin', () => {
    expect(code(store)).not.toMatch(/Pinned by NavBharatAI/);
    expect(code(store)).not.toMatch(/\.pinned\b/);
    expect(code(store)).not.toMatch(/pinOrder/);
    expect(code(store)).not.toMatch(/pinnedItems/);
  });
  it('the admin still pins and unpins from the admin screen', () => {
    expect(store).toMatch(/'Unpin' : 'Pin to top'/);
    expect(store).toMatch(/\/api\/nav-store\/admin\/pins/);
  });
});

describe('📌 what the server says', () => {
  it('the public lists send no pinned / pinOrder field', () => {
    expect(code(routes)).not.toMatch(/pinned:\s*(?:rank|webPinRank)\.has/);
    expect(code(routes)).not.toMatch(/pinOrder:/);
  });
  it('a pinned app still comes first — in the Android list and in both web orders (Newest and For You)', () => {
    expect(routes).toMatch(/publicApps\.sort\(\(a, b\) => \{\s*const ar = rank\.get\(`apk:\$\{a\.id\}`\)/);
    expect(routes).toMatch(/visible = pinnedFirst\(visible\);/);
    expect(routes).toMatch(/const ranked = pinnedFirst\(rankForYou\(/);
  });
});
