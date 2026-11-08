import { describe, it, expect } from 'vitest';
import { nextStep, domainRecheckMs } from '../src/lib/nextStepGuide';

describe('nextStep — one next step from live facts', () => {
  it('a waiting build beats everything, even while building', () => {
    const s = nextStep({ building: true, blockingAsks: 1, topAskTitle: 'Add your Razorpay key', publishFreshness: 'changed' });
    expect(s?.id).toBe('build.waiting');
    expect(s?.cta?.target).toBe('tray');
    expect(s?.en).toContain('Razorpay');
  });
  it('building ⇒ wait, never publish', () => {
    expect(nextStep({ building: true, publishFreshness: 'never_published', buildFinished: true, buildOk: true })?.id).toBe('build.running');
  });
  it('failed build ⇒ report', () => {
    expect(nextStep({ buildFinished: true, buildOk: false })?.cta?.target).toBe('report');
  });
  it('database ask ⇒ opens Database settings', () => {
    const s = nextStep({ buildFinished: true, buildOk: true, openAsks: 1, topAskIsDatabase: true, topAskTitle: 'Connect Firebase' });
    expect(s?.cta?.target).toBe('database');
    expect(s?.hi).toContain('database');
  });
  it('publish flow: first, stale, then domain', () => {
    const ok = { buildFinished: true, buildOk: true } as const;
    expect(nextStep({ ...ok, publishFreshness: 'never_published' })?.id).toBe('publish.first');
    expect(nextStep({ ...ok, publishFreshness: 'changed', domain: 'a.in', domainActive: false })?.id).toBe('publish.stale');
    const d = nextStep({ ...ok, publishFreshness: 'up_to_date', domain: 'a.in', domainActive: false });
    expect(d?.id).toBe('domain.pending');
    expect(d?.recheck).toBe(true);
    expect(nextStep({ ...ok, publishFreshness: 'up_to_date', domain: 'a.in', domainActive: true })?.id).toBe('all.done');
  });
  it('an unchecked domain is never called pending', () => {
    expect(nextStep({ buildFinished: true, buildOk: true, publishFreshness: 'up_to_date', domain: 'a.in' })?.id).toBe('live.done');
  });
  it('nothing known ⇒ nothing shown', () => {
    expect(nextStep({})).toBeNull();
    expect(nextStep({ buildFinished: true, buildOk: true, publishFreshness: 'unknown' })).toBeNull();
  });
  it('recheck backs off', () => {
    expect(domainRecheckMs(0)).toBe(30_000);
    expect(domainRecheckMs(9)).toBe(120_000);
  });
});
