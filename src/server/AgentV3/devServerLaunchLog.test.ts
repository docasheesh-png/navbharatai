// Tests for the dev-server launch log — the hand-off that makes the revival recipe a FACT rather than
// a re-derivation. Every rule here exists because getting it wrong would store a recipe that looks
// valid and then fails at the moment it is needed.

import { describe, it, expect, beforeEach } from 'vitest';
import { recordDevServerLaunch, lastDevServerLaunch, __resetDevServerLaunchLog } from './devServerLaunchLog';

const NOW = 1_000_000;
const HOUR = 60 * 60 * 1000;

describe('devServerLaunchLog', () => {
  beforeEach(() => __resetDevServerLaunchLog());

  it('hands back exactly the command and port that were recorded', () => {
    recordDevServerLaunch('w1', 'npm run start', 3000, NOW);
    expect(lastDevServerLaunch('w1', NOW + 1000)).toMatchObject({ command: 'npm run start', port: 3000 });
  });

  it('the most recent launch wins — a server relaunched on a new port is not remembered on the old one', () => {
    recordDevServerLaunch('w1', 'npm run dev', 5173, NOW);
    recordDevServerLaunch('w1', 'npm run dev', 5174, NOW + 1000);
    expect(lastDevServerLaunch('w1', NOW + 2000)?.port).toBe(5174);
  });

  it('workspaces are isolated — one app never inherits another app’s start command', () => {
    recordDevServerLaunch('w1', 'npm run dev', 5173, NOW);
    expect(lastDevServerLaunch('w2', NOW)).toBeNull();
  });

  it('a stale launch is NOT evidence about the server running now', () => {
    recordDevServerLaunch('w1', 'npm run dev', 5173, NOW);
    expect(lastDevServerLaunch('w1', NOW + 2 * HOUR)).toBeNull();
  });

  it('refuses junk rather than storing a launch that cannot be replayed', () => {
    recordDevServerLaunch('w1', '', 5173, NOW);
    recordDevServerLaunch('w2', 'npm run dev', 0, NOW);
    recordDevServerLaunch('w3', 'npm run dev', 70000, NOW);
    recordDevServerLaunch('', 'npm run dev', 5173, NOW);
    expect(lastDevServerLaunch('w1', NOW)).toBeNull();
    expect(lastDevServerLaunch('w2', NOW)).toBeNull();
    expect(lastDevServerLaunch('w3', NOW)).toBeNull();
  });

  it('an unknown workspace is null, never a fabricated default', () => {
    expect(lastDevServerLaunch('never-seen', NOW)).toBeNull();
  });
});
