/**
 * AUTOPSY f15a9bcc (2026-09-23), admin-approved 2026-09-24. A vendor-status app was asked to show
 * "nearby shops that are open". The build generated four "nearby vendors" around the user and listed
 * them as real, the reviewer passed it, and the fake-code check said "No fake/placeholder code" — it
 * knew only the literal words fakeData / mockData / dummyData.
 *
 * Locked here: the check now recognises made-up data about OTHER people (precision-first), the user is
 * told in plain words, and both prompts tell the model not to invent it in the first place.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  scanAuthenticity, simulatedDataIssues, simulatedDataNotice, highSeverityAuthenticityIssues,
} from '../src/server/AgentV3/AuthenticityAnalysis';
import { architectSystemPrompt, NO_INVENTED_PEOPLE_RULE } from '../src/server/AgentV3/systemPrompt';
import { fileSystemPrompt } from '../src/server/AgentV3/SimpleBuilder';
import { GOLDEN_SCAFFOLDS } from '../src/server/AgentV3/goldenScaffolds/registry';

const kinds = (line: string, file = 'src/useNearbyDiscovery.ts') => scanAuthenticity(file, line).map((i) => i.kind);

describe('made-up data about other people is recognised', () => {
  it.each([
    'function generateSimulatedVendors(center: LatLng): NearbyBusiness[] {',
    'const SIMULATED_NEARBY_SHOPS = 4;',
    'const mockUsers = [{ id: 1 }];',
    'setDrivers(fakeDrivers);',
    '  // Simulate nearby vendors around the user so the list is not empty',
    'const dummyFollowers = ["a", "b"];',
  ])('flags %s', (line) => {
    expect(kinds(line)).toContain('simulated-data');
  });

  it.each([
    'const sampleProducts = [{ name: "Tea", price: 10 }];', // the app's OWN catalogue is its data
    'const seedMenu = loadMenu();',
    'world.simulateGravity(dt);',                          // physics, no people
    'const simulation = new Simulation();',
    'import mockup from "./mockup.png";',
    'const users = await supabase.from("users").select();', // real data
    '<input placeholder="Search users" />',
    'export function MockInterviewPage() {',                // "mock interview" is a product, not people
  ])('does not flag %s', (line) => {
    expect(kinds(line, 'src/App.tsx')).not.toContain('simulated-data');
  });

  it('is advisory: never a readiness blocker that would fail a build and force a doomed heal', () => {
    const files = { 'src/useNearbyDiscovery.ts': 'const mockUsers = [];' };
    expect(simulatedDataIssues(files)).toHaveLength(1);
    expect(highSeverityAuthenticityIssues(files)).toHaveLength(0);
  });

  it('ignores tests and mock folders — those are supposed to hold made-up data', () => {
    expect(simulatedDataIssues({
      'src/__mocks__/users.ts': 'export const mockUsers = [];',
      'src/mocks/vendors.ts': 'export const fakeVendors = [];',
      'src/Nearby.test.tsx': 'const mockUsers = [];',
    })).toHaveLength(0);
  });

  it('none of our own templates trips it (precision canary)', () => {
    expect(GOLDEN_SCAFFOLDS.length).toBeGreaterThan(10);
    const hits = GOLDEN_SCAFFOLDS.flatMap((s) => simulatedDataIssues({ 'src/App.tsx': s.appTsx }).map((i) => `${s.id}: ${i.snippet}`));
    expect(hits).toEqual([]);
  });
});

describe('the user is told, in plain words', () => {
  it('names the file, says it is demo data, and offers the real path', () => {
    const note = simulatedDataNotice(simulatedDataIssues({ 'src/useNearbyDiscovery.ts': 'const fakeVendors = [];' }));
    expect(note).toContain('demo data, not real data');
    expect(note).toContain('src/useNearbyDiscovery.ts');
    expect(note).toContain('shared online database');
    expect(note).not.toMatch(/GLM|Kimi|Claude|Anthropic|Gemini|Grok|Moonshot|Nemotron/i); // white-label
    expect(note).not.toMatch(/[ऀ-ॿ]/); // English-only UI text
    expect(simulatedDataNotice([])).toBe('');
  });

  it('the route appends it to the summary and records it (source guard)', () => {
    const src = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(src).toMatch(/summary: `\$\{result\.summary\}\$\{simulatedDataNotice\(invented\)\}`/);
    expect(src).toContain("code: 'SIMULATED_DATA_SHIPPED'");
  });
});

describe('the model is told not to invent it in the first place', () => {
  it('the architect prompt carries the rule', () => {
    expect(architectSystemPrompt('vite-react')).toContain(NO_INVENTED_PEOPLE_RULE);
    expect(NO_INVENTED_PEOPLE_RULE).toMatch(/Bluetooth/);
    expect(NO_INVENTED_PEOPLE_RULE).toMatch(/shared online database/);
  });
  it('the fast lane\'s per-file prompt carries it too', () => {
    expect(fileSystemPrompt('vite-react')).toMatch(/Never generate simulated\/mock data about OTHER people/);
  });
});
