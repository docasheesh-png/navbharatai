import { describe, it, expect, vi } from 'vitest';
import { mergeViaPullRequest, githubPrMode, planRevert, type PrCapableClient } from './GitHubPrFlow';
import type { CiVerdict, PullRequestInfo } from './GitHubAppClient';

function fakeClient(over: Partial<PrCapableClient> & { ci?: CiVerdict; pr?: Partial<PullRequestInfo>; merged?: boolean } = {}): PrCapableClient & { mergeCalls: number } {
  let mergeCalls = 0;
  const client = {
    async openPullRequest(): Promise<PullRequestInfo> { return { number: 5, htmlUrl: 'https://github.com/o/r/pull/5', headSha: 'sha5', ...(over.pr ?? {}) }; },
    async combinedStatus(): Promise<CiVerdict> { return over.ci ?? 'none'; },
    async mergePullRequest(): Promise<boolean> { mergeCalls++; return over.merged ?? true; },
    ...over,
  } as PrCapableClient & { mergeCalls: number };
  Object.defineProperty(client, 'mergeCalls', { get: () => mergeCalls });
  return client;
}

describe('mergeViaPullRequest', () => {
  it('merges immediately when the repo has no CI configured (none)', async () => {
    const client = fakeClient({ ci: 'none', merged: true });
    const r = await mergeViaPullRequest(client, 'app-x', { head: 'nbi/build-1', base: 'main', title: 't' });
    expect(r.opened).toBe(true);
    expect(r.merged).toBe(true);
    expect(client.mergeCalls).toBe(1);
    expect(r.note).toContain('Merged PR #5');
  });

  it('merges when CI is green (success)', async () => {
    const client = fakeClient({ ci: 'success', merged: true });
    const r = await mergeViaPullRequest(client, 'app-x', { head: 'h', base: 'main', title: 't' });
    expect(r.merged).toBe(true);
    expect(r.note).toContain('CI green');
  });

  it('does NOT merge when CI is red — leaves the PR open with an honest note', async () => {
    const client = fakeClient({ ci: 'failure' });
    const r = await mergeViaPullRequest(client, 'app-x', { head: 'h', base: 'main', title: 't' });
    expect(r.opened).toBe(true);
    expect(r.merged).toBe(false);
    expect(client.mergeCalls).toBe(0);
    expect(r.note).toContain('RED');
  });

  it('does NOT merge while CI is still pending', async () => {
    const client = fakeClient({ ci: 'pending' });
    const r = await mergeViaPullRequest(client, 'app-x', { head: 'h', base: 'main', title: 't' });
    expect(r.merged).toBe(false);
    expect(client.mergeCalls).toBe(0);
    expect(r.note).toContain('still running');
  });

  it('reads CI against the PR head sha', async () => {
    const status = vi.fn(async (): Promise<CiVerdict> => 'none');
    const client = fakeClient({ combinedStatus: status, ci: 'none', merged: true });
    await mergeViaPullRequest(client, 'app-x', { head: 'h', base: 'main', title: 't' });
    expect(status).toHaveBeenCalledWith('app-x', 'sha5');
  });

  it('degrades to a skipped result on a bad input or a thrown client', async () => {
    const noHead = await mergeViaPullRequest(fakeClient(), 'app-x', { head: '', base: 'main', title: 't' });
    expect(noHead.opened).toBe(false);

    const throwing: PrCapableClient = { async openPullRequest() { throw new Error('boom'); }, async combinedStatus() { return 'none'; }, async mergePullRequest() { return false; } };
    const res = await mergeViaPullRequest(throwing, 'app-x', { head: 'h', base: 'main', title: 't' });
    expect(res.opened).toBe(false);
    expect(res.merged).toBe(false);
  });
});

describe('planRevert', () => {
  it('auto-reverts a single-parent head (the squash "Ship to main" shape) to its parent', () => {
    const plan = planRevert({ sha: 'm1', parents: [{ sha: 'p0' }] });
    expect(plan).toEqual({ canRevert: true, parentSha: 'p0' });
  });

  it('refuses a true (multi-parent) merge commit honestly — points at GitHub Revert', () => {
    const plan = planRevert({ sha: 'm2', parents: [{ sha: 'a' }, { sha: 'b' }] });
    expect(plan.canRevert).toBe(false);
    expect(plan.parentSha).toBeUndefined();
    expect(plan.reason).toMatch(/multi-parent/i);
  });

  it('refuses a root commit (no parents) honestly', () => {
    const plan = planRevert({ sha: 'root', parents: [] });
    expect(plan.canRevert).toBe(false);
    expect(plan.reason).toMatch(/first commit/i);
  });

  it('refuses safely when the head is unreadable (null / malformed)', () => {
    expect(planRevert(null).canRevert).toBe(false);
    expect(planRevert(undefined).canRevert).toBe(false);
    // @ts-expect-error — exercising a malformed shape at runtime
    expect(planRevert({ sha: 'x' }).canRevert).toBe(false);
  });
});

describe('githubPrMode', () => {
  it('is off unless GITHUB_PR_MODE=true', () => {
    const prev = process.env.GITHUB_PR_MODE;
    delete process.env.GITHUB_PR_MODE;
    expect(githubPrMode()).toBe(false);
    process.env.GITHUB_PR_MODE = 'true';
    expect(githubPrMode()).toBe(true);
    if (prev === undefined) delete process.env.GITHUB_PR_MODE; else process.env.GITHUB_PR_MODE = prev;
  });
});
