import React, { useState, useEffect } from 'react';
import { Smartphone, Globe, FileText, Download, Star, Check, X, ChevronRight, Plus, Trash2, Copy, AlertCircle, CheckCircle2, Rocket, Shield, Search, BarChart2, Monitor, Image as ImageIcon, Info, Play } from 'lucide-react';

interface StoreData {
  appName: string;
  shortDesc: string;
  packageName: string;
  version: string;
  category: string;
  ageRating: string;
  platforms: string[];
  devName: string;
  devEmail: string;
  privacyUrl: string;
  supportUrl: string;
  fullDesc: string;
  whatsNew: string;
  keywords: string;
  selectedKeywords: string[];
  screenshots: string[];
  checklist: Record<string, boolean>;
  contentRating: Record<string, boolean>;
}

const DEFAULT_DATA: StoreData = {
  appName: '', shortDesc: '', packageName: '', version: '1.0.0', category: 'Productivity',
  ageRating: '4+', platforms: ['Android', 'Web'], devName: '', devEmail: '', privacyUrl: '', supportUrl: '',
  fullDesc: '', whatsNew: '', keywords: '', selectedKeywords: [], screenshots: Array(8).fill(''),
  checklist: {}, contentRating: {}
};

const CATEGORIES = ['Games', 'Education', 'Productivity', 'Social', 'Finance', 'Health', 'Shopping', 'Entertainment', 'Utilities', 'Travel'];
const AGE_RATINGS = ['4+', '9+', '12+', '17+'];
const PLATFORMS = ['Android', 'iOS', 'Web'];

const KEYWORD_SUGGESTIONS: Record<string, string[]> = {
  Productivity: ['task manager', 'to-do list', 'planner', 'notes', 'reminder', 'calendar', 'organizer', 'workflow', 'project management', 'time tracking', 'collaboration', 'team', 'schedule', 'goals', 'productivity'],
  Finance: ['budget', 'expense tracker', 'money manager', 'savings', 'investment', 'UPI', 'wallet', 'banking', 'loan', 'credit', 'tax', 'salary', 'finance', 'payment', 'bill tracker'],
  Games: ['puzzle', 'action', 'adventure', 'multiplayer', 'offline', 'casual', 'strategy', 'racing', 'sports', 'card game', 'RPG', 'arcade', 'quiz', 'brain game', 'family'],
  Education: ['learning', 'course', 'tutorial', 'quiz', 'exam', 'study', 'school', 'college', 'skill', 'certificate', 'language', 'math', 'science', 'practice', 'teacher'],
  Social: ['chat', 'friends', 'community', 'share', 'feed', 'stories', 'follow', 'like', 'comment', 'group', 'dating', 'network', 'profile', 'video call', 'messaging'],
  Health: ['fitness', 'workout', 'diet', 'meditation', 'mental health', 'yoga', 'sleep', 'calories', 'steps', 'heart rate', 'water tracker', 'medicine', 'doctor', 'wellness', 'exercise'],
  Shopping: ['ecommerce', 'deals', 'discount', 'cart', 'wishlist', 'product', 'delivery', 'shop', 'sale', 'offer', 'fashion', 'grocery', 'compare', 'review', 'coupon'],
  Entertainment: ['music', 'video', 'movies', 'streaming', 'podcast', 'news', 'sports', 'comedy', 'web series', 'short videos', 'live', 'radio', 'ebook', 'audiobook', 'trending'],
  Utilities: ['tool', 'calculator', 'converter', 'scanner', 'QR code', 'PDF', 'file manager', 'cleaner', 'VPN', 'battery saver', 'flashlight', 'compass', 'translator', 'password', 'backup'],
  Travel: ['trip', 'hotel', 'flight', 'booking', 'map', 'navigation', 'guide', 'itinerary', 'tourism', 'adventure', 'backpacking', 'visa', 'currency', 'weather', 'review'],
};

