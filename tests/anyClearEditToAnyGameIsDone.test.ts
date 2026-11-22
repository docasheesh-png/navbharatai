// ANY CLEAR EDIT TO ANY GAME IS DONE — never refused, never put back (admin 2026-11-22, verbatim: "isko aur flexible aur
// strong karo! user koi bhi game banaye kuch bhi edit/update karwa sake!!").
//
// 🧬 THE CLASS: a protective rule written as a cage. The growth guard (growthGuard.ts) and the game prompt rules protect a
// working game from changes nobody asked for — but several of them protected it from the user too:
//   • a FREE HAND ("jo chahe badlo", "change whatever you want") opened nothing;
//   • a WHOLE-GAME / WHOLE-MAP replacement ("poora game badal do", "poora world badal do") had every old feature, place and the
//     old mount PUT BACK, because a removal needed the name of every part;
//   • a KIT part the user named ("apna camera chahiye", "joystick bada karo", "traffic kam karo") was refused for EVERY request;
//   • the MOUNT (src/App.tsx's <OpenWorldGame>) was put back whatever the request said;
//   • the prompts said "NEVER write your own … camera", "DO NOT rewrite src/App.tsx's world" with no "unless asked".
// Each case below is a real request that was refused or reverted before this change, and the protection that must survive.
import { describe, it, expect } from 'vitest';
import {
  growthVerdict, growthRestores, growthAskNote, growthNotRestoredNote, mayEdit, mayRemove, mayEditKit, mayUnmount, replacesWholeGame, replacesWholeMap,
  repairWorld, FEATURES_INDEX, WORLD_FILE, APP_FILE,
} from '../src/server/AgentV3/growthGuard';
import { enforceGrowthAtTurnEnd } from '../src/server/AgentV3/growthTurn';
import { kitPartVocabulary } from '../src/server/AgentV3/partMeaning';
import { GAME_ASKED_CHANGE_WINS, OPEN_WORLD_HANDOFF, projectGrowthRules, GAME_FEATURES_RULE } from '../src/server/AgentV3/gameKitSeed';
import { GAME_KIT_RULE, VEHICLE_CAMERA_RULE_LINES } from '../src/server/AgentV3/systemPrompt';
import { ToolDispatcher } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { FakeActuator } from './helpers/dispatcherHarness';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { openWorldAppSource } from '../src/server/lib/GameOpenWorldGenerator';

const COINS = "import { defineFeature } from '../play/features';\nexport default defineFeature({ id: 'coins', setup() { return { count: 0 }; } });\n";
const POLICE = "import { defineFeature } from '../play/features';\nexport default defineFeature({ id: 'police', update() { /* chase */ } });\n";
const JOBS = "import { defineFeature } from '../play/features';\nexport default defineFeature({ id: 'deliveryJobs', update() {} });\n";
const INDEX = "import type { GameFeature } from '../play/features';\nimport type { OpenWorld } from '../play/openWorld';\nimport coins from './coins';\nimport police from './police';\n\nexport const FEATURES: GameFeature<OpenWorld>[] = [\n  coins,\n  police,\n];\n";
const WORLD = "import type { OpenWorldOptions } from './play/openWorld';\n\nexport const WORLD: OpenWorldOptions = {\n  seed: 7,\n  regions: [\n    { id: 'main-city', kind: 'city' },\n    { id: 'old-town', kind: 'town', toward: 'east', city: { blocksX: 3 } },\n  ],\n};\n";
const NEW_WORLD = "import type { OpenWorldOptions } from './play/openWorld';\n\nexport const WORLD: OpenWorldOptions = {\n  seed: 9,\n  style: 'desert',\n  regions: [\n    { id: 'dune-land', kind: 'desert' },\n  ],\n};\n";
const APP = openWorldAppSource({ city: true });
const MY_APP = "import { useState } from 'react';\nexport default function App() { const [s] = useState(0); return <canvas data-score={s} />; }\n";
const CAMERA = 'src/game/three/camera.ts';
const TOUCH = 'src/game/ui/touchControls.ts';
const TRAFFIC = 'src/game/three/citytraffic.ts';
const STARTER = 'src/game/OpenWorldGame.tsx';
const kitOf = (p: string): string => recipeFilePool().get(p)!.content;
const PROJECT: Record<string, string> = {
  [FEATURES_INDEX]: INDEX, 'src/game/features/coins.ts': COINS, 'src/game/features/police.ts': POLICE, 'src/game/features/deliveryJobs.ts': JOBS,
  [WORLD_FILE]: WORLD, [APP_FILE]: APP, [CAMERA]: kitOf(CAMERA), [TOUCH]: kitOf(TOUCH), [TRAFFIC]: kitOf(TRAFFIC), [STARTER]: kitOf(STARTER),
};
const edited = (p: string): string => `${kitOf(p)}\n// changed as the user asked\n`;

