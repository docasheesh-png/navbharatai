import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  LISTENING_PORTS_COMMAND, parseListeningPorts, rankPortCandidates, MAX_PORT_CANDIDATES,
} from './PortDiscovery';

// THE FLIP SYSTEM (admin 2026-08-07: "ek par na chale to dusra, dusre par na chale to teesra?") —
// adapted per the external-suggestion rule: not a blind cascade of guesses, but evidence-first
// discovery. The sandbox OS says which ports are REALLY listening; candidates are ranked by the
// strength of their evidence; and the route publishes only a port whose page actually rendered.

describe('LISTENING_PORTS_COMMAND — a fact source that exists in every sandbox', () => {
  it('reads /proc/net/tcp (no ss/netstat dependency) and filters to LISTEN state', () => {
    expect(LISTENING_PORTS_COMMAND).toContain('/proc/net/tcp');
    expect(LISTENING_PORTS_COMMAND).toContain('/proc/net/tcp6');
    expect(LISTENING_PORTS_COMMAND).toContain('"0A"'); // TCP LISTEN
    expect(LISTENING_PORTS_COMMAND).toContain('LISTENING:');
    expect(LISTENING_PORTS_COMMAND).not.toMatch(/\bss\b|\bnetstat\b/);
  });
});

describe('parseListeningPorts', () => {
  it('parses the marker line and tolerates surrounding noise', () => {
    expect(parseListeningPorts('npm WARN something\nLISTENING:3000,5000,5432\n')).toEqual([3000, 5000, 5432]);
  });

  it('empty / absent marker / garbage → []', () => {
    expect(parseListeningPorts('LISTENING:')).toEqual([]);
    expect(parseListeningPorts('no marker here')).toEqual([]);
    expect(parseListeningPorts('')).toEqual([]);
    expect(parseListeningPorts(null)).toEqual([]);
  });
});

describe('rankPortCandidates — evidence order, infra exclusion, bounds', () => {
  it('log-parsed port first, then script, then expected', () => {
    expect(rankPortCandidates({ parsed: 5000, scriptPort: 5173, expected: 3000, listening: [] }))
      .toEqual([5000, 5173, 3000]);
  });

  it('THE REPORTED CASE: expectation said 3000, the OS says the app is on 5000 — 5000 is reachable', () => {
    const c = rankPortCandidates({ parsed: null, scriptPort: null, expected: 3000, listening: [5000, 5432] });
    expect(c[0]).toBe(3000); // today's truth is still tried first (cheap, often right)
    expect(c).toContain(5000); // the flip target the OS proved
  });

  it('NEVER offers infrastructure ports — the provisioned PostgreSQL (5432) must not be published as the app', () => {
    const c = rankPortCandidates({ parsed: null, scriptPort: null, expected: 3000, listening: [22, 5432, 3306, 27017, 6379, 8080] });
    expect(c).toEqual([3000, 8080]);
  });

  it('dedupes, orders extra listeners common-dev-first, and stays bounded', () => {
    const c = rankPortCandidates({ parsed: 3000, scriptPort: 3000, expected: 3000, listening: [9999, 5173, 3000, 8080, 7777, 6666] });
    expect(c[0]).toBe(3000);
    expect(c.slice(1, 3)).toEqual([5173, 8080]); // common dev ports beat arbitrary ones
    expect(c.length).toBeLessThanOrEqual(MAX_PORT_CANDIDATES);
    expect(new Set(c).size).toBe(c.length);
  });

  it('invalid inputs are dropped, never crash', () => {
    expect(rankPortCandidates({ parsed: null, scriptPort: null, expected: null, listening: [0, -1, 70000, NaN as unknown as number] })).toEqual([]);
  });
});

// Source contract: the flip is wired into the Diagnose path (the heal route the watchdog and the
// button both use), engages only when the first port's page did not render, and every flip target is
// verified by visiting before it can win.
describe('wiring — flip on evidence, verdicts earned', () => {
  const SRC = readFileSync(fileURLToPath(new URL('../routes/agentv3.ts', import.meta.url)), 'utf8');

  it('the scan + ranking are used by the diagnose path', () => {
    expect(SRC).toContain("'preview-port-scan'");
    expect(SRC).toContain('rankPortCandidates({ parsed: port, scriptPort, expected: effectivePort, listening })');
  });

  it('the flip engages ONLY when the first page did not render (happy path costs nothing)', () => {
    expect(SRC).toContain('if (winner.url && !winner.served.rendered)');
  });

  it('a flip target wins only when its page RENDERED', () => {
    expect(SRC).toContain('if (attempt.url && attempt.served.rendered) { winner = attempt; winnerPort = cand; break; }');
  });
});
