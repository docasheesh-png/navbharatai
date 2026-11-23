# Map expansion — staged rollout and kill switches (plan item 13)

Every map-expansion change ships so that it can be turned off without a deploy of new code, and the risky ones ship **off**.
This page lists, per item, what turns it off, what it defaults to, and what to check before the next step.
A test (`tests/theMapRolloutPageMatchesTheCode.test.ts`) keeps this page honest: every switch named here exists in the code
with the default written here.

## The order for anything risky
1. **Off by default** in the kit or the server.
2. **Admin canary:** turn it on for an admin game only (a kit option in that game's own files, or the env switch on a
   staging service), run a Console Run, then a phone check on a budget Android phone.
3. **Weak tier:** a phone-tier game with many places (the "1,000 villages" list) — memory flat after a long walk, no hitch
   when a city is built, no place in the sea.
4. **All:** flip the default in a small PR of its own, with the kill switch kept.

A step that shows a glitch the owner would see stops the rollout; the switch goes back to off first, the fix comes after.

## Switches, per item

| Item | What | Switch | Default | Where |
|---|---|---|---|---|
| 2 | Late ground edits redraw terrain and plants | world option `lateEdits: true` | **off** | `GameOpenWorldGenerator.ts` (`options.lateEdits === true`), `AthreeMapGenerator.ts` |
| 4 | Only the nearest cities stand built (phone 2, mid 5, desktop 8) | world option `liveCities: false` (all stay built) or a number | on, by device tier | `GameOpenWorldGenerator.ts` (`LIVE_CITIES`) |
| 4 | Up to 1,000 places | `MAX_REGIONS` in the game's own `play/openWorld.ts`; an older copy reads 100 | 1,000 | `GameOpenWorldGenerator.ts`, `worldGrow.ts` (`placesTheMapHolds`) |
| 8 | A race moves onto the world's city roads: the builder asks once; the platform makes the switch (`TRACK.world = true`) only on the user's "race shehar me karo" | env `AGENTV3_RACING_WORLD=on` | **off** | `raceWorld.ts`, `mapGrowthIntent.ts`, `RacingRoadGame` (`GameShellGenerator.ts`) |
| 10 | Map requests read by meaning, a note to the builder (#4488) | env `AGENTV3_MAP_GROWTH_NOTE=off` | on | `mapGrowthIntent.ts`, `growthTurn.ts` |
| 12 | The playtest's geometry look (and memory over a round, #4495) | env `AGENTV3_GAME_GEOMETRY_PROBE=off` | on | `gameGeometryProbe.ts`, `gamePlaytest.ts` |
| — | The growth guard (nothing the user did not ask for is changed) | env `AGENTV3_GROWTH_GUARD=off` | on | `growthGuard.ts` |

## Items without a switch, and why
- **3 (lands joined edge to edge)** and **6 (venue regions, #4483):** they act only on entries that ask for them
  (`joinTo`, `kind: 'venue'`); a map without them lays out byte-identically (checked by layout dumps in each PR). Turning
  one off for a game = removing that entry from its `src/game/world.ts`.
- **5 (world layer):** a refactor with identical output; the old bridge path stays for edited projects.

## Deferred items and their planned switches
- **7 (sports on the world):** env `AGENTV3_SPORTS_WORLD`, default off; and only when the user asks (owner decision).
- **8 (racing on joined places):** `TRACK.world` in the game's `src/game/track.ts`, set only after the user says yes once — by the platform (`raceWorld.ts`), behind `AGENTV3_RACING_WORLD` (off; table above). Turning it off for one game = `world: false` in its `src/game/track.ts`.
- **9 (battle royale):** no growth — the island stays 8 km (owner decision); places that do not fit are reported.
- **11 (migration):** a kit file is refreshed only while it is unedited (`GAME_KIT_HISTORY`); never a silent rewrite.

## Before lateEdits may be turned on (follow-ups from #4466)
- Rivers and road meshes are redrawn over an edited area (today only terrain chunks and plants are).
- The stored physics heightfield is refreshed over an edited area.
Until both land, `lateEdits` stays off everywhere.
