import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { navFor } from '../src/lib/offlineAssistant';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * AI Tools real-ification (admin autopsy 2026-07-20): the Settings → AI Tools tiles were
 * display-only — Voice to App POSTed to a non-existent /api/generate and always errored.
 * These tests lock the real wiring so the tools can never silently regress to fake paths.
 */

const kb = (id: string) => APP_KNOWLEDGE_BASE.find((f) => f.id === id);

describe('Voice to App — real v5 handoff', () => {
  it('KB entry exists, is honest about the real path, and Offline AI can navigate to it', () => {
    const entry = kb('voice_to_app');
    expect(entry).toBeTruthy();
    // Corrected 2026-07-31: the builder tools left "Settings → AI Tools" (moved to Home → Other AI on
    // 2026-07-23), and Voice to App is now the inline 🎙️ mic in the NavBharatAI Pro v5.0 composer —
    // the stale "AI Tools → Voice to App" path pointed at a doorway that no longer exists.
    expect(entry!.path).toMatch(/Pro v5\.0/);
    expect(entry!.path).toMatch(/mic/i);
    expect(entry!.path).not.toMatch(/Settings/);
    // The description must state the REAL mechanism (speech dictated into the Pro v5.0 chat), not a fake generate.
    expect(entry!.description).toMatch(/Pro v5\.0/);
    expect(entry!.description).toMatch(/mic|speech|transcrib/i);
    expect(navFor(entry!)).toEqual({ view: 'voice' });
  });

  it('the component no longer calls the dead /api/generate endpoint (root cause stays dead)', () => {
    const src = readFileSync(join(__dirname, '../src/components/ide/VoiceToApp.tsx'), 'utf8');
    // The route never existed on the server — any reappearance is a regression to a fake feature.
    expect(src).not.toContain("'/api/generate'");
    expect(src).toContain('onBuildViaV5');
  });

  it('ViewPanels hands the voice prompt to the v5 prefill signal, not the legacy generated-code path', () => {
    const src = readFileSync(join(__dirname, '../src/components/panels/ViewPanels.tsx'), 'utf8');
    expect(src).toContain('onBuildViaV5Prompt');
    // The old fake flow set generatedCode from a response that could never arrive.
    expect(src).not.toMatch(/VoiceToApp onAppGenerated/);
  });
});

