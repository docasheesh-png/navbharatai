import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXED_TEXT_CHAIN } from '../src/server/AI/fixedTextChain';

describe('retired diagnostic interfaces retain the main-chain provider', () => {
  it('removes only diagnostic menu entries, renderers and route registration', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).not.toContain('<MitrifyChatPanel');
    expect(app).not.toContain('useMitrifyBot');
    expect(app).toContain("String(activeView) === 'mitrify_chat'");
    expect(readFileSync('src/lib/adminTabs.ts', 'utf8')).not.toContain('provider-diagnostics');
    expect(readFileSync('src/components/AdminDashboard.tsx', 'utf8')).not.toContain('ProviderDiagnosticPanels');
    expect(readFileSync('src/server/routes/admin.ts', 'utf8')).not.toContain('registerProviderDiagnosticRoutes');
    expect(readFileSync('src/server/AppContext/AppKnowledgeBase.ts', 'utf8')).not.toContain('Provider testing bots');
    for (const path of ['src/components/panels/MitrifyChatPanel.tsx', 'src/server/routes/providerDiagnostics.ts',
      'src/server/routes/providerLoadBatch.ts', 'src/server/lib/providerDiagnosticRunner.ts']) expect(existsSync(path)).toBe(false);
  });
  it('keeps requested fallback order and shared transport/security/accounting', () => {
    expect(FIXED_TEXT_CHAIN).toEqual(['glm45', 'glm47', 'groq', 'cloudflare', 'openrouter', 'mitrify', 'cheapinf', 'llama8b', 'dsv4flash', 'gpt5nano', 'glmflashx', 'geminipaid']);
    for (const path of ['src/server/lib/mitrify.ts', 'src/server/lib/providerRedaction.ts', 'src/server/AI/FreeChain/store.ts',
      'src/server/AI/InferenceGateway/firestoreLedger.ts']) expect(existsSync(path)).toBe(true);
  });
});
