// Road Tale — the library branching story in English and Hindi: scenes as plain data, items that open choices,
// five endings to collect, letter-by-letter text, a step back, and a story checker.
// Our own code; every part is a named block so it can be changed by chat. Studied for ideas only, no code taken.
export const roadTaleAppTsx = `// __TITLE__ — a short branching story in English and Hindi: you set out from the village for the town fair, and every
// choice changes the road. Some choices need something you picked up earlier, and there are several endings to find.
// Our own code. Every part is a named block below, so any of it can be changed by asking: the OPTIONS, the STORY (each
// scene with its text in both languages and its choices), the ENDINGS, the LOOKS, the COPY. Ideas studied (no code taken):
// a story written as plain data (scenes that point at other scenes), choices that need or give an item, a check that every
// scene can be reached and every path ends, text that appears letter by letter, a step back, and an endings collection.
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'road-tale-best-v1';

// ── OPTIONS ────────────────────────────────────────────────────────────────
export const OPTIONS = { start: 'gate', lettersPerTick: 2, tickMs: 18 };

const COPY = {
  en: { play: 'Begin the story', again: 'Play again', over: 'खेल खत्म — The end', back: 'Step back', found: 'Endings found', skip: 'Show all',
    bag: 'Bag', empty: 'empty', lang: 'हिंदी' },
  hi: { play: 'कहानी शुरू करो', again: 'फिर खेलो', over: 'खेल खत्म', back: 'एक कदम पीछे', found: 'मिले अंत', skip: 'पूरा दिखाओ',
    bag: 'थैला', empty: 'खाली', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── STORY — each scene: text in both languages, and choices that lead to other scenes ─────────────────────────────
// A choice can 'need' an item (it only shows when you have it) and 'give' an item. A scene with 'ending' finishes the story.
export interface Choice { en: string; hi: string; to: string; needs?: string; gives?: string }
export interface Scene { en: string; hi: string; icon: string; choices: Choice[]; ending?: { en: string; hi: string; stars: number } }
export const ITEMS: Record<string, { en: string; hi: string; icon: string }> = {
  lantern: { en: 'lantern', hi: 'लालटेन', icon: '🏮' },
  mango: { en: 'mango', hi: 'आम', icon: '🥭' },
  map: { en: 'old map', hi: 'पुराना नक्शा', icon: '🗺️' },
  flute: { en: 'flute', hi: 'बाँसुरी', icon: '🪈' },
};
export const STORY: Record<string, Scene> = {
  gate: { icon: '🏡', en: 'Dawn at the village gate. The fair in town starts at sunset. Grandmother holds out a lantern and a mango.',
    hi: 'गाँव के दरवाज़े पर सुबह। शहर का मेला शाम को शुरू होगा। दादी एक लालटेन और एक आम देती हैं।',
    choices: [{ en: 'Take the lantern', hi: 'लालटेन ले लो', to: 'crossroads', gives: 'lantern' }, { en: 'Take the mango', hi: 'आम ले लो', to: 'crossroads', gives: 'mango' }] },
  crossroads: { icon: '🛤️', en: 'A crossroads. The river path is pretty but long; the hill path is short but steep.',
    hi: 'एक चौराहा। नदी वाला रास्ता सुंदर पर लंबा है; पहाड़ी वाला छोटा पर खड़ा।',
    choices: [{ en: 'River path', hi: 'नदी का रास्ता', to: 'river' }, { en: 'Hill path', hi: 'पहाड़ी का रास्ता', to: 'hill' }] },
  river: { icon: '🏞️', en: 'By the river a boy is crying — his goat is stuck on a rock in the water.',
    hi: 'नदी किनारे एक लड़का रो रहा है — उसकी बकरी पानी में एक चट्टान पर फँसी है।',
    choices: [{ en: 'Wade in and help', hi: 'पानी में उतर कर मदद करो', to: 'goat' }, { en: 'Keep walking', hi: 'चलते रहो', to: 'ferry' }] },
  goat: { icon: '🐐', en: 'You carry the goat back. The boy grins and gives you a little bamboo flute.',
    hi: 'तुम बकरी को वापस ले आते हो। लड़का मुस्कुरा कर तुम्हें एक छोटी बाँसुरी देता है।',
    choices: [{ en: 'Thank him and go on', hi: 'धन्यवाद कहो और आगे बढ़ो', to: 'ferry', gives: 'flute' }] },
  ferry: { icon: '⛴️', en: 'The ferryman is hungry and grumpy. "No crossing on an empty stomach," he says.',
    hi: 'नाविक भूखा और चिड़चिड़ा है। "खाली पेट नाव नहीं चलेगी," वह कहता है।',
    choices: [{ en: 'Share your mango', hi: 'अपना आम बाँटो', to: 'townGate', needs: 'mango' },
      { en: 'Play him a tune', hi: 'उसे धुन सुनाओ', to: 'townGate', needs: 'flute' }, { en: 'Walk to the far bridge', hi: 'दूर वाले पुल तक चलो', to: 'late' }] },
  hill: { icon: '⛰️', en: 'Half way up, a cave mouth. Something glints inside. The path goes on to the top.',
    hi: 'आधे रास्ते पर एक गुफ़ा। अंदर कुछ चमक रहा है। रास्ता ऊपर तक जाता है।',
    choices: [{ en: 'Look inside with the lantern', hi: 'लालटेन से अंदर देखो', to: 'cave', needs: 'lantern' }, { en: 'Climb to the top', hi: 'चोटी तक चढ़ो', to: 'top' }] },
  cave: { icon: '🕯️', en: 'A dusty old map on a ledge, with a dotted line marked "short way to the fair".',
    hi: 'एक ताक पर धूल भरा पुराना नक्शा, जिस पर लिखा है "मेले का छोटा रास्ता"।',
    choices: [{ en: 'Take the map', hi: 'नक्शा ले लो', to: 'top', gives: 'map' }] },
  top: { icon: '🌄', en: 'From the top you see the town. Two ways down: the goat track or the long road.',
    hi: 'चोटी से शहर दिखता है। नीचे जाने के दो रास्ते: बकरियों की पगडंडी या लंबी सड़क।',
    choices: [{ en: 'Follow the map', hi: 'नक्शे के पीछे चलो', to: 'secret', needs: 'map' }, { en: 'Goat track', hi: 'पगडंडी', to: 'slip' }, { en: 'Long road', hi: 'लंबी सड़क', to: 'late' }] },
  slip: { icon: '🪨', en: 'You slip and slide the last bit on your bottom. Dusty, but faster!',
    hi: 'तुम फिसल कर आखिरी हिस्सा बैठे-बैठे उतर जाते हो। धूल तो लगी, पर जल्दी पहुँचे!',
    choices: [{ en: 'Dust off and go in', hi: 'धूल झाड़ो और अंदर चलो', to: 'townGate' }] },
  townGate: { icon: '🏮', en: 'The town gate, just as the lamps are lit. The fair is starting!',
    hi: 'शहर का दरवाज़ा, ठीक जब दीये जल रहे हैं। मेला शुरू हो रहा है!',
    choices: [{ en: 'Join the music stage', hi: 'संगीत के मंच पर जाओ', to: 'endStage', needs: 'flute' }, { en: 'Ride the big wheel', hi: 'बड़े झूले पर बैठो', to: 'endFair' }] },
  late: { icon: '🌙', en: 'The long way takes all day. By the time you arrive the stalls are closing.',
    hi: 'लंबा रास्ता पूरा दिन ले लेता है। जब तुम पहुँचते हो, दुकानें बंद हो रही हैं।',
    choices: [{ en: 'Light the lantern and look around', hi: 'लालटेन जलाओ और घूमो', to: 'endLantern', needs: 'lantern' }, { en: 'Head home', hi: 'घर लौटो', to: 'endHome' }] },
  secret: { icon: '🗺️', en: 'The dotted line leads through a mango grove straight to the back of the fair — before anyone else.',
    hi: 'नक्शे की लकीर आम के बाग से होकर सीधे मेले के पीछे ले जाती है — सबसे पहले।', choices: [{ en: 'Go in first', hi: 'सबसे पहले अंदर जाओ', to: 'endFirst' }] },
  endStage: { icon: '🎶', en: 'You play the flute on stage and the whole fair claps along.', hi: 'तुम मंच पर बाँसुरी बजाते हो और पूरा मेला ताली बजाता है।', choices: [],
    ending: { en: 'Star of the fair', hi: 'मेले का सितारा', stars: 3 } },
  endFair: { icon: '🎡', en: 'You ride the big wheel and see the whole town glowing.', hi: 'तुम बड़े झूले पर बैठ कर पूरे शहर को जगमगाता देखते हो।', choices: [],
    ending: { en: 'A good day out', hi: 'एक अच्छा दिन', stars: 2 } },
  endFirst: { icon: '🥇', en: 'First through the gate — you get the best spot for the fireworks.', hi: 'सबसे पहले पहुँचे — आतिशबाज़ी के लिए सबसे अच्छी जगह मिली।', choices: [],
    ending: { en: 'The secret way', hi: 'गुप्त रास्ता', stars: 3 } },
  endLantern: { icon: '✨', en: 'Your lantern draws a crowd and the stall keepers stay open a little longer.', hi: 'तुम्हारी लालटेन देख कर भीड़ जुटती है और दुकानें थोड़ी देर और खुली रहती हैं।',
    choices: [],
    ending: { en: 'Late but lucky', hi: 'देर से पर किस्मत से', stars: 2 } },
  endHome: { icon: '🏡', en: 'You walk home under the stars. Next year you will leave earlier.', hi: 'तुम तारों के नीचे घर लौटते हो। अगले साल जल्दी निकलोगे।', choices: [],
    ending: { en: 'Next year', hi: 'अगले साल', stars: 1 } },
};

// ── RULES — pure ────────────────────────────────────────────────────────────
export interface Walk { at: string; bag: string[]; path: string[] }
export const begin = (): Walk => ({ at: OPTIONS.start, bag: [], path: [OPTIONS.start] });
export const choicesAt = (w: Walk, story = STORY) => story[w.at].choices.filter((c) => !c.needs || w.bag.includes(c.needs));
export function choose(w: Walk, c: Choice): Walk {
  const bag = c.gives && !w.bag.includes(c.gives) ? [...w.bag, c.gives] : w.bag;
  return { at: c.to, bag, path: [...w.path, c.to] };
}
export const endingIds = (story = STORY) => Object.keys(story).filter((id) => story[id].ending);

/** Every state you can reach by playing (scene plus bag), so we can check the story has no traps. */
export function explore(story = STORY, start = OPTIONS.start): Walk[] {
  const seen = new Set<string>(), out: Walk[] = [], todo: Walk[] = [{ at: start, bag: [], path: [start] }];
  while (todo.length) {
    const w = todo.pop() as Walk, key = w.at + '|' + w.bag.slice().sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key); out.push(w);
    for (const c of choicesAt(w, story)) todo.push(choose(w, c));
  }
  return out;
}

/** Problems with a story: broken links, unknown items, scenes nobody can reach, endings with choices, and dead ends. */
export function validate(story = STORY, start = OPTIONS.start): string[] {
  const problems: string[] = [];
  if (!story[start]) return ['missing start ' + start];
  for (const [id, s] of Object.entries(story)) {
    if (!s.en || !s.hi) problems.push(id + ' needs text in both languages');
    if (s.ending && s.choices.length) problems.push(id + ' is an ending but has choices');
    for (const c of s.choices) {
      if (!story[c.to]) problems.push(id + ' points at missing ' + c.to);
      for (const item of [c.needs, c.gives]) if (item && !ITEMS[item]) problems.push(id + ' uses unknown item ' + item);
      if (!c.en || !c.hi) problems.push(id + ' has a choice without both languages');
    }
  }
  if (problems.length) return problems;
  const states = explore(story, start), reached = new Set(states.map((w) => w.at));
  for (const id of Object.keys(story)) if (!reached.has(id)) problems.push(id + ' can never be reached');
  for (const w of states) if (!story[w.at].ending && !choicesAt(w, story).length) problems.push(w.at + ' is a dead end with bag ' + w.bag.join(','));
  return problems;
}

function chime(freq: number) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'triangle'; osc.frequency.value = freq; gain.gain.value = 0.04; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.15);
  } catch { /* sound can be blocked */ }
}

// ── LOOKS ──────────────────────────────────────────────────────────────────
const LOOKS = { page: '#fef3c7', ink: '#1c1917', star: '#f59e0b' };

// ── THE SCREEN ─────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [walk, setWalk] = useState<Walk | null>(null);
  const [history, setHistory] = useState<Walk[]>([]);
  const [shown, setShown] = useState(0);
  const [found, setFound] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const t = COPY[lang];
  const scene = walk ? STORY[walk.at] : null;
  const text = scene ? scene[lang] : '';

  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem(BEST) || '[]'); if (Array.isArray(v)) setFound(v.filter((x) => typeof x === 'string')); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    setShown(0);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => setShown((n) => {
      if (n >= text.length && timer.current) clearInterval(timer.current);
      return n + OPTIONS.lettersPerTick;
    }), OPTIONS.tickMs);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [text]);

  useEffect(() => {
    if (!walk || !STORY[walk.at].ending || found.includes(walk.at)) return;
    const next = [...found, walk.at]; setFound(next); chime(880);
    try { localStorage.setItem(BEST, JSON.stringify(next)); } catch { /* ignore */ }
  }, [walk, found]);

  function start() { setWalk(begin()); setHistory([]); }
  function pick(c: Choice) { if (!walk) return; setHistory([...history, walk]); setWalk(choose(walk, c)); chime(c.gives ? 660 : 440); }
  function back() { if (!history.length) return; setWalk(history[history.length - 1]); setHistory(history.slice(0, -1)); }
  const done = shown >= text.length;

  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        <span className="badge">{t.found} {found.length}/{endingIds().length}</span>
        <span className="badge">{t.bag}: {walk && walk.bag.length ? walk.bag.map((i) => ITEMS[i].icon).join(' ') : t.empty}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {!walk && <button className="primary" onClick={start}>{t.play}</button>}
      {walk && scene && (
        <div className="card" style={{ padding: 16, background: LOOKS.page, color: LOOKS.ink, borderRadius: 10 }}>
          <div style={{ fontSize: 40 }}>{scene.icon}</div>
          <p style={{ fontSize: 17, lineHeight: 1.5, minHeight: 80 }} onClick={() => setShown(text.length)}>{text.slice(0, shown)}</p>
          {!done && <button className="badge" onClick={() => setShown(text.length)}>{t.skip}</button>}
          {done && !scene.ending && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {choicesAt(walk).map((c) => (
                <button key={c.to + c.en} className="primary" style={{ background: ACCENT, color: '#fff' }} onClick={() => pick(c)}>
                  {c.needs ? ITEMS[c.needs].icon + ' ' : ''}{c[lang]}
                </button>
              ))}
            </div>
          )}
          {done && scene.ending && (
            <div>
              <h2 style={{ fontSize: 18 }}>{scene.ending[lang]}</h2>
              <div style={{ color: LOOKS.star, fontSize: 24 }}>{'★'.repeat(scene.ending.stars)}{'☆'.repeat(3 - scene.ending.stars)}</div>
              <p>{t.over}</p>
              <button className="primary" onClick={start}>{t.again}</button>
            </div>
          )}
          {history.length > 0 && !scene.ending && <button className="badge" style={{ marginTop: 10 }} onClick={back}>{t.back}</button>}
        </div>
      )}
      <div className="row" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
        {endingIds().map((id) => <span key={id} className="badge" title={found.includes(id) ? STORY[id].ending?.[lang] : '?'}>{found.includes(id) ? STORY[id].icon : '❔'}</span>)}
      </div>
    </div>
  );
}
`;
