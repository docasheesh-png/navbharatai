import { describe, it, expect } from 'vitest';
import {
  buildServicesProbeCommand,
  parseProcessList,
  splitProcsSection,
  mergeServiceStatus,
  extraPorts,
  portsSummary,
} from './portsPanel';
import { LISTENING_PORTS_COMMAND, parseListeningPorts } from './PortDiscovery';
import type { Service } from './serviceGraph';

const svc = (over: Partial<Service> = {}): Service => ({
  id: 'root', name: 'web', kind: 'frontend', dir: '', script: 'dev', port: 5173, dependsOn: [], ...over,
});

describe('buildServicesProbeCommand — reuses the proven port scan, never a second copy of it', () => {
  // A first draft hand-rolled its own /proc/net/tcp parser. Two parsers of the same kernel file is the
  // drift root-cause rule 2 exists to prevent, and only a duplicate-identifier error caught it.
  it('embeds PortDiscovery\'s LISTENING_PORTS_COMMAND verbatim', () => {
    expect(buildServicesProbeCommand()).toContain(LISTENING_PORTS_COMMAND);
  });

  it('gets the process list in the SAME round trip (a second sandbox command is billed VM time)', () => {
    const cmd = buildServicesProbeCommand();
    expect(cmd).toContain('NBAI_PROCS:');
    expect(cmd).toContain('ps -eo pid,args');
    expect(cmd.indexOf('NBAI_PROCS:')).toBeGreaterThan(cmd.indexOf(LISTENING_PORTS_COMMAND));
  });

  it('its output is readable by the shared parser (the two halves really do fit together)', () => {
    const fakeStdout = 'LISTENING:3001,5173\nNBAI_PROCS:\n  12 node server.js\n';
    expect(parseListeningPorts(fakeStdout)).toEqual([3001, 5173]);
    expect(parseProcessList(splitProcsSection(fakeStdout))).toEqual([{ pid: 12, command: 'node server.js' }]);
  });
});

describe('splitProcsSection', () => {
  it('returns everything after the marker', () => {
    expect(splitProcsSection('LISTENING:80\nNBAI_PROCS:\n  1 node a.js').trim()).toBe('1 node a.js');
  });

  it('returns empty when ps produced nothing, rather than mistaking port output for processes', () => {
    expect(splitProcsSection('LISTENING:80')).toBe('');
    expect(splitProcsSection('')).toBe('');
    expect(splitProcsSection(null)).toBe('');
  });
});

describe('parseProcessList', () => {
  it('keeps the app\'s own processes', () => {
    const ps = '  123 node /app/server.js\n  456 npm run dev\n';
    expect(parseProcessList(ps)).toEqual([
      { pid: 123, command: 'node /app/server.js' },
      { pid: 456, command: 'npm run dev' },
    ]);
  });

  // A list including our own probe and the sandbox's shell makes the panel look busy and says nothing.
  it('drops the probe itself and unrelated system noise', () => {
    const ps = '  1 /bin/sh\n  2 ps -eo pid,args --no-headers\n  3 node -e console.log("LISTENING:")\n  4 node app.js\n';
    expect(parseProcessList(ps)).toEqual([{ pid: 4, command: 'node app.js' }]);
  });

  it('handles a missing ps (an empty list, never a crash)', () => {
    expect(parseProcessList('')).toEqual([]);
    expect(parseProcessList(null)).toEqual([]);
  });
});

describe('mergeServiceStatus — expected vs REAL, and the three states stay distinct', () => {
  it('a service whose port is listening is up', () => {
    const [row] = mergeServiceStatus([svc()], [5173]);
    expect(row.status).toBe('listening');
    expect(row.note).toContain('5173');
  });

  // This row is the whole point: it is what explains a "broken" app that is really a dead backend.
  it('a service that should be up and is not says so, and says why it matters', () => {
    const [row] = mergeServiceStatus([svc({ name: 'api', kind: 'backend', port: 3001 })], [5173]);
    expect(row.status).toBe('not_listening');
    expect(row.note).toMatch(/looks broken/i);
  });

  // serviceGraph's null port is load-bearing: calling a worker "not listening" is a false alarm about
  // a service that is working perfectly.
  it('a portless worker is NEVER reported as not-listening', () => {
    const [row] = mergeServiceStatus([svc({ name: 'emailer', kind: 'worker', port: null })], []);
    expect(row.status).toBe('no_port');
    expect(row.note).toMatch(/does not use a port/i);
  });

  it('every row carries a plain-language note (a bare status is not actionable)', () => {
    const rows = mergeServiceStatus([svc(), svc({ id: 'a', port: 3001 }), svc({ id: 'w', port: null })], [5173]);
    for (const r of rows) expect(r.note.length).toBeGreaterThan(10);
  });

  it('handles no services at all', () => {
    expect(mergeServiceStatus([], [5173])).toEqual([]);
  });
});

describe('extraPorts — a real listener the graph does not know about is still real', () => {
  it('reports a port nothing in the graph claims', () => {
    expect(extraPorts([svc()], [5173, 5432]).map((e) => e.port)).toEqual([5432]);
  });

  // NAMED, not just listed: an unexplained 5432 invites a user to go and kill their own database.
  it('names infrastructure using PortDiscovery\'s own list, not a second copy', () => {
    expect(extraPorts([svc()], [5432])[0].label).toMatch(/infrastructure/i);
    expect(extraPorts([svc()], [9999])[0].label).not.toMatch(/infrastructure/i);
  });

  it('reports nothing when every listener is accounted for', () => {
    expect(extraPorts([svc()], [5173])).toEqual([]);
  });

  it('ignores portless services when deciding what is extra', () => {
    expect(extraPorts([svc({ port: null })], [3001]).map((e) => e.port)).toEqual([3001]);
  });
});

describe('portsSummary — one line a non-technical user can act on', () => {
  it('names what is down, because that is the actionable fact', () => {
    const rows = mergeServiceStatus([svc({ name: 'api', port: 3001 })], []);
    expect(portsSummary(rows, [])).toContain('api');
  });

  it('pluralises honestly', () => {
    const one = mergeServiceStatus([svc({ name: 'api', port: 3001 })], []);
    const two = mergeServiceStatus([svc({ id: 'a', name: 'api', port: 3001 }), svc({ id: 'b', name: 'web', port: 5173 })], []);
    expect(portsSummary(one, [])).toMatch(/One part .* is not running/);
    expect(portsSummary(two, [])).toMatch(/2 parts .* are not running/);
  });

  it('says all-clear only when something is genuinely up', () => {
    expect(portsSummary(mergeServiceStatus([svc()], [5173]), [5173])).toMatch(/Everything/i);
  });

  it('distinguishes "your app is down but the sandbox is busy" from "nothing at all"', () => {
    expect(portsSummary([], [5432])).toMatch(/something else/i);
    expect(portsSummary([], [])).toMatch(/Nothing is running/i);
  });
});
