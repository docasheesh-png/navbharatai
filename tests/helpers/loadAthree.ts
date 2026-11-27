// Loads the EMITTED Athree map modules the way a game would use them: transpile each emitted TypeScript file and run it, resolving
// its relative imports among the emitted files. The tests run the generated code, not a copy of it. The loader is the one the build
// itself uses to run the robot checks at build time (mapRobotRun.ts), so tests and build time load the map the same way.
import { generateAthreeMap } from '../../src/server/lib/athreeMap/AthreeMapGenerator';
import { loadEmittedAthree } from '../../src/server/lib/athreeMap/mapRobotRun';

export function loadAthree(include?: string[], choiceOrExclusions?: {archetype:any;sizeKm:number} | null | readonly string[], excludedModules: readonly string[] = []): Record<string, any> {
  return loadEmittedAthree(generateAthreeMap(include, choiceOrExclusions, excludedModules).files) as Record<string, any>;
}
