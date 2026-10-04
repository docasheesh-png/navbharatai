import { useMemo, useState } from 'react';
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