const CHECKLIST_GROUPS = [
  {
    title: 'App Readiness', icon: Smartphone, color: 'text-blue-400', items: [
      { key: 'tested_devices', label: 'App tested on multiple devices' },
      { key: 'no_crashes', label: 'No crashes in last 50 sessions' },
      { key: 'loading_time', label: 'Loading time under 3 seconds' },
      { key: 'offline_mode', label: 'Offline mode works (or N/A)' },
      { key: 'all_features', label: 'All features functional' },
      { key: 'error_messages', label: 'Error messages are user-friendly' },
      { key: 'version_updated', label: 'App version number updated' },
    ]
  },
  {
    title: 'Store Requirements', icon: Globe, color: 'text-emerald-400', items: [
      { key: 'app_icon', label: 'App icon (1024×1024 PNG)' },
      { key: 'feature_graphic', label: 'Feature graphic (1024×500 PNG)' },
      { key: 'screenshots_min', label: 'At least 2 screenshots uploaded' },
      { key: 'privacy_policy', label: 'Privacy policy URL added' },
      { key: 'description_complete', label: 'App description complete (>100 words)' },
      { key: 'category_selected', label: 'Category selected' },
    ]
  },
  {
    title: 'Legal & Compliance', icon: Shield, color: 'text-amber-400', items: [
      { key: 'gdpr', label: 'GDPR compliance (if targeting EU)' },
      { key: 'coppa', label: 'COPPA compliance (if targeting children)' },
      { key: 'tos', label: 'Terms of service link added' },
      { key: 'content_rating_done', label: 'Content rating questionnaire complete' },
      { key: 'no_copyright', label: 'No third-party copyright violations' },
    ]
  },
  {
    title: 'ASO Optimization', icon: Search, color: 'text-violet-400', items: [
      { key: 'title_keyword', label: 'Title includes primary keyword' },
      { key: 'desc_keywords', label: 'Description has 10+ keywords naturally' },
      { key: 'screenshots_5', label: '5+ screenshots uploaded' },
      { key: 'short_desc', label: 'Short description compelling (action words)' },
      { key: 'review_strategy', label: 'Positive review strategy ready' },
    ]
  },
];

const CONTENT_QUESTIONS = [
  { key: 'violence', label: 'Does your app contain violence or graphic content?' },
  { key: 'adult', label: 'Does your app contain adult or sexual content?' },
  { key: 'gambling', label: 'Does your app involve gambling or simulated gambling?' },
  { key: 'user_content', label: 'Can users share/upload unmoderated content?' },
  { key: 'location', label: 'Does your app use precise location tracking?' },
];

function ASOScoreRing({ score }: { score: number }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <svg width="96" height="96" viewBox="0 0 96 96">
      <circle cx="48" cy="48" r={r} fill="none" stroke="#ffffff10" strokeWidth="8" />
      <circle cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth="8"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" strokeDashoffset={circ / 4}
        style={{ transition: 'stroke-dasharray 0.5s ease' }} />
      <text x="48" y="44" textAnchor="middle" fill="white" fontSize="18" fontWeight="bold">{score}</text>
      <text x="48" y="58" textAnchor="middle" fill="#ffffff60" fontSize="9">ASO Score</text>
    </svg>
  );
}

interface Props {
  generatedCode?: string;
}

