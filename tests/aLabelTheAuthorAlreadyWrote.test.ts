// AUTOPSY 6bae5835 (2026-09-27): one <input> in a working app shipped with no label, and the report could
// not say whether the write-time note had reached that file and been ignored, or never reached it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { labelFieldsFromPlaceholder, inputsMissingLabel } from '../src/server/AppMakerLab/intelligence/A11yLinter';
import { writeQualitySummary, emptyWriteTypecheckStats } from '../src/server/AgentV3/writeTimeTypecheck';

const PANEL = `export function TasksPanel() {
  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search tasks"
      />
      <input placeholder={t('x')} />
      <label>Name <input placeholder="Your name" /></label>
      <Input placeholder="Component" />
      <textarea placeholder='Write a note'></textarea>
      <input type="hidden" name="id" />
    </div>
  );
}`;

describe('the label repair', () => {
  it('names an unlabelled field with its own literal placeholder — multi-line tag included', () => {
    const r = labelFieldsFromPlaceholder(PANEL);
    expect(r.repaired).toBe(2);
    expect(r.code).toContain('<input aria-label="Search tasks"');
    expect(r.code).toContain("<textarea aria-label='Write a note'");
    expect(inputsMissingLabel(r.code)).toEqual([4, 1]); // only the expression placeholder is left
  });
  it('🔒 never touches a component, a wrapped field, an expression placeholder or a hidden input', () => {
    const r = labelFieldsFromPlaceholder(PANEL);
    expect(r.code).toContain('<Input placeholder="Component" />');
    expect(r.code).toContain('<label>Name <input placeholder="Your name" /></label>');
    expect(r.code).toContain("<input placeholder={t('x')} />");
    expect(r.code).toContain('<input type="hidden" name="id" />');
  });
  it('is a no-op on a file with nothing to fix, and idempotent', () => {
    expect(labelFieldsFromPlaceholder('const x = 1;')).toEqual({ code: 'const x = 1;', repaired: 0 });
    const once = labelFieldsFromPlaceholder(PANEL).code;
    expect(labelFieldsFromPlaceholder(once).repaired).toBe(0);
  });
  it('runs before the lint, only over files this build wrote, behind a kill switch', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const repair = route.indexOf('labelFieldsFromPlaceholder(integrityFiles[path])');
    const lint = route.indexOf('const quality = hasUserApp ? lintBuiltApp(integrityFiles) : null;');
    expect(repair).toBeGreaterThan(-1);
    expect(repair).toBeLessThan(lint);
    expect(route).toContain("process.env.AGENTV3_LABEL_REPAIR !== 'off'");
    expect(route).toContain('for (const path of [...writtenFiles.keys()])');
  });
});

describe('noted and ignored, or never noted', () => {
  it('splits the files still flagged at the end by whether a note reached them', () => {
    const line = writeQualitySummary(['src/a.tsx', 'src/b.tsx'], ['src/a.tsx', 'src/c.tsx']);
    expect(line).toMatch(/notes went to 2 file\(s\)/);
    expect(line).toMatch(/1 had been noted and not fixed \(src\/a\.tsx\)/);
    expect(line).toMatch(/1 never got a note \(src\/c\.tsx\)/);
  });
  it('silent when there is nothing on either side', () => {
    expect(writeQualitySummary([], [])).toBe('');
  });
  it('the counter lives on the object every lane shares, and the dispatcher fills it', () => {
    expect(emptyWriteTypecheckStats().qualityNotedFiles).toEqual([]);
    const d = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    expect(d).toContain('const noted = this._writeTypecheckStats.qualityNotedFiles;');
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toContain("code: 'WRITE_TIME_QUALITY'");
  });
});
