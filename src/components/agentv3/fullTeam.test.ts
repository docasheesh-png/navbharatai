import { describe, it, expect } from 'vitest';
import { canSteerMidBuild, showTeamHq, teamHqModel, formatElapsed } from './fullTeam';
import type { AgentCard, TodoItem } from './agentV3Types';

describe('canSteerMidBuild — mid-build messages are open to EVERY tier (A1, was max-only)', () => {
  it('allows a running build in the build lane', () => {
    expect(canSteerMidBuild(true, 'max', 'build')).toBe(true);
  });

  // THE CHANGE (ROADMAP §8A/A1): these tiers used to be refused, leaving Stop-and-rebuild as the only
  // correction — paying for a whole build to avoid one turn. The free tier paid it in NavBharatAI's money.
  it('allows EVERY lower tier too — control is not what makes Full Team premium', () => {
    for (const tier of ['weak', 'off', 'mini', 'medium']) {
      expect(canSteerMidBuild(true, tier, 'build'), tier).toBe(true);
    }
  });

  it('still refuses when idle (a normal send starts a turn instead) and on the read-only lanes', () => {
    expect(canSteerMidBuild(false, 'max', 'build')).toBe(false);
    expect(canSteerMidBuild(false, 'weak', 'build')).toBe(false);
    expect(canSteerMidBuild(true, 'max', 'planner')).toBe(false);
    expect(canSteerMidBuild(true, 'weak', 'advisor')).toBe(false);
  });
});

describe('showTeamHq — the premium card renders only for a live Full Team build', () => {
  it('max + running → shown; anything else → hidden', () => {
    expect(showTeamHq(true, 'max')).toBe(true);
    expect(showTeamHq(false, 'max')).toBe(false);
    expect(showTeamHq(true, 'medium')).toBe(false);
    expect(showTeamHq(true, 'off')).toBe(false);
  });
});

describe('teamHqModel — the card is driven by REAL reducer state (agents + plan todos)', () => {
  const agents: Record<string, AgentCard> = {
    architect: { agent: 'architect' as any, lastAction: 'planning', active: true, updatedTs: 100 },
    frontend: { agent: 'frontend' as any, lastAction: 'writing App.tsx', active: true, updatedTs: 300 },
    reviewer: { agent: 'reviewer' as any, lastAction: 'finished', active: false, updatedTs: 200 },
  };
  const todos: TodoItem[] = [
    { id: '1', text: 'scaffold', status: 'done' } as any,
    { id: '2', text: 'build ui', status: 'in_progress' } as any,
    { id: '3', text: 'wire api', status: 'pending' } as any,
  ];

  it('roster is newest-activity-first; activeCount counts only working members', () => {
    const m = teamHqModel(agents, todos);
    expect(m.roster.map((a) => a.agent)).toEqual(['frontend', 'reviewer', 'architect']);
    expect(m.activeCount).toBe(2);
  });

  it('progress squares mirror the real plan (done/active/total)', () => {
    const m = teamHqModel(agents, todos);
    expect(m.progress).toEqual({ done: 1, active: 1, total: 3 });
  });

  it('empty state: no agents, no todos → zeroed model (card renders nothing fake)', () => {
    const m = teamHqModel({}, []);
    expect(m.roster).toEqual([]);
    expect(m.activeCount).toBe(0);
    expect(m.progress).toEqual({ done: 0, active: 0, total: 0 });
  });
});

describe('formatElapsed', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatElapsed(9_000)).toBe('9s');
    expect(formatElapsed(222_000)).toBe('3m 42s');
    expect(formatElapsed(3_720_000)).toBe('1h 2m');
    expect(formatElapsed(-5)).toBe('0s');
  });
});
