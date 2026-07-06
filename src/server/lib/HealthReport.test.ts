import { describe, it, expect } from 'vitest';
import { buildHealthReport, formatUptime, renderStatusPageHtml, type HealthSignals } from './HealthReport';

function signals(partial: Partial<HealthSignals> = {}): HealthSignals {
  return {
    ready: true,
    uptimeSec: 3600,
    version: 'rev-123',
    nodeVersion: 'v20.0.0',
    memory: { rss: 200 * 1024 * 1024, heapUsed: 80 * 1024 * 1024, heapTotal: 120 * 1024 * 1024 },
    maintenanceMode: false,
    checks: [],
    ...partial,
  };
}

describe('formatUptime', () => {
  it('formats days/hours/minutes and sub-minute seconds', () => {
    expect(formatUptime(45)).toBe('45s');
    expect(formatUptime(60)).toBe('1m');
    expect(formatUptime(3661)).toBe('1h 1m');
    expect(formatUptime(90061)).toBe('1d 1h 1m');
  });
  it('clamps invalid input to 0s', () => {
    expect(formatUptime(-5)).toBe('0s');
    expect(formatUptime(NaN)).toBe('0s');
  });
});

describe('buildHealthReport', () => {
  it('is ok when ready, no maintenance, and all checks ok', () => {
    const r = buildHealthReport(signals({ checks: [{ name: 'x', status: 'ok', detail: '' }] }));
    expect(r.status).toBe('ok');
    expect(r.ready).toBe(true);
    expect(r.memoryMb.rss).toBe(200);
    expect(r.uptimeHuman).toBe('1h');
    expect(r.version).toBe('rev-123');
  });

  it('is down when the server is not ready, regardless of checks', () => {
    const r = buildHealthReport(signals({ ready: false, checks: [{ name: 'x', status: 'ok', detail: '' }] }));
    expect(r.status).toBe('down');
  });

  it('is degraded (not down) when a dependency check is down but the server is serving', () => {
    const r = buildHealthReport(signals({ checks: [{ name: 'db', status: 'down', detail: 'unreachable' }] }));
    expect(r.status).toBe('degraded');
    expect(r.ready).toBe(true);
  });

  it('is degraded under maintenance mode even with all checks ok', () => {
    const r = buildHealthReport(signals({ maintenanceMode: true }));
    expect(r.status).toBe('degraded');
    expect(r.maintenanceMode).toBe(true);
  });

  it('takes the worst check status into account', () => {
    const r = buildHealthReport(signals({
      checks: [
        { name: 'a', status: 'ok', detail: '' },
        { name: 'b', status: 'degraded', detail: 'slow' },
      ],
    }));
    expect(r.status).toBe('degraded');
  });

  it('converts memory bytes to MB and defaults missing version/node', () => {
    const r = buildHealthReport(signals({ version: '', nodeVersion: '', memory: { rss: 0, heapUsed: 0, heapTotal: 0 } }));
    expect(r.version).toBe('unknown');
    expect(r.node).toBe('unknown');
    expect(r.memoryMb).toEqual({ rss: 0, heapUsed: 0, heapTotal: 0 });
  });
});

describe('renderStatusPageHtml', () => {
  const html = renderStatusPageHtml();
  it('is a self-contained page polling /api/health with no external resources', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain("fetch('/api/health')");
    expect(html).not.toMatch(/src="https?:/);
    expect(html).not.toMatch(/href="https?:\/\//);
  });
});
