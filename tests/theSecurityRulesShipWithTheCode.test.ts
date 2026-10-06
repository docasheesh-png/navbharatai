// Q-610 (forensic audit 2026-10-04; admin 2026-10-06 "ok banao") — the Firestore and Storage rules are
// deployed by the same pipeline that deploys the code relying on them, to the project the server reads.
//
// Before: rules were only ever deployed by hand, so #3538's hardened rules sat in the repo while production
// enforced the old ones, and `.firebaserc`'s default pointed a manual deploy at the HOSTING project.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

type Step = { id?: string; name: string; args?: string[]; allowFailure?: boolean; entrypoint?: string };
const cfg = load(readFileSync('cloudbuild.yaml', 'utf8')) as { steps: Step[] };
const steps = cfg.steps;
const rulesAt = steps.findIndex((s) => s.id === 'deploy-security-rules');
const rules = steps[rulesAt];
const script = (rules?.args ?? []).join('\n');

describe('the rules ship with every merge', () => {
  it('a rules step exists and deploys firestore rules and storage rules only', () => {
    expect(rulesAt).toBeGreaterThan(-1);
    expect(script).toMatch(/deploy --only firestore:rules,storage /);
    expect(script).not.toMatch(/--only[^\n]*(hosting|functions)/);
  });

  it('to the project the server reads, never the hosting project', () => {
    expect(script).toContain('--project gen-lang-client-0866594388');
    expect(script).not.toContain('navbharatai-3395f');
  });

  it('with the firebase-tools version package.json pins', () => {
    const pinned = (JSON.parse(readFileSync('package.json', 'utf8')) as { devDependencies?: Record<string, string>; dependencies?: Record<string, string> });
    const want = (pinned.devDependencies?.['firebase-tools'] ?? pinned.dependencies?.['firebase-tools'] ?? '').replace(/^[\^~]/, '');
    expect(want).not.toBe('');
    expect(script).toContain(`firebase-tools@${want} `);
  });
});

describe('🔒 and it can never stop a deploy', () => {
  it('allowFailure is set and the script always exits 0', () => {
    expect(rules.allowFailure).toBe(true);
    expect(script).toMatch(/set \+e/);
    expect(script.trim().endsWith('exit 0')).toBe(true);
    expect(script).not.toMatch(/exit [1-9]/);
  });

  it('it runs before the deploy step, so the deploy is still the last thing that happens', () => {
    const deployAt = steps.findIndex((s) => (s.args ?? []).slice(0, 2).join(' ') === 'run deploy');
    expect(deployAt).toBe(steps.length - 1);
    expect(rulesAt).toBeLessThan(deployAt);
  });

  it('a missing permission is named in one plain line, with the role to grant', () => {
    expect(script).toContain('roles/firebaserules.admin');
  });

  it('every bash variable is escaped for Cloud Build ($$) so the build is not rejected at submit time', () => {
    for (const m of script.matchAll(/\$(\w+)/g)) {
      const name = m[1];
      if (name === 'COMMIT_SHA') continue; // a Cloud Build built-in, substituted on purpose
      const at = m.index ?? 0;
      expect(script[at - 1], `$${name} must be written $$${name}`).toBe('$');
    }
  });
});
