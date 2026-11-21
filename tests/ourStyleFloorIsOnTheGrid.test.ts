// failedbr #1228 (2026-11-20): DESIGN_CONSISTENCY blamed "src/nb-autostyle.css (5)" — the platform's own style floor emitted
// 2px / 6px / 10px spacing, and the off-grid count was charged to the user's app.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { autoStyleSheet } from '../src/server/AgentV3/autoStyleFloor';
import { lintBuiltApp } from '../src/server/AgentV3/buildQualityLint';

const CLASSES = ['card', 'panel', 'btn', 'btn-primary', 'btn-secondary', 'button-ghost', 'header', 'title', 'subtitle', 'list', 'list-item', 'row', 'grid', 'tiles', 'chips', 'badge', 'tag', 'pill', 'modal', 'input', 'input-field', 'search', 'option', 'choice', 'active', 'selected', 'nav-tab', 'tabs', 'price', 'avatar', 'empty-state', 'toast', 'footer', 'container', 'board', 'cell'];

describe('our style floor is on the 4px grid (failedbr #1228)', () => {
  it('a floor for every common class family has no off-grid spacing', () => {
    const r = lintBuiltApp({ 'src/nb-autostyle.css': autoStyleSheet(CLASSES), 'src/App.tsx': 'export default function App() { return <div className="card">x</div>; }' });
    expect(r?.design.violations.filter((v) => v.type === 'off-grid-spacing') ?? []).toEqual([]);
  });
  it('🔒 no spacing literal in the floor\'s source is off the grid', () => {
    const src = readFileSync('src/server/AgentV3/autoStyleFloor.ts', 'utf8');
    const values = [...src.matchAll(/(?:gap|padding|margin)[a-z-]*:\s*([^;'`]+)/g)].flatMap((m) => [...m[1].matchAll(/(\d+)px/g)].map((n) => Number(n[1])));
    expect(values.length).toBeGreaterThan(5);
    expect(values.filter((n) => n % 4 !== 0)).toEqual([]);
  });
});
