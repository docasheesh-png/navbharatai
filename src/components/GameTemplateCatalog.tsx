import { useMemo, useState } from 'react';
import { Car, ChevronRight, CircleDot, Crown, Gamepad2, LayoutGrid, Search, Shield, Sparkles } from 'lucide-react';

type GameTemplate = { name: string; category: string; description: string; mechanics: string };

const racingTracks = [
  ['Grand Prix Circuit', 'technical corners, pit lane, lap timing'], ['Street Circuit', 'tight city blocks, barriers, hairpins'],
  ['Desert Rally', 'dunes, loose gravel, changing grip'], ['Mountain Pass', 'elevation changes, switchbacks, cliffs'],
  ['Coastal Highway', 'long sweepers, seaside scenery, traffic'], ['Forest Run', 'narrow roads, chicanes, low visibility'],
  ['Snow & Ice', 'low traction, snowbanks, frozen sections'], ['Volcano Ring', 'lava hazards, heat zones, dramatic elevation'],
  ['Airport Sprint', 'runway straights, service roads, broad turns'], ['Neon Night City', 'night lighting, wet roads, neon markers'],
  ['Oval Speedway', 'banked turns, drafting, high-speed laps'], ['Figure-Eight', 'crossing point, collision timing, compact layout'],
  ['Kart Park', 'boost pads, item zones, playful shortcuts'], ['Canyon Run', 'cliffside bends, narrow bridges, elevation'],
  ['Jungle Rally', 'mud, roots, water crossings, dense scenery'], ['Riverside GP', 'river bends, bridges, mixed corner speeds'],
  ['Industrial Zone', 'container chicanes, service tunnels, tight turns'], ['Countryside', 'rolling hills, farm roads, mixed surfaces'],
  ['Beach Sprint', 'sand sections, boardwalk, tide-side shortcuts'], ['Space Station', 'low-gravity sections, boost gates, looped track'],
  ['Autumn Park', 'leaf-covered corners, scenic loops, variable grip'], ['Urban Rooftop', 'elevated lanes, ramps, precision jumps'],
  ['Temple Trail', 'stone paths, ancient gates, obstacle timing'], ['Endurance 24H', 'day-night cycle, pit strategy, durability'],
];

const games: GameTemplate[] = [
  ...racingTracks.map(([name, mechanics]) => ({ name, category: 'Racing', description: 'Top-down arcade racer track architecture', mechanics })),
  { name: 'Carrom Board', category: 'Board & Classics', description: 'Physics-based tabletop striker game', mechanics: 'flick aiming, legal shots, pocket detection, turn rules, queen cover, foul handling and local multiplayer' },
  { name: 'Ludo', category: 'Board & Classics', description: 'Four-player turn-based board game', mechanics: 'dice rolls, token selection, safe squares, capture, home stretch, exact finish and optional bot opponents' },
  { name: 'Snake', category: 'Board & Classics', description: 'Grid-based arcade survival game', mechanics: 'fixed-step movement, food spawning, growth, wall/self collision, increasing speed and saved high scores' },
  { name: 'Chess', category: 'Board & Classics', description: 'Accessible chessboard and rules architecture', mechanics: 'legal moves, check/checkmate, castling, en passant, promotion, undo, clocks and optional engine adapter' },
  { name: 'Tic-Tac-Toe', category: 'Board & Classics', description: 'Local and bot-ready strategy game', mechanics: 'turn validation, win detection, draw state, rematch and adjustable bot difficulty' },
  { name: 'Sudoku', category: 'Board & Classics', description: 'Puzzle generation and solving interface', mechanics: 'validated boards, notes, hints, difficulty levels, timer and mistake tracking' },
  { name: 'Breakout', category: 'Arcade', description: 'Paddle-and-brick arcade game', mechanics: 'ball physics, brick patterns, power-ups, lives, levels and keyboard/touch controls' },
  { name: 'Space Shooter', category: 'Arcade', description: 'Wave-based vertical shooter', mechanics: 'player movement, enemy waves, projectiles, collision system, pickups and boss phases' },
  { name: 'Platformer', category: 'Arcade', description: 'Reusable 2D platform adventure', mechanics: 'acceleration, jumping, coyote time, collision layers, checkpoints, collectibles and camera follow' },
  { name: 'Tower Defense', category: 'Strategy', description: 'Path-based defense strategy', mechanics: 'enemy waves, tower targeting, upgrades, currency, pathfinding and pause/speed controls' },
  { name: 'Memory Match', category: 'Casual', description: 'Card matching game with progression', mechanics: 'shuffled pairs, flip state, move counter, timer, difficulty and accessible keyboard focus' },
  { name: 'Mahjong Solitaire', category: 'Casual', description: 'Tile-matching puzzle architecture', mechanics: 'tile layout, free-tile rules, matching, shuffle, undo, hints and solvability checks' },
  { name: 'Bubble Shooter', category: 'Arcade', description: 'Aim-and-match casual game', mechanics: 'projectile aiming, grid attachment, color clusters, chain clearing and level objectives' },
];

