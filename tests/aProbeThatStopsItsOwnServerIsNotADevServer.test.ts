// Autopsy 05eb30ba (2026-11-18): three diagnostic commands that started a server for themselves (`… & pid=$!`)
// and killed it again were classified as dev-server starts and answered with "dev server already healthy on
// port 5173 — reused it" — without running. The real commands from that report are the fixtures.
import { describe, expect, it } from 'vitest';
import { isLongRunningCommand, managesItsOwnServerLifetime } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';

const REAL = [
  `(npm run preview -- --host 127.0.0.1 > /tmp/apex-preview.log 2>&1 & pid=$!; sleep 2; printf '%s\\n' '--- HTTP HEAD ---'; curl -I --max-time 5 http://127.0.0.1:4173/; printf '%s\\n' '--- PAGE MARKERS ---'; curl -s --max-time 5 http://127.0.0.1:4173/ | grep -Eo '<title>[^<]+|id="root"' | head; kill $pid; wait $pid 2>/dev/null; printf '%s\\n' '--- PREVIEW LOG ---'; cat /tmp/apex-preview.log)`,
  `npx vite --host 127.0.0.1 > /tmp/nav-vite.log 2>&1 & pid=$!; for i in $(seq 1 30); do curl -sf http://127.0.0.1:5173/src/game/Game.ts -o /tmp/Game.js && break; sleep .2; done; curl -sf http://127.0.0.1:5173/src/game/GameCanvas.tsx -o /tmp/GameCanvas.js; kill $pid; wait $pid 2>/dev/null || true; printf '%s\\n' '--- Game exports ---'; tail -n 8 /tmp/Game.js`,
  `set -e\nport=5189\nnpx vite --host 127.0.0.1 --port $port > /tmp/nav-vite.log 2>&1 & pid=$!\ncleanup(){ kill $pid 2>/dev/null || true; wait $pid 2>/dev/null || true; }\ntrap cleanup EXIT\nfor i in $(seq 1 30); do curl -sf "http://127.0.0.1:$port/" >/dev/null && break; sleep .2; done\ncurl -sf "http://127.0.0.1:$port/src/game/Game.ts" -o /tmp/Game.js\ngrep -n "export.*Game" /tmp/Game.js || true`,
];

describe('a probe that stops its own server is not the app\'s dev server', () => {
  it.each(REAL)('the real command runs as itself: %#', (cmd) => {
    expect(managesItsOwnServerLifetime(cmd)).toBe(true);
    expect(isLongRunningCommand(cmd)).toBe(false);
  });

  it('a real dev-server start keeps today\'s handling', () => {
    for (const cmd of ['npm run dev -- --host 0.0.0.0 --port 5173', 'npx vite --host 0.0.0.0', 'npm run dev &', 'nohup npm run dev > /tmp/dev.log 2>&1 &']) {
      expect(isLongRunningCommand(cmd)).toBe(true);
    }
  });

  it('stopping a server and then starting it for real is still a dev-server start', () => {
    expect(isLongRunningCommand('npm run dev & pid=$!; sleep 3; kill $pid; npm run dev')).toBe(true);
  });

  it('capturing a pid without killing it is not enough', () => {
    expect(isLongRunningCommand('npm run dev & pid=$!; echo $pid > /tmp/dev.pid')).toBe(true);
  });
});
