import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildListDeploysRequest, deployPhase, parseDeploy, latestDeploy,
  probeBackend, deployVerdict, readDeployVerdict,
} from '../src/server/AgentV3/renderDeployStatus';
import { managedDeployOutcome } from '../src/lib/backendDeployWiring';

/**
 * DID THE BACKEND ACTUALLY COME UP? (admin 2026-09-05)
 *
 * `deployBackendToRender` reported success the moment the host ACCEPTED the request — all it ever
 * knew. "Deploy triggered" was true; "your app is live" was never checked. A failed build, a crash on
 * a missing setting, a start command that exits immediately: every one produced the same cheerful
 * message, and the user found out by opening their own site.
 *
 * This path's recurring bug class, stated once: each layer reported its own narrow success as the
 * whole outcome.
 */
const okRes = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe('deployPhase — three answers a user can act on, and an honest fourth', () => {
  it('live is live; every failure form is a failure', () => {
    expect(deployPhase('live')).toBe('live');
    for (const s of ['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled', 'deactivated']) {
      expect(deployPhase(s), s).toBe('failed');
    }
  });

  it('the building forms are in-progress', () => {
    for (const s of ['created', 'build_in_progress', 'update_in_progress', 'pre_deploy_in_progress', 'queued']) {
      expect(deployPhase(s), s).toBe('in-progress');
    }
  });

  it('🔒 an unfamiliar status is unknown — never guessed into success or failure', () => {
    // The host can add a status tomorrow. Mapping the unfamiliar onto either verdict would make this
    // confidently wrong about the one case it has never seen.
    for (const s of ['', null, undefined, 'some_new_status', 'paused']) {
      expect(deployPhase(s as any), String(s)).toBe('unknown');
    }
  });
});

describe('parsers', () => {
  it('both wrapper shapes, and junk rejected', () => {
    expect(parseDeploy({ deploy: { id: 'd1', status: 'live' } })).toEqual({ id: 'd1', status: 'live' });
    expect(parseDeploy({ id: 'd2' })).toEqual({ id: 'd2', status: '' });
    for (const junk of [null, {}, { id: '  ' }, 'no']) expect(parseDeploy(junk)).toBeNull();
  });

  it('the newest readable deploy wins, and an unreadable list is null', () => {
    expect(latestDeploy([null, { deploy: { id: 'd9', status: 'live' } }, { id: 'old' }])?.id).toBe('d9');
    expect(latestDeploy(null)).toBeNull();
    expect(latestDeploy([])).toBeNull();
  });

  it('the deploys request is bounded and authorised', () => {
    const r = buildListDeploysRequest('k', 'srv-1', 99);
    expect(r.url).toContain('/services/srv-1/deploys');
    expect(r.url).toContain('limit=20');            // clamped
    expect(r.headers.Authorization).toBe('Bearer k');
  });
});

describe('probeBackend — asking the app itself, and never throwing', () => {
  it('an answer is an answer, whatever the code', async () => {
    expect(await probeBackend('https://x.onrender.com', (async () => okRes('', 404)) as any))
      .toEqual({ answered: true, status: 404 });
  });

  it('a refused connection is not an answer', async () => {
    expect(await probeBackend('https://x.onrender.com', (async () => { throw new Error('ECONNREFUSED'); }) as any))
      .toEqual({ answered: false, status: 0 });
  });

  it('a non-URL is refused without a request', async () => {
    let called = false;
    await probeBackend('dashboard.render.com', (async () => { called = true; return okRes(''); }) as any);
    expect(called).toBe(false);
  });
});

describe('deployVerdict — the probe outranks the host status', () => {
  it('🔒 a 404 from a live service is LIVE — a backend that only serves /api is healthy', () => {
    // Requiring a 200 would raise a confident false alarm on a perfectly working app.
    expect(deployVerdict('live', 'live', { answered: true, status: 404 }).live).toBe(true);
    expect(deployVerdict('unknown', '', { answered: true, status: 200 }).live).toBe(true);
  });

  it('🔒 a host that says "live" while nothing answers is NOT reported live', () => {
    // That exact mismatch is what a user experiences as "you said it worked".
    const v = deployVerdict('live', 'live', { answered: false, status: 0 });
    expect(v.live).toBe(false);
    expect(v.message).toMatch(/could not confirm/i);
  });

  it('a failed build names where the reason is, and the two usual causes', () => {
    const v = deployVerdict('failed', 'build_failed', { answered: false, status: 0 });
    expect(v.live).toBe(false);
    expect(v.message).toMatch(/logs/i);
    expect(v.message).toMatch(/missing setting/i);
  });

  it('a 5xx is named as the APP failing, not the hosting', () => {
    const v = deployVerdict('live', 'live', { answered: true, status: 503 });
    expect(v.live).toBe(false);
    expect(v.message).toMatch(/not the hosting/i);
  });

  it('still building says so, and promises nothing', () => {
    const v = deployVerdict('in-progress', 'build_in_progress', null);
    expect(v.live).toBe(false);
    expect(v.message).toMatch(/still building/i);
  });

  it('🔒 no evidence at all is never reported as failure', () => {
    // "We could not tell" and "it is broken" are different facts, and only one of them is true here.
    const v = deployVerdict('unknown', '', null);
    expect(v.live).toBe(false);
    expect(v.message).not.toMatch(/did not start/i);
  });
});

