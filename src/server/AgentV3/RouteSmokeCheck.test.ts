import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  planSmokeChecks, classifySmokeStatus, summarizeSmoke, smokeCurlCommand, parseCurlStatus,
  MAX_SMOKE_ROUTES,
} from './RouteSmokeCheck';

const file = (content: string) => [{ path: 'server/index.js', content }];

describe('planSmokeChecks — what is safe to call, and why the rest is not', () => {
  it('calls the GET routes the app declares', () => {
    const plan = planSmokeChecks(file(`
      app.get('/api/health', h);
      app.get('/api/products', p);
    `));
    expect(plan.targets).toEqual(['/api/health', '/api/products']);
  });

  it('NEVER calls a mutating route — that would run the user\'s own writes against their data', () => {
    // Not skipped by policy: unreachable from here at all. No diagnostic value justifies a check
    // that creates or deletes someone's records.
    const plan = planSmokeChecks(file(`
      app.post('/api/orders', c);
      app.delete('/api/orders', d);
      app.put('/api/orders', u);
      app.patch('/api/orders', p);
    `));
    expect(plan.targets).toEqual([]);
    expect(plan.skipped).toHaveLength(4);
    expect(plan.skipped[0].why).toContain('never create or delete your data');
  });

  it('skips a route with a path parameter instead of inventing an id', () => {
    // An invented id returns 404, which we would then report as a broken route — a false alarm about
    // working code, and false alarms are what teach people to ignore the report.
    const plan = planSmokeChecks(file(`app.get('/api/users/:id', h); app.get('/api/users', l);`));
    expect(plan.targets).toEqual(['/api/users']);
    expect(plan.skipped[0].why).toContain('made-up one would look like a broken route');
  });

  it('records what it left out rather than dropping it silently', () => {
    // A check that quietly tests 3 of 40 routes and reports "all passed" is a more convincing lie
    // than no check at all.
    const many = Array.from({ length: MAX_SMOKE_ROUTES + 3 }, (_, i) => `app.get('/api/r${i}', h);`).join('\n');
    const plan = planSmokeChecks(file(many));
    expect(plan.targets).toHaveLength(MAX_SMOKE_ROUTES);
    expect(plan.skipped).toHaveLength(3);
    expect(plan.skipped[0].why).toContain('only the first');
  });

  it('deduplicates the same path declared twice', () => {
    const plan = planSmokeChecks(file(`app.get('/api/x', a); app.get('/api/x', b);`));
    expect(plan.targets).toEqual(['/api/x']);
  });

  it('returns nothing for an app with no routes, without throwing', () => {
    expect(planSmokeChecks([])).toEqual({ targets: [], skipped: [] });
    expect(planSmokeChecks(file('const x = 1;')).targets).toEqual([]);
  });
});

describe('classifySmokeStatus — the reading is where honesty lives', () => {
  it('2xx and 3xx are working', () => {
    expect(classifySmokeStatus('/api/x', 200).verdict).toBe('pass');
    expect(classifySmokeStatus('/api/x', 302).verdict).toBe('pass');
  });

  it('401 and 403 are the app working CORRECTLY, not failing', () => {
    // Calling a guarded route a failure would fail every app that has authentication — i.e. every
    // serious one — and bury the real failures under noise.
    for (const status of [401, 403]) {
      const r = classifySmokeStatus('/api/admin', status);
      expect(r.verdict).toBe('protected');
      expect(r.reason).toContain('which is correct');
    }
  });

  it('404 on a route the CODE declares is the real signal', () => {
    const r = classifySmokeStatus('/api/products', 404);
    expect(r.verdict).toBe('fail');
    expect(r.reason).toContain('in your code but the server returned 404');
  });

  it('separates "no answer at all" from "answered 404"', () => {
    // One says the server is not there; the other says it is there and does not know this path.
    // Reporting both as "failed" hides which of the two the user has to fix.
    const dead = classifySmokeStatus('/api/x', null);
    expect(dead.verdict).toBe('unreachable');
    expect(dead.reason).toContain('may not be running');
    expect(classifySmokeStatus('/api/x', 404).verdict).toBe('fail');
  });

  it('a 5xx is a failure; a 400 asking for input is not', () => {
    expect(classifySmokeStatus('/api/x', 500).verdict).toBe('fail');
    // The route IS served — it just wants a body or a query the smoke call cannot supply.
    const r = classifySmokeStatus('/api/search', 400);
    expect(r.verdict).toBe('pass');
    expect(r.reason).toContain('expects different input');
  });
});

