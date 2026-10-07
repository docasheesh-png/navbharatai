// THE ISOLATION PROBE MUST REACH CLOUD RUN (C-1, 2026-10-07).
//
// infra/hosting-isolation-probe is published like a user app to prove, from inside the build and the runtime,
// that neither identity can reach anything (docs/HOSTING_ARCHITECTURE.md §11). Its first version served HTTP
// with bare `node:http` — and the publish planner recognises a server only by its framework, so it classified
// the probe `unknown` and would have published it as a STATIC site: no build identity, no runtime identity,
// nothing proven. These tests run the REAL planner, route chooser and archive packer on the probe's REAL files.
//
// ⚠️ The planner's blindness to plain `node:http` servers is a separate product bug (BUILD_REPORT_QUEUE Q-707),
// deliberately not changed here.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planDeployment, choosePublishRoute } from '../src/server/AgentV3/deployPlan';
import { packWorkspaceArchive } from '../src/server/AgentV3/sourceArchive';

const dir = join(__dirname, '..', 'infra', 'hosting-isolation-probe');
const files = {
  'package.json': readFileSync(join(dir, 'package.json'), 'utf8'),
  'probe.js': readFileSync(join(dir, 'probe.js'), 'utf8'),
};

describe('the isolation probe is a server app to the publish path', () => {
  it('the planner sees an Express server that static hosting cannot serve', () => {
    const plan = planDeployment(files);
    expect(plan.shape).toBe('node-server');
    expect(plan.staticHostingSufficient).toBe(false);
    expect(plan.backend).toEqual({ runtime: 'node', startCommand: 'node probe.js serve', framework: 'Express' });
  });

  it('🔒 with hosting available Publish takes the CONTAINER route — never the static one', () => {
    const plan = planDeployment(files);
    expect(choosePublishRoute(plan, { containerHostingAvailable: true })).toBe('container');
    expect(choosePublishRoute(plan, { containerHostingAvailable: false })).toBe('refuse');
  });

  it('the build probe still runs during the install, and the runtime serves both results', () => {
    const pkg = JSON.parse(files['package.json']);
    expect(pkg.scripts.postinstall).toBe('node probe.js build');
    expect(pkg.dependencies.express).toBeTruthy();
    expect(files['probe.js']).toContain("app.get('/build'");
    expect(files['probe.js']).toContain("app.get('/'");
    expect(files['probe.js']).not.toContain("require('node:http')");
  });

  it('the hosting archive packs every probe file — nothing is silently left out', () => {
    const archive = packWorkspaceArchive(files);
    expect(archive.skipped).toEqual([]);
    expect(archive.packed.sort()).toEqual(['package.json', 'probe.js']);
  });
});
