import { useMemo, useState } from 'react';
import ThemeToggle from './theme';
import c1 from './gita/01.json';
import c2 from './gita/02.json';
import c3 from './gita/03.json';
import c4 from './gita/04.json';
import c5 from './gita/05.json';
import c6 from './gita/06.json';
import c7 from './gita/07.json';
import c8 from './gita/08.json';
import c9 from './gita/09.json';
import c10 from './gita/10.json';
import c11 from './gita/11.json';
import c12 from './gita/12.json';
import c13 from './gita/13.json';
import c14 from './gita/14.json';
import c15 from './gita/15.json';
import c16 from './gita/16.json';
import c17 from './gita/17.json';
import c18 from './gita/18.json';

interface RawVerse { v: number; sp?: string; sa: string; hi: string }
interface Shloka extends RawVerse { ch: number }

const CHAPTERS: Array<{ n: number; hi: string; en: string }> = [
  { n: 1, hi: 'अर्जुन विषाद योग', en: 'Despair of Arjuna' },
  { n: 2, hi: 'सांख्य योग', en: 'The eternal self' },
  { n: 3, hi: 'कर्म योग', en: 'Action' },
  { n: 4, hi: 'ज्ञान कर्म संन्यास योग', en: 'Knowledge and action' },
  { n: 5, hi: 'कर्म संन्यास योग', en: 'Renunciation in action' },
  { n: 6, hi: 'आत्म संयम योग', en: 'Self-discipline' },
  { n: 7, hi: 'ज्ञान विज्ञान योग', en: 'Knowing the divine' },
  { n: 8, hi: 'अक्षर ब्रह्म योग', en: 'The imperishable' },
  { n: 9, hi: 'राजविद्या राजगुह्य योग', en: 'The royal secret' },
  { n: 10, hi: 'विभूति योग', en: 'Divine glories' },
  { n: 11, hi: 'विश्वरूप दर्शन योग', en: 'The universal form' },
  { n: 12, hi: 'भक्ति योग', en: 'Devotion' },
  { n: 13, hi: 'क्षेत्र क्षेत्रज्ञ विभाग योग', en: 'Field and knower' },
  { n: 14, hi: 'गुणत्रय विभाग योग', en: 'The three gunas' },
  { n: 15, hi: 'पुरुषोत्तम योग', en: 'The supreme person' },
  { n: 16, hi: 'दैवासुर सम्पद्विभाग योग', en: 'Divine and demonic' },
  { n: 17, hi: 'श्रद्धात्रय विभाग योग', en: 'Three kinds of faith' },
  { n: 18, hi: 'मोक्ष संन्यास योग', en: 'Freedom' },
];

// The whole Gita, one JSON file per chapter in src/gita/. The Sanskrit is the ancient public-domain text;
// the Hindi below each verse is a plain bhavarth written for this app, not a copy of any published translation.
// Numbering follows Gita Press; 13.0 is Arjuna's question that opens chapter 13 in some editions.
const BY_CHAPTER: RawVerse[][] = [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14, c15, c16, c17, c18] as RawVerse[][];
const SHLOKAS: Shloka[] = BY_CHAPTER.flatMap((verses, i) => verses.map((x) => ({ ...x, ch: i + 1 })));
/** The 700 verses everyone counts — 13.0 is shown, but not counted, so the number matches every other edition. */
const COUNTED = SHLOKAS.filter((s) => s.v > 0);
const SEARCH_LIMIT = 40;

function load(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function save(key: string, v: string[]) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode — bookmarks just will not persist */ }
}

const refOf = (s: Shloka) => s.ch + '.' + s.v;
const refLabel = (s: Shloka) => (s.v === 0 ? 'अध्याय ' + s.ch + ' · आरंभिक प्रश्न' : 'अध्याय ' + s.ch + ' · श्लोक ' + s.v);

/** Verse of the day: the SAME verse for everyone all day, because it is keyed off the date, not random. */
function verseOfTheDay(d: Date): Shloka {
  const dayNumber = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  return COUNTED[((dayNumber % COUNTED.length) + COUNTED.length) % COUNTED.length];
}