export function AppStorePublisher({ generatedCode }: Props) {
  const [activeTab, setActiveTab] = useState(0);
  const [data, setData] = useState<StoreData>(() => {
    try {
      const saved = localStorage.getItem('navbharat_store_data');
      return saved ? { ...DEFAULT_DATA, ...JSON.parse(saved) } : DEFAULT_DATA;
    } catch { return DEFAULT_DATA; }
  });
  const [copiedField, setCopiedField] = useState('');

  const update = (patch: Partial<StoreData>) => {
    const next = { ...data, ...patch };
    setData(next);
    try { localStorage.setItem('navbharat_store_data', JSON.stringify(next)); } catch {}
  };

  const togglePlatform = (p: string) => {
    const platforms = data.platforms.includes(p) ? data.platforms.filter(x => x !== p) : [...data.platforms, p];
    update({ platforms });
  };

  const toggleCheckItem = (key: string) => {
    update({ checklist: { ...data.checklist, [key]: !data.checklist[key] } });
  };

  const toggleContentRating = (key: string) => {
    update({ contentRating: { ...data.contentRating, [key]: !data.contentRating[key] } });
  };

  const addKeyword = (kw: string) => {
    if (data.selectedKeywords.length >= 12) return;
    if (!data.selectedKeywords.includes(kw)) {
      update({ selectedKeywords: [...data.selectedKeywords, kw] });
    }
  };

  const removeKeyword = (kw: string) => {
    update({ selectedKeywords: data.selectedKeywords.filter(k => k !== kw) });
  };

  const generateDescription = () => {
    if (!data.appName) return;
    const desc = `${data.appName} — ${data.shortDesc || 'a powerful app'}\n\n${data.appName} is designed to make ${data.category.toLowerCase()} simple and effective.\n\n✅ Key Features:\n• Fast and smooth performance\n• User-friendly interface\n• Secure and reliable\n• Regular updates\n\n${data.appName} makes your work even easier. Millions of users already rely on it — give it a try too!\n\nQuestions? Contact: ${data.devEmail || 'support@yourapp.com'}`;
    update({ fullDesc: desc });
  };

  const generateScreenshotIdeas = (): string[] => {
    return [
      `Main dashboard — ${data.appName || 'App'} ka clean home screen`,
      'Key feature #1 — step-by-step usage',
      'Key feature #2 — in action',
      'User profile / settings page',
      'Success/completion screen — emotional moment',
      'Onboarding — the "Get Started" first screen',
    ];
  };

  const calcASOScore = (): number => {
    let score = 0;
    if (data.appName.length >= 10 && data.appName.length <= 30) score += 40;
    else if (data.appName.length > 0) score += 20;
    if (data.selectedKeywords.length >= 8) score += 30;
    else score += Math.floor((data.selectedKeywords.length / 8) * 30);
    if (data.fullDesc.length >= 500) score += 20;
    else score += Math.floor((data.fullDesc.length / 500) * 20);
    const screenCount = data.screenshots.filter(s => s !== '').length;
    if (screenCount >= 5) score += 10;
    else score += Math.floor((screenCount / 5) * 10);
    return Math.min(score, 100);
  };

  const calcReadiness = (): number => {
    const all = CHECKLIST_GROUPS.flatMap(g => g.items);
    const done = all.filter(i => data.checklist[i.key]).length;
    return Math.round((done / all.length) * 100);
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.appName || 'app'}-store-metadata.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const TABS = [
    { label: 'App Info', icon: Smartphone },
    { label: 'Screenshots', icon: ImageIcon },
    { label: 'Store Listing', icon: FileText },
    { label: 'ASO Keywords', icon: Search },
    { label: 'Publish Checklist', icon: Rocket },
  ];

  const asoScore = calcASOScore();
  const readiness = calcReadiness();
  const keywordSuggestions = KEYWORD_SUGGESTIONS[data.category] || KEYWORD_SUGGESTIONS.Productivity;

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-[#161b22]">
        <div className="w-10 h-10 bg-rose-600/20 rounded-xl flex items-center justify-center">
          <Rocket className="w-5 h-5 text-rose-400" />
        </div>
        <div>
          <h2 className="font-semibold text-white text-base">App Store Publisher</h2>
          <p className="text-xs text-white/40">Optimize metadata and ASO for Google Play & the App Store</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="text-right">
            <div className="text-[10px] text-white/30">Readiness</div>
            <div className={`text-xs font-bold ${readiness >= 80 ? 'text-emerald-400' : readiness >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{readiness}%</div>
          </div>
          <button onClick={exportData} className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#0d1117] border border-white/10 rounded-lg text-white/50 hover:text-white transition-all">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/5 bg-[#161b22]">
        {TABS.map((tab, i) => (
          <button
            key={i}
            onClick={() => setActiveTab(i)}
            className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-all ${
              activeTab === i ? 'border-rose-500 text-rose-400' : 'border-transparent text-white/30 hover:text-white/60'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">

        {/* Tab 0: App Info */}
        {activeTab === 0 && (
          <div className="flex gap-4 p-5">
            <div className="flex-1 space-y-4">
              {/* App Name */}
              <div>
                <div className="flex justify-between mb-1.5">
                  <label className="text-xs text-white/50">App Name <span className="text-red-400">*</span></label>
                  <span className={`text-[10px] ${data.appName.length > 30 ? 'text-red-400' : 'text-white/30'}`}>{data.appName.length}/30</span>
                </div>
                <input className="w-full bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-500/50" placeholder="e.g. NavBharat AI" value={data.appName} onChange={e => update({ appName: e.target.value })} maxLength={50} />
              </div>
              {/* Short Desc */}
              <div>
                <div className="flex justify-between mb-1.5">
                  <label className="text-xs text-white/50">Short Description</label>
                  <span className={`text-[10px] ${data.shortDesc.length > 80 ? 'text-red-400' : 'text-white/30'}`}>{data.shortDesc.length}/80</span>
                </div>
                <input className="w-full bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-500/50" placeholder="One-line description for store listings" value={data.shortDesc} onChange={e => update({ shortDesc: e.target.value })} maxLength={80} />
              </div>
              {/* Package + Version */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-white/50 mb-1.5 block">Package Name</label>
                  <input className="w-full bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-500/50" placeholder="com.company.appname" value={data.packageName} onChange={e => update({ packageName: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1.5 block">Version</label>
                  <input className="w-full bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-500/50" placeholder="1.0.0" value={data.version} onChange={e => update({ version: e.target.value })} />
                </div>
              </div>
              {/* Category + Age */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-white/50 mb-1.5 block">Category</label>
                  <select className="w-full bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-500/50" value={data.category} onChange={e => update({ category: e.target.value })}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1.5 block">Age Rating</label>
                  <div className="flex gap-1.5">
                    {AGE_RATINGS.map(r => (
                      <button key={r} onClick={() => update({ ageRating: r })} className={`flex-1 py-2 text-xs rounded-xl border transition-all ${data.ageRating === r ? 'border-rose-500/50 bg-rose-500/10 text-rose-300' : 'border-white/10 bg-[#161b22] text-white/40'}`}>{r}</button>
                    ))}
                  </div>
                </div>
              </div>
              {/* Platforms */}
              <div>
                <label className="text-xs text-white/50 mb-1.5 block">Supported Platforms</label>
                <div className="flex gap-2">
                  {PLATFORMS.map(p => (
                    <button key={p} onClick={() => togglePlatform(p)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs transition-all ${data.platforms.includes(p) ? 'border-rose-500/50 bg-rose-500/10 text-rose-300' : 'border-white/10 bg-[#161b22] text-white/40'}`}>
                      {data.platforms.includes(p) ? <Check className="w-3 h-3" /> : null}
                      {p === 'Android' ? '🤖' : p === 'iOS' ? '🍎' : '🌐'} {p}
                    </button>
                  ))}
                </div>
              </div>
              {/* Dev Info */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-white/50 mb-1.5 block">Developer Name</label>
                  <input className="w-full bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-500/50" placeholder="Your Name / Company" value={data.devName} onChange={e => update({ devName: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1.5 block">Developer Email</label>
                  <input className="w-full bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-500/50" placeholder="dev@example.com" value={data.devEmail} onChange={e => update({ devEmail: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-white/50 mb-1.5 block">Privacy Policy URL</label>
                  <input className="w-full bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-500/50" placeholder="https://yourapp.com/privacy" value={data.privacyUrl} onChange={e => update({ privacyUrl: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-white/50 mb-1.5 block">Support URL</label>
                  <input className="w-full bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-500/50" placeholder="https://yourapp.com/support" value={data.supportUrl} onChange={e => update({ supportUrl: e.target.value })} />
                </div>
              </div>
            </div>

            {/* Right: Phone Preview */}
            <div className="w-48 shrink-0">
              <p className="text-[10px] text-white/30 uppercase tracking-wider text-center mb-3">App Preview</p>
              <div className="mx-auto w-36 bg-[#161b22] border border-white/10 rounded-3xl p-3 space-y-2">
                <div className="w-16 h-16 mx-auto bg-gradient-to-br from-rose-500 to-violet-600 rounded-2xl flex items-center justify-center text-2xl">
                  {data.category === 'Games' ? '🎮' : data.category === 'Finance' ? '💰' : data.category === 'Health' ? '💪' : '📱'}
                </div>
                <p className="text-[11px] font-semibold text-white text-center truncate">{data.appName || 'App Name'}</p>
                <p className="text-[9px] text-white/30 text-center truncate">{data.devName || 'Developer'}</p>
                <div className="flex justify-center gap-0.5">
                  {[1,2,3,4,5].map(i => <Star key={i} className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />)}
                </div>
                <div className="flex gap-1 flex-wrap justify-center">
                  {data.platforms.map(p => (
                    <span key={p} className="text-[7px] bg-white/5 text-white/30 px-1 rounded">{p}</span>
                  ))}
                </div>
                <div className="w-full py-1.5 bg-rose-600 rounded-xl text-[9px] text-white text-center">Install</div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 1: Screenshots */}
        {activeTab === 1 && (
          <div className="p-5 space-y-5">
            <div className="grid grid-cols-2 gap-5">
              {/* Phone Screenshots */}
              <div>
                <p className="text-xs text-white/50 uppercase tracking-wider mb-3">📱 Phone Screenshots (1080×1920)</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {data.screenshots.slice(0, 6).map((sc, i) => (
                    <div key={i} className="aspect-[9/16] bg-[#161b22] border border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center gap-1 relative group hover:border-rose-500/30 transition-all cursor-pointer"
                      onClick={() => {
                        const url = prompt(`Screenshot ${i + 1} URL:`);
                        if (url !== null) {
                          const scs = [...data.screenshots];
                          scs[i] = url;
                          update({ screenshots: scs });
                        }
                      }}
                    >
                      {sc ? (
                        <>
                          <img src={sc} alt={`Screenshot ${i+1}`} className="w-full h-full object-cover rounded-xl" onError={e => (e.currentTarget.style.display = 'none')} />
                          <button onClick={e => { e.stopPropagation(); const scs = [...data.screenshots]; scs[i] = ''; update({ screenshots: scs }); }}
                            className="absolute top-1 right-1 w-4 h-4 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <X className="w-2.5 h-2.5 text-white" />
                          </button>
                        </>
                      ) : (
                        <>
                          <Plus className="w-5 h-5 text-white/20" />
                          <span className="text-[8px] text-white/20">{i + 1}</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {/* Tablet Screenshots */}
              <div>
                <p className="text-xs text-white/50 uppercase tracking-wider mb-3">💻 Tablet Screenshots (2048×2732)</p>
                <div className="grid grid-cols-2 gap-2">
                  {data.screenshots.slice(6, 8).map((sc, i) => (
                    <div key={i} className="aspect-[3/4] bg-[#161b22] border border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center gap-1 relative group hover:border-rose-500/30 transition-all cursor-pointer"
                      onClick={() => {
                        const url = prompt(`Tablet Screenshot ${i + 1} URL:`);
                        if (url !== null) {
                          const scs = [...data.screenshots];
                          scs[6 + i] = url;
                          update({ screenshots: scs });
                        }
                      }}
                    >
                      {sc ? (
                        <img src={sc} alt={`Tablet ${i+1}`} className="w-full h-full object-cover rounded-xl" />
                      ) : (
                        <>
                          <Monitor className="w-6 h-6 text-white/20" />
                          <span className="text-[9px] text-white/20">Tablet {i + 1}</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Screenshot Ideas */}
            <div className="bg-[#161b22] border border-white/5 rounded-xl p-4">
              <p className="text-xs text-white/50 uppercase tracking-wider mb-3">💡 Screenshot Ideas for {data.appName || 'Your App'}</p>
              <div className="space-y-1.5">
                {generateScreenshotIdeas().map((idea, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-rose-500/20 text-rose-400 text-[9px] flex items-center justify-center shrink-0">{i + 1}</span>
                    <p className="text-xs text-white/50">{idea}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-amber-500/5 border border-amber-500/10 rounded-xl p-3">
              <p className="text-xs text-amber-300 flex items-center gap-1.5 mb-1.5"><Info className="w-3 h-3" /> Screenshot Tips</p>
              <ul className="text-[10px] text-white/40 space-y-1">
                <li>• The first screenshot matters most — show the main value</li>
                <li>• Add a text overlay to explain the feature</li>
                <li>• Use real UI — a mockup is fine, but real is better</li>
                <li>• Bright, high-contrast screenshots increase the download rate</li>
              </ul>
            </div>
          </div>
        )}

        {/* Tab 2: Store Listing */}
        {activeTab === 2 && (
          <div className="p-5 space-y-4">
            {/* Platform Toggle */}
            <div className="flex gap-2">
              {['Google Play', 'App Store'].map(p => (
                <span key={p} className="text-xs px-3 py-1.5 bg-[#161b22] border border-white/10 rounded-lg text-white/40">{p === 'Google Play' ? '🤖' : '🍎'} {p}</span>
              ))}
            </div>

            {/* Full Description */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-white/50">Full Description (max 4000 chars)</label>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] ${data.fullDesc.length > 4000 ? 'text-red-400' : 'text-white/30'}`}>{data.fullDesc.length}/4000</span>
                  {/* Honest label (admin autopsy 2026-07-21): this fills a template from your fields —
                      it is not an AI generation. */}
                  <button onClick={generateDescription} className="text-[10px] text-rose-400 hover:text-rose-300 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-lg">Fill template</button>
                </div>
              </div>
              <textarea
                className="w-full bg-[#161b22] border border-white/10 rounded-xl p-3 text-sm text-white placeholder-white/20 resize-none focus:outline-none focus:border-rose-500/50"
                rows={8}
                placeholder="Describe your app — features, benefits, use cases..."
                value={data.fullDesc}
                onChange={e => update({ fullDesc: e.target.value })}
                maxLength={4000}
              />
            </div>

            {/* What's New */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-white/50">What's New (max 500 chars)</label>
                <span className={`text-[10px] ${data.whatsNew.length > 500 ? 'text-red-400' : 'text-white/30'}`}>{data.whatsNew.length}/500</span>
              </div>
              <textarea
                className="w-full bg-[#161b22] border border-white/10 rounded-xl p-3 text-sm text-white placeholder-white/20 resize-none focus:outline-none focus:border-rose-500/50"
                rows={3}
                placeholder="What's new in this version..."
                value={data.whatsNew}
                onChange={e => update({ whatsNew: e.target.value })}
                maxLength={500}
              />
            </div>

            {/* Content Rating */}
            <div className="bg-[#161b22] border border-white/5 rounded-xl p-4">
              <p className="text-xs text-white/50 uppercase tracking-wider mb-3">Content Rating Questionnaire</p>
              <div className="space-y-2.5">
                {CONTENT_QUESTIONS.map(q => (
                  <div key={q.key} className="flex items-center justify-between gap-3">
                    <p className="text-xs text-white/50">{q.label}</p>
                    <div className="flex gap-1.5 shrink-0">
                      {['Yes', 'No'].map(ans => (
                        <button key={ans} onClick={() => toggleContentRating(q.key + '_' + ans)}
                          className={`text-[10px] px-2 py-0.5 rounded-lg border transition-all ${data.contentRating[q.key + '_' + ans] ? (ans === 'Yes' ? 'border-red-500/40 bg-red-500/10 text-red-400' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400') : 'border-white/10 text-white/30'}`}>
                          {ans}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs text-amber-300">
                  Calculated Rating: {Object.values(CONTENT_QUESTIONS).some(q => data.contentRating[q.key + '_Yes']) ? '12+' : '4+'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: ASO Keywords */}
        {activeTab === 3 && (
          <div className="flex gap-4 p-5">
            <div className="flex-1 space-y-4">
              <div>
                <label className="text-xs text-white/50 mb-1.5 block">Primary Keyword</label>
                <input className="w-full bg-[#161b22] border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-rose-500/50" placeholder="Main keyword (e.g. task manager)" value={data.keywords} onChange={e => update({ keywords: e.target.value })} />
              </div>

              {/* Suggestions */}
              <div>
                <p className="text-xs text-white/50 mb-2">Suggested for {data.category}</p>
                <div className="flex flex-wrap gap-1.5">
                  {keywordSuggestions.map(kw => {
                    const isSelected = data.selectedKeywords.includes(kw);
                    return (
                      <button key={kw} onClick={() => isSelected ? removeKeyword(kw) : addKeyword(kw)}
                        className={`text-[10px] px-2 py-1 rounded-lg border transition-all ${isSelected ? 'border-rose-500/50 bg-rose-500/10 text-rose-300' : 'border-white/10 bg-[#161b22] text-white/40 hover:border-white/20'}`}>
                        {isSelected ? <span className="mr-1">✓</span> : null}{kw}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Selected Keywords */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-white/50">Selected Keywords</p>
                  <span className={`text-[10px] ${data.selectedKeywords.length >= 12 ? 'text-amber-400' : 'text-white/30'}`}>{data.selectedKeywords.length}/12</span>
                </div>
                {data.selectedKeywords.length === 0 ? (
                  <p className="text-xs text-white/20 py-2">Select keywords from above</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {data.selectedKeywords.map(kw => (
                      <span key={kw} className="flex items-center gap-1 text-[10px] px-2 py-1 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-lg">
                        {kw}
                        <button onClick={() => removeKeyword(kw)}><X className="w-2.5 h-2.5" /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Keyword Analysis Table */}
              {/* The fabricated Volume/Competition/Relevance table was removed (admin autopsy
                  2026-07-21): those numbers were computed from the row index (i%3, i%2, 10-i), not any
                  real ASO data source — showing invented metrics as real is dishonest. We list the
                  chosen keywords honestly; real search-volume data needs a paid ASO API we don't have. */}
              <div className="bg-[#161b22] border border-white/5 rounded-xl overflow-hidden">
                <div className="px-3 py-2 border-b border-white/5 text-[9px] text-white/30 uppercase tracking-wider">Selected keywords</div>
                {data.selectedKeywords.length === 0 ? (
                  <div className="px-3 py-2 text-[10px] text-white/40">No keywords added yet.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
                    {data.selectedKeywords.map((kw) => (
                      <span key={kw} className="text-[10px] text-white/70 bg-white/5 border border-white/10 rounded-full px-2 py-0.5">{kw}</span>
                    ))}
                  </div>
                )}
                <div className="px-3 py-2 border-t border-white/5 text-[9px] text-white/30 leading-relaxed">
                  Tip: keep your strongest keywords in the app title &amp; subtitle. Live search-volume data isn&apos;t available here.
                </div>
              </div>
            </div>

            {/* ASO Score Ring */}
            <div className="w-44 shrink-0 flex flex-col items-center gap-3 pt-4">
              <ASOScoreRing score={asoScore} />
              <div className="w-full space-y-2">
                {[
                  { label: 'Title', score: data.appName.length >= 10 ? 100 : Math.floor((data.appName.length / 10) * 100), weight: '40%' },
                  { label: 'Keywords', score: Math.min(100, Math.floor((data.selectedKeywords.length / 8) * 100)), weight: '30%' },
                  { label: 'Description', score: Math.min(100, Math.floor((data.fullDesc.length / 500) * 100)), weight: '20%' },
                  { label: 'Screenshots', score: Math.min(100, Math.floor((data.screenshots.filter(s => s).length / 5) * 100)), weight: '10%' },
                ].map(item => (
                  <div key={item.label}>
                    <div className="flex justify-between text-[9px] mb-0.5">
                      <span className="text-white/40">{item.label}</span>
                      <span className="text-white/30">{item.weight}</span>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${item.score >= 80 ? 'bg-emerald-500' : item.score >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${item.score}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Publish Checklist */}
        {activeTab === 4 && (
          <div className="p-5 space-y-4">
            {/* Readiness Banner */}
            <div className={`rounded-xl p-4 border flex items-center gap-3 ${readiness >= 80 ? 'bg-emerald-500/10 border-emerald-500/20' : readiness >= 50 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
              {readiness >= 80 ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" /> : <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />}
              <div>
                <p className={`text-sm font-semibold ${readiness >= 80 ? 'text-emerald-300' : readiness >= 50 ? 'text-amber-300' : 'text-red-300'}`}>
                  {readiness >= 80 ? '🎉 Ready to Publish!' : readiness >= 50 ? '⚡ Almost Ready' : '🔧 Some work remaining'}
                </p>
                <p className="text-xs text-white/40">{readiness}% checklist complete — {CHECKLIST_GROUPS.flatMap(g => g.items).filter(i => data.checklist[i.key]).length} / {CHECKLIST_GROUPS.flatMap(g => g.items).length} items done</p>
              </div>
              <div className="ml-auto text-2xl font-bold text-white">{readiness}%</div>
            </div>

            {/* Honest publishing path (admin autopsy 2026-07-21): this tool PREPARES your store
                listing (metadata + ASO + checklist + JSON export) — it does not upload to the stores.
                Real publishing needs signed builds + your store credentials. */}
            <div className="rounded-xl p-4 border border-indigo-500/20 bg-indigo-500/5 text-xs text-white/60 leading-relaxed">
              <p className="text-indigo-300 font-semibold mb-1">How publishing actually works</p>
              This tool prepares your listing (metadata, ASO, checklist) and exports it as JSON. The
              actual signed builds are produced by the repo&apos;s CI: <span className="text-white/80">Actions → &ldquo;Build Android App Bundle (.aab, signed)&rdquo;</span> for Google Play and
              <span className="text-white/80"> &ldquo;Build iOS App (.ipa)&rdquo;</span> for the App Store. Those need one-time signing keys &amp; store
              credentials set by an admin — then the admin uploads the build to Play Console / App Store Connect.
            </div>

            {/* Checklist Groups */}
            {CHECKLIST_GROUPS.map(group => (
              <div key={group.title} className="bg-[#161b22] border border-white/5 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
                  <group.icon className={`w-4 h-4 ${group.color}`} />
                  <p className="text-sm font-medium text-white">{group.title}</p>
                  <span className="ml-auto text-[10px] text-white/30">{group.items.filter(i => data.checklist[i.key]).length}/{group.items.length}</span>
                </div>
                <div className="divide-y divide-white/5">
                  {group.items.map(item => (
                    <label key={item.key} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/2 transition-colors group">
                      <div onClick={() => toggleCheckItem(item.key)} className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all cursor-pointer ${data.checklist[item.key] ? 'bg-emerald-500 border-emerald-500' : 'border-white/20 bg-transparent group-hover:border-white/40'}`}>
                        {data.checklist[item.key] && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <span className={`text-sm ${data.checklist[item.key] ? 'text-white/30 line-through' : 'text-white/60'}`}>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}

            <button onClick={exportData} className="w-full py-3 bg-rose-600 hover:bg-rose-500 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors">
              <Download className="w-4 h-4" /> Export All Metadata as JSON
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
