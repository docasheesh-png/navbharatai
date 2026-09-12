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

export const geetaAppTsx = `import { useMemo, useState } from 'react';
import ThemeToggle from './theme';

interface Shloka { ch: number; v: number; sa: string; hi: string }

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

// The selection this app carries. The Devanagari is the original text; the Hindi below each verse is a
// plain paraphrase written for this app, not a copy of any published translation.
const SHLOKAS: Shloka[] = [
  { ch: 1, v: 1, sa: 'धर्मक्षेत्रे कुरुक्षेत्रे समवेता युयुत्सवः। मामकाः पाण्डवाश्चैव किमकुर्वत सञ्जय॥', hi: 'धृतराष्ट्र ने पूछा: हे संजय, धर्मभूमि कुरुक्षेत्र में युद्ध की इच्छा से इकट्ठे हुए मेरे और पाण्डु के पुत्रों ने क्या किया?' },
  { ch: 2, v: 13, sa: 'देहिनोऽस्मिन्यथा देहे कौमारं यौवनं जरा। तथा देहान्तरप्राप्तिर्धीरस्तत्र न मुह्यति॥', hi: 'जैसे इस शरीर में बचपन, जवानी और बुढ़ापा आते जाते हैं, वैसे ही आत्मा एक शरीर छोड़कर दूसरा पा लेती है। समझदार व्यक्ति इस पर घबराता नहीं।' },
  { ch: 2, v: 20, sa: 'न जायते म्रियते वा कदाचिन्नायं भूत्वा भविता वा न भूयः। अजो नित्यः शाश्वतोऽयं पुराणो न हन्यते हन्यमानेऽस्मिन्शरीरे॥', hi: 'आत्मा कभी जन्म नहीं लेती और कभी मरती नहीं। वह अजन्मा, नित्य और सनातन है। शरीर मारा जाता है, आत्मा नहीं।' },
  { ch: 2, v: 22, sa: 'वासांसि जीर्णानि यथा विहाय नवानि गृह्णाति नरोऽपराणि। तथा शरीराणि विहाय जीर्णान्यन्यानि संयाति नवानि देही॥', hi: 'जैसे आदमी पुराने कपड़े छोड़कर नए पहन लेता है, वैसे ही आत्मा पुराना शरीर छोड़कर नया शरीर ले लेती है।' },
  { ch: 2, v: 23, sa: 'नैनं छिन्दन्ति शस्त्राणि नैनं दहति पावकः। न चैनं क्लेदयन्त्यापो न शोषयति मारुतः॥', hi: 'आत्मा को हथियार काट नहीं सकते, आग जला नहीं सकती, पानी गीला नहीं कर सकता और हवा सुखा नहीं सकती।' },
  { ch: 2, v: 47, sa: 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन। मा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि॥', hi: 'तेरा हक़ सिर्फ़ कर्म करने पर है, फल पर नहीं। फल की चाह से काम मत कर, और काम छोड़ भी मत।' },
  { ch: 2, v: 48, sa: 'योगस्थः कुरु कर्माणि सङ्गं त्यक्त्वा धनञ्जय। सिद्ध्यसिद्ध्योः समो भूत्वा समत्वं योग उच्यते॥', hi: 'आसक्ति छोड़कर, सफलता और असफलता दोनों में एक जैसा रहकर अपना काम कर। इस समता को ही योग कहा जाता है।' },
  { ch: 2, v: 62, sa: 'ध्यायतो विषयान्पुंसः सङ्गस्तेषूपजायते। सङ्गात्सञ्जायते कामः कामात्क्रोधोऽभिजायते॥', hi: 'जो चीज़ों के बारे में सोचता रहता है, उसका उनसे लगाव हो जाता है। लगाव से इच्छा पैदा होती है और इच्छा से क्रोध।' },
  { ch: 3, v: 35, sa: 'श्रेयान्स्वधर्मो विगुणः परधर्मात्स्वनुष्ठितात्। स्वधर्मे निधनं श्रेयः परधर्मो भयावहः॥', hi: 'अपना कर्तव्य अधूरा निभाना भी दूसरे का कर्तव्य अच्छी तरह निभाने से बेहतर है। दूसरे का रास्ता डर की ओर ले जाता है।' },
  { ch: 4, v: 7, sa: 'यदा यदा हि धर्मस्य ग्लानिर्भवति भारत। अभ्युत्थानमधर्मस्य तदात्मानं सृजाम्यहम्॥', hi: 'जब भी धर्म कमज़ोर पड़ता है और अधर्म बढ़ता है, तब मैं स्वयं प्रकट होता हूँ।' },
  { ch: 4, v: 8, sa: 'परित्राणाय साधूनां विनाशाय च दुष्कृताम्। धर्मसंस्थापनार्थाय सम्भवामि युगे युगे॥', hi: 'सज्जनों की रक्षा, बुराई का नाश और धर्म की स्थापना के लिए मैं हर युग में आता हूँ।' },
  { ch: 5, v: 10, sa: 'ब्रह्मण्याधाय कर्माणि सङ्गं त्यक्त्वा करोति यः। लिप्यते न स पापेन पद्मपत्रमिवाम्भसा॥', hi: 'जो अपने काम ईश्वर को अर्पित करके, आसक्ति छोड़कर करता है, वह पाप से उतना ही अछूता रहता है जितना कमल का पत्ता पानी से।' },
  { ch: 6, v: 5, sa: 'उद्धरेदात्मनात्मानं नात्मानमवसादयेत्। आत्मैव ह्यात्मनो बन्धुरात्मैव रिपुरात्मनः॥', hi: 'अपने आप को अपने ही प्रयास से ऊपर उठाओ, अपने आप को गिराओ मत। इंसान का सबसे बड़ा मित्र और सबसे बड़ा शत्रु वह स्वयं है।' },
  { ch: 6, v: 17, sa: 'युक्ताहारविहारस्य युक्तचेष्टस्य कर्मसु। युक्तस्वप्नावबोधस्य योगो भवति दुःखहा॥', hi: 'जिसका खाना, घूमना, काम करना और सोना जागना संतुलित है, उसका योग दुःख मिटा देता है।' },
  { ch: 7, v: 7, sa: 'मत्तः परतरं नान्यत्किञ्चिदस्ति धनञ्जय। मयि सर्वमिदं प्रोतं सूत्रे मणिगणा इव॥', hi: 'मुझसे बढ़कर कुछ नहीं है। यह सारा जगत मुझमें उसी तरह पिरोया है जैसे धागे में मोती।' },
  { ch: 8, v: 7, sa: 'तस्मात्सर्वेषु कालेषु मामनुस्मर युध्य च। मय्यर्पितमनोबुद्धिर्मामेवैष्यस्यसंशयम्॥', hi: 'इसलिए हर समय मुझे याद रखते हुए अपना कर्तव्य निभा। मन और बुद्धि मुझमें लगा देने पर तू निश्चय ही मुझ तक पहुँचेगा।' },
  { ch: 9, v: 22, sa: 'अनन्याश्चिन्तयन्तो मां ये जनाः पर्युपासते। तेषां नित्याभियुक्तानां योगक्षेमं वहाम्यहम्॥', hi: 'जो लोग बिना किसी और सहारे के मुझमें मन लगाकर मेरी उपासना करते हैं, उनका भार मैं स्वयं उठाता हूँ।' },
  { ch: 9, v: 26, sa: 'पत्रं पुष्पं फलं तोयं यो मे भक्त्या प्रयच्छति। तदहं भक्त्युपहृतमश्नामि प्रयतात्मनः॥', hi: 'जो शुद्ध मन से प्रेमपूर्वक मुझे एक पत्ता, फूल, फल या पानी भी अर्पित करता है, उसे मैं स्वीकार करता हूँ।' },
  { ch: 10, v: 20, sa: 'अहमात्मा गुडाकेश सर्वभूताशयस्थितः। अहमादिश्च मध्यं च भूतानामन्त एव च॥', hi: 'मैं हर प्राणी के हृदय में बैठी आत्मा हूँ। सब प्राणियों का आदि, मध्य और अन्त भी मैं ही हूँ।' },
  { ch: 11, v: 7, sa: 'इहैकस्थं जगत्कृत्स्नं पश्याद्य सचराचरम्। मम देहे गुडाकेश यच्चान्यद्द्रष्टुमिच्छसि॥', hi: 'इस एक ही रूप में सारा चर और अचर जगत देख लो। जो भी और देखना चाहो, वह भी यहीं है।' },
  { ch: 12, v: 15, sa: 'यस्मान्नोद्विजते लोको लोकान्नोद्विजते च यः। हर्षामर्षभयोद्वेगैर्मुक्तो यः स च मे प्रियः॥', hi: 'जिससे किसी को परेशानी नहीं होती, जो किसी से परेशान नहीं होता, और जो खुशी, जलन, डर और बेचैनी से मुक्त है, वह मुझे प्रिय है।' },
  { ch: 14, v: 5, sa: 'सत्त्वं रजस्तम इति गुणाः प्रकृतिसम्भवाः। निबध्नन्ति महाबाहो देहे देहिनमव्ययम्॥', hi: 'सत्त्व, रज और तम, ये तीनों गुण प्रकृति से पैदा होते हैं और अविनाशी आत्मा को शरीर में बाँध देते हैं।' },
  { ch: 15, v: 15, sa: 'सर्वस्य चाहं हृदि सन्निविष्टो मत्तः स्मृतिर्ज्ञानमपोहनं च।', hi: 'मैं सबके हृदय में बसा हूँ। याद, ज्ञान और भूलना भी मुझसे ही होता है।' },
  { ch: 16, v: 3, sa: 'तेजः क्षमा धृतिः शौचमद्रोहो नातिमानिता। भवन्ति सम्पदं दैवीमभिजातस्य भारत॥', hi: 'तेज, क्षमा, धीरज, शुद्धता, किसी से बैर न रखना और घमंड न करना, ये दैवी स्वभाव वाले व्यक्ति के गुण हैं।' },
  { ch: 17, v: 3, sa: 'सत्त्वानुरूपा सर्वस्य श्रद्धा भवति भारत। श्रद्धामयोऽयं पुरुषो यो यच्छ्रद्धः स एव सः॥', hi: 'हर व्यक्ति की श्रद्धा उसके स्वभाव के अनुसार होती है। इंसान श्रद्धा से बना है, जिस पर उसकी श्रद्धा है वही वह है।' },
  { ch: 18, v: 66, sa: 'सर्वधर्मान्परित्यज्य मामेकं शरणं व्रज। अहं त्वां सर्वपापेभ्यो मोक्षयिष्यामि मा शुचः॥', hi: 'सब कुछ छोड़कर केवल मेरी शरण में आ जा। मैं तुझे सब पापों से मुक्त कर दूँगा, चिन्ता मत कर।' },
];

const CHAPTERS_HELD = new Set(SHLOKAS.map((s) => s.ch)).size;

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

/** Verse of the day: the SAME verse for everyone all day, because it is keyed off the date, not random. */
function verseOfTheDay(d: Date): Shloka {
  const dayNumber = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  return SHLOKAS[((dayNumber % SHLOKAS.length) + SHLOKAS.length) % SHLOKAS.length];
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
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return SHLOKAS.filter((s) => {
      const ch = CHAPTERS[s.ch - 1];
      return s.hi.toLowerCase().includes(q) || s.sa.includes(search.trim())
        || ch.hi.toLowerCase().includes(q) || ch.en.toLowerCase().includes(q) || refOf(s).includes(q);
    });
  }, [search]);

  const toggleSave = (s: Shloka) => {
    const r = refOf(s);
    const next = saved.includes(r) ? saved.filter((x) => x !== r) : saved.concat(r);
    setSaved(next);
    save('geeta-saved-v1', next);
  };

  const openAt = (ch: number, i: number) => { setOpenChapter(ch); setIndex(i); setTab('chapters'); };

  const Verse = (props: { s: Shloka; showRef?: boolean }) => (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          अध्याय {props.s.ch} · श्लोक {props.s.v}
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
      <p style={{ fontSize: 20, lineHeight: 1.8, margin: '12px 0', fontWeight: 600 }}>{props.s.sa}</p>
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
        Bhagavad Gita — हिन्दी अर्थ सहित
      </p>

      {/* 🔒 The honesty line, on the first screen and not in a footnote: the app says exactly how much of
          the text it carries, so it can never imply it holds all 700 shlokas. */}
      <div className="alert" style={{ marginBottom: 16, fontSize: 13 }}>
        इस ऐप में गीता के <strong>{SHLOKAS.length} चुने हुए श्लोक</strong> हैं (कुल 700 में से),
        18 अध्यायों में से {CHAPTERS_HELD} अध्यायों से। हिन्दी अर्थ सरल भाषा में इसी ऐप के लिए लिखा गया है।
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
            <label htmlFor="q">खोजें (हिन्दी अर्थ या अध्याय)</label>
            <input id="q" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="जैसे: कर्म, भक्ति, 2.47" />
          </div>
          {search.trim() !== '' && (
            results.length === 0
              ? <div className="nb-empty">इस चयन में कुछ नहीं मिला।</div>
              : <div>
                  <p style={{ fontSize: 12, color: 'var(--muted)' }}>{results.length} श्लोक मिले</p>
                  {results.map((s) => <Verse key={refOf(s)} s={s} showRef />)}
                </div>
          )}
        </div>
      )}

      {tab === 'chapters' && openChapter === null && (
        <div className="stack">
          {CHAPTERS.map((c) => {
            const count = SHLOKAS.filter((s) => s.ch === c.n).length;
            return (
              <button
                key={c.n}
                className="btn-ghost"
                onClick={() => { setOpenChapter(c.n); setIndex(0); }}
                style={{ textAlign: 'left', display: 'block', width: '100%', padding: '12px 14px' }}
              >
                <div style={{ fontWeight: 600 }}>{c.n}. {c.hi}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {c.en} · {count > 0 ? count + ' श्लोक' : 'इस चयन में नहीं'}
                </div>
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
            <div className="nb-empty">
              इस अध्याय के श्लोक इस चयन में शामिल नहीं हैं। यह जानबूझकर खाली दिखाया गया है —
              ऐप वही दिखाता है जो उसके पास सच में है।
            </div>
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
                  <button className="btn-ghost" onClick={() => openAt(s.ch, SHLOKAS.filter((x) => x.ch === s.ch).findIndex((x) => x.v === s.v))} style={{ marginBottom: 18 }}>
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
