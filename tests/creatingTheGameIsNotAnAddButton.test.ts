// failedbr #1341 → #1343 (2026-11-20): ". Create game" was read as a request for an Add control (REQ-001 "Add / create");
// the requirement was carried into the next turn, which built a "Create New Text File" feature instead of the game.
import { describe, expect, it } from 'vitest';
import { requestedProbeFeatures } from '../src/server/AgentV3/FeaturePresence';

const probes = (m: string) => requestedProbeFeatures(m).map((f) => f.feature);

describe('creating the product is not an Add button (failedbr #1341)', () => {
  it.each(['. Create game', 'Create a block game', 'create an app for notes', 'create my portfolio website'])('no Add probe: %s', (m) => {
    expect(probes(m)).not.toContain('add');
  });
  it.each(['add a task', 'todo app where I can add tasks and create notes', 'add a task to the game', 'create a new entry'])('still an Add: %s', (m) => {
    expect(probes(m)).toContain('add');
  });
});
