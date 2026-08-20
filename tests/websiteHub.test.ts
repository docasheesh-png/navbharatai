import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';
import type { SettingsScreen } from '../src/types';

/**
 * "Your Website" hub (admin 2026-07-29): Settings → App Settings now brings the real-website
 * essentials into ONE place — Domain (+ DNS + SSL), Database, Secrets & API Keys (the Hosting &
 * Deploy tile was removed 2026-08-20; publishing lives in the v5.0 Publish sheet)
 * — with Build & Debug (General/Terminal/Logs) split out, and an honest note that Frontend + Backend
 * CODE is built by NavBharatAI (not a fake tile). Source-level lock (the hub lives inline in
 * SettingsPanel.tsx) + KB/navigation lock.
 */
const src = readFileSync(join(__dirname, '../src/components/panels/SettingsPanel.tsx'), 'utf8');
const kb = (id: string) => APP_KNOWLEDGE_BASE.find((f) => f.id === id);

describe('App Settings — Your Website hub', () => {
  it('App Settings group leads with the real-website essentials as tiles', () => {
    const start = src.indexOf("title: 'App Settings'");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 1800);
    expect(block).toContain("id: 'domain'");
    expect(block).toContain("id: 'database'");
    expect(block).toContain("id: 'auth'");
    expect(block).toContain("id: 'storage'");
    expect(block).toContain("id: 'secrets'");
    // The section carries the honest one-line purpose. Reworded 2026-08-14 to say "BUILT APP" —
    // once General Settings became its own group, "your app" was ambiguous between the app the user
    // built and NavBharatAI itself, which is the exact confusion the split exists to end.
    expect(block).toContain('Everything your BUILT APP needs');
    // NO DUPLICATE PUBLISH SURFACE — the point this hub keeps being pulled towards, twice now.
    // 2026-07-29: the standalone "Hosting & Publish" tile was merged into "Hosting & Deploy".
    // 2026-08-20: "Hosting & Deploy" (cloudeploy) was REMOVED OUTRIGHT on the admin's call — the
    // v5.0 Publish sheet already deploys to the user's own Vercel/Netlify/Cloudflare, while that
    // screen still read the retired v2.0 channel and so could not see a v5.0 app at all. It had
    // just published the "Waiting for magic..." placeholder to a real URL as a success. Publishing
    // now has exactly ONE home, and these guards keep it that way.
    expect(block).not.toContain("id: 'hosting'");
    expect(src).not.toContain("settingsScreen === 'hosting'");
    expect(block).not.toContain("id: 'cloudeploy'");
    expect(src).not.toContain("settingsScreen === 'cloudeploy'");
    expect(src).not.toContain('MultiCloudDeploy');
  });

  it('🔒 LOGS stays inside App Settings (admin 2026-07-29: "hatana mat") — and General no longer does', () => {
    // The 2026-07-29 instruction named TERMINAL and LOGS, and it still holds for Logs. General was
    // never covered by it, and on 2026-08-14 the admin moved General into its own group: App Settings
    // is about the app the USER BUILT, while theme/view-mode/text-size are about NavBharatAI itself.
    const start = src.indexOf("title: 'App Settings'");
    const block = src.slice(start, src.indexOf("title: 'Legal & Trust'", start));
    expect(block).toContain("id: 'logs'");
    expect(block).not.toContain("id: 'general'");
    // It went to a named group of its own, not into some invented catch-all.
    expect(src).toContain("title: 'General Settings'");
    expect(src).not.toContain("title: 'Build & Debug'");
  });

  it('🔒 Terminal was removed from that pair (admin 2026-08-11) — the IDE already has it', () => {
    // The 2026-07-29 instruction said "terminal aur logs ko hatana mat". On 2026-08-11 the admin
    // reversed it for TERMINAL only, confirmed explicitly before the change: the Settings screen
    // mounted the same TerminalPanel on the same workspace as Code Studio, so it was a second doorway
    // to one room. LOGS is unchanged and still locked above — it has no IDE twin.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain("id: 'shell'");
    expect(code).not.toContain("settingsScreen === 'shell'");
  });

  it('the Domain sub-screen mounts the ONE real ConnectMyWebsitePanel flow', () => {
    expect(src).toContain("settingsScreen === 'domain'");
    // It reuses the real, shared component (not a new half-working screen).
    expect(src).toContain('<ConnectMyWebsitePanel');
    expect(src).toContain("onBack={() => setSettingsScreen('root')}");
  });

  it('the honest auto-hosting ANSWER survives the removed screen — as an info line, not a tile', () => {
    // Removing the Hosting & Deploy screen must not remove the useful thing it said. A user opening
    // App Settings to look for hosting still gets an answer here; only the broken second doorway is
    // gone. Same rule as Frontend & Backend: an honest info line beats a tile that does nothing.
    expect(src).toContain('Hosting — your app is already hosted');
    const start = src.indexOf('Hosting — your app is already hosted');
    const block = src.slice(start, start + 900);
    // …and it points at the path that genuinely publishes a v5.0 app.
    expect(block).toContain('Publish');
    expect(block).toContain('Pro v5.0');
    // It is an info line, NOT a clickable settings tile.
    expect(src).not.toContain("id: 'hosting'");
  });

  it('the Storage sub-screen mounts the real StorageSettings connection panel', () => {
    expect(src).toContain("settingsScreen === 'storage'");
    expect(src).toContain('<StorageSettings');
  });

  it('the Authentication sub-screen mounts the real AuthSettings connection panel', () => {
    expect(src).toContain("settingsScreen === 'auth'");
    expect(src).toContain('<AuthSettings');
  });

  it('Frontend & Backend get an honest info line, NOT a fake tile', () => {
    expect(src).toContain('Frontend &amp; Backend — built for you');
    // They are NOT clickable settings tiles (no settingsScreen ids for them).
    expect(src).not.toContain("id: 'frontend'");
    expect(src).not.toContain("id: 'backend'");
  });

  it('SettingsScreen type carries the hub screens — and no longer carries the removed ones', () => {
    // 'hosting' was merged into 'cloudeploy' (2026-07-29); 'cloudeploy' was removed (2026-08-20).
    // A union member nothing can navigate to is how the 'modules' dead screen survived unnoticed,
    // so the type is kept in step with the tiles rather than left carrying ghosts.
    const domain: SettingsScreen = 'domain';
    const auth: SettingsScreen = 'auth';
    const storage: SettingsScreen = 'storage';
    expect([domain, auth, storage]).toEqual(['domain', 'auth', 'storage']);
    // @ts-expect-error 'cloudeploy' was removed from SettingsScreen on 2026-08-20.
    const gone: SettingsScreen = 'cloudeploy';
    expect(gone).toBe('cloudeploy'); // the value still exists at runtime; the TYPE must not accept it
  });
});

