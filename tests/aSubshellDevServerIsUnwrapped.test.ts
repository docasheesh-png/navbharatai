// 🔴 A DEV SERVER BACKGROUNDED IN A SUBSHELL IS STARTED, NOT MANGLED (failedbr #2379, f0313035, 2026-11-15).
//
// The model ran `(npm run dev -- --host 0.0.0.0 --port 3000 >/dev/null 2>&1 &) ; sleep 3; node -e '…port probe…'`. The
// launcher's splitter cut on the `&` inside the parentheses, kept the `(` and lost the `)`, and ran
// `( BROWSER=none (npm run dev … ) > /tmp/nbai-devserver.log 2>&1` — a bash syntax error on every attempt, reported as
// "the dev server did not start and its log had no recognisable error" three times (84 s). The user stopped.
// Reversion: drop the unwrapSubshellBackgroundedServer call from dropProbesAfterDevServer and the first test fails.

import { describe, it, expect } from 'vitest';
import { pastedAppFacts } from '../src/server/lib/pastedSource';
import { dropProbesAfterDevServer, stripDevServerBackgrounding, unwrapSubshellBackgroundedServer } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';

/** The report's own command (the probe body trimmed). */
const REAL = `(npm run dev -- --host 0.0.0.0 --port 3000 >/dev/null 2>&1 &) ; sleep 3; node -e 'const fs=require("fs");console.log("LISTENING")'`;

describe('the subshell is unwrapped before the probes are dropped', () => {
  it('#2379: the launcher gets the bare dev command — balanced, no stray parenthesis', () => {
    const serverOnly = dropProbesAfterDevServer(REAL);
    expect(serverOnly).toBe('npm run dev -- --host 0.0.0.0 --port 3000 >/dev/null 2>&1 &');
    const launched = stripDevServerBackgrounding(serverOnly);
    expect(launched).toBe('npm run dev -- --host 0.0.0.0 --port 3000');
    expect(launched).not.toMatch(/[()]/);
  });
  it('a subshell server with nothing after it is unwrapped too', () => {
    expect(unwrapSubshellBackgroundedServer('(npm run dev &)')).toBe('npm run dev &');
  });
  it('anything else is left exactly as it was', () => {
    for (const cmd of ['npm run dev', 'npm run dev &', '(cd frontend && npm install)', '(npm run build &) ; echo done', 'npm run dev -- --port 3000 &\ncurl -s localhost:3000']) {
      expect(unwrapSubshellBackgroundedServer(cmd), cmd).toBe(cmd);
    }
  });
});

// …and the same report's pasted page: its four emoji buttons were counted as "0 button(s)".
describe('emoji-labelled buttons are controls (failedbr #2379)', () => {
  const PAGE = `<!DOCTYPE html><html><head><title>3D Driving Game</title></head><body>
<div id="controls">
<button onclick="move(-1)">⬅️</button>
<button onclick="speedUp()">⚡</button>
<button onclick="brake()">🛑</button>
<button onclick="move(1)">➡️</button>
<button aria-label="Pause the game">⏸</button>
<button>Start</button>
</div></body></html>`;
  it('all six are kept, each distinct', () => {
    expect(pastedAppFacts(PAGE).controls).toEqual(['⬅️ (move(-1))', '⚡ (speedUp())', '🛑 (brake())', '➡️ (move(1))', 'Pause the game', 'Start']);
  });
  it('an empty or decorative-only button is still not a control', () => {
    expect(pastedAppFacts('<!DOCTYPE html><html><body><button></button><button>   </button></body></html>').controls).toEqual([]);
  });
});
