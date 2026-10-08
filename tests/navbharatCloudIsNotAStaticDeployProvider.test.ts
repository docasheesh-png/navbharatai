// NAVBHARAT CLOUD IS NOT A STATIC DeployProvider — and must not be registered as one (2026-10-07).
//
// Asked: expose `hostAppOnNavBharatCloud` through the DeployProvider registry as `navbharat-cloud`. Traced and
// NOT done, because the generic interface cannot carry the first-party lifecycle without opening bypasses:
//   • `DeployProvider.deploy(ws, files)` receives the BUILT `dist/` files of the STATIC branch — the branch
//     the publish route takes only when `planDeployment` says static hosting suffices. A container built
//     from `dist/` has no server to start, and an app that needs one never reaches `provider.deploy` at all.
//   • `DeployContext.userId` is the request BODY's claimed uid (both `/publish` and the AI `deploy` tool).
//     The server path keys the plan, the server-app cap, the vault and the attempt record on the VERIFIED
//     uid; a provider has no verified identity to hand them.
//   • `deploy()` resolves to a bare URL. The server path answers 403 cap / 409 deploy-in-progress / 422 /
//     503 with a deployment id; none of that survives being flattened to `string | throw`.
//   • `withDeploymentPersistence` records and gates by provider id, and `runServerPublish` records the
//     hosted app itself — a provider would write the record twice under two sets of rules.
// NavBharat Cloud IS selected by the existing publish flow — by the app's shape (`choosePublishRoute`), into
// `runServerPublish`, which runs every gate. These tests lock that this stays the only door.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'glob';
import { listDeployProviders, getDeployProvider, deployProviderStatus } from '../src/server/AgentV3/DeployProviders';
// The three self-registering providers, imported exactly as the route imports them, so the registry under
// test is the one production builds.
import '../src/server/AgentV3/VercelProvider';
import '../src/server/AgentV3/NetlifyProvider';
import '../src/server/AgentV3/CloudflareProvider';
import { NAVBHARAT_CLOUD_PROVIDER } from '../src/server/AgentV3/hostedDeploymentRecord';
import { choosePublishRoute } from '../src/server/AgentV3/deployPlan';

const root = join(__dirname, '..');
const read = (f: string): string => readFileSync(join(root, f), 'utf8');
/** Source with comments removed, so a sentence ABOUT a call is never counted as one. */
const code = (f: string): string => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
const serverFiles = globSync('src/server/**/*.ts', { cwd: root }).filter((f) => !/\.test\.ts$/.test(f)).concat('server.ts');

describe('the static DeployProvider registry', () => {
  it('🔒 has no `navbharat-cloud` entry — the publish chooser can never offer a container host as a static target', () => {
    expect(NAVBHARAT_CLOUD_PROVIDER).toBe('navbharat-cloud');
    expect(getDeployProvider(NAVBHARAT_CLOUD_PROVIDER)).toBeUndefined();
    expect(listDeployProviders().map((p) => p.id)).not.toContain(NAVBHARAT_CLOUD_PROVIDER);
    expect(deployProviderStatus({}).map((p) => p.id)).not.toContain(NAVBHARAT_CLOUD_PROVIDER);
  });

  it('🔒 every registered provider is a static host — `deploy()` is handed built files, nothing else', () => {
    for (const p of listDeployProviders()) expect(p.kind, p.id).toBe('static');
  });

  it('🔒 no module registers a provider under the NavBharat Cloud id, by literal or by constant', () => {
    const offenders = serverFiles.filter((f) => {
      const src = code(f);
      return /registerDeployProvider\s*\(/.test(src) && /'navbharat-cloud'|NAVBHARAT_CLOUD_PROVIDER/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});

describe('the one door into NavBharat Cloud', () => {
  it('🔒 `hostAppOnNavBharatCloud` is called from exactly one place: the deps of the one server-publish sequence', () => {
    const callers = serverFiles.filter((f) => f !== 'src/server/AgentV3/hostApp.ts' && /hostAppOnNavBharatCloud\s*\(/.test(code(f)));
    expect(callers).toEqual(['src/server/routes/agentv3.ts']);
    const route = code('src/server/routes/agentv3.ts');
    expect(route.match(/hostAppOnNavBharatCloud\s*\(/g)?.length).toBe(1);
    expect(route).toMatch(/host:\s*\(opts\)\s*=>\s*hostAppOnNavBharatCloud\(opts\)/);
  });

  it('🔒 Publish uses the verified owner, and the paid extra server is the only other door', () => {
    const callers = serverFiles.filter((f) => f !== 'src/server/AgentV3/serverPublish.ts' && /runServerPublish\s*\(/.test(code(f)));
    expect(callers).toEqual(['src/server/routes/agentv3.ts']);
    const route = code('src/server/routes/agentv3.ts');
    // Two calls, both in this file: the normal Publish, and the paid extra which forwards an
    // input the resell route already built from the verified identity (never a uid in the body).
    expect(route.match(/runServerPublish\s*\(/g)?.length).toBe(2);
    expect(route).toMatch(/runServerPublish\(\{[\s\S]{0,200}ownerUid:\s*hostOwnerUid,\s*isAdmin:\s*hostIsAdmin,/);
    expect(route).toContain('publishServer: (input) => runServerPublish(input,');
    const resell = code('src/server/routes/resellHosting.ts');
    expect(resell).toContain('ownerUid: who.uid');
    expect(resell).not.toMatch(/ownerUid:\s*req\.body/);
  });

  it('a server app is routed to the container by its SHAPE, and a static one never is', () => {
    expect(choosePublishRoute({ staticHostingSufficient: false }, { containerHostingAvailable: true })).toBe('container');
    expect(choosePublishRoute({ staticHostingSufficient: false }, { containerHostingAvailable: false })).toBe('refuse');
    expect(choosePublishRoute({ staticHostingSufficient: true }, { containerHostingAvailable: true })).toBe('static');
  });
});
