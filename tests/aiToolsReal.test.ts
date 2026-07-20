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
    expect(entry!.path).toContain('AI Tools → Voice to App');
    // The description must state the REAL mechanism (hand-off to Pro v5.0), not a fake generate.
    expect(entry!.description).toMatch(/Pro v5\.0/);
    expect(entry!.description).toMatch(/prefilled|prefill/i);
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
    expect(entry!.path).toContain('AI Tools → AI Debugger');
    expect(entry!.description).toMatch(/REAL AI analysis/i);
    expect(entry!.description).toMatch(/never shows a canned fake/i);
    expect(navFor(entry!)).toEqual({ view: 'debugger' });
  });

  it('the canned mock generator is gone from the client (fake analysis can never return)', () => {
    const src = readFileSync(join(__dirname, '../src/components/ide/AIDebugger.tsx'), 'utf8');
    expect(src).not.toMatch(/function generateMockResponse\(/);
    // Failures now surface honestly.
    expect(src).toContain('analyzeError');
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
    expect(entry!.path).toContain('AI Tools → AI Image Gen');
    expect(entry!.description).toMatch(/REAL images/i);
    expect(entry!.description).toMatch(/never shows a placeholder/i);
    expect(navFor(entry!)).toEqual({ view: 'imagegen' });
  });

  it('the client calls our server route — the third-party hotlink is gone for good', () => {
    const src = readFileSync(join(__dirname, '../src/components/ide/AIImageGenerator.tsx'), 'utf8');
    expect(src).toContain("'/api/image/generate'");
    expect(src).not.toContain('pollinations');
  });

  it('the /api/image/generate route is registered on the server', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/imageGen.ts'), 'utf8');
    expect(route).toContain("app.post('/api/image/generate'");
    const server = readFileSync(join(__dirname, '../server.ts'), 'utf8');
    expect(server).toContain('registerImageGenRoutes(app)');
  });
});

describe('Bot Builder — real build handoff', () => {
  it('KB entry exists, is honest, and Offline AI can navigate to it', () => {
    const entry = kb('bot_builder');
    expect(entry).toBeTruthy();
    expect(entry!.path).toContain('AI Tools → Bot Builder');
    expect(entry!.description).toMatch(/BUILD it for real/i);
    expect(entry!.description).toMatch(/Pro v5\.0/);
    expect(navFor(entry!)).toEqual({ view: 'botbuilder' });
  });

  it('the component wires "Build Bot App" through the v5 prefill signal', () => {
    const src = readFileSync(join(__dirname, '../src/components/ide/BotBuilder.tsx'), 'utf8');
    expect(src).toContain('botFlowToBuildPrompt');
    expect(src).toContain('onBuildViaV5');
    const vp = readFileSync(join(__dirname, '../src/components/panels/ViewPanels.tsx'), 'utf8');
    expect(vp).toMatch(/BotBuilder onBuildViaV5/);
  });
});
