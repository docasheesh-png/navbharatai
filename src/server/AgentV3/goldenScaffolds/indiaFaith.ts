// AgentV3 — Golden Scaffold apps (India-first, faith): Bhagavad Gita reader (Hindi), Quran reader (Hindi).
//
// Admin-requested 2026-09-12 ("bhagwat geeta in hindi, quran in hindi … aap isko real professional
// banana"). Same contract as the other scaffold modules: a complete hand-verified App.tsx, CI-proven to
// parse under esbuild and compile under the in-browser Babel preview, no backticks, no backslash escapes.
//
// 🔒 THE HONESTY DECISION THAT SHAPES BOTH APPS, and the reason they are built this way rather than the
// obvious way. A scripture reader's tempting shape is a complete-looking book: eighteen chapters, a
// hundred and fourteen surahs, every one tappable. Bundling the full text is a real size and licensing
// question (a modern Hindi translation is somebody's copyrighted work), so the full book is not on offer
// here — and a reader that LOOKS complete while carrying a handful of verses is exactly the
// "built but not really working" state the second absolute rule forbids. It is also the version a
// believing user would be most hurt by.
//
// So both apps COUNT what they hold and say it on the first screen, every chapter that is genuinely not
// in the selection shows a real empty state rather than being hidden, and the Hindi meanings are plain
// original paraphrase rather than a copied translation. The verse and ayah texts themselves are the
// ancient public-domain originals.
//
// ✅ THE GITA NOW CARRIES THE WHOLE BOOK (admin 2026-09-30: "haan, poori Gita ke 700 shloka daal do"). The
// licensing question above was about a modern Hindi TRANSLATION; it is answered by writing our own bhavarth
// for every verse (gitaText.ts says where each half comes from). The size question is answered by keeping
// the text out of App.tsx: eighteen JSON files, one per chapter. The honesty line still counts what it holds —
// it now says 700. The Quran reader is unchanged and still a counted selection.

export const geetaAppTsx = `import { useMemo, useState } from 'react';
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
`;