describe('readDeployVerdict — evidence-backed, never throws', () => {
  it('a live service that answers is reported live', async () => {
    const v = await readDeployVerdict(
      { apiKey: 'k', serviceId: 's', serviceUrl: 'https://x.onrender.com' },
      (async (url: any) => (String(url).includes('/deploys')
        ? okRes([{ deploy: { id: 'd', status: 'live' } }])
        : okRes('', 200))) as any,
    );
    expect(v.live).toBe(true);
  });

  it('🔒 mid-build, the URL is not probed — it tells us nothing we do not already know', () => {
    // And it costs a request against someone else's service on every poll.
    return readDeployVerdict(
      { apiKey: 'k', serviceId: 's', serviceUrl: 'https://x.onrender.com' },
      (async (url: any) => {
        expect(String(url)).toContain('/deploys');   // fails if the probe fires
        return okRes([{ deploy: { id: 'd', status: 'build_in_progress' } }]);
      }) as any,
    ).then((v) => {
      expect(v.phase).toBe('in-progress');
      expect(v.probe).toBeNull();
    });
  });

  it('an unreadable status still produces an honest answer, not a throw', async () => {
    const v = await readDeployVerdict(
      { apiKey: 'k', serviceId: 's' },
      (async () => { throw new Error('offline'); }) as any,
    );
    expect(v.phase).toBe('unknown');
    expect(v.live).toBe(false);
  });
});

describe('🔒 the wiring — a status the user can get, and a client that asks for it', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  const handler = (() => {
    const at = route.indexOf("app.post('/api/agentv3/deploy-status'");
    return at === -1 ? '' : route.slice(at, route.indexOf('app.post(', at + 40));
  })();
  const chooser = readFileSync(join(__dirname, '..', 'src/components/agentv3/HostingChooser.tsx'), 'utf8');

  it('the endpoint exists and is ownership-checked', () => {
    expect(handler).not.toBe('');
    expect(handler).toContain('assertWorkspaceOwner(req, workspaceId)');
  });

  it('🔒 the host\'s own status word never reaches the user — the white-label law', () => {
    // `build_failed` / `live` name a provider's pipeline. The message is ours; the word is not.
    expect(handler).toContain('res.json({ live: verdict.live, phase: verdict.phase, message: verdict.message })');
    expect(handler).not.toContain('status: verdict.status');
  });

  it('🔒 the client actually asks — a check nobody runs is not a check', () => {
    expect(chooser).toContain("authedFetch('/api/agentv3/deploy-status'");
    expect(chooser).toContain('void verifyBackend(data.serviceId');
  });

  it('🔒 the polling is bounded, and the timeout still says something true', () => {
    // Silence after "Deploy triggered" is exactly what let a dead service pass for a live one.
    expect(chooser).toContain('5 * 60_000');
    expect(chooser).toContain('still building after five minutes');
  });

  it('it backs off rather than hammering someone else\'s API', () => {
    expect(chooser).toContain('Math.min(delay * 1.5, 30_000)');
  });
});

/**
 * THE FREE PLAN SLEEPS, AND THE USER HEARS IT FROM US (admin 2026-09-05).
 *
 * `buildCreateServiceRequest` picks the FREE plan deliberately — a default that cannot surprise
 * someone with a bill on their own account. The cost of that default is real: the service idles out
 * after about a quarter of an hour and the next visitor waits while it wakes. Someone who learns that
 * from their own slow site concludes NavBharatAI built something bad.
 */
describe('🔒 the free-plan note — true where it is said, absent where it would be a guess', () => {
  const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
  const handler = (() => {
    const at = route.indexOf("app.post('/api/agentv3/deploy-backend'");
    return route.slice(at, route.indexOf('app.post(', at + 40));
  })();

  it('is set ONLY in the branch that created the service', () => {
    // An existing service may be on any plan; claiming it sleeps would be a confident guess about
    // somebody else's account.
    const createdAt = handler.indexOf('result = { ok: true, url: created.service.serviceUrl');
    // The DECLARATION (`let planNote = ''`) is not an assignment of a claim — only a real value is.
    const assignments = handler.split('\n')
      .map((l, i) => ({ l: l.trim(), i }))
      .filter((x) => /^planNote = /.test(x.l));
    expect(createdAt).toBeGreaterThan(-1);
    // Exactly one place claims a plan — a second would mean some other branch claims one it cannot know.
    expect(assignments).toHaveLength(1);
    expect(handler.indexOf(assignments[0].l)).toBeGreaterThan(createdAt);
  });

  it('reaches the response and the user', () => {
    expect(handler).toContain('...(planNote ? { planNote } : {})');
    const { lines } = managedDeployOutcome(200, {
      ok: true, url: 'https://x.onrender.com', planNote: 'This runs on your free plan.',
    });
    expect(lines.join(' ')).toContain('free plan');
  });
});
