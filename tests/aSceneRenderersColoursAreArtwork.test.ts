// 🔴 failedbr #2437 (fe73bca3): the app was 100/100 READY at 525 s; the builder then went after "24 distinct colours —
// worst: src/game/platformer/render.ts (21)" — a CANVAS RENDERER painting sky, ground and sprites — and the wallet stop
// ended the build mid-polish, reported as "did not succeed". A scene renderer's colours are artwork, not UI theme.
// Reversion: drop `isSceneRenderer` from the colour boundary and this fails.
import { describe, it, expect } from 'vitest';
import { lintBuiltApp, isSceneRenderer } from '../src/server/AgentV3/buildQualityLint';

const colours = ['#87ceeb', '#3a7d44', '#8b5a2b', '#ffcc00', '#ff4444', '#4444ff', '#222222', '#ffffff', '#999999', '#663399', '#00cc88', '#ff8800', '#cc0066', '#336699', '#aaff00'];
const RENDERER = `export function draw(ctx: CanvasRenderingContext2D) {\n${colours.map((c, i) => `  ctx.fillStyle = '${c}'; ctx.fillRect(${i}, 0, 10, 10);`).join('\n')}\n}\n`;
const UI = `export function Card() { return <div style={{ ${colours.map((c, i) => `c${i}: '${c}'`).join(', ')} }}>x</div>; }\n`;

describe('a scene renderer is not a UI palette', () => {
  it('recognises canvas and three.js painters, not components', () => {
    expect(isSceneRenderer('src/game/platformer/render.ts', RENDERER)).toBe(true);
    expect(isSceneRenderer('src/game/three/world.ts', 'const m = new THREE.MeshStandardMaterial({ color: "#ff0000" });')).toBe(true);
    expect(isSceneRenderer('src/components/Card.tsx', UI)).toBe(false);
    expect(isSceneRenderer('src/lib/theme.ts', "export const accent = '#ff0000';")).toBe(false);
  });
  it('the #2437 shape: a renderer with 15 colours does not trip the colour budget', () => {
    const lint = lintBuiltApp({ 'src/game/platformer/render.ts': RENDERER, 'src/App.tsx': 'export default function App(){ return <main className="app">hi</main>; }' });
    expect(lint?.design.violations.some((v) => v.type === 'color-count')).toBe(false);
  });
  it('the same colours scattered through a UI component still do', () => {
    const lint = lintBuiltApp({ 'src/components/Card.tsx': UI });
    expect(lint?.design.violations.some((v) => v.type === 'color-count')).toBe(true);
  });
});