export function matchGameTemplate(request: string): GameTemplate | undefined {
  const text = request.trim().toLowerCase();
  if (!text) return undefined;
  const aliases: Record<string, string[]> = {
    'Grand Prix Circuit': ['grand prix', 'formula', 'car game', 'gaadi', 'gadi', 'track'],
    'Snow & Ice': ['snow', 'ice', 'icy', 'baraf', 'frozen'], 'Desert Rally': ['desert', 'dune', 'sand', 'registan'],
    'Mountain Pass': ['mountain', 'hill', 'pahad'], 'Street Circuit': ['street', 'city', 'urban road'],
    'Coastal Highway': ['coastal', 'coast', 'sea', 'samundar'], 'Forest Run': ['forest', 'jungle road'],
    'Volcano Ring': ['volcano', 'lava'], 'Airport Sprint': ['airport', 'runway'], 'Neon Night City': ['neon', 'night race'],
    'Oval Speedway': ['oval', 'speedway'], 'Figure-Eight': ['figure eight', '8 shape'], 'Kart Park': ['kart'],
    'Canyon Run': ['canyon'], 'Jungle Rally': ['jungle'], 'Riverside GP': ['river', 'riverside'],
    'Industrial Zone': ['industrial', 'factory'], 'Countryside': ['countryside', 'village'], 'Beach Sprint': ['beach'],
    'Space Station': ['space station'], 'Autumn Park': ['autumn'], 'Urban Rooftop': ['rooftop'],
    'Temple Trail': ['temple'], 'Endurance 24H': ['endurance', '24 hour'],
    'Carrom Board': ['carrom', 'caram'], 'Ludo': ['ludo'], 'Snake': ['snake', 'saap'], 'Chess': ['chess', 'shatranj'],
    'Tic-Tac-Toe': ['tic tac toe', 'noughts'], 'Sudoku': ['sudoku'], 'Breakout': ['breakout', 'brick breaker'],
    'Space Shooter': ['space shooter', 'spaceship', 'shooter'], 'Platformer': ['platformer', 'platform game'],
    'Tower Defense': ['tower defense', 'tower defence'], 'Memory Match': ['memory match', 'matching cards'],
    'Mahjong Solitaire': ['mahjong'], 'Bubble Shooter': ['bubble shooter'],
  };
  const candidates = games.map(game => {
    const words = game.name.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2);
    let score = words.reduce((total, word) => total + (text.includes(word) ? 3 : 0), 0);
    if (aliases[game.name]?.some(alias => text.includes(alias))) score += 5;
    if (game.category === 'Racing' && /race|racing|racer|car game|gaadi|gadi/.test(text)) score += 2;
    return { game, score };
  }).sort((left, right) => right.score - left.score);
  return candidates[0]?.score ? candidates[0].game : undefined;
}

const sources = [
  { name: 'Phaser game framework', href: 'https://github.com/phaserjs/phaser', license: 'MIT' },
  { name: 'Phaser examples', href: 'https://github.com/phaserjs/examples', license: 'MIT (review individual assets)' },
  { name: 'Three.js racing starter', href: 'https://github.com/mrdoob/Starter-Kit-Racing', license: 'MIT' },
];

