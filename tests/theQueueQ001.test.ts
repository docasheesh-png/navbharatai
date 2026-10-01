// BUILD_REPORT_QUEUE Q-001 (autopsy 6461025c): a hand rewrite of package.json downgraded express 5 → 4
// and left @types/express at 5, so the next install put express 4 under v5 typings.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { restoreInconsistentDowngrades } from '../src/server/AgentV3/DependencyAutoFix';

const pkg = (deps: Record<string, string>, dev: Record<string, string> = {}) =>
  JSON.stringify({ name: 'app', dependencies: deps, devDependencies: dev }, null, 2) + '\n';

describe('a downgrade that leaves its typings behind is undone', () => {
  const before = pkg({ express: '^5.1.0', '@types/express': '^5.0.6', cors: '^2.8.5' });

  it('the 6461025c rewrite: express back to the installed 5, everything else as written', () => {
    const after = pkg({ express: '^4.21.2', '@types/express': '^5.0.6', cors: '^2.8.5', jsonwebtoken: '^9.0.2' });
    const out = restoreInconsistentDowngrades(after, before);
    expect(out.restored).toHaveLength(1);
    const parsed = JSON.parse(out.content);
    expect(parsed.dependencies.express).toBe('^5.1.0');
    expect(parsed.dependencies.jsonwebtoken).toBe('^9.0.2');
  });

  it('a deliberate downgrade that moves the typings too is left alone', () => {
    const after = pkg({ express: '^4.21.2', '@types/express': '^4.17.21', cors: '^2.8.5' });
    expect(restoreInconsistentDowngrades(after, before).restored).toEqual([]);
  });

  it('an upgrade, a package with no typings, and a first write are left alone', () => {
    expect(restoreInconsistentDowngrades(pkg({ express: '^6.0.0', '@types/express': '^5.0.6' }), before).restored).toEqual([]);
    expect(restoreInconsistentDowngrades(pkg({ react: '^18.3.1' }), pkg({ react: '^19.0.0' })).restored).toEqual([]);
    expect(restoreInconsistentDowngrades(pkg({ express: '^4.0.0', '@types/express': '^5.0.6' }), '').restored).toEqual([]);
  });

  it('scoped packages map to their @types name', () => {
    const b = pkg({ '@babel/core': '^8.0.0' }, { '@types/babel__core': '^8.0.0' });
    const a = pkg({ '@babel/core': '^7.24.0' }, { '@types/babel__core': '^8.0.0' });
    expect(JSON.parse(restoreInconsistentDowngrades(a, b).content).dependencies['@babel/core']).toBe('^8.0.0');
  });

  it('every package.json write passes through it', () => {
    expect(readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8')).toContain('const downgrade = restoreInconsistentDowngrades(out, existingContent);');
  });
});