export const quranAppTsx = `import { useMemo, useState } from 'react';
import ThemeToggle from './theme';

interface Ayah { s: number; a: number; ar: string; tr: string; hi: string }

// The surahs this app carries. Arabic is the original text; the Hindi transliteration and the Hindi
// meaning are written in plain language for this app so that a reader who cannot read Arabic can still
// recite and understand.
const SURAHS: Array<{ n: number; ar: string; hi: string; en: string; ayat: number }> = [
  { n: 1, ar: 'الفاتحة', hi: 'अल-फ़ातिहा', en: 'The Opening', ayat: 7 },
  { n: 103, ar: 'العصر', hi: 'अल-अस्र', en: 'The Declining Day', ayat: 3 },
  { n: 108, ar: 'الكوثر', hi: 'अल-कौसर', en: 'The Abundance', ayat: 3 },
  { n: 112, ar: 'الإخلاص', hi: 'अल-इख़्लास', en: 'The Sincerity', ayat: 4 },
  { n: 113, ar: 'الفلق', hi: 'अल-फ़लक़', en: 'The Daybreak', ayat: 5 },
  { n: 114, ar: 'الناس', hi: 'अन-नास', en: 'Mankind', ayat: 6 },
];

const AYAT: Ayah[] = [
  { s: 1, a: 1, ar: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ', tr: 'बिस्मिल्लाहिर् रहमानिर् रहीम', hi: 'अल्लाह के नाम से, जो बेहद मेहरबान और रहम करने वाला है।' },
  { s: 1, a: 2, ar: 'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ', tr: 'अल-हम्दु लिल्लाहि रब्बिल् आलमीन', hi: 'सारी तारीफ़ अल्लाह के लिए है, जो सारे जहान का पालनहार है।' },
  { s: 1, a: 3, ar: 'الرَّحْمَٰنِ الرَّحِيمِ', tr: 'अर्-रहमानिर् रहीम', hi: 'जो बेहद मेहरबान और रहम करने वाला है।' },
  { s: 1, a: 4, ar: 'مَالِكِ يَوْمِ الدِّينِ', tr: 'मालिकि यौमिद् दीन', hi: 'जो इंसाफ़ के दिन का मालिक है।' },
  { s: 1, a: 5, ar: 'إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ', tr: 'इय्याका नअ-बुदु व इय्याका नस्तईन', hi: 'हम तेरी ही इबादत करते हैं और तुझसे ही मदद मांगते हैं।' },
  { s: 1, a: 6, ar: 'اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ', tr: 'इहदिनस् सिरातल् मुस्तक़ीम', hi: 'हमें सीधा रास्ता दिखा।' },
  { s: 1, a: 7, ar: 'صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ', tr: 'सिरातल् लज़ीना अनअम्ता अलैहिम, ग़ैरिल् मग़-दूबि अलैहिम व लज़्-ज़ाल्लीन', hi: 'उन लोगों का रास्ता जिन पर तूने इनाम किया, न उनका जिन पर ग़ुस्सा हुआ और न भटके हुए लोगों का।' },

  { s: 103, a: 1, ar: 'وَالْعَصْرِ', tr: 'वल्-अस्र', hi: 'गुज़रते वक़्त की क़सम।' },
  { s: 103, a: 2, ar: 'إِنَّ الْإِنسَانَ لَفِي خُسْرٍ', tr: 'इन्नल् इन्साना लफ़ी ख़ुस्र', hi: 'बेशक इंसान घाटे में है।' },
  { s: 103, a: 3, ar: 'إِلَّا الَّذِينَ آمَنُوا وَعَمِلُوا الصَّالِحَاتِ وَتَوَاصَوْا بِالْحَقِّ وَتَوَاصَوْا بِالصَّبْرِ', tr: 'इल्लल् लज़ीना आमनू व अमिलुस् सालिहाति, व तवासौ बिल्-हक़्क़ि, व तवासौ बिस्-सब्र', hi: 'सिवाय उनके जो ईमान लाए, अच्छे काम किए, एक दूसरे को सच्चाई की नसीहत दी और सब्र की नसीहत दी।' },

  { s: 108, a: 1, ar: 'إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ', tr: 'इन्ना अअ-तैनाकल् कौसर', hi: 'बेशक हमने तुझे बहुत कुछ अता किया।' },
  { s: 108, a: 2, ar: 'فَصَلِّ لِرَبِّكَ وَانْحَرْ', tr: 'फ़-सल्लि लिरब्बिका वन्हर', hi: 'तो अपने रब के लिए नमाज़ पढ़ और क़ुर्बानी कर।' },
  { s: 108, a: 3, ar: 'إِنَّ شَانِئَكَ هُوَ الْأَبْتَرُ', tr: 'इन्ना शानिअका हुवल् अब्तर', hi: 'बेशक तेरा दुश्मन ही नाम-ओ-निशान से महरूम रहेगा।' },

  { s: 112, a: 1, ar: 'قُلْ هُوَ اللَّهُ أَحَدٌ', tr: 'क़ुल हुवल्लाहु अहद', hi: 'कह दो: वह अल्लाह एक है।' },
  { s: 112, a: 2, ar: 'اللَّهُ الصَّمَدُ', tr: 'अल्लाहुस् समद', hi: 'अल्लाह बेनियाज़ है, सब उसके मोहताज हैं।' },
  { s: 112, a: 3, ar: 'لَمْ يَلِدْ وَلَمْ يُولَدْ', tr: 'लम यलिद व लम यूलद', hi: 'न उसकी कोई औलाद है और न वह किसी से पैदा हुआ।' },
  { s: 112, a: 4, ar: 'وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ', tr: 'व लम यकुल् लहू कुफ़ुवन अहद', hi: 'और कोई उसके बराबर नहीं है।' },

  { s: 113, a: 1, ar: 'قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ', tr: 'क़ुल अऊज़ु बिरब्बिल् फ़लक़', hi: 'कह दो: मैं सुबह के रब की पनाह मांगता हूँ।' },
  { s: 113, a: 2, ar: 'مِن شَرِّ مَا خَلَقَ', tr: 'मिन शर्रि मा ख़लक़', hi: 'हर उस चीज़ की बुराई से जो उसने बनाई।' },
  { s: 113, a: 3, ar: 'وَمِن شَرِّ غَاسِقٍ إِذَا وَقَبَ', tr: 'व मिन शर्रि ग़ासिक़िन इज़ा वक़ब', hi: 'और छाती हुई रात की बुराई से जब वह फैल जाए।' },
  { s: 113, a: 4, ar: 'وَمِن شَرِّ النَّفَّاثَاتِ فِي الْعُقَدِ', tr: 'व मिन शर्रिन् नफ़्फ़ासाति फ़िल् उक़द', hi: 'और गिरहों में फूंक मारने वालों की बुराई से।' },
  { s: 113, a: 5, ar: 'وَمِن شَرِّ حَاسِدٍ إِذَا حَسَدَ', tr: 'व मिन शर्रि हासिदिन इज़ा हसद', hi: 'और जलने वाले की बुराई से जब वह जले।' },

  { s: 114, a: 1, ar: 'قُلْ أَعُوذُ بِرَبِّ النَّاسِ', tr: 'क़ुल अऊज़ु बिरब्बिन् नास', hi: 'कह दो: मैं सब इंसानों के रब की पनाह मांगता हूँ।' },
  { s: 114, a: 2, ar: 'مَلِكِ النَّاسِ', tr: 'मलिकिन् नास', hi: 'जो सब इंसानों का बादशाह है।' },
  { s: 114, a: 3, ar: 'إِلَٰهِ النَّاسِ', tr: 'इलाहिन् नास', hi: 'जो सब इंसानों का माबूद है।' },
  { s: 114, a: 4, ar: 'مِن شَرِّ الْوَسْوَاسِ الْخَنَّاسِ', tr: 'मिन शर्रिल् वस्वासिल् ख़न्नास', hi: 'उस छिपकर बहकाने वाले की बुराई से।' },
  { s: 114, a: 5, ar: 'الَّذِي يُوَسْوِسُ فِي صُدُورِ النَّاسِ', tr: 'अल्लज़ी युवस्विसु फ़ी सुदूरिन् नास', hi: 'जो इंसानों के सीनों में वहम डालता है।' },
  { s: 114, a: 6, ar: 'مِنَ الْجِنَّةِ وَالنَّاسِ', tr: 'मिनल् जिन्नति वन्-नास', hi: 'चाहे वह जिन्नों में से हो या इंसानों में से।' },
];

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

const refOf = (x: Ayah) => x.s + ':' + x.a;
const surahOf = (n: number) => SURAHS.find((s) => s.n === n);

/** Ayah of the day — keyed off the date, so it is the same for every reader all day. */
function ayahOfTheDay(d: Date): Ayah {
  const dayNumber = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  return AYAT[((dayNumber % AYAT.length) + AYAT.length) % AYAT.length];
}

function App() {
  const [tab, setTab] = useState<'today' | 'surahs' | 'saved'>('today');
  const [openSurah, setOpenSurah] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [saved, setSaved] = useState<string[]>(() => load('quran-saved-v1'));

  const today = useMemo(() => ayahOfTheDay(new Date()), []);
  const inSurah = useMemo(
    () => (openSurah === null ? [] : AYAT.filter((x) => x.s === openSurah)),
    [openSurah],
  );
  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return AYAT.filter((x) => {
      const s = surahOf(x.s);
      return x.hi.toLowerCase().includes(q) || x.tr.toLowerCase().includes(q)
        || (s ? s.hi.toLowerCase().includes(q) || s.en.toLowerCase().includes(q) : false) || refOf(x).includes(q);
    });
  }, [search]);

  const toggleSave = (x: Ayah) => {
    const r = refOf(x);
    const next = saved.includes(r) ? saved.filter((y) => y !== r) : saved.concat(r);
    setSaved(next);
    save('quran-saved-v1', next);
  };

  const AyahCard = (props: { x: Ayah; showRef?: boolean }) => {
    const s = surahOf(props.x.s);
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {props.showRef && s ? s.hi + ' · ' : ''}आयत {props.x.s}:{props.x.a}
          </div>
          <button
            className="btn-ghost"
            aria-label={saved.includes(refOf(props.x)) ? 'हटाएँ' : 'सहेजें'}
            onClick={() => toggleSave(props.x)}
            style={{ padding: '2px 8px' }}
          >
            {saved.includes(refOf(props.x)) ? 'सहेजा ✓' : 'सहेजें'}
          </button>
        </div>
        <p dir="rtl" lang="ar" style={{ fontSize: 26, lineHeight: 2, margin: '14px 0', textAlign: 'right', fontWeight: 500 }}>
          {props.x.ar}
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.7, margin: '0 0 8px', fontStyle: 'italic' }}>{props.x.tr}</p>
        <p style={{ fontSize: 15, lineHeight: 1.75, margin: 0, color: 'var(--muted)' }}>{props.x.hi}</p>
      </div>
    );
  };

  return (
    <div className="container" style={{ maxWidth: 620, paddingTop: 24, paddingBottom: 56 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>क़ुरआन — हिन्दी में</h1>
        <ThemeToggle />
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--muted)' }}>
        अरबी, हिन्दी उच्चारण और सरल हिन्दी अर्थ
      </p>

      {/* 🔒 The honesty line, on the first screen: the app states exactly how much it carries rather than
          looking like a complete Quran with most of it missing. */}
      <div className="alert" style={{ marginBottom: 16, fontSize: 13 }}>
        इस ऐप में <strong>{SURAHS.length} सूरह</strong> (कुल 114 में से) और
        <strong> {AYAT.length} आयतें</strong> शामिल हैं। अरबी मूल पाठ है; हिन्दी उच्चारण और अर्थ
        आसान भाषा में इसी ऐप के लिए लिखे गए हैं।
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 16 }}>
        {([['today', 'आज की आयत'], ['surahs', 'सूरह'], ['saved', 'सहेजी गईं']] as Array<[typeof tab, string]>).map(([id, label]) => (
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
          <h2 style={{ fontSize: 15, margin: '0 0 10px', color: 'var(--muted)' }}>आज की आयत</h2>
          <AyahCard x={today} showRef />
          <div className="field" style={{ marginTop: 20 }}>
            <label htmlFor="q">खोजें (हिन्दी अर्थ, उच्चारण या सूरह)</label>
            <input id="q" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="जैसे: सब्र, फ़ातिहा, 112:1" />
          </div>
          {search.trim() !== '' && (
            results.length === 0
              ? <div className="nb-empty">इस चयन में कुछ नहीं मिला।</div>
              : <div>
                  <p style={{ fontSize: 12, color: 'var(--muted)' }}>{results.length} आयतें मिलीं</p>
                  {results.map((x) => <AyahCard key={refOf(x)} x={x} showRef />)}
                </div>
          )}
        </div>
      )}

      {tab === 'surahs' && openSurah === null && (
        <div className="stack">
          {SURAHS.map((s) => {
            const have = AYAT.filter((x) => x.s === s.n).length;
            return (
              <button
                key={s.n}
                className="btn-ghost"
                onClick={() => setOpenSurah(s.n)}
                style={{ textAlign: 'left', display: 'block', width: '100%', padding: '12px 14px' }}
              >
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{s.n}. {s.hi}</span>
                  <span dir="rtl" lang="ar" style={{ fontSize: 18 }}>{s.ar}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {s.en} · {have} / {s.ayat} आयतें
                </div>
              </button>
            );
          })}
        </div>
      )}

      {tab === 'surahs' && openSurah !== null && (
        <div>
          <button className="btn-ghost" onClick={() => setOpenSurah(null)} style={{ marginBottom: 12 }}>
            ← सभी सूरह
          </button>
          <h2 style={{ fontSize: 17, margin: '0 0 12px' }}>
            {openSurah}. {surahOf(openSurah) ? surahOf(openSurah)!.hi : ''}
          </h2>
          {inSurah.length === 0
            ? <div className="nb-empty">इस सूरह की आयतें इस चयन में शामिल नहीं हैं।</div>
            : inSurah.map((x) => <AyahCard key={refOf(x)} x={x} />)}
        </div>
      )}

      {tab === 'saved' && (
        saved.length === 0
          ? <div className="nb-empty">अभी कोई आयत सहेजी नहीं गई। किसी आयत पर "सहेजें" दबाएँ।</div>
          : AYAT.filter((x) => saved.includes(refOf(x))).map((x) => <AyahCard key={refOf(x)} x={x} showRef />)
      )}
    </div>
  );
}

export default App;
`;