function App() {
  const [tab, setTab] = useState<'today' | 'chapters' | 'saved'>('today');
  const [openChapter, setOpenChapter] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const [search, setSearch] = useState('');
  const [saved, setSaved] = useState<string[]>(() => load('geeta-saved-v1'));

  const today = useMemo(() => verseOfTheDay(new Date()), []);
  const inChapter = useMemo(
    () => (openChapter === null ? [] : SHLOKAS.filter((s) => s.ch === openChapter)),
    [openChapter],
  );
  const results = useMemo(() => {
    const raw = search.trim();
    const q = raw.toLowerCase();
    if (!q) return [];
    return SHLOKAS.filter((s) => {
      const ch = CHAPTERS[s.ch - 1];
      return s.hi.toLowerCase().includes(q) || s.sa.includes(raw)
        || ch.hi.toLowerCase().includes(q) || ch.en.toLowerCase().includes(q) || refOf(s) === q;
    });
  }, [search]);

  const toggleSave = (s: Shloka) => {
    const r = refOf(s);
    const next = saved.includes(r) ? saved.filter((x) => x !== r) : saved.concat(r);
    setSaved(next);
    save('geeta-saved-v1', next);
  };

  const openAt = (s: Shloka) => {
    setOpenChapter(s.ch);
    setIndex(Math.max(0, SHLOKAS.filter((x) => x.ch === s.ch).findIndex((x) => x.v === s.v)));
    setTab('chapters');
  };

  const Verse = (props: { s: Shloka; showRef?: boolean }) => (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {refLabel(props.s)}
          {props.showRef ? ' — ' + CHAPTERS[props.s.ch - 1].hi : ''}
        </div>
        <button
          className="btn-ghost"
          aria-label={saved.includes(refOf(props.s)) ? 'हटाएँ' : 'सहेजें'}
          onClick={() => toggleSave(props.s)}
          style={{ padding: '2px 8px' }}
        >
          {saved.includes(refOf(props.s)) ? 'सहेजा ✓' : 'सहेजें'}
        </button>
      </div>
      {props.s.sp ? <div style={{ fontSize: 13, marginTop: 10, color: 'var(--muted)' }}>{props.s.sp}</div> : null}
      <p style={{ fontSize: 20, lineHeight: 1.8, margin: '8px 0 12px', fontWeight: 600, whiteSpace: 'pre-line' }}>{props.s.sa}</p>
      <p style={{ fontSize: 15, lineHeight: 1.75, margin: 0, color: 'var(--muted)' }}>{props.s.hi}</p>
    </div>
  );

  return (
    <div className="container" style={{ maxWidth: 620, paddingTop: 24, paddingBottom: 56 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>श्रीमद् भगवद्गीता</h1>
        <ThemeToggle />
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--muted)' }}>
        Bhagavad Gita — हिन्दी भावार्थ सहित
      </p>

      {/* 🔒 The honesty line, on the first screen and not in a footnote: what the app carries and where the
          Hindi comes from. */}
      <div className="alert" style={{ marginBottom: 16, fontSize: 13 }}>
        इस ऐप में गीता के <strong>सभी {CHAPTERS.length} अध्याय और पूरे {COUNTED.length} श्लोक</strong> हैं
        (अध्याय 13 के आरंभ में अर्जुन का प्रश्न भी, जो कुछ संस्करणों में मिलता है)। संस्कृत मूल पाठ है;
        हर श्लोक का हिन्दी भावार्थ सरल भाषा में इसी ऐप के लिए लिखा गया है।
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 16 }}>
        {([['today', 'आज का श्लोक'], ['chapters', 'अध्याय'], ['saved', 'सहेजे गए']] as Array<[typeof tab, string]>).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={tab === id ? '' : 'btn-ghost'}
            aria-current={tab === id ? 'page' : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'today' && (
        <div>
          <h2 style={{ fontSize: 15, margin: '0 0 10px', color: 'var(--muted)' }}>आज का श्लोक</h2>
          <Verse s={today} showRef />
          <div className="field" style={{ marginTop: 20 }}>
            <label htmlFor="q">खोजें (हिन्दी अर्थ, अध्याय या श्लोक संख्या)</label>
            <input id="q" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="जैसे: कर्म, भक्ति, 2.47" />
          </div>
          {search.trim() !== '' && (
            results.length === 0
              ? <div className="nb-empty">कुछ नहीं मिला। कोई और शब्द आज़माएँ।</div>
              : <div>
                  <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {results.length} श्लोक मिले{results.length > SEARCH_LIMIT ? ' — पहले ' + SEARCH_LIMIT + ' दिखाए गए हैं, खोज को और सटीक करें' : ''}
                  </p>
                  {results.slice(0, SEARCH_LIMIT).map((s) => <Verse key={refOf(s)} s={s} showRef />)}
                </div>
          )}
        </div>
      )}

      {tab === 'chapters' && openChapter === null && (
        <div className="stack">
          {CHAPTERS.map((c) => {
            const count = BY_CHAPTER[c.n - 1].filter((x) => x.v > 0).length;
            return (
              <button
                key={c.n}
                className="btn-ghost"
                onClick={() => { setOpenChapter(c.n); setIndex(0); }}
                style={{ textAlign: 'left', display: 'block', width: '100%', padding: '12px 14px' }}
              >
                <div style={{ fontWeight: 600 }}>{c.n}. {c.hi}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{c.en} · {count} श्लोक</div>
              </button>
            );
          })}
        </div>
      )}

      {tab === 'chapters' && openChapter !== null && (
        <div>
          <button className="btn-ghost" onClick={() => setOpenChapter(null)} style={{ marginBottom: 12 }}>
            ← सभी अध्याय
          </button>
          <h2 style={{ fontSize: 17, margin: '0 0 12px' }}>
            अध्याय {openChapter}: {CHAPTERS[openChapter - 1].hi}
          </h2>
          {inChapter.length === 0 ? (
            <div className="nb-empty">इस अध्याय के श्लोक लोड नहीं हो सके।</div>
          ) : (
            <div>
              <Verse s={inChapter[Math.min(index, inChapter.length - 1)]} />
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <button className="btn-ghost" disabled={index <= 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>← पिछला</button>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {Math.min(index, inChapter.length - 1) + 1} / {inChapter.length}
                </span>
                <button className="btn-ghost" disabled={index >= inChapter.length - 1} onClick={() => setIndex((i) => Math.min(inChapter.length - 1, i + 1))}>अगला →</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'saved' && (
        saved.length === 0
          ? <div className="nb-empty">अभी कोई श्लोक सहेजा नहीं गया। किसी श्लोक पर "सहेजें" दबाएँ।</div>
          : <div>
              {SHLOKAS.filter((s) => saved.includes(refOf(s))).map((s) => (
                <div key={refOf(s)}>
                  <Verse s={s} showRef />
                  <button className="btn-ghost" onClick={() => openAt(s)} style={{ marginBottom: 18 }}>
                    अध्याय में खोलें →
                  </button>
                </div>
              ))}
            </div>
      )}
    </div>
  );
}

export default App;
