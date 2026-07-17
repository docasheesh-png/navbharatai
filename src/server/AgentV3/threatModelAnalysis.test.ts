import { describe, it, expect } from 'vitest';
import { analyzeThreatModel, threatModelSummary } from './threatModelAnalysis';

const src = (path: string, content: string) => ({ path, content });

describe('analyzeThreatModel', () => {
  it('flags a real secret hardcoded in CLIENT code', () => {
    const f = analyzeThreatModel([src('src/api.ts', "const key = 'sk_live_abc123def456ghi789';")]);
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe('client-secret');
    expect(f[0].severity).toBe('high');
  });

  it('does NOT flag an env-ref, a placeholder, or a secret in SERVER code', () => {
    expect(analyzeThreatModel([src('src/config.ts', 'const key = import.meta.env.VITE_KEY;')])).toEqual([]);
    expect(analyzeThreatModel([src('src/config.ts', "const key = 'your_api_key_here';")])).toEqual([]);
    // Server-side file: a secret there is expected (not shipped to the browser) → not a client-secret finding.
    expect(analyzeThreatModel([src('server/routes/pay.ts', "const k = 'sk_live_abc123def456ghi789';")]).filter((x) => x.kind === 'client-secret')).toEqual([]);
  });

  it('flags wildcard CORS with credentials', () => {
    const content = "app.use(cors({ origin: '*', credentials: true }));";
    const f = analyzeThreatModel([src('server/index.ts', content)]);
    expect(f.some((x) => x.kind === 'cors-wildcard-credentials')).toBe(true);
  });

  it('does NOT flag wildcard CORS WITHOUT credentials', () => {
    const f = analyzeThreatModel([src('server/index.ts', "app.use(cors({ origin: '*' }));")]);
    expect(f.filter((x) => x.kind === 'cors-wildcard-credentials')).toEqual([]);
  });

  it('flags SQL built by template interpolation and by concatenation', () => {
    const tpl = analyzeThreatModel([src('server/db.ts', 'db.query(`SELECT * FROM users WHERE id = ${id}`);')]);
    expect(tpl.some((x) => x.kind === 'sql-injection')).toBe(true);
    const cat = analyzeThreatModel([src('server/db.ts', "db.execute('SELECT * FROM t WHERE n = ' + name);")]);
    expect(cat.some((x) => x.kind === 'sql-injection')).toBe(true);
  });

  it('does NOT flag a parameterized query', () => {
    const f = analyzeThreatModel([src('server/db.ts', "db.query('SELECT * FROM users WHERE id = $1', [id]);")]);
    expect(f.filter((x) => x.kind === 'sql-injection')).toEqual([]);
  });

  it('flags dangerouslySetInnerHTML from a variable but not from a literal or sanitized value', () => {
    const bad = analyzeThreatModel([src('src/Post.tsx', '<div dangerouslySetInnerHTML={{ __html: post.body }} />')]);
    expect(bad.some((x) => x.kind === 'xss-dangerous-html')).toBe(true);
    const lit = analyzeThreatModel([src('src/Post.tsx', '<div dangerouslySetInnerHTML={{ __html: "<b>hi</b>" }} />')]);
    expect(lit.filter((x) => x.kind === 'xss-dangerous-html')).toEqual([]);
    const clean = analyzeThreatModel([src('src/Post.tsx', '<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(post.body) }} />')]);
    expect(clean.filter((x) => x.kind === 'xss-dangerous-html')).toEqual([]);
  });

  it('flags eval on a non-literal but not on a literal', () => {
    expect(analyzeThreatModel([src('src/run.ts', 'eval(userInput);')]).some((x) => x.kind === 'eval-injection')).toBe(true);
    expect(analyzeThreatModel([src('src/run.ts', "eval('1 + 1');")]).filter((x) => x.kind === 'eval-injection')).toEqual([]);
  });

  it('ignores test files and never throws on garbage', () => {
    expect(analyzeThreatModel([src('src/api.test.ts', "const key = 'sk_live_abc123def456ghi789';")])).toEqual([]);
    expect(analyzeThreatModel([])).toEqual([]);
    expect(analyzeThreatModel(null as never)).toEqual([]);
  });
});

describe('threatModelSummary', () => {
  it('is empty when clean, lists findings with a high count otherwise', () => {
    expect(threatModelSummary([])).toBe('');
    const f = analyzeThreatModel([src('src/api.ts', "const key = 'sk_live_abc123def456ghi789';")]);
    const s = threatModelSummary(f);
    expect(s).toContain('Threat model —');
    expect(s).toContain('1 high');
  });
});
