import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * Polish campaign — Tier-1 Deploy/Hosting (5) + Billing (2), rock-solid verification.
 *
 * Root cause: three deploy entries pointed at RETIRED surfaces — "Engineer AI chat → deploy" (Engineer AI
 * is retired, App.tsx) and "Pro Chat → Deploy button" (renamed to "Publish"). The real deploy is the
 * NavBharatAI Pro v5.0 "Publish" button (Hosting chooser). Billing pointed at a non-existent "Settings →
 * Billing" tab (the real gate is the "Wallet & Billing" menu item + the Pro header token chip).
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const groups = read('src/components/home/homeToolGroups.ts');
const panel = read('src/components/agentv3/AgentV3Panel.tsx');
const app = read('src/App.tsx');
const kb = (id: string) => APP_KNOWLEDGE_BASE.find((f) => f.id === id);

describe('Deploy entries route to the real v5.0 "Publish", not retired surfaces', () => {
  it.each(['engineer_ai_deploy', 'pro_chat_multi_deploy', 'one-click-deploy'])(
    '%s no longer names Engineer AI chat / the old Deploy button',
    (id) => {
      const e = kb(id)!;
      expect(e).toBeTruthy();
      expect(e.path).not.toMatch(/Engineer AI chat/);
      expect(e.path).not.toMatch(/Pro Chat → header bar → Deploy/);
      expect(e.path).toMatch(/Pro v5\.0/);
      expect(e.path).toMatch(/Publish/);
    },
  );
  it('the real "Publish" control + Hosting chooser exist in the Pro panel', () => {
    expect(panel).toContain('setShowHostingChooser(true)');
  });
  it('Engineer AI really is retired (so the old deploy path could not have worked)', () => {
    expect(app).toMatch(/EngineerAIChat retired/);
  });
});

describe('APK Builder + CI/CD Pipeline are real Publish & Deploy tiles', () => {
  it('the tiles exist in the Publish & Deploy group', () => {
    expect(groups).toContain("title: 'Publish & Deploy'");
    expect(groups).toContain("label: 'APK Builder'");
    expect(groups).toContain("label: 'CI/CD Pipeline'");
  });
  it('their KB paths match', () => {
    expect(kb('apk_builder')!.path).toMatch(/AI Tools → APK Builder/);
    expect(kb('cicd_pipeline')!.path).toMatch(/Publish & Deploy → CI\/CD Pipeline/);
  });
});

describe('Billing routes to the real Wallet & Billing surface', () => {
  it('the KB no longer points at a non-existent "Settings → Billing" tab', () => {
    const b = kb('billing')!;
    expect(b.path).not.toMatch(/Settings → Billing/);
    expect(b.path).toMatch(/Wallet & Billing/);
  });
  it('the real "Wallet & Billing" menu item + Pro token chip → billing exist', () => {
    expect(app).toContain("label: 'Wallet & Billing'");
    expect(panel).toContain("detail: { view: 'billing' }"); // header token chip navigates to billing
  });
  it('Insights & Integrations path is the real Other AI tile', () => {
    expect(kb('insights-integrations-panel')!.path).toMatch(/Other AI → Insights & Webhooks/);
  });
});
