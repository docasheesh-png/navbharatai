// ADMIN 2026-09-28: Teacher AI → Exam mode → Settings → the language dropdown "bas 1 second ke liye khulta
// hai". The sheet moved the focus to its heading inside an effect keyed on `onClose`, and its parent
// passes `onClose` as an inline arrow — a new function on every render — so every re-render pulled the
// focus out of the <select>, and a native <select> closes its list the moment it loses focus.
//
// Proven in a real browser before the fix: focus on the select, the parent re-rendering every 300 ms,
// 1.5 s later the focus was on the heading. With `useDialogOpen` it stays on the select and Escape still
// closes. These guards are source-level because this repo has no DOM test environment, and tsc cannot
// see which dependency list an effect runs on.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const hook = readFileSync('src/hooks/useDialogOpen.ts', 'utf8');

describe('the hook focuses once and closes on Escape', () => {
  it('the focus effect has NO dependencies — it runs on open only', () => {
    expect(hook).toMatch(/useEffect\(\(\) => \{\s*focusRef\.current\?\.focus\(\);[\s\S]{0,200}\}, \[\]\);/);
  });
  it('Escape reads the CURRENT onClose through a ref, so a new function never re-runs anything', () => {
    expect(hook).toMatch(/onCloseRef\.current = onClose;/);
    expect(hook).toMatch(/onCloseRef\.current\(\);/);
  });
});

describe('the two dialogs that had the bug use it', () => {
  it('Exam settings (the reported one) and the publish celebration', () => {
    expect(readFileSync('src/components/professionals/ExamMode.tsx', 'utf8')).toContain('useDialogOpen(headingRef, onClose);');
    expect(readFileSync('src/components/agentv3/PublishCelebration.tsx', 'utf8')).toContain('useDialogOpen(closeRef, onClose);');
  });

  it('no component moves the focus inside an effect keyed on onClose any more', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!p.endsWith('.tsx')) continue;
        const src = readFileSync(p, 'utf8');
        const re = /useEffect\(\(\) => \{([\s\S]*?)\}, \[onClose\]\);/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) if (/\.focus\(\)/.test(m[1])) offenders.push(p);
      }
    };
    walk('src/components');
    expect(offenders).toEqual([]);
  });
});
