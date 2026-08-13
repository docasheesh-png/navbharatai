import { describe, it, expect } from 'vitest';
import { nextBuildSuggestions } from './nextBuildSuggestions';

describe('nextBuildSuggestions — contextual "what to build next", never a repeat of what exists', () => {
  it('a game gets GAME-specific next steps first (score, sound, save, tutorial…)', () => {
    const s = nextBuildSuggestions({
      appText: 'A 3D coin collector game with levels and hazards',
      source: 'const player = {}; function movePlayer(){}',
      max: 5,
    });
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].kind).toBe('domain'); // domain-specific comes first
    const blob = s.map((x) => x.prompt.toLowerCase()).join(' | ');
    // something a game needs and this stub lacks — sound / save-progress / tutorial
    expect(blob).toMatch(/sound|save|progress|tutorial|difficulty|touch/);
  });

  it('never suggests a feature the app ALREADY has', () => {
    // This game source already has sound + a high-score save + a difficulty curve.
    const s = nextBuildSuggestions({
      appText: 'an endless runner game',
      source: 'playSound(); localStorage.setItem("highScore", x); speedUp(); const difficulty = 2;',
    });
    const titles = s.map((x) => x.title.toLowerCase()).join(' | ');
    expect(titles).not.toMatch(/sound/);
    expect(titles).not.toMatch(/save|high.?score|progress/);
  });

  it('falls back to universal enhancements for a plain app with no clear domain', () => {
    const s = nextBuildSuggestions({ appText: 'a calculator', source: 'function add(a,b){return a+b}' });
    expect(s.length).toBeGreaterThan(0);
    // dark mode / mobile / share are universal — the calculator has none of them
    expect(s.map((x) => x.id)).toEqual(expect.arrayContaining(['dark-mode']));
    expect(s.every((x) => x.prompt.length > 0)).toBe(true);
  });

  it('a dark-mode-already app is not told to add dark mode', () => {
    const s = nextBuildSuggestions({
      appText: 'a notes app',
      source: 'const [theme,setTheme]=useState("dark"); // dark mode toggle with prefers-color-scheme',
    });
    expect(s.map((x) => x.id)).not.toContain('dark-mode');
  });

  it('respects the max and always returns ready-to-send prompts', () => {
    const s = nextBuildSuggestions({ appText: 'a hospital management app', source: '', max: 3 });
    expect(s.length).toBeLessThanOrEqual(3);
    for (const x of s) {
      expect(x.id).toBeTruthy();
      expect(x.title).toBeTruthy();
      expect(x.prompt).toBeTruthy();
      expect(['domain', 'enhancement']).toContain(x.kind);
    }
  });

  it('is pure and safe on empty / junk input', () => {
    expect(nextBuildSuggestions({ appText: '', source: '' }).length).toBeGreaterThan(0); // universal still apply
    expect(() => nextBuildSuggestions({ appText: null as never, source: null as never })).not.toThrow();
  });
});