describe('🔓 a FREE HAND opens edits everywhere — never a removal', () => {
  const FREE = ['jo chahe badlo, game ko mazedaar banao', 'change whatever you want to make it fun', 'apne hisaab se badal do', 'feel free to change anything', 'jaisa aapko sahi lage waisa karo'];
  it.each(FREE)('"%s" opens a feature AND a kit part for editing', (request) => {
    expect(mayEdit(request, 'police')).toBe(true);
    expect(growthVerdict({ path: CAMERA, before: kitOf(CAMERA), after: edited(CAMERA), request }).allow).toBe(true);
  });
  it('a free hand is not a removal: a feature deleted under "jo chahe badlo" goes back', () => {
    expect(mayRemove('jo chahe badlo', 'police')).toBe(false);
    expect(growthVerdict({ path: 'src/game/features/police.ts', before: POLICE, after: null, request: 'jo chahe badlo' })).toMatchObject({ allow: false, restore: POLICE });
  });
});

describe('🔄 the WHOLE game / the WHOLE map replaced — the old parts are not put back', () => {
  const WHOLE_GAME = ['poora game badal do, ab yeh racing game hai', 'sab kuch hata ke naya game banao', 'redo the whole game from scratch', 'purana game hata do aur ek zombie game banao', 'replace the whole game with a cricket game'];
  it.each(WHOLE_GAME)('"%s": features may go, the list may shrink, the map may be replaced, the mount may change', (request) => {
    expect(replacesWholeGame(request)).toBe(true);
    expect(growthVerdict({ path: 'src/game/features/police.ts', before: POLICE, after: null, request }).allow).toBe(true);
    const shrunk = INDEX.replace("import police from './police';\n", '').replace('  police,\n', '');
    expect(growthVerdict({ path: FEATURES_INDEX, before: INDEX, after: shrunk, request }).allow).toBe(true);
    expect(repairWorld(WORLD, NEW_WORLD, request)).toBeNull();
    expect(growthVerdict({ path: APP_FILE, before: APP, after: MY_APP, request }).allow).toBe(true);
  });
  it('"poora world badal do, ek desert world banao" replaces the map — and only the map', () => {
    const request = 'poora world badal do, ek desert world banao';
    expect(replacesWholeMap(request)).toBe(true);
    expect(replacesWholeGame(request)).toBe(false);
    expect(repairWorld(WORLD, NEW_WORLD, request)).toBeNull();
    expect(growthVerdict({ path: 'src/game/features/police.ts', before: POLICE, after: null, request }).allow).toBe(false);
  });
  it('🔒 a "whole" that is about a quantity or a possession replaces nothing', () => {
    for (const request of ['sab cars ko lal karo', 'poore game ka colour change karo', 'poore game me speed badlo', 'ek naya shehar jodo', 'naya map add karo north me', 'poora game theek karo', 'make the whole game faster']) {
      expect(replacesWholeGame(request)).toBe(false);
      expect(replacesWholeMap(request)).toBe(false);
    }
    expect(repairWorld(WORLD, NEW_WORLD, 'ek naya shehar jodo')).not.toBeNull();   // the old places come back
  });
});

