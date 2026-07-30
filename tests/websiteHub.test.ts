import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';
import type { SettingsScreen } from '../src/types';

/**
 * "Your Website" hub (admin 2026-07-29): Settings → App Settings now brings the real-website
 * essentials into ONE place — Domain (+ DNS + SSL), Hosting & Publish, Database, Secrets & API Keys
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
    expect(block).toContain("id: 'cloudeploy'"); // Hosting & Deploy (single publish surface)
    expect(block).toContain("id: 'database'");
    expect(block).toContain("id: 'auth'");
    expect(block).toContain("id: 'storage'");
    expect(block).toContain("id: 'secrets'");
    // The section carries the honest one-line purpose.
    expect(block).toContain('Everything your app needs');
    // No duplicate publish surface: the old standalone "Hosting & Publish" tile/screen is gone,
    // merged into Hosting & Deploy (admin 2026-07-29).
    expect(block).not.toContain("id: 'hosting'");
    expect(src).not.toContain("settingsScreen === 'hosting'");
  });

  it('Terminal, Logs and General stay INSIDE App Settings (admin: do not remove them)', () => {
    const start = src.indexOf("title: 'App Settings'");
    const block = src.slice(start, start + 1800);
    expect(block).toContain("id: 'general'");
    expect(block).toContain("id: 'shell'"); // Terminal
    expect(block).toContain("id: 'logs'");
    // They were not spun out into a separate group.
    expect(src).not.toContain("title: 'Build & Debug'");
  });

  it('the Domain sub-screen mounts the ONE real ConnectMyWebsitePanel flow', () => {
    expect(src).toContain("settingsScreen === 'domain'");
    // It reuses the real, shared component (not a new half-working screen).
    expect(src).toContain('<ConnectMyWebsitePanel');
    expect(src).toContain("onBack={() => setSettingsScreen('root')}");
  });

  it('the Hosting & Deploy screen keeps the honest auto-hosting note (merged from the old screen)', () => {
    const start = src.indexOf("settingsScreen === 'cloudeploy'");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 1600);
    // The honest "your app is already hosted" reassurance was folded in — not lost.
    expect(block).toContain('already hosted');
    // The real deploy component still renders below it with the app bundle.
    expect(block).toContain('<MultiCloudDeploy generatedCode={generatedCode} />');
  });

  it('the Storage sub-screen mounts the real StorageSettings connection panel', () => {
    expect(src).toContain("settingsScreen === 'storage'");
    expect(src).toContain('<StorageSettings');
  });

  it('the Authentication sub-screen mounts the real AuthSettings connection panel', () => {
    expect(src).toContain("settingsScreen === 'auth'");
    expect(src).toContain('<AuthSettings');
  });

  it('Multi-Cloud Deploy is an App Settings tile mounting the real component with the app code', () => {
    const start = src.indexOf("title: 'App Settings'");
    const block = src.slice(start, start + 1800);
    expect(block).toContain("id: 'cloudeploy'");
    expect(src).toContain("settingsScreen === 'cloudeploy'");
    // Real deploy needs the app bundle — generatedCode is threaded through, not stubbed.
    expect(src).toContain('<MultiCloudDeploy generatedCode={generatedCode} />');
  });

  it('Frontend & Backend get an honest info line, NOT a fake tile', () => {
    expect(src).toContain('Frontend &amp; Backend — built for you');
    // They are NOT clickable settings tiles (no settingsScreen ids for them).
    expect(src).not.toContain("id: 'frontend'");
    expect(src).not.toContain("id: 'backend'");
  });

  it('SettingsScreen type carries the new hub screens', () => {
    // 'hosting' was merged into 'cloudeploy' (Hosting & Deploy) — no longer a SettingsScreen member.
    const domain: SettingsScreen = 'domain';
    const cloudeploy: SettingsScreen = 'cloudeploy';
    const auth: SettingsScreen = 'auth';
    const storage: SettingsScreen = 'storage';
    expect([domain, cloudeploy, auth, storage]).toEqual(['domain', 'cloudeploy', 'auth', 'storage']);
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

  it('settings_multicloud KB entry exists, is honest about real-vs-CLI, and moved out of Other AI', () => {
    const m = kb('settings_multicloud');
    expect(m).toBeTruthy();
    expect(m!.path).toContain('Settings → App Settings → Hosting & Deploy');
    expect(m!.description).toMatch(/NavBharat Hosting/);
    expect(m!.description).toMatch(/Vercel/);
    // Honest: some platforms are real in-app, others show CLI steps — nothing faked.
    expect(m!.description.toLowerCase()).toContain('cli');
    expect(m!.description.toLowerCase()).toContain('faked');
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