describe('AI Debugger — real analysis, no fake fallback', () => {
  it('KB entry exists, is honest, and Offline AI can navigate to it', () => {
    const entry = kb('ai_debugger');
    expect(entry).toBeTruthy();
    expect(entry!.path).toContain('Other AI → AI Debugger'); // moved from Settings → Home "Other AI" (2026-07-23)
    expect(entry!.description).toMatch(/REAL analysis/i);
    expect(entry!.description).toMatch(/never a fake result/i);
    expect(navFor(entry!)).toEqual({ view: 'debugger' });
  });

  it('KB entry documents the Full App Scan mode (whole-app debugging from Pro/GitHub sources)', () => {
    const entry = kb('ai_debugger');
    expect(entry!.description).toMatch(/Full App Scan/i);
    expect(entry!.description).toMatch(/file and line/i);
    expect(entry!.howToUse).toMatch(/Scan for problems/i);
    expect(entry!.keywords).toEqual(expect.arrayContaining(['full app scan', 'github repo debug']));
  });

  it('the canned mock generator is gone from the client (fake analysis can never return)', () => {
    const src = readFileSync(join(__dirname, '../src/components/ide/AIDebugger.tsx'), 'utf8');
    expect(src).not.toMatch(/function generateMockResponse\(/);
    // Failures now surface honestly.
    expect(src).toContain('analyzeError');
    // Both modes are wired: single-error + the whole-app scan panel.
    expect(src).toContain('AppScanPanel');
  });

  it('the Full App Scan panel exists and streams from the real /api/app-debug/run route', () => {
    const src = readFileSync(join(__dirname, '../src/components/ide/AppScanPanel.tsx'), 'utf8');
    expect(src).toContain('/api/app-debug/run');
    expect(src).toContain('/api/app-debug/sources');
  });

  it('the debugger has system-level intelligence: graph analyzer, health score, and investigate', () => {
    const panel = readFileSync(join(__dirname, '../src/components/ide/AppScanPanel.tsx'), 'utf8');
    expect(panel).toContain('/api/app-debug/investigate'); // deep-dive per finding
    expect(panel).toMatch(/health/i);                       // project health header
    const route = readFileSync(join(__dirname, '../src/server/routes/appDebug.ts'), 'utf8');
    expect(route).toContain('scanAppGraph');                // cross-file graph scan wired in
    const kbEntry = kb('ai_debugger');
    expect(kbEntry!.description).toMatch(/HEALTH score/);
    expect(kbEntry!.description).toMatch(/Investigate & fix/);
  });

  it('auto-fix hands the findings to the Pro v5 page for the scanned app (wired end-to-end)', () => {
    const panel = readFileSync(join(__dirname, '../src/components/ide/AppScanPanel.tsx'), 'utf8');
    expect(panel).toContain('onAutoFixInV5');           // panel invokes the handoff
    expect(panel).toContain('buildFixPrompt');          // composes the real fix prompt from findings
    const viewPanels = readFileSync(join(__dirname, '../src/components/panels/ViewPanels.tsx'), 'utf8');
    expect(viewPanels).toContain('onAutoFixInV5');      // threaded through to AIDebugger
    const app = readFileSync(join(__dirname, '../src/App.tsx'), 'utf8');
    expect(app).toContain('onAutoFixInV5');             // App implements it via v3Resume + v3PendingFix
    expect(app).toMatch(/setV3Resume\(\{ sessionId: sid/); // retargets the SCANNED app's session
    const kbEntry = kb('ai_debugger');
    expect(kbEntry!.description).toMatch(/Auto-fix these in NavBharatAI Pro/);
  });

  it('the /api/debug route is registered on the server (the endpoint the client calls exists)', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/debug.ts'), 'utf8');
    expect(route).toContain("app.post('/api/debug'");
    const server = readFileSync(join(__dirname, '../server.ts'), 'utf8');
    expect(server).toContain('registerDebugRoutes(app)');
  });
});

describe('AI Image Gen — our own engine, no third-party hotlink', () => {
  it('KB entry exists, is honest, and Offline AI can navigate to it', () => {
    const entry = kb('ai_image_gen');
    expect(entry).toBeTruthy();
    expect(entry!.path).toContain('Other AI → AI Image Gen'); // moved from Settings → Home "Other AI" (2026-07-23)
    expect(entry!.description).toMatch(/REAL images/i);
    expect(entry!.description).toMatch(/never shows a placeholder/i);
    expect(navFor(entry!)).toEqual({ view: 'imagegen' });
  });

  it('the client calls our server route — the third-party hotlink is gone for good', () => {
    const src = readFileSync(join(__dirname, '../src/components/ide/AIImageGenerator.tsx'), 'utf8');
    expect(src).toContain("'/api/image/generate'");
    // Case-INSENSITIVE — the "Pollinations AI" badge (capital P) slipped past the old lowercase check
    // (white-label leak, PROGRESS 2026-07-31). No vendor name may appear on this user-facing surface.
    expect(src).not.toMatch(/pollinations/i);
  });

  it('the /api/image/generate route is registered on the server', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/imageGen.ts'), 'utf8');
    expect(route).toContain("app.post('/api/image/generate'");
    const server = readFileSync(join(__dirname, '../server.ts'), 'utf8');
    expect(server).toContain('registerImageGenRoutes(app)');
  });
});

describe('Bot Builder — real Go-Live deployment', () => {
  it('KB entry exists, is honest, and Offline AI can navigate to it', () => {
    const entry = kb('bot_builder');
    expect(entry).toBeTruthy();
    expect(entry!.path).toContain('Other AI → Bot Builder'); // moved from Settings → Home "Other AI" (2026-07-23)
    expect(entry!.description).toMatch(/REAL bot/i);
    expect(entry!.description).toMatch(/Go Live/i);
    expect(entry!.description).toMatch(/telegram/i);
    expect(navFor(entry!)).toEqual({ view: 'botbuilder' });
  });

  it('the component wires "Go Live" to the REAL bot connector (Build Bot App removed 2026-07-23)', () => {
    const src = readFileSync(join(__dirname, '../src/components/ide/BotBuilder.tsx'), 'utf8');
    expect(src).toContain('Go Live');
    expect(src).toContain('/api/bots/telegram/connect');
    expect(src).not.toContain('Build Bot App'); // the misleading handoff button is gone
    const server = readFileSync(join(__dirname, '../server.ts'), 'utf8');
    expect(server).toContain('registerBotRoutes(app)');
  });
});
