import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * APP MART (admin 2026-08-16) — item #1 of NAV_STORE_MASTER_PLAN.md Part B.
 *
 * Three changes, one purpose: the store was buried inside "Other" and looked broken when it had
 * apps in it. A store nobody arrives at has nothing to sell, and everything planned on top of it
 * (ads, creator earnings) needs an audience first — so this is the change every later one depends
 * on, which is why it is pinned rather than left to survive on good intentions.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('the name is App Mart on every surface a user can see', () => {
  const surfaces = [
    'src/components/ide/NavAppStore.tsx',
    'src/components/agentv3/HostingChooser.tsx',
    'src/components/ide/PublishToNavStore.tsx',
    'src/components/ide/StoreBuildPanel.tsx',
    'src/server/AppContext/AppKnowledgeBase.ts',
  ];

  it.each(surfaces)('%s carries no user-visible "Nav App Store"', (path) => {
    // Comments are stripped: they are history, and rewriting them would add noise to every future
    // diff for no user-visible gain. Only strings a person can read are renamed.
    const src = read(path)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*(\/\/|\s\*).*$/gm, '');
    expect(src).not.toContain('Nav App Store');
  });

  it('the store screen introduces itself as App Mart', () => {
    const store = read('src/components/ide/NavAppStore.tsx');
    expect(store).toContain('>App Mart<');
  });

  it('every AI can still find it when a user says the OLD name', () => {
    // A rename that makes the thing unfindable is a regression wearing new paint.
    const kb = read('src/server/AppContext/AppKnowledgeBase.ts');
    expect(kb).toContain("'app mart'");
    expect(kb).toContain("'nav app store'");
  });
});

describe('App Mart is a Home tile, and the ONLY doorway', () => {
  it('the fifth card exists on the Home screen and opens the store view', () => {
    const home = read('src/components/home/HomeView.tsx');
    expect(home).toContain("id: 'appmart'");
    expect(home).toContain("title: 'App Mart'");
    expect(home).toContain('onOpenAppMart');
    expect(read('src/App.tsx')).toContain("onOpenAppMart={() => toggleTab('appstore')}");
  });

  it('the Home grid actually fits five cards', () => {
    // The grid was `lg:grid-cols-4`. Left alone, the fifth card would have dropped onto its own row
    // and read as an afterthought — the opposite of promoting it.
    const home = read('src/components/home/HomeView.tsx');
    expect(home).toContain('xl:grid-cols-5');
  });

  it('it is NOT also a tile inside Other — one room, one door', () => {
    expect(read('src/components/home/homeToolGroups.ts')).not.toMatch(/id: 'appstore'/);
  });
});

describe('Browse is two labelled halves, and an empty half never says the store is empty', () => {
  const store = read('src/components/ide/NavAppStore.tsx');

  it('both halves are always headed, so neither can be mistaken for the other', () => {
    expect(store).toContain('Play instantly — runs in your browser, nothing to install');
    expect(store).toContain('Install on Android — real .apk apps');
  });

  it('THE BUG FROM THE ADMIN\'S SCREENSHOT: "No apps published yet" no longer sits under a listed app', () => {
    /**
     * Before: the instant-app list rendered above, and the APK list rendered its own empty state
     * below — so a store WITH an app in it displayed "No apps published yet" underneath, and the
     * whole screen read as broken. The store-wide empty state must now require BOTH halves to be
     * empty, and each half owns a message that is true of that half alone.
     */
    expect(store).toContain('webApps.length === 0 && apps.length === 0');
    expect(store).toContain('No instant apps yet');
    expect(store).toContain('No Android apps yet');
    expect(store).not.toContain('No apps published yet.');
  });

  it('the whole-store empty state invites, rather than apologises', () => {
    expect(store).toContain('App Mart is just getting started.');
  });
});