describe('summarizeSmoke — never claims more than happened', () => {
  const r = (path: string, verdict: 'pass' | 'protected' | 'fail' | 'unreachable') =>
    ({ path, status: 200, verdict, reason: '' });

  it('counts each verdict and says what was not checked', () => {
    const s = summarizeSmoke([r('/a', 'pass'), r('/b', 'protected'), r('/c', 'fail')], 4);
    expect(s).toMatchObject({ checked: 3, passed: 1, protectedCount: 1, failed: 1, hasFailures: true });
    expect(s.headline).toContain('1 of 3');
    expect(s.headline).toContain('4 not checked');
  });

  it('only says "working" when everything checked actually answered', () => {
    const s = summarizeSmoke([r('/a', 'pass'), r('/b', 'protected')]);
    expect(s.hasFailures).toBe(false);
    expect(s.headline).toContain('checked and working');
    expect(s.headline).toContain('1 correctly require sign-in');
  });

  it('an unreachable route counts as a failure, not as nothing', () => {
    expect(summarizeSmoke([r('/a', 'unreachable')]).hasFailures).toBe(true);
  });

  it('says plainly when nothing could be checked, instead of implying success', () => {
    const s = summarizeSmoke([]);
    expect(s.hasFailures).toBe(false);
    expect(s.headline).toBe('No routes could be checked automatically.');
  });
});

describe('the call itself', () => {
  it('asks for the status code and discards the body', () => {
    // The body could be the user's own data, and this runs inside a build whose output is logged.
    const cmd = smokeCurlCommand('http://localhost:3000', '/api/health');
    expect(cmd).toContain('-o /dev/null');
    expect(cmd).toContain("%{http_code}");
    expect(cmd).toContain('http://localhost:3000/api/health');
    expect(cmd).toContain('--max-time');
  });

  it('strips quotes, because this string becomes a shell command', () => {
    expect(smokeCurlCommand("http://h", "/api/'; rm -rf /; '")).not.toContain("'; rm -rf /");
  });

  it('reads the status back, and refuses to guess when it cannot', () => {
    expect(parseCurlStatus('200')).toBe(200);
    expect(parseCurlStatus('some noise\n404')).toBe(404);
    // curl writes 000 when it could not connect at all — that is "no answer", not status zero.
    expect(parseCurlStatus('000')).toBeNull();
    expect(parseCurlStatus('')).toBeNull();
    expect(parseCurlStatus('curl: (7) Failed to connect')).toBeNull();
  });
});

describe('wired into the build, as evidence and not as a gate', () => {
  const route = readFileSync(join(__dirname, '..', 'routes', 'agentv3.ts'), 'utf8');

  it('runs after a successful build and calls the app\'s own routes', () => {
    expect(route).toContain("process.env.AGENTV3_ROUTE_SMOKE !== 'off'");
    expect(route).toContain('smokeCurlCommand(lastPreviewUrl, target)');
    expect(route).toContain('classifySmokeStatus(target, status)');
  });

  it('records the clean run too — "we checked and it worked" is the evidence this phase is for', () => {
    expect(route).toContain("code: summary.hasFailures ? 'ROUTE_SMOKE_FAILED' : 'ROUTE_SMOKE_PASSED'");
  });

  it('never changes the build verdict', () => {
    // A probe that can be wrong about a route it does not fully understand must not be able to mark
    // a working build as failed.
    const at = route.indexOf("AGENTV3_ROUTE_SMOKE");
    const block = route.slice(at, route.indexOf('APP HEALTH CULTURE', at));
    expect(block).not.toMatch(/result\s*=\s*\{[^}]*ok:\s*false/);
    expect(block).toContain('never a gate');
  });

  it('reuses the file map the integrity pass already loaded, instead of paying for it twice', () => {
    // The post-answer stretch is already the slowest part of a build; a second full workspace load
    // for this would make it worse for a check that needs no new data.
    expect(route).toContain('routeSmokePlan = planSmokeChecks(');
    expect(route).toContain('const plan = routeSmokePlan;');
  });

  it('says in the report what it did NOT check', () => {
    expect(route).toContain('SKIPPED ${s.method} ${s.path}');
  });
});
