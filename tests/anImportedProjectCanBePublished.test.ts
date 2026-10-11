// AN IMPORTED PROJECT CAN BE PUBLISHED (admin 2026-10-07, the isolation-probe zip).
//
// On a fresh chat the admin imported a zip: "Imported 2 files", preview running, connect audit done — and
// Publish was grey. `state.workspaceId` was set ONLY by the build stream's `workspace` event, so a session
// whose workspace came from an import (zip or repo, both through `runProjectImport`) never had one in its
// state, and every control gated on `!state.workspaceId` (Publish, Report) stayed disabled.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adoptWorkspace } from '../src/components/agentv3/agentV3Reducer';
import { initialAgentV3State } from '../src/components/agentv3/agentV3Types';

const read = (f: string): string => readFileSync(join(__dirname, '..', f), 'utf8');

describe('adoptWorkspace', () => {
  it('🔒 a session with no workspace takes the one its import landed in', () => {
    expect(initialAgentV3State.workspaceId).toBeFalsy();
    expect(adoptWorkspace(initialAgentV3State, 'agentv3-u1-s1').workspaceId).toBe('agentv3-u1-s1');
  });

  it('🔒 never replaces a live workspace — a session attached to a build keeps it', () => {
    const live = { ...initialAgentV3State, workspaceId: 'agentv3-live' };
    expect(adoptWorkspace(live, 'agentv3-other')).toBe(live);
  });

  it('a blank id changes nothing', () => {
    expect(adoptWorkspace(initialAgentV3State, '  ')).toBe(initialAgentV3State);
    expect(adoptWorkspace(initialAgentV3State, null)).toBe(initialAgentV3State);
  });
});

describe('the import path adopts the workspace it landed in', () => {
  const panel = read('src/components/agentv3/AgentV3Panel.tsx');
  const start = panel.indexOf('const runProjectImport = async (');
  const body = panel.slice(start, panel.indexOf('\n  };\n', start));

  it('🔒 runProjectImport adopts targetWorkspaceId as soon as the import succeeded, before reporting it', () => {
    expect(start).toBeGreaterThan(0);
    const cancelled = body.indexOf('if (!result) return;');
    const adopted = body.indexOf('adoptWorkspace(targetWorkspaceId);');
    const reported = body.indexOf('Imported ');
    expect(cancelled).toBeGreaterThan(0);
    expect(adopted).toBeGreaterThan(cancelled);
    expect(adopted).toBeLessThan(reported);
  });

  it('the hook exposes it, and the panel takes it from the hook', () => {
    expect(read('src/hooks/useAgentV3Build.ts')).toMatch(/adoptWorkspace: \(workspaceId: string\) => void;/);
    expect(panel).toMatch(/const \{ state,[^}]*\badoptWorkspace\b[^}]*\} = useAgentV3Build\(\);/);
  });

  it('Publish and Report are still gated on the session HAVING a workspace — adoption is what opens them', () => {
    expect(panel).toContain('disabled={running || !state.workspaceId}');
  });
});