describe('App Settings hub — KB awareness', () => {
  it('settings_root describes the website essentials in App Settings', () => {
    const root = kb('settings_root');
    expect(root).toBeTruthy();
    expect(root!.description).toMatch(/Domain/);
    expect(root!.description).toMatch(/Hosting/);
    // Honest: Frontend/Backend are built, not configured.
    expect(root!.description).toMatch(/built for you by NavBharatAI/i);
  });

  it('connect_domain is now reachable from Settings → App Settings → Domain', () => {
    const d = kb('connect_domain');
    expect(d).toBeTruthy();
    expect(d!.path).toContain('Settings → App Settings → Domain');
  });

  it('the removed Hosting & Deploy KB entry is gone — but "deploy"/"hosting" still find the REAL path', () => {
    // Deleting the entry alone would have been the wrong half of the job: its keywords ('deploy',
    // 'hosting', 'vercel', 'live kaise kare') are exactly what users type, and every AI answers from
    // this file. So the entry goes AND the same questions must still resolve — to the Publish flow
    // that genuinely publishes a v5.0 app.
    expect(kb('settings_multicloud')).toBeFalsy();
    const publish = kb('agentv3_deploy');
    expect(publish).toBeTruthy();
    for (const word of ['deploy', 'hosting', 'vercel', 'go live']) {
      expect(publish!.keywords).toContain(word);
    }
    expect(publish!.path.toLowerCase()).toContain('publish');
    // And the hub description must not still advertise a tile that no longer exists.
    expect(kb('settings_root')!.description).not.toMatch(/Hosting & Deploy \(your app is auto-hosted/);
  });

  it('settings_auth KB entry exists, names Clerk/Auth0, and is honest about DB-bundled auth', () => {
    const a = kb('settings_auth');
    expect(a).toBeTruthy();
    expect(a!.path).toContain('Settings → App Settings → Authentication');
    expect(a!.description).toMatch(/Clerk/);
    expect(a!.description).toMatch(/Auth0/);
    expect(a!.description).toMatch(/Database connection/);
    expect(a!.description).not.toMatch(/\b(glm|kimi|claude|anthropic|sonnet|opus|grok)\b/i);
  });

  it('settings_storage KB entry exists, is honest about S3/Cloudinary, and names the real path', () => {
    const s = kb('settings_storage');
    expect(s).toBeTruthy();
    expect(s!.path).toContain('Settings → App Settings → Storage');
    expect(s!.description).toMatch(/S3-compatible/);
    expect(s!.description).toMatch(/Cloudinary/);
    // Honest: Firebase/Supabase storage comes with the Database connection.
    expect(s!.description).toMatch(/Database/);
    // White-label: never leaks an internal AI vendor.
    expect(s!.description).not.toMatch(/\b(glm|kimi|claude|anthropic|sonnet|opus|grok)\b/i);
  });
});
