import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';
import { existsSync } from 'node:fs';

/**
 * Polish campaign — Core AI Chat cluster, rock-solid verification.
 *
 * Root cause fixed: the KB still described the RETIRED Pro Chat v2.0 surface and pointed Free Chat at a
 * "Reports" tab that no longer exists. The real surfaces today are:
 *   • Free Chat  → menu "NavBharatAI FREE"  /  Home "Start Free Chat"  (App.tsx menuItems + HomeView).
 *   • NavBharatAI Pro → Home "NavBharatAI Pro" card ("Open Pro Builder") / menu "NavBharatAI Pro"
 *     (the v2.0 ProChatPanel is retired — App.tsx: "The old ProChatPanel (v2.0) is retired").
 * This suite pins the corrected navigation so no NavBharatAI AI sends a user to a control that is gone.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const app = read('src/App.tsx');
const home = read('src/components/home/HomeView.tsx');
const professionals = read('src/components/professionals/ProfessionalsView.tsx');
const kb = (id: string) => APP_KNOWLEDGE_BASE.find((f) => f.id === id);

// The 10 Core AI Chat features in the roadmap.
const CLUSTER = [
  'freelance_ai', 'pro_chat', 'pro_chat_file_upload', 'free_chat',
  'free_chat_file_analysis', 'pro_chat_extended_thinking', 'pro_chat_planner',
  'pro_chat_session_memory', 'pro_chat_design_to_code',
];

describe('Core AI Chat — real navigation labels exist in code', () => {
  it('Free Chat gate: menu "NavBharatAI FREE" + Home "Start Free Chat"', () => {
    expect(app).toContain("label: 'NavBharatAI FREE'");
    expect(home).toContain('Start Free Chat');
  });
  it('Pro builder gate: Home "Open Pro Builder" + menu "NavBharatAI Pro"', () => {
    // CORRECTED 2026-09-12. This asserted the sidebar row "App Builder v5.0" — whose destination
    // (engine_builder) App.tsx no longer renders, making it a dead button that this very suite's
    // header promises to catch ("so no NavBharatAI AI sends a user to a control that is gone"). A
    // label assertion cannot see a deleted destination; the real gate is the menuItems entry.
    expect(home).toContain('Open Pro Builder');
    expect(app).toContain("{ id: 'nbi_pro_chat', label: 'NavBharatAI Pro', icon: Bot }");
    expect(read('src/components/panels/SidebarNav.tsx')).not.toContain("toggleTab('engine_builder')");
  });
  it('the Freelancing gate exists', () => {
    // The Offline AI half of this assertion went with that feature on 2026-09-14 (admin: "offline ai
    // ko hamesha ke liye parmanent delete karo"). Its absence is now itself pinned, below.
    expect(professionals).toContain('Freelancing & Online-Income');
  });

  it('🔒 the Offline AI is GONE — no menu entry, no view, no module', () => {
    // "koi trace na bache". A half-removed feature is the worst outcome: a menu item that opens
    // nothing, or a dead module the bundler still ships. This asserts the removal stayed complete.
    expect(app).not.toContain("label: 'Offline AI'");
    expect(app).not.toContain('offline_ai');
    expect(existsSync(join(process.cwd(), 'src/components/offline'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'src/lib/offlineAssistant.ts'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'src/lib/offlineLlmEngine.ts'))).toBe(false);
    // …while the things that merely SHARE the word "offline" must survive: the error-log queue is
    // used by main.tsx and has nothing to do with the removed feature.
    expect(existsSync(join(process.cwd(), 'src/lib/offlineQueue.ts'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'src/lib/neonatalDosing.ts'))).toBe(true);
  });
});

describe('Core AI Chat — no KB entry points at a retired control', () => {
  it('none of the 10 cluster paths mention "Reports" or a "Pro Chat button/tab"', () => {
    for (const id of CLUSTER) {
      const e = kb(id);
      expect(e, `missing KB entry ${id}`).toBeTruthy();
      expect(e!.path, `${id} path still names Reports`).not.toMatch(/Reports/);
      expect(e!.path, `${id} path still names a Pro Chat button/tab`).not.toMatch(/Pro Chat (button|tab)/i);
      expect(e!.path, `${id} path still says "Header → Pro Chat"`).not.toMatch(/Header → Pro Chat/);
    }
  });

  it('Free Chat routes to the real "NavBharatAI FREE" surface', () => {
    const fc = kb('free_chat')!;
    expect(fc.path).toMatch(/NavBharatAI FREE/);
    expect(fc.howToUse).not.toMatch(/Reports/);
    const fa = kb('free_chat_file_analysis')!;
    expect(fa.path).toMatch(/NavBharatAI FREE/);
  });

  it('Pro entry routes to the real "NavBharatAI Pro" gate', () => {
    const pc = kb('pro_chat')!;
    expect(pc.path).toMatch(/Open Pro Builder|NavBharatAI Pro/);
  });
});

describe('Core AI Chat — offline & freelancing paths are accurate', () => {
  it('freelance_ai path names the real Professionals entry', () => {
    expect(kb('freelance_ai')!.path).toMatch(/Freelancing & Online-Income/);
  });
});
