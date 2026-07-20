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
