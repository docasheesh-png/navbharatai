// 🎮 A PLAY SCREEN IS A CANVAS, NOT A PAGE WITH A TITLE (failedbr #2279, 2026-11-20 — "GO CAR").
//
// The racing game's GameplayScreen hosted the 3D scene with a HUD over it and was flagged DESIGN_PAGE_INCONSISTENT
// (NO_HEADING) — a finding the design repair pass acts on, so the platform would have paid to stack a title over a
// running game. Reversion: drop `&& !isPlayScreen(path, content)` from analyzePage and the first test fails.

import { describe, it, expect } from 'vitest';
import { analyzePage, isPlayScreen } from '../src/server/AgentV3/DesignCoverage';

const GAMEPLAY = `import { useRef } from 'react';
import FloatingIslandMap from '../components/FloatingIslandMap';
import MobileControls from '../components/MobileControls';
export default function GameplayScreen() {
  const hostRef = useRef<HTMLDivElement>(null);
  return (
    <div className="gameplay">
      <div className="scene-host" ref={hostRef} />
      <FloatingIslandMap hostRef={hostRef} />
      <div className="hud"><span className="hud-speed">0 km/h</span><span className="hud-lap">Lap 1/3</span></div>
      <div className="countdown"><span className="countdown-number">3</span></div>
      <MobileControls />
    </div>
  );
}`;

describe('a play screen is not held to a page title', () => {
  it("#2279's GameplayScreen: no NO_HEADING", () => {
    const f = analyzePage('src/screens/GameplayScreen.tsx', GAMEPLAY);
    expect(f?.defects ?? []).not.toContain('NO_HEADING');
  });
  it('a canvas game page is a play screen too', () => {
    expect(isPlayScreen('src/pages/RacePage.tsx', '<div><canvas ref={canvasRef} /></div>')).toBe(true);
  });
});

describe('the boundaries: everything else still needs its title', () => {
  it('a menu, garage or results screen in the same game is still flagged', () => {
    for (const p of ['src/screens/MainMenuScreen.tsx', 'src/screens/GarageScreen.tsx', 'src/screens/GameOverScreen.tsx', 'src/screens/LevelSelectScreen.tsx']) {
      expect(isPlayScreen(p, GAMEPLAY), p).toBe(false);
    }
  });
  it('a screen named for play with no play surface is still flagged', () => {
    const plain = '<div className="a"><p className="b">x</p><p className="c">y</p><p className="d">z</p><p className="e">w</p><p className="f">v</p></div>';
    expect(analyzePage('src/screens/GameplayScreen.tsx', plain)?.defects).toContain('NO_HEADING');
  });
  it('an ordinary dashboard page is unchanged', () => {
    const dash = '<div className="a"><div className="b"><p className="c">1</p><p className="d">2</p><p className="e">3</p><p className="f">4</p></div></div>';
    expect(analyzePage('src/pages/DashboardPage.tsx', dash)?.defects).toContain('NO_HEADING');
  });
});
