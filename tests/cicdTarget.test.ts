import { describe, it, expect } from 'vitest';
import { workflowPath, commitTarget, commitMessage, type CiPlatform } from '../src/lib/cicdTarget';

const ALL: CiPlatform[] = ['github', 'cloudbuild', 'gitlab'];

describe('workflowPath — one source of truth for the file name', () => {
  it('puts each platforms file where that platform actually looks for it', () => {
    // GitHub only runs a workflow from this exact directory; anywhere else and nothing happens.
    expect(workflowPath('github')).toBe('.github/workflows/cicd.yml');
    expect(workflowPath('cloudbuild')).toBe('cloudbuild.yaml');
    expect(workflowPath('gitlab')).toBe('.gitlab-ci.yml');
  });

  it('every platform has a path, so a new one cannot be added without deciding this', () => {
    for (const p of ALL) expect(workflowPath(p), p).toMatch(/\.ya?ml$/);
  });
});

describe('commitTarget — only offer to commit where the file will really do something', () => {
  it('commits a GitHub Actions workflow, which runs as soon as it lands', () => {
    const t = commitTarget('github');
    expect(t.canCommit).toBe(true);
  });

  it('commits a Cloud Build config too, because Cloud Build reads it from GitHub', () => {
    // This is how NavBharatAI itself deploys, so it is a real path, not a guess.
    expect(commitTarget('cloudbuild').canCommit).toBe(true);
  });

  it('REFUSES GitLab rather than committing a file that would do nothing', () => {
    const t = commitTarget('gitlab');
    expect(t.canCommit).toBe(false);
    if (!t.canCommit) {
      expect(t.reason).toMatch(/GitLab/);
      // It has to say what the user should do instead, not just decline.
      expect(t.reason).toMatch(/download/i);
    }
  });

  it('always explains itself, either way', () => {
    for (const p of ALL) {
      const t = commitTarget(p);
      const text = t.canCommit ? t.note : t.reason;
      expect(text.length, p).toBeGreaterThan(20);
    }
  });
});

describe('commitMessage', () => {
  it('names the app so a repository history says where the file came from', () => {
    expect(commitMessage('github', 'Chai Point')).toBe('Add CI/CD workflow for Chai Point (NavBharatAI)');
    expect(commitMessage('cloudbuild', 'Chai Point')).toBe('Add Cloud Build config for Chai Point (NavBharatAI)');
  });

  it('stays a valid message when the app has no name', () => {
    expect(commitMessage('github', '')).toBe('Add CI/CD workflow (NavBharatAI)');
    expect(commitMessage('github', '   ')).not.toContain('  (');
  });
});
