import { describe, it, expect } from 'vitest';
import { resolveDependencies, buildOsvQuery, parseOsvResponse, scanVulnerabilities, vulnScanSummary } from './VulnScanner';

const pkg = JSON.stringify({
  dependencies: { lodash: '^4.17.20', express: '4.18.2' },
  devDependencies: { vite: '^5.0.0' },
});

describe('resolveDependencies', () => {
  it('uses EXACT versions from a package-lock (npm v3 packages map) over the range', () => {
    const lock = JSON.stringify({ packages: { '': {}, 'node_modules/lodash': { version: '4.17.21' }, 'node_modules/express': { version: '4.18.2' }, 'node_modules/vite': { version: '5.4.1' } } });
    const deps = resolveDependencies(pkg, lock);
    expect(deps).toContainEqual({ name: 'lodash', version: '4.17.21' });
    expect(deps).toContainEqual({ name: 'vite', version: '5.4.1' });
    expect(deps.every((d) => !d.approx)).toBe(true); // all exact from lock
  });

  it('falls back to the base version from the range (flagged approx) when there is no lockfile', () => {
    const deps = resolveDependencies(pkg);
    expect(deps.find((d) => d.name === 'lodash')).toEqual({ name: 'lodash', version: '4.17.20', approx: true });
    expect(deps.find((d) => d.name === 'express')).toEqual({ name: 'express', version: '4.18.2', approx: true });
  });

  it('supports the npm v1 lockfile shape (top-level dependencies map)', () => {
    const lockV1 = JSON.stringify({ dependencies: { lodash: { version: '4.17.21' } } });
    const deps = resolveDependencies(pkg, lockV1);
    expect(deps.find((d) => d.name === 'lodash')).toEqual({ name: 'lodash', version: '4.17.21' });
  });

  it('returns [] for unparseable package.json', () => {
    expect(resolveDependencies('{ not json')).toEqual([]);
  });
});

describe('buildOsvQuery / parseOsvResponse', () => {
  const deps = [{ name: 'lodash', version: '4.17.15' }, { name: 'express', version: '4.18.2' }];
  it('builds an npm-ecosystem querybatch aligned to the dep order', () => {
    expect(buildOsvQuery(deps)).toEqual({
      queries: [
        { package: { name: 'lodash', ecosystem: 'npm' }, version: '4.17.15' },
        { package: { name: 'express', ecosystem: 'npm' }, version: '4.18.2' },
      ],
    });
  });

  it('maps results (by position) to findings, skipping packages with no vulns', () => {
    const body = { results: [{ vulns: [{ id: 'GHSA-p6mc-m468-83gw' }, { id: 'CVE-2021-23337' }] }, {}] };
    const findings = parseOsvResponse(body, deps);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ package: 'lodash', version: '4.17.15', ids: ['GHSA-p6mc-m468-83gw', 'CVE-2021-23337'] });
  });

  it('returns [] on a malformed response (never invents findings)', () => {
    expect(parseOsvResponse({}, deps)).toEqual([]);
    expect(parseOsvResponse(null, deps)).toEqual([]);
  });
});

describe('scanVulnerabilities — honest failure, never a fake all-clear', () => {
  const deps = [{ name: 'lodash', version: '4.17.15' }];

  it('returns findings on a successful OSV response', async () => {
    const fetchOk = async () => ({ ok: true, status: 200, json: async () => ({ results: [{ vulns: [{ id: 'CVE-2021-23337' }] }] }) });
    const r = await scanVulnerabilities(deps, fetchOk);
    expect(r).toEqual({ ok: true, scanned: 1, findings: [{ package: 'lodash', version: '4.17.15', ids: ['CVE-2021-23337'] }] });
  });

  it('reports ok:false (not a clean scan) when the API errors or is unreachable', async () => {
    const fetch500 = async () => ({ ok: false, status: 503, json: async () => ({}) });
    expect(await scanVulnerabilities(deps, fetch500)).toEqual({ ok: false, reason: expect.stringContaining('HTTP 503') });
    const fetchThrows = async () => { throw new Error('ENETUNREACH'); };
    const r = await scanVulnerabilities(deps, fetchThrows as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('ENETUNREACH');
  });

  it('an empty dep set is a clean scan of zero (no network call needed)', async () => {
    expect(await scanVulnerabilities([], (async () => { throw new Error('should not be called'); }) as never)).toEqual({ ok: true, scanned: 0, findings: [] });
  });
});

describe('vulnScanSummary — never fakes health', () => {
  it('an UNAVAILABLE scan is explicitly not a clean bill of health', () => {
    const s = vulnScanSummary({ ok: false, reason: 'network error' });
    expect(s).toContain('could NOT run');
    expect(s).toContain('Not a clean bill of health');
  });

  it('a clean scan says so with the count', () => {
    expect(vulnScanSummary({ ok: true, scanned: 12, findings: [] })).toContain('No known vulnerabilities in 12');
  });

  it('findings list the package, advisory ids and an osv.dev link', () => {
    const s = vulnScanSummary({ ok: true, scanned: 3, findings: [{ package: 'lodash', version: '4.17.15', ids: ['CVE-2021-23337'], approx: true }] });
    expect(s).toContain('lodash@4.17.15');
    expect(s).toContain('approx');
    expect(s).toContain('CVE-2021-23337');
    expect(s).toContain('https://osv.dev/vulnerability/CVE-2021-23337');
  });
});