describe('🔓 a KIT part the user names — by its name or by what it does — is theirs to change', () => {
  const ASKED: Array<[string, string]> = [
    ['apna camera chahiye, first person camera banao', CAMERA],
    ['camera thoda upar karo', STARTER],
    ['joystick ko bada karo', TOUCH],
    ['touch buttons right side me karo', TOUCH],
    ['shehar ka traffic kam karo', TRAFFIC],
  ];
  it.each(ASKED)('"%s" opens %s', (request, path) => {
    expect(mayEditKit(request, path)).toBe(true);
    expect(growthVerdict({ path, before: kitOf(path), after: edited(path), request }).allow).toBe(true);
  });
  it('🔒 a request that does not touch the kit still never changes it — not even a repair or a "sab"', () => {
    for (const request of ['baarish bhi daalo', 'game crash ho raha hai, fix karo', 'sab kuch thoda fast karo', 'police ko tez karo']) {
      expect(growthVerdict({ path: CAMERA, before: kitOf(CAMERA), after: edited(CAMERA), request })).toMatchObject({ allow: false, restore: kitOf(CAMERA) });
    }
  });
  it('a kit file is known by what it does, not only its name', () => {
    expect(kitPartVocabulary(TOUCH).join(' ')).toMatch(/joystick/);
    expect(kitPartVocabulary(STARTER).join(' ')).toMatch(/camera/);
    expect(kitPartVocabulary('src/game/athree/index.ts')).toEqual([]);   // "index" names nothing
  });
});

describe('🔓 the MOUNT changes when the user asks for the open world to go', () => {
  it('"OpenWorldGame hata do, mera apna 2D game App.tsx me likho" and "mera khud ka world banao" are allowed', () => {
    for (const request of ['OpenWorldGame hata do, mera apna 2D game App.tsx me likho', 'mera khud ka world banao', 'remove the open world, I want a simple arena']) {
      expect(mayUnmount(request)).toBe(true);
      expect(growthVerdict({ path: APP_FILE, before: APP, after: MY_APP, request }).allow).toBe(true);
    }
  });
  it('🔒 a request that only mentions the map or "apna" never unmounts it; deleting App.tsx is never allowed', () => {
    for (const request of ['apna ghar map me daalo', 'map me se police hatao', 'App.tsx ka layout badlo', 'baarish bhi daalo']) {
      expect(mayUnmount(request)).toBe(false);
      expect(growthVerdict({ path: APP_FILE, before: APP, after: MY_APP, request }).allow).toBe(false);
    }
    expect(growthVerdict({ path: APP_FILE, before: APP, after: null, request: 'poora game badal do' }).allow).toBe(false);
  });
});

describe('🔓 a part named by what it does (partMeaning)', () => {
  it('"missions wala part hatao" removes the deliveryJobs feature (a job is a mission)', () => {
    expect(mayRemove('missions wala part hatao', 'deliveryJobs')).toBe(true);
    expect(mayRemove('missions wala part hatao', 'police')).toBe(false);
  });
});

