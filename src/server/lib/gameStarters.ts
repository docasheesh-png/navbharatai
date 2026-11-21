/**
 * The game kit's ready-to-play genre starters (src/game/<name>.tsx), and the genre each is for. ONE list (2026-11-20):
 * three readers in the build engine (actionVisibility, endlessRaceCourse, shellBypass) each hard-coded RacingRoadGame,
 * so a new starter would have been read as the builder's own hand-written game everywhere else. PURE.
 */
export const GAME_STARTERS: ReadonlyArray<{ name: string; module: string; genre: string }> = [
  { name: 'RacingRoadGame', module: 'racingroadgame', genre: 'racing' },
  { name: 'LaneRunnerGame', module: 'lanerunnergame', genre: 'runner' },
  // Written by generate_open_world (not a shell module): a player on the Athree map, with a city on request.
  { name: 'OpenWorldGame', module: 'openworldgame', genre: 'open-world' },
];

/** The starter names as a regex alternation, for the readers above. */
export const GAME_STARTER_ALTERNATION = GAME_STARTERS.map((s) => s.name).join('|');
