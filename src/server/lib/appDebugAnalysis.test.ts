import { describe, it, expect } from 'vitest';
import {
  isAnalyzableFile, filePriority, selectFilesForAI,
  buildAppDebugSystemPrompt, buildAppDebugBatchPrompt,
  parseAiFindings, mergeFindings, summarizeScan, computeHealth,
  type AppFinding,
} from './appDebugAnalysis';
import type { StaticFinding } from './appStaticScan';

describe('isAnalyzableFile — sends real source, never junk/secrets/binaries', () => {
  it('accepts source and config, rejects build artifacts, secrets, binaries', () => {
    expect(isAnalyzableFile('src/app.ts')).toBe(true);
    expect(isAnalyzableFile('package.json')).toBe(true);
    expect(isAnalyzableFile('Dockerfile')).toBe(true);
    expect(isAnalyzableFile('node_modules/x/index.js')).toBe(false);
    expect(isAnalyzableFile('dist/bundle.js')).toBe(false);
    expect(isAnalyzableFile('.env')).toBe(false);          // never send secrets to the model
    expect(isAnalyzableFile('secret.pem')).toBe(false);
    expect(isAnalyzableFile('logo.png')).toBe(false);
  });
});

describe('filePriority — source first, tests last', () => {
  it('ranks source below config below assets, tests lowest', () => {
    expect(filePriority('src/a.ts')).toBeLessThan(filePriority('vite.config.ts'));
    expect(filePriority('vite.config.ts')).toBeLessThan(filePriority('styles/app.css'));
    expect(filePriority('src/a.test.ts')).toBe(5);
  });
});

describe('selectFilesForAI — bounded, prioritized, batched', () => {
  it('picks analyzable files source-first and reports nothing skipped when small', () => {
    const sel = selectFilesForAI({
      'README.md': '# hi',
      'src/a.ts': 'export const a = 1;',
      'node_modules/x.js': 'junk',
      'logo.png': 'binary',
    });
    expect(sel.picked).toContain('src/a.ts');
    expect(sel.picked).not.toContain('node_modules/x.js');
    expect(sel.picked).not.toContain('logo.png');
    // source before docs
    expect(sel.picked.indexOf('src/a.ts')).toBeLessThan(sel.picked.indexOf('README.md'));
    expect(sel.skippedForBudget).toBe(0);
    expect(sel.batches.length).toBeGreaterThanOrEqual(1);
  });

  it('honestly reports files skipped for the token budget', () => {
    const files: Record<string, string> = {};
    // 200 sizeable source files → far past AI_MAX_FILES / char budget
    for (let i = 0; i < 200; i++) files[`src/f${i}.ts`] = 'x'.repeat(4000);
    const sel = selectFilesForAI(files);
    expect(sel.analyzableTotal).toBe(200);
    expect(sel.picked.length).toBeLessThan(200);
    expect(sel.skippedForBudget).toBe(200 - sel.picked.length);
    expect(sel.skippedForBudget).toBeGreaterThan(0);
  });

  it('truncates a single oversized file rather than dropping it', () => {
    const sel = selectFilesForAI({ 'src/huge.ts': 'y'.repeat(50_000) });
    expect(sel.picked).toEqual(['src/huge.ts']);
    const body = sel.batches[0].files[0].content;
    expect(body.length).toBeLessThan(50_000);
    expect(body).toMatch(/file truncated/);
  });
});

describe('buildAppDebug prompts — white-label + line-numbered', () => {
  it('system prompt is white-label and demands a JSON array', () => {
    const sys = buildAppDebugSystemPrompt();
    expect(sys).toMatch(/NavBharatAI/);
    expect(sys).toMatch(/NEVER mention any underlying AI model/i);
    expect(sys).toMatch(/JSON array/i);
    for (const vendor of ['GLM', 'Kimi', 'Claude', 'Gemini', 'Grok', 'Anthropic', 'OpenAI']) {
      expect(sys).not.toContain(vendor);
    }
  });

  it('batch prompt numbers lines so the model can cite them', () => {
    const p = buildAppDebugBatchPrompt({ files: [{ path: 'src/a.ts', content: 'const a=1;\nconst b=2;' }] });
    expect(p).toMatch(/FILE: src\/a\.ts/);
    expect(p).toMatch(/1\tconst a=1;/);
    expect(p).toMatch(/2\tconst b=2;/);
  });
});

