import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/server/routes/supabaseIntegration.ts', 'utf8');
const ui = readFileSync('src/components/settings/SupabaseConnectCard.tsx', 'utf8');

describe('BYO_LIFECYCLE_V1 wiring', () => {
  it('both new routes answer 404 before doing anything when the flag is off', () => {
    for (const route of ['test', 'rotate']) {
      const at = src.indexOf(`app.post('/api/integrations/supabase/${route}'`);
      expect(at).toBeGreaterThan(-1);
      const firstLine = src.slice(at, at + 300).split('\n')[1];
      expect(firstLine).toContain("envFlag('BYO_LIFECYCLE_V1')");
      expect(firstLine).toContain('404');
    }
  });
  it('rotate goes through rotateKey (probe before store) and only vault-linked projects', () => {
    const body = src.slice(src.indexOf("supabase/rotate'"), src.indexOf("supabase/project-health'"));
    expect(body).toContain('rotateKey(');
    expect(body).toContain('databasesInVault(');
  });
  it('the UI renders the new buttons and the confirm only behind the flag', () => {
    expect(ui).toContain('{byoLifecycle && (');
    expect(ui).toContain('if (byoLifecycle && !window.confirm(');
  });
});