describe('🔓 lock 1 at the real write: the builder\'s tools let the asked change through', () => {
  const dispatcher = (request: string) => {
    const act = new FakeActuator();
    for (const [p, c] of Object.entries(PROJECT)) act.files.set(p, c);
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(act, `ws-any-edit-${Math.random()}`, new WorkspaceState(stream), stream);
    d.setGrowthBaseline(PROJECT, request);
    return { d, act };
  };
  it('"apna camera chahiye" — write_file over the kit camera goes through; "baarish daalo" — refused, with the words that open it', async () => {
    const asked = dispatcher('apna camera chahiye, first person camera banao');
    const ok = await asked.d.dispatch({ id: '1', name: 'write_file', input: { path: CAMERA, content: edited(CAMERA), overwrite: true } }, 'architect');
    expect(String(ok.content)).not.toMatch(/growth guard/);
    expect(asked.act.files.get(CAMERA)).toBe(edited(CAMERA));
    const other = dispatcher('baarish bhi daalo');
    const no = await other.d.dispatch({ id: '2', name: 'write_file', input: { path: CAMERA, content: edited(CAMERA), overwrite: true } }, 'architect');
    expect(String(no.content)).toMatch(/REFUSED \(growth guard\)/);
    expect(String(no.content)).toMatch(/opens the moment the user's own words ask for it/);
    expect(other.act.files.get(CAMERA)).toBe(kitOf(CAMERA));
  });
});

describe('🔓 lock 2 at the end of the turn: the asked change stays; the user is always told the truth', () => {
  it('"poora game badal do": the new game is kept — nothing is put back', () => {
    const now: Record<string, string | null> = { ...PROJECT, 'src/game/features/police.ts': null, 'src/game/features/coins.ts': null, [FEATURES_INDEX]: "export const FEATURES = [\n];\n", [WORLD_FILE]: NEW_WORLD, [APP_FILE]: MY_APP };
    expect(growthRestores({ filesAtTurnStart: PROJECT, now, request: 'poora game badal do, ab yeh racing game hai' })).toEqual([]);
  });
  it('a put-back that FAILED is told to the user, not only to the report', async () => {
    const said: string[] = [];
    await enforceGrowthAtTurnEnd({
      filesAtTurnStart: PROJECT, request: 'baarish bhi daalo',
      read: async (p) => (p === CAMERA ? edited(CAMERA) : PROJECT[p]),
      write: async () => { throw new Error('sandbox gone'); },
      platformWrote: new Map(), refused: [], record: () => {}, say: (t) => said.push(t),
    });
    expect(said.join('\n')).toMatch(/could not put it back, so it is still changed/);
    expect(growthNotRestoredNote([])).toBe('');
  });
  it('the ask-note names the engine part and the words that open it — never "the engine is never edited"', () => {
    const note = growthAskNote([CAMERA]);
    expect(note).toMatch(/"camera badlo"/);
    expect(note).not.toMatch(/never edited/);
  });
});

describe('🔓 the prompt rules say the same: every "never" guards what was NOT asked', () => {
  it('the open-world handoff, the features rule and every project rule set carry the asked-change line', () => {
    expect(GAME_FEATURES_RULE).toContain(GAME_ASKED_CHANGE_WINS);
    expect(OPEN_WORLD_HANDOFF).toContain(GAME_ASKED_CHANGE_WINS);
    expect(OPEN_WORLD_HANDOFF).not.toMatch(/DO NOT rewrite src\/App\.tsx's world/);
    expect(OPEN_WORLD_HANDOFF).toMatch(/Unless the user asks for it/);
    // 🧬 the class, as a census: ANY combination of project rules that says "never" also says the user's request wins.
    const shapes: Array<Record<string, string>> = [
      { [FEATURES_INDEX]: INDEX }, { [WORLD_FILE]: WORLD }, { 'src/game/player.ts': 'x' }, { 'src/App.tsx': '<RacingRoadGame />' },
      { [WORLD_FILE]: WORLD, 'src/game/player.ts': 'x' }, PROJECT,
    ];
    for (const files of shapes) {
      const rules = projectGrowthRules(files);
      if (/\bnever\b|\bdo not\b/i.test(rules)) expect(rules).toContain(GAME_ASKED_CHANGE_WINS);
    }
  });
  it('the system prompt\'s kit rule and camera rule are defaults, not refusals of an asked-for camera', () => {
    expect(GAME_KIT_RULE).toMatch(/user clearly asks for is DONE/);
    expect(VEHICLE_CAMERA_RULE_LINES.join(' ')).toMatch(/never to refuse an asked-for view/);
    expect(GAME_ASKED_CHANGE_WINS).toMatch(/camera: 'first-person'/);
  });
});