export function GameTemplateCatalog({ onUse }: { onUse: (prompt: string, gameName?: string) => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [gameRequest, setGameRequest] = useState('');
  const categories = ['All', ...Array.from(new Set(games.map(game => game.category)))];
  const filtered = useMemo(() => games.filter(game =>
    (category === 'All' || game.category === category) &&
    `${game.name} ${game.description} ${game.mechanics}`.toLowerCase().includes(query.toLowerCase())
  ), [query, category]);

  const makePrompt = (game: GameTemplate) => `Build a complete, playable ${game.name} game for navBharat. Category: ${game.category}. Core mechanics: ${game.mechanics}. Use the existing AgentV3 game starter kit and current project framework; do not add an unrelated engine or replace the scaffold. Keep game rules/state separate from rendering, provide responsive desktop/mobile controls, pause/restart, accessible UI, and persistent best score/settings where appropriate. Include working code without placeholders. Start with a polished playable scope and leave clean extension points for levels, multiplayer adapters, telemetry, and localization. Use original/basic shapes or clearly licensed assets only; do not copy proprietary game art.${game.category === 'Racing' ? '\n\nRACING TRACK LIFECYCLE — ROOT-CAUSE REQUIREMENTS:\n- Use a continuous closed loop or recycled segment ring with monotonic world distance; never run out of road.\n- Bound and validate every road/height lookup; keep the vehicle attached to the active road surface each fixed simulation step, with no extrapolation beyond available segments.\n- Validate final-to-first seam continuity for position, heading, elevation, width, and curvature before driving.\n- Keep world progress separate from camera projection; reject NaN/Infinity and pause with a useful diagnostic if track data is invalid.\n- Add deterministic coverage beyond the previous failure distance, across many laps, including seam continuity, finite coordinates, and grounded-car invariants.' : ''}`;

  const matchedGame = useMemo(() => matchGameTemplate(gameRequest), [gameRequest]);

  const autoBuild = () => {
    if (!matchedGame) return;
    const originalRequest = gameRequest.trim();
    onUse(`${makePrompt(matchedGame)}\n\nUSER'S ORIGINAL REQUEST (preserve these details in the finished game):\n${originalRequest}`, matchedGame.name);
  };

  const iconFor = (game: GameTemplate) => game.category === 'Racing' ? Car : game.name === 'Chess' ? Crown : game.category === 'Board & Classics' ? LayoutGrid : game.category === 'Strategy' ? Shield : CircleDot;

  return <section className="mt-12">
    <div className="flex items-end justify-between gap-4 mb-5 flex-wrap">
      <div><div className="flex items-center gap-2 text-indigo-300 text-xs font-black uppercase tracking-[.2em]"><Sparkles className="w-4 h-4" /> Game Architect</div>
        <h3 className="text-2xl font-black text-white mt-2">Ready-to-build game templates</h3>
        <p className="text-sm text-[#8b949e] mt-1">{games.length} starter architectures. Apni game describe karein; navBharat matching template khud choose karega.</p></div>
      <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#161b22] px-3 py-2"><Search className="w-4 h-4 text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search games or mechanics" className="bg-transparent outline-none text-sm text-white w-52" /></label>
    </div>
    <div className="mb-6 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4 sm:p-5">
      <label htmlFor="game-auto-request" className="mb-2 block text-xs font-bold text-white">Aap kaunsi game banwana chahte hain?</label>
      <div className="flex flex-col gap-3 sm:flex-row"><input id="game-auto-request" value={gameRequest} onChange={event => setGameRequest(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') autoBuild(); }} placeholder="Jaise: baraf wali racing game, ludo, chess..." className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#0d1117] px-4 py-3 text-sm text-white outline-none focus:border-indigo-500" />
        <button onClick={autoBuild} disabled={!matchedGame} className="rounded-xl bg-indigo-600 px-5 py-3 text-xs font-black text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">Build in NavBharatAI Pro</button></div>
      {matchedGame && <p aria-live="polite" className="mt-2 text-xs text-emerald-300">Auto-selected: <strong>{matchedGame.name}</strong> · {matchedGame.description}</p>}
      {!matchedGame && gameRequest.trim() && <p aria-live="polite" className="mt-2 text-xs text-amber-300">Could not confidently match a starter. Add a game type or mechanic (for example, “racing”, “ludo”, “chess”) so the right architecture is selected.</p>}
    </div>
    <div className="flex gap-2 overflow-x-auto pb-4">{categories.map(item => <button key={item} onClick={() => setCategory(item)} className={`rounded-full px-3 py-1.5 text-xs font-bold whitespace-nowrap ${category === item ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-400 hover:text-white'}`}>{item}</button>)}</div>
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {filtered.map(game => { const Icon = iconFor(game); return <article key={game.name} className="rounded-2xl border border-white/10 bg-[#161b22] p-5 hover:border-indigo-500/40 transition-colors">
        <div className="flex justify-between gap-3"><div className="w-10 h-10 rounded-xl bg-indigo-500/10 grid place-items-center text-indigo-300"><Icon className="w-5 h-5" /></div><span className="text-[10px] uppercase tracking-wider text-slate-500">{game.category}</span></div>
        <h4 className="font-bold text-white mt-4">{game.name}</h4><p className="text-xs text-slate-400 mt-1">{game.description}</p><p className="text-xs leading-relaxed text-slate-500 mt-3 min-h-10">{game.mechanics}</p>
        <div className="mt-4 flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Auto-matched from your request <ChevronRight className="h-4 w-4" /></div>
      </article>; })}
    </div>
    {filtered.length === 0 && <p className="py-10 text-center text-sm text-slate-500">No templates match that search.</p>}
    <div className="mt-8 rounded-2xl border border-white/10 bg-black/20 p-5"><div className="flex items-center gap-2 text-sm font-bold text-white"><Gamepad2 className="w-4 h-4 text-emerald-400" /> Free source references</div><p className="text-xs text-slate-500 mt-1 mb-3">Frameworks and examples only; each source’s code/assets retain their own terms.</p><div className="flex flex-wrap gap-3">{sources.map(source => <a key={source.name} href={source.href} target="_blank" rel="noreferrer" className="text-xs text-indigo-300 hover:text-white underline underline-offset-2">{source.name} · {source.license}</a>)}</div></div>
  </section>;
}
