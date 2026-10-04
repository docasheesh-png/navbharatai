// Autopsy "Sur Taal" (2026-10-04): a music player described in eight numbered design sections (Hindi
// prose, bullet lists) was decomposed into 23 project modules, one "continue" each. The same report
// carried five more false findings; each class is locked here with the report's own prompt.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isLongRunningCommand, pathsAsBasenames } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';
import { TSC_ENSURE, PRIME_NODE_MODULES } from '../src/server/AgentV3/tscCommand';
import { megaProjectSignals, detectMegaProject } from '../src/server/AgentV3/ProjectPlan';
import { sectionedSpecSize, countEnumeratedFeatures } from '../src/server/AgentV3/enumeratedFeatures';
import { analyzeRequirementGaps, shouldSurfaceRequirementGaps, boundDevanagari } from '../src/server/lib/RequirementGapAnalyzer';
import { requestedCapabilities } from '../src/server/AgentV3/nativeCapabilities';
import { lintDesign, TOKEN_MODULE_PATH } from '../src/server/AppMakerLab/intelligence/DesignLinter';
import { moduleTurnEtaLine, skipsOpeningEta } from '../src/server/AgentV3/moduleTurnEta';

const PROMPT = readFileSync('tests/fixtures/surTaalPrompt.txt', 'utf8');
const ROUTE = readFileSync('src/server/routes/agentv3.ts', 'utf8');

describe('A · a path that contains "vite" is not a dev-server launch', () => {
  it('the typecheck and the warm-cache copy are ordinary commands', () => {
    expect(isLongRunningCommand(TSC_ENSURE)).toBe(false);
    expect(isLongRunningCommand(PRIME_NODE_MODULES)).toBe(false);
    expect(isLongRunningCommand('cp -a /home/user/.warm/vite-react/node_modules node_modules')).toBe(false);
  });
  it('a real launch is still one', () => {
    for (const c of ['npm run dev', 'npx vite', './node_modules/.bin/vite --host', 'vite']) expect(isLongRunningCommand(c)).toBe(true);
    expect(isLongRunningCommand('npx vite build')).toBe(false);
  });
  it('paths shrink to their last segment', () => {
    expect(pathsAsBasenames('cp /a/vite-react/x y')).toBe('cp x y');
  });
});

describe('B · numbered design sections size the request, not every bullet under them', () => {
  it('eight sections, not forty features — and no project plan', () => {
    expect(countEnumeratedFeatures(PROMPT)).toBeGreaterThanOrEqual(14); // what fired project mode
    expect(sectionedSpecSize(PROMPT)).toBe(8);
    const s = megaProjectSignals(PROMPT);
    expect(s.sections).toBe(8);
    expect(s.fires).toBe(false);
    expect(detectMegaProject(PROMPT)).toBe(false);
  });
  it('a plain bullet list is not a sectioned spec', () => {
    expect(sectionedSpecSize('- login\n- dashboard\n- reports\n- settings')).toBeNull();
  });
});

describe('C · the domain is read from words, not from pieces of words or a menu button', () => {
  it('the music player is not a shop or a restaurant', () => {
    const g = analyzeRequirementGaps(PROMPT);
    expect(g.domain).not.toBe('ecommerce');
    expect(g.domain).not.toBe('restaurant');
    expect(shouldSurfaceRequirementGaps(g)).toBe(false);
  });
  it('a Devanagari word must stand alone', () => {
    const re = boundDevanagari(/सामान/);
    expect(re.test('सामान्य')).toBe(false);
    expect(re.test('घर का सामान')).toBe(true);
  });
  it('a real shop and a real restaurant still read as one', () => {
    expect(analyzeRequirementGaps('build an online store with cart and checkout').domain).toBe('ecommerce');
    expect(analyzeRequirementGaps('restaurant app with menu, table orders and KOT').domain).toBe('restaurant');
  });
});

describe('D · phone powers are named by what the app does, not by a word in a label', () => {
  it('"Music Scanner", "Contact us" and "Event location" ask for nothing', () => {
    expect(requestedCapabilities(PROMPT).map((c) => c.id)).toEqual([]);
    expect(requestedCapabilities('add a Contact us page and show the event location').map((c) => c.id)).toEqual([]);
  });
  it('real requests still match', () => {
    expect(requestedCapabilities('scan a QR code to pay').map((c) => c.id)).toContain('qr-scan');
    expect(requestedCapabilities('pick a contact from the phone book').map((c) => c.id)).toContain('contacts');
    expect(requestedCapabilities('show my current location on a map').map((c) => c.id)).toContain('location');
  });
});

describe('E · the palette module is the palette, not a colour explosion', () => {
  const palette = Array.from({ length: 30 }, (_, i) => `  c${i}: '#${(0x100000 + i * 4111).toString(16).slice(0, 6)}',`).join('\n');
  const tokens = `export const colors = {\n${palette}\n};`;
  it('a theme/colors module is recognised', () => {
    for (const p of ['src/theme/colors.ts', 'src/design/tokens.ts', 'src/palette.ts']) expect(TOKEN_MODULE_PATH.test(p)).toBe(true);
    expect(TOKEN_MODULE_PATH.test('src/screens/Player.tsx')).toBe(false);
  });
  it('its colours do not count against the budget', () => {
    const without = lintDesign(tokens);
    const withModule = lintDesign(tokens, { tokenModuleCode: tokens });
    expect(without.violations.some((v) => v.type === 'color-count')).toBe(true);
    expect(withModule.violations.some((v) => v.type === 'color-count')).toBe(false);
  });
});

describe('F · a module turn is not promised the whole app\'s time', () => {
  const plan = { modules: [{ status: 'done' }, { status: 'pending' }] };
  it('a continue of an unfinished plan skips the opening estimate', () => {
    expect(skipsOpeningEta(plan, true, () => true)).toBe(true);
    expect(skipsOpeningEta(plan, false, () => true)).toBe(false);
    expect(skipsOpeningEta(plan, true, () => false)).toBe(false);
    expect(skipsOpeningEta({ modules: [{ status: 'done' }] }, true, () => true)).toBe(false);
    expect(skipsOpeningEta(null, true, () => true)).toBe(false);
  });
  it('the module line does not mention an estimate that was never shown', () => {
    expect(moduleTurnEtaLine(1, 23, 'Player')).toMatch(/estimate above/);
    expect(moduleTurnEtaLine(1, 23, 'Player', false)).not.toMatch(/estimate/);
  });
  it('the route peeks before the estimate and stays silent on a skipped one', () => {
    const peek = ROUTE.indexOf("'eta-plan-peek'");
    const est = ROUTE.indexOf('const est = estimateBuildTime(etaComplexity');
    expect(peek).toBeGreaterThan(0);
    expect(peek).toBeLessThan(est);
    expect(ROUTE).toMatch(/if \(etaSkippedForModule\) \{[\s\S]{0,400}ETA_SKIPPED_MODULE_TURN[\s\S]{0,300}\} else \{\s*\n\s*events\.emit\(\{ type: 'narration', agent: 'architect', text: etaShown/);
  });
});
