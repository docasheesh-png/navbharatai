// failedbr #1153, #1102, #1043 (2026-11-20): "I made your change, but I could not open your app" went out on NEW apps and on
// previews that WERE opened and showed a console error.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { greenGuardUnverifiedMessage } from '../src/server/AgentV3/GreenGuard';

describe('the unverified note says which thing happened (failedbr #1153)', () => {
  it('a new app opened and broken', () => {
    const m = greenGuardUnverifiedMessage({ provenBroken: true, newApp: true });
    expect(m).toMatch(/I built your app, but when I opened it the preview showed an error/);
    expect(m).not.toMatch(/could not open|made your change/);
  });
  it('the old sentence stays for an edit that could not be checked', () => {
    expect(greenGuardUnverifiedMessage()).toMatch(/^⚠️ I made your change, but I could not open your app to confirm it works this time\./);
  });
  it('🔒 both route call sites pass the facts', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route.match(/greenGuardUnverifiedMessage\(\{ provenBroken: previewProvenBroken === true, newApp: intent === 'new_build' \}\)/g)?.length).toBe(2);
    expect(route).not.toContain('greenGuardUnverifiedMessage()');
  });
});
