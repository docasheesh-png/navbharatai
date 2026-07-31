import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * Polish campaign — Core AI Chat cluster, rock-solid verification.
 *
 * Root cause fixed: the KB still described the RETIRED Pro Chat v2.0 surface and pointed Free Chat at a
 * "Reports" tab that no longer exists. The real surfaces today are:
 *   • Free Chat  → menu "NavBharatAI FREE"  /  Home "Start Free Chat"  (App.tsx menuItems + HomeView).
 *   • NavBharatAI Pro → Home "NavBharatAI Pro" card ("Open Pro Builder") / menu "App Builder v5.0"
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
  'offline_ai', 'freelance_ai', 'pro_chat', 'pro_chat_file_upload', 'free_chat',
  'free_chat_file_analysis', 'pro_chat_extended_thinking', 'pro_chat_planner',
  'pro_chat_session_memory', 'pro_chat_design_to_code',
];

describe('Core AI Chat — real navigation labels exist in code', () => {
  it('Free Chat gate: menu "NavBharatAI FREE" + Home "Start Free Chat"', () => {
    expect(app).toContain("label: 'NavBharatAI FREE'");
    expect(home).toContain('Start Free Chat');
  });
  it('Pro builder gate: Home "Open Pro Builder" + menu "App Builder v5.0"', () => {
    expect(home).toContain('Open Pro Builder');
    expect(read('src/components/panels/SidebarNav.tsx')).toContain('App Builder v5.0');
  });
  it('Offline AI + Freelancing gates exist', () => {
    expect(app).toContain("label: 'Offline AI'");
    expect(professionals).toContain('Freelancing & Online-Income');
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

  it('Pro entry routes to the real "NavBharatAI Pro" / "App Builder v5.0" gate', () => {
    const pc = kb('pro_chat')!;
    expect(pc.path).toMatch(/Open Pro Builder|App Builder v5\.0/);
  });
});

describe('Core AI Chat — offline & freelancing paths are accurate', () => {
  it('offline_ai path names the real "Offline AI" menu item', () => {
    expect(kb('offline_ai')!.path).toMatch(/Offline AI/);
  });
  it('freelance_ai path names the real Professionals entry', () => {
    expect(kb('freelance_ai')!.path).toMatch(/Freelancing & Online-Income/);
  });
});