describe('parseAiFindings — robust + honest', () => {
  it('parses a clean JSON array', () => {
    const t = JSON.stringify([
      { severity: 'high', file: 'src/a.ts', line: 12, category: 'logic', problem: 'off-by-one', suggestion: 'use <=' },
    ]);
    const fs = parseAiFindings(t);
    expect(fs).toHaveLength(1);
    expect(fs[0]).toMatchObject({ severity: 'high', file: 'src/a.ts', line: 12, source: 'ai' });
  });

  it('tolerates ```json fences and stray prose', () => {
    const t = 'Here are the issues:\n```json\n[{"severity":"low","file":"a.ts","line":1,"problem":"x","suggestion":"y"}]\n```';
    expect(parseAiFindings(t)).toHaveLength(1);
  });

  it('drops findings with no problem text (never an empty card)', () => {
    const t = JSON.stringify([{ severity: 'high', file: 'a.ts', problem: '' }, { file: 'b.ts', problem: 'real' }]);
    const fs = parseAiFindings(t);
    expect(fs).toHaveLength(1);
    expect(fs[0].file).toBe('b.ts');
  });

  it('honours an explicit empty array as "no findings"', () => {
    expect(parseAiFindings('[]')).toEqual([]);
  });

  it('returns [] for unparseable junk rather than fabricating', () => {
    expect(parseAiFindings('the model was confused and wrote prose only')).toEqual([]);
  });

  it('normalizes odd severities and maps a cited basename back to a real path', () => {
    const t = JSON.stringify([{ severity: 'blocker', file: 'a.ts', line: 3, problem: 'bad' }]);
    const fs = parseAiFindings(t, ['src/deep/a.ts']);
    expect(fs[0].severity).toBe('high');
    expect(fs[0].file).toBe('src/deep/a.ts');
  });
});

describe('mergeFindings + summarizeScan — dedupe, rank, honest counts', () => {
  const stat: StaticFinding = {
    severity: 'medium', file: 'src/a.ts', line: 5, category: 'error-handling',
    problem: 'empty catch', suggestion: 'handle it', source: 'static',
  };
  const aiDup: AppFinding = {
    severity: 'high', file: 'src/a.ts', line: 5, category: 'error-handling',
    problem: 'swallowed error', suggestion: 'log it', source: 'ai',
  };
  const aiNew: AppFinding = {
    severity: 'critical', file: 'src/b.ts', line: 2, category: 'security',
    problem: 'sql injection', suggestion: 'parameterize', source: 'ai',
  };

  it('static wins at a shared spot; unique AI findings are kept', () => {
    const merged = mergeFindings([stat], [aiDup, aiNew]);
    expect(merged).toHaveLength(2); // aiDup deduped against the static one
    expect(merged.find((f) => f.file === 'src/a.ts')!.source).toBe('static');
  });

  it('ranks most-severe first', () => {
    const merged = mergeFindings([stat], [aiNew]);
    expect(merged[0].severity).toBe('critical'); // b.ts critical before a.ts medium
    expect(merged[0].file).toBe('src/b.ts');
  });

  it('summary counts by severity and totals', () => {
    const merged = mergeFindings([stat], [aiNew]);
    const s = summarizeScan(merged, {
      filesTotal: 10, filesStaticScanned: 10, filesAiScanned: 8, filesAiSkippedForBudget: 2, bytesAiScanned: 1234,
    });
    expect(s.total).toBe(2);
    expect(s.counts.critical).toBe(1);
    expect(s.counts.medium).toBe(1);
    expect(s.filesAiSkippedForBudget).toBe(2);
    expect(s.health).toBeTruthy();
    expect(s.health.score).toBeGreaterThanOrEqual(0);
    expect(s.health.score).toBeLessThanOrEqual(100);
  });
});

describe('computeHealth — honest project health score', () => {
  it('a clean app scores 100 with a clean verdict', () => {
    const h = computeHealth([], 20);
    expect(h.score).toBe(100);
    expect(h.verdict).toMatch(/clean/i);
    expect(h.topCategories).toEqual([]);
  });

  it('a critical-heavy app scores low and lists top categories', () => {
    const many: AppFinding[] = Array.from({ length: 6 }, (_, i) => ({
      severity: 'critical', file: `f${i}.ts`, line: 1, category: 'security', problem: 'x', suggestion: 'y', source: 'ai',
    }));
    const h = computeHealth(many, 10);
    expect(h.score).toBeLessThan(50);
    expect(h.topCategories[0]).toEqual({ category: 'security', count: 6 });
  });

  it('scales by size — the same findings hurt a tiny app more than a large one', () => {
    const finds: AppFinding[] = Array.from({ length: 4 }, (_, i) => ({
      severity: 'high', file: `f${i}.ts`, line: 1, category: 'logic', problem: 'x', suggestion: 'y', source: 'ai',
    }));
    const small = computeHealth(finds, 8);
    const large = computeHealth(finds, 200);
    expect(large.score).toBeGreaterThan(small.score);
  });
});
