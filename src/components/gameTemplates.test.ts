import { describe, expect, it } from 'vitest';
import { matchGameTemplate } from './GameTemplateCatalog';
import { createTrack, RACING_TRACKS, racingTrackIndex } from './EndlessRacingGame';

describe('game template auto selection', () => {
  it.each([
    ['baraf wali racing game', 'Snow & Ice'],
    ['mountain pass car racer', 'Mountain Pass'],
    ['carrom game', 'Carrom Board'],
    ['ludo with friends', 'Ludo'],
    ['shatranj chess', 'Chess'],
    ['space shooter', 'Space Shooter'],
  ])('matches "%s" to %s', (request, expected) => {
    expect(matchGameTemplate(request)?.name).toBe(expected);
  });

  it('does not silently choose a default for an unrecognized request', () => {
    expect(matchGameTemplate('make something fun')).toBeUndefined();
    expect(matchGameTemplate('')).toBeUndefined();
  });

  it('maps all 24 named tracks to their own geometry profile', () => {
    expect(RACING_TRACKS).toHaveLength(24);
    const signatures = RACING_TRACKS.map((_, index) => {
      const points = createTrack(index);
      return `${points[300].x.toFixed(2)},${points[300].y.toFixed(2)}:${points[700].x.toFixed(2)},${points[700].y.toFixed(2)}`;
    });
    expect(new Set(signatures).size).toBe(24);
    expect(racingTrackIndex('Snow & Ice')).toBe(6);
    expect(racingTrackIndex('missing track')).toBe(0);
  });

  it.each(RACING_TRACKS.map((name, index) => [name, index] as const))('%s remains finite and closes without a position seam', (_name, index) => {
    const points = createTrack(index);
    expect(points).toHaveLength(1401);
    expect(points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.distance))).toBe(true);
    expect(points.at(-1)!.x).toBeCloseTo(points[0].x, 8);
    expect(points.at(-1)!.y).toBeCloseTo(points[0].y, 8);
    expect(points.at(-1)!.distance).toBeGreaterThan(points.at(-2)!.distance);
  });
});
