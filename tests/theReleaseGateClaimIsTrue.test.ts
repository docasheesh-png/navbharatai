/**
 * Q-141: the knowledge base told every AI that the deploy pipeline refuses to deploy while the release gate is
 * closed. The live deploy is Cloud Build, which has no gate step. The claim must match the pipelines — and if
 * someone adds the step, this test is where the claim gets upgraded.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { getFeatureById } from '../src/server/AppContext/AppKnowledgeBase';

describe('the release gate claim matches the pipelines', () => {
  it('the entry says Cloud Build does not check it, for as long as cloudbuild.yaml has no gate step', () => {
    const entry = getFeatureById('admin-release-gate')!;
    const cloudbuild = readFileSync('cloudbuild.yaml', 'utf8');
    const enforcedOnLive = /release\/gate/.test(cloudbuild);
    expect(enforcedOnLive).toBe(false);
    expect(entry.description).toMatch(/Cloud Build[^.]*does NOT check the gate/);
    expect(entry.description).not.toMatch(/The deploy pipeline checks the public GET \/api\/release\/gate\?sha=<commit> before promoting and refuses/);
  });
});
