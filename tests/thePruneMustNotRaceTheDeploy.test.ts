import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';

/**
 * THE PRUNE MUST NOT RACE THE DEPLOY (2026-09-18).
 *
 * A deploy failed with `Image 'gcr.io/…/navbharat-cloud-run:1431bafe…' not found.` — the image the
 * build had pushed ninety seconds earlier. The pipeline's last step deleted old registry images, and
 * four PRs had merged inside three minutes, so four builds ran at once: one build's cleanup executed
 * inside another build's push→deploy window. Both of that cleanup's guards are blind in exactly that
 * window — an undeployed image is in no Cloud Run revision, and `--sort-by=TIMESTAMP` reads a
 * BuildKit-cached creation time — and `--force-delete-tags` took the `:$COMMIT_SHA` tag with the
 * digest. The step was removed; a native Artifact Registry cleanup policy replaces it, server-side.
 *
 * These are config invariants, so they are asserted against the file itself. Two of them are the
 * failure; the third is the hazard REMOVING it created, and is the reason this file exists at all
 * rather than the removal being left to a comment.
 */
describe('cloudbuild.yaml — nothing on the deploy path may delete a registry image', () => {
  const path = join(__dirname, '..', 'cloudbuild.yaml');
  const raw = readFileSync(path, 'utf8');
  const cfg = load(raw) as {
    steps: Array<{ name?: string; entrypoint?: string; args?: string[] }>;
    substitutions?: Record<string, string>;
  };

  /** Everything the build actually RUNS — never the comments, which are allowed to discuss deletes. */
  const executed = (): string =>
    cfg.steps.map((s) => [s.name ?? '', s.entrypoint ?? '', ...(s.args ?? [])].join('\n')).join('\n');

  it('🔴 no step deletes an image — that is the bug, and a comment about it is not a guard', () => {
    const ran = executed();
    expect(ran).not.toMatch(/container\s+images\s+delete/);
    expect(ran).not.toMatch(/artifacts\s+docker\s+images\s+delete/);
    expect(ran).not.toMatch(/--force-delete-tags/);
    // The prose in the file DOES name the removed command, deliberately, so the finding survives.
    expect(raw).toMatch(/force-delete-tags/);
  });

  it('🔒 the deploy is the LAST step — nothing may run after the image goes live', () => {
    const last = cfg.steps[cfg.steps.length - 1];
    expect((last.args ?? []).slice(0, 2)).toEqual(['run', 'deploy']);
  });

  it('every substitution the steps use is declared — an undeclared one fails the build outright', () => {
    const declared = new Set(Object.keys(cfg.substitutions ?? {}));
    const used = new Set<string>();
    for (const m of executed().matchAll(/\$\{(_[A-Z0-9_]+)\}/g)) used.add(m[1]);
    for (const name of used) expect(declared.has(name), `${name} is used but not declared`).toBe(true);
  });

  it('🔴 and every DECLARED substitution is used — Cloud Build MUST_MATCH fails on an orphan', () => {
    // This is the hazard created by deleting the step that read `_KEEP_IMAGES`, `_PRUNE_MIN_AGE` and
    // `_PRUNE_MAX`: leaving them declared would fail every future build at config parse, long after
    // anyone remembered why. Cloud Build's default substitution_option is MUST_MATCH and this file
    // sets no ALLOW_LOOSE, so the orphan is fatal rather than untidy.
    const ran = executed();
    for (const name of Object.keys(cfg.substitutions ?? {})) {
      expect(ran.includes(`\${${name}}`), `${name} is declared but no step reads it`).toBe(true);
    }
  });

  it('the pipeline still builds, pushes and deploys — removal must not have taken anything else', () => {
    const ran = executed();
    expect(ran).toContain('gcr.io/$PROJECT_ID/navbharat-cloud-run:$COMMIT_SHA');
    expect(ran).toContain('navbharat-ai-prod');
    expect(cfg.steps.filter((s) => (s.args ?? [])[0] === 'push')).toHaveLength(2);
  });
});
