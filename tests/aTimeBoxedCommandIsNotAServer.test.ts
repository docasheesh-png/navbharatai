// Autopsy c6e4c6ff (2026-09-18) — 103 seconds burned fighting the agent's own instruction.
//
// The agent ran, to watch its backend boot:
//     . .env && DATABASE_URL="$DATABASE_URL" timeout 5 npm run server 2>&1 | head -30
// `isLongRunningCommand` said TRUE, so the managed dev-server sequence ran on it — deps check, port
// pin, host bind, backgrounded launch, port wait, two RESTART attempts — and closed with
//     [health-check] dev server did not come up on port 3000 after automatic recovery.
// four lines below the app's own "Server listening on port 3000". Both in the same output.
//
// `timeout N` is the agent SAYING the command exits. This is the third member of the class this
// file already records twice (`2>/dev/null`, `--save-dev`): a pattern matching a command's WORDS
// while its SHAPE says the opposite.
import { describe, it, expect } from 'vitest';
import {
  isLongRunningCommand,
  isSmokeTestSegment,
  timeBoxedSeconds,
  MAX_TIMEBOX_SECONDS,
} from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';

describe('the exact command that cost 103 seconds', () => {
  const real = '. .env && DATABASE_URL="$DATABASE_URL" timeout 5 npm run server 2>&1 | head -30';

  it('is no longer treated as a dev server to manage', () => {
    expect(isLongRunningCommand(real)).toBe(false);
  });

  it('is recognised as time-boxed even behind an env assignment', () => {
    // `timeout` is not at position 0 here — an anchored prefix test could never have caught it.
    expect(isSmokeTestSegment(' DATABASE_URL="$DATABASE_URL" timeout 5 npm run server 2>&1 | head -30')).toBe(true);
  });
});

describe('timeBoxedSeconds reads the bound the agent wrote', () => {
  const cases: Array<[string, number | null]> = [
    ['timeout 5 npm run server', 5],
    ['timeout 5s npm run dev', 5],
    ['timeout 2m npm run dev', 120],
    ['timeout 1h npm run dev', 3600],
    ['timeout 1d npm run dev', 86400],
    ['timeout -k 2 30 npm run dev', 30],          // -k CONSUMES its argument; 30 is the duration
    ['timeout -s TERM 45 npm run dev', 45],       // so does -s
    ['timeout --kill-after 2 30 npm run dev', 30],
    ['timeout -k 2 600 npm run dev', 600],        // the case where reading -k's arg would be unsafe
    ['timeout --foreground 5 npm run dev', 5],    // a flag that takes no argument
    ['timeout -k2 30 npm run dev', 30],           // attached short-option argument
    ['/usr/bin/timeout 5 npm run dev', 5],        // an absolute path to the binary
    ['npm run dev', null],
    ['npm run dev -- --timeout 5000', null],      // a FLAG is not the command
    ['timeout 0 npm run dev', null],              // 0 bounds nothing
    ['', null],
  ];
  for (const [cmd, expected] of cases) {
    it(`${cmd || '(empty)'} → ${expected}`, () => expect(timeBoxedSeconds(cmd)).toBe(expected));
  }
});

describe('the cap is the safety argument', () => {
  it(`a bound at or under ${MAX_TIMEBOX_SECONDS}s is a smoke test`, () => {
    expect(isSmokeTestSegment(`timeout ${MAX_TIMEBOX_SECONDS} npm run dev`)).toBe(true);
    expect(isLongRunningCommand(`timeout ${MAX_TIMEBOX_SECONDS} npm run dev`)).toBe(false);
  });

  it('a kill-after argument can never be mistaken for the duration', () => {
    // Reading -k's 2 here would call a ten-minute server a smoke test and run it in the foreground.
    expect(isSmokeTestSegment('timeout -k 2 600 npm run dev')).toBe(false);
    expect(isLongRunningCommand('timeout -k 2 600 npm run dev')).toBe(true);
  });

  it('a LONG bound keeps the managed path exactly as it is', () => {
    // `timeout 600 npm run dev` may genuinely mean "start the server"; running that in the foreground
    // would block until E2B's own command timeout — strictly worse than today.
    expect(isSmokeTestSegment('timeout 600 npm run dev')).toBe(false);
    expect(isLongRunningCommand('timeout 600 npm run dev')).toBe(true);
    expect(isLongRunningCommand('timeout 5m npm run dev')).toBe(true);
  });
});

describe('a REAL dev-server launch is untouched — this fix must not stop servers starting', () => {
  const launches = [
    '. .env && npm run dev 2>&1 | head -40',
    'npm run dev',
    'npm run dev -- --host 0.0.0.0',
    'npx vite',
    'next dev',
    'ng serve',
    'uvicorn main:app --reload',
    'pkill -f "vite"; sleep 1; npm run dev &',
  ];
  for (const cmd of launches) {
    it(`"${cmd}" still takes the managed path`, () => expect(isLongRunningCommand(cmd)).toBe(true));
  }
});

describe('the two classes this file already records stay closed', () => {
  it('a redirect is still not a dev server (autopsy debc468c)', () => {
    expect(isLongRunningCommand('git checkout HEAD -- server/ensureSchema.ts 2>/dev/null')).toBe(false);
    expect(isLongRunningCommand('ls -la 2>/dev/null')).toBe(false);
  });

  it('--save-dev is still not a dev server (the VPN App autopsy)', () => {
    expect(isLongRunningCommand('npm install --save-dev @types/react @types/react-dom')).toBe(false);
  });
});

describe('REVERSION GUARD — the predicate must be consulted where the decision is made', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const src = fs.readFileSync('src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost.ts', 'utf8');
  const fn = src.slice(src.indexOf('export function isLongRunningCommand'), src.indexOf('export function stripDevServerBackgrounding'));

  it('isLongRunningCommand consults isSmokeTestSegment', () => {
    expect(fn).toContain('isSmokeTestSegment');
  });
});
