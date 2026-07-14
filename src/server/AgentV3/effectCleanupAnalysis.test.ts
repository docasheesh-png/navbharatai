import { describe, it, expect } from 'vitest';
import { analyzeEffectCleanup, effectCleanupSummary } from './effectCleanupAnalysis';

const src = (content: string, path = 'src/components/Widget.tsx') => [{ path, content }];

describe('analyzeEffectCleanup — missing useEffect cleanup (memory leak)', () => {
  it('flags setInterval in a useEffect with no cleanup return', async () => {
    const issues = await analyzeEffectCleanup(src(
      `useEffect(() => {\n  setInterval(() => tick(), 1000);\n}, []);`));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'missing-effect-cleanup', resource: 'setInterval' });
  });

  it('flags addEventListener in a useEffect with no cleanup', async () => {
    const issues = await analyzeEffectCleanup(src(
      `useEffect(() => {\n  window.addEventListener('resize', onResize);\n}, []);`));
    expect(issues).toHaveLength(1);
    expect(issues[0].resource).toBe('addEventListener');
  });

  it('does NOT flag when the effect RETURNS a cleanup function (correct pattern)', async () => {
    const issues = await analyzeEffectCleanup(src(
      `useEffect(() => {\n  const id = setInterval(() => tick(), 1000);\n  return () => clearInterval(id);\n}, []);`));
    expect(issues).toEqual([]);
  });

  it('does NOT flag when cleanup removes the listener', async () => {
    const issues = await analyzeEffectCleanup(src(
      `useEffect(() => {\n  window.addEventListener('resize', onResize);\n  return () => window.removeEventListener('resize', onResize);\n}, []);`));
    expect(issues).toEqual([]);
  });

  it('flags a concise-body arrow effect that sets an interval (no cleanup possible)', async () => {
    const issues = await analyzeEffectCleanup(src(
      `useEffect(() => setInterval(poll, 5000), []);`));
    expect(issues).toHaveLength(1);
  });

  it('does NOT flag a useEffect with no leaky setup (pure state work)', async () => {
    const issues = await analyzeEffectCleanup(src(
      `useEffect(() => {\n  setCount(c => c + 1);\n}, [dep]);`));
    expect(issues).toEqual([]);
  });

  it('flags a subscription without cleanup, and de-dupes / skips test files', async () => {
    const leak = await analyzeEffectCleanup(src(`useEffect(() => {\n  store.subscribe(onChange);\n}, []);`));
    expect(leak[0].resource).toBe('subscribe');
    expect(await analyzeEffectCleanup(src(`useEffect(() => { setInterval(x, 1); }, []);`, 'src/w.test.tsx'))).toEqual([]);
  });

  it('summary reports the count or is empty when clean; never throws on malformed input', async () => {
    expect(effectCleanupSummary([])).toBe('');
    const issues = await analyzeEffectCleanup(src(`useEffect(() => { setInterval(x, 1); }, []);`));
    expect(effectCleanupSummary(issues)).toContain('leak a resource');
    // @ts-expect-error malformed
    expect(await analyzeEffectCleanup(null)).toEqual([]);
    expect(await analyzeEffectCleanup(src('const <<< =', 'src/bad.tsx'))).toEqual([]);
  });
});
