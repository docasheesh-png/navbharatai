// 🔴 A MISSING-PRIVACY-POLICY NOTE IS ADVICE, NOT AN ORDER TO BUILD ONE (failedbr #2337, 00f57957, 2026-11-12).
//
// "Make a mobile gun shoring game like sniper": the done signal fired at step 10 (92/100) and the app had rendered. The
// model then ran `evaluate`, read "ships no privacy policy — add one before a public launch", answered "I need to fix the
// privacy policy issue", and started a PrivacyPolicy page and store metadata nobody asked for; the user pressed Stop.
// Reversion: put the old "— add one before a public launch." snippet back and this test fails.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('the privacy note tells the model not to build', () => {
  it('the project-level note is marked advisory and says not to build a page unless asked', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    const at = src.indexOf("kind: 'missing-privacy-policy'");
    const note = src.slice(at, at + 1200);
    expect(note).toMatch(/ADVISORY/);
    expect(note).toMatch(/do NOT build a privacy page or store metadata unless the user asked/);
    expect(note).not.toMatch(/— add one before a public launch\.'/);
    expect(note).toMatch(/severity: 'medium'/); // still surfaced, still never a blocker
  });
});
