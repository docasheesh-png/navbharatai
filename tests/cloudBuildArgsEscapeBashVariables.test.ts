import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

/**
 * Cloud Build performs ITS OWN substitution on every `$NAME` / `${NAME}` inside a step's `args` before the
 * step runs, and rejects a name that is neither a built-in (`$PROJECT_ID`, `$COMMIT_SHA`, …) nor a
 * user-defined `_VARIABLE`. A bash variable in an inline script must therefore be written `$$NAME`, or the
 * build fails at SUBMIT time — i.e. every deploy of every merge stops before a single step runs. Found on
 * #3540's first draft (`$URL`, `$BODY`); locked here for the class.
 */
const BUILT_INS = new Set(['PROJECT_ID', 'PROJECT_NUMBER', 'BUILD_ID', 'COMMIT_SHA', 'SHORT_SHA', 'REVISION_ID', 'BRANCH_NAME', 'TAG_NAME', 'REPO_NAME', 'REPO_FULL_NAME', 'LOCATION', 'TRIGGER_NAME', 'TRIGGER_BUILD_CONFIG_PATH', 'SERVICE_ACCOUNT_EMAIL', 'SERVICE_ACCOUNT']);

describe('cloudbuild.yaml — every $ in a step is a Cloud Build variable, a $_user variable, or an escaped $$', () => {
  const doc = parse(readFileSync('cloudbuild.yaml', 'utf8')) as { steps: Array<{ args?: string[]; entrypoint?: string; name: string }>; substitutions?: Record<string, string> };
  const declared = new Set(Object.keys(doc.substitutions ?? {}));

  it('no step references a bare bash variable Cloud Build would reject at submit time', () => {
    const bad: string[] = [];
    for (const [i, step] of doc.steps.entries()) {
      for (const arg of step.args ?? []) {
        const text = String(arg).replace(/\$\$/g, '');            // `$$` is a literal dollar — drop pairs first
        for (const m of text.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)) {
          const name = m[1];
          if (BUILT_INS.has(name)) continue;
          if (name.startsWith('_')) { if (!declared.has(name)) bad.push(`step ${i} (${step.name}): $${name} is used but not declared under substitutions`); continue; }
          bad.push(`step ${i} (${step.name}): $${name} is neither a built-in nor a _user substitution — write $$${name} for a bash variable`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('every declared _substitution is used by some step (Cloud Build MUST_MATCH fails a build otherwise)', () => {
    const all = doc.steps.flatMap((s) => s.args ?? []).join('\n') + '\n' + readFileSync('cloudbuild.yaml', 'utf8').split('substitutions:')[0];
    for (const name of declared) expect(all, name).toMatch(new RegExp(`\\$\\{?${name}\\}?`));
  });
});
