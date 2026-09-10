import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Site settings (ROADMAP §13, 1.6): the config is FORMED in one place and reaches every publish. */
const src = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const deploy = src('src/server/AgentV3/Deployment.ts');
const routes = src('src/server/routes/agentv3.ts');
const engineer = src('src/server/EngineerAI/DeploymentService.ts');

describe('🔒 the version config is formed by hostingVersionConfig, never hardcoded', () => {
  it('both first-party publish paths pass the formed config', () => {
    expect(deploy.split('await this.versionConfigFor(workspaceId, files)').length - 1).toBe(2);
    expect(deploy).toContain('hostingVersionConfig(files, saved)');
    // The old literal is gone from the v5 deployer.
    expect(deploy).not.toContain("rewrites: [{ glob: '**', path: '/index.html' }],\n          headers: [{ glob: '/assets/**'");
  });

  it('the Engineer AI deployer (a sibling with the same hardcoded config) uses the same form', () => {
    expect(engineer).toContain('hostingVersionConfig(');
    expect(engineer).not.toContain("rewrites: [{ glob: '**', path: '/index.html' }]");
  });
});

describe('🔒 the settings routes', () => {
  const block = (name: string) => {
    const start = routes.indexOf(`app.post('/api/agentv3/${name}'`);
    expect(start).toBeGreaterThan(-1);
    return routes.slice(start, start + 2500);
  };
  it('are owner-checked, like every route that changes what the public sees', () => {
    for (const r of ['site-config', 'site-config/save']) expect(block(r)).toContain('assertVerifiedWorkspaceOwner(req, workspaceId)');
  });
  it('save validates through the pure module and stores only the validated config', () => {
    const b = block('site-config/save');
    expect(b).toContain('validateSiteConfig(req.body?.config)');
    expect(b).toContain('siteConfigStore.set(workspaceId, userId ?? \'\', config)');
    expect(b).not.toMatch(/siteConfigStore\.set\([^)]*req\.body/);
  });
  it('says settings reach the live site on the NEXT publish — never implies the live site changed', () => {
    expect(block('site-config/save')).toContain('Publish again for these settings to reach your live site.');
  });
});
