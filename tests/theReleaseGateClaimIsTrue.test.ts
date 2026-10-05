/**
 * Q-141: the knowledge base told every AI that the deploy pipeline refuses to deploy while the release gate is
 * closed. At the time the live deploy (Cloud Build) had no gate step, so the claim was false. #3540 added the
 * step to cloudbuild.yaml — a check that is INERT until the trigger carries the `_RELEASE_GATE_URL` substitution —
 * so the claim was upgraded here, exactly as the first version of this test said it would be: the entry must now
 * say the live pipeline carries the check, that it holds nothing until that substitution is set, and must never
 * fall back to the unconditional "refuses to deploy" sentence. If the step is ever removed again, this test is
 * where the claim goes back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { getFeatureById } from '../src/server/AppContext/AppKnowledgeBase';

describe('the release gate claim matches the pipelines', () => {
  it('cloudbuild.yaml carries the gate check, and the entry says it is inert until _RELEASE_GATE_URL is set', () => {
    const entry = getFeatureById('admin-release-gate')!;
    const cloudbuild = readFileSync('cloudbuild.yaml', 'utf8');
    const stepOnLive = /release\/gate/.test(cloudbuild) && /_RELEASE_GATE_URL/.test(cloudbuild);
    expect(stepOnLive).toBe(true);
    expect(entry.description).toMatch(/Cloud Build/);
    expect(entry.description).toMatch(/_RELEASE_GATE_URL/);
    expect(entry.howToUse).toMatch(/_RELEASE_GATE_URL/);
    // The old false claims, in both directions: "does NOT check" is no longer true, and the unconditional
    // "refuses to deploy" was never true.
    expect(entry.description).not.toMatch(/does NOT check the gate/);
    expect(entry.description).not.toMatch(/The deploy pipeline checks the public GET \/api\/release\/gate\?sha=<commit> before promoting and refuses/);
  });
});
