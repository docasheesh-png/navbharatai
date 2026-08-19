import React, { useState, useEffect } from 'react';
import { Languages, Globe, Plus, Trash2, Check, X, Copy, Download, Search, Edit2, ChevronRight, RefreshCw, Upload, FileCode } from 'lucide-react';

interface TranslationKey {
  key: string;
  values: Record<string, string>;
}

interface Language {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
  rtl?: boolean;
}

const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिंदी', flag: '🇮🇳' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', flag: '🇮🇳' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', flag: '🇮🇳' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', flag: '🇮🇳' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', flag: '🇮🇳' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', flag: '🇮🇳' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', flag: '🇮🇳' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', flag: '🇮🇳' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', flag: '🇮🇳' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', flag: '🇵🇰', rtl: true },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', rtl: true },
  { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
];

// Sample auto-translations for common strings
const AUTO_TRANSLATIONS: Record<string, Record<string, string>> = {
  welcome: { en: 'Welcome', hi: 'स्वागत है', ta: 'வரவேற்கிறோம்', bn: 'স্বাগত', te: 'స్వాగతం', mr: 'स्वागत आहे', gu: 'સ્વાગત છે', kn: 'ಸ್ವಾಗತ', ml: 'സ്വാഗതം', pa: 'ਜੀ ਆਇਆਂ', ur: 'خوش آمدید', es: 'Bienvenido', fr: 'Bienvenue', de: 'Willkommen', ar: 'مرحباً', zh: '欢迎', ja: 'ようこそ', ko: '환영합니다' },
  login: { en: 'Login', hi: 'लॉगिन करें', ta: 'உள்நுழை', bn: 'লগইন', te: 'లాగిన్', mr: 'लॉगिन', gu: 'લૉગ ઇન', kn: 'ಲಾಗಿನ್', ml: 'ലോഗിൻ', pa: 'ਲੌਗਇਨ', ur: 'لاگ ان', es: 'Iniciar sesión', fr: 'Connexion', de: 'Anmelden', ar: 'تسجيل الدخول', zh: '登录', ja: 'ログイン', ko: '로그인' },
  logout: { en: 'Logout', hi: 'लॉगआउट', ta: 'வெளியேறு', bn: 'লগআউট', te: 'లాగ్ అవుట్', mr: 'लॉगआउट', gu: 'લૉગ આઉટ', kn: 'ಲಾಗ್ ಔಟ್', ml: 'ലോഗ് ഔട്ട്', pa: 'ਲੌਗਆਉਟ', ur: 'لاگ آؤٹ', es: 'Cerrar sesión', fr: 'Déconnexion', de: 'Abmelden', ar: 'تسجيل الخروج', zh: '登出', ja: 'ログアウト', ko: '로그아웃' },
  submit: { en: 'Submit', hi: 'जमा करें', ta: 'சமர்ப்பி', bn: 'জমা দিন', te: 'సమర్పించు', mr: 'सबमिट करा', gu: 'સબમિટ કરો', kn: 'ಸಲ್ಲಿಸು', ml: 'സമർപ്പിക്കുക', pa: 'ਜਮ੍ਹਾ ਕਰੋ', ur: 'جمع کریں', es: 'Enviar', fr: 'Soumettre', de: 'Absenden', ar: 'إرسال', zh: '提交', ja: '送信', ko: '제출' },
  cancel: { en: 'Cancel', hi: 'रद्द करें', ta: 'ரத்துசெய்', bn: 'বাতিল', te: 'రద్దు చేయి', mr: 'रद्द करा', gu: 'રદ કરો', kn: 'ರದ್ದುಮಾಡು', ml: 'റദ്ദാക്കുക', pa: 'ਰੱਦ ਕਰੋ', ur: 'منسوخ کریں', es: 'Cancelar', fr: 'Annuler', de: 'Abbrechen', ar: 'إلغاء', zh: '取消', ja: 'キャンセル', ko: '취소' },
  save: { en: 'Save', hi: 'सहेजें', ta: 'சேமி', bn: 'সংরক্ষণ', te: 'సేవ్ చేయి', mr: 'जतन करा', gu: 'સાચવો', kn: 'ಉಳಿಸು', ml: 'സേവ് ചെയ്യുക', pa: 'ਸੁਰੱਖਿਅਤ ਕਰੋ', ur: 'محفوظ کریں', es: 'Guardar', fr: 'Enregistrer', de: 'Speichern', ar: 'حفظ', zh: '保存', ja: '保存', ko: '저장' },
  search: { en: 'Search', hi: 'खोजें', ta: 'தேடு', bn: 'অনুসন্ধান', te: 'వెతుకు', mr: 'शोधा', gu: 'શોધો', kn: 'ಹುಡುಕು', ml: 'തിരയുക', pa: 'ਖੋਜੋ', ur: 'تلاش کریں', es: 'Buscar', fr: 'Rechercher', de: 'Suchen', ar: 'بحث', zh: '搜索', ja: '検索', ko: '검색' },
  settings: { en: 'Settings', hi: 'सेटिंग्स', ta: 'அமைப்புகள்', bn: 'সেটিংস', te: 'సెట్టింగులు', mr: 'सेटिंग्ज', gu: 'સેટિંગ્સ', kn: 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು', ml: 'ക്രമീകരണങ്ങൾ', pa: 'ਸੈਟਿੰਗਾਂ', ur: 'ترتیبات', es: 'Configuración', fr: 'Paramètres', de: 'Einstellungen', ar: 'الإعدادات', zh: '设置', ja: '設定', ko: '설정' },
  home: { en: 'Home', hi: 'होम', ta: 'முகப்பு', bn: 'হোম', te: 'హోమ్', mr: 'मुख्यपृष्ठ', gu: 'ઘર', kn: 'ಮನೆ', ml: 'ഹോം', pa: 'ਘਰ', ur: 'ہوم', es: 'Inicio', fr: 'Accueil', de: 'Startseite', ar: 'الرئيسية', zh: '首页', ja: 'ホーム', ko: '홈' },
  profile: { en: 'Profile', hi: 'प्रोफ़ाइल', ta: 'சுயவிவரம்', bn: 'প্রোফাইল', te: 'ప్రొఫైల్', mr: 'प्रोफाइल', gu: 'પ્રોફાઇલ', kn: 'ಪ್ರೊಫೈಲ್', ml: 'പ്രൊഫൈൽ', pa: 'ਪ੍ਰੋਫਾਈਲ', ur: 'پروفائل', es: 'Perfil', fr: 'Profil', de: 'Profil', ar: 'الملف الشخصي', zh: '个人资料', ja: 'プロフィール', ko: '프로필' },
  error: { en: 'Error occurred', hi: 'त्रुटि हुई', ta: 'பிழை ஏற்பட்டது', bn: 'ত্রুটি ঘটেছে', te: 'లోపం సంభవించింది', mr: 'त्रुटी आली', gu: 'ભૂલ આવી', kn: 'ದೋಷ ಸಂಭವಿಸಿದೆ', ml: 'പിശക് സംഭവിച്ചു', pa: 'ਗਲਤੀ ਆਈ', ur: 'خطا ہوئی', es: 'Ocurrió un error', fr: 'Une erreur s\'est produite', de: 'Fehler aufgetreten', ar: 'حدث خطأ', zh: '发生错误', ja: 'エラーが発生しました', ko: '오류가 발생했습니다' },
  loading: { en: 'Loading...', hi: 'लोड हो रहा है...', ta: 'ஏற்றுகிறது...', bn: 'লোড হচ্ছে...', te: 'లోడవుతోంది...', mr: 'लोड होत आहे...', gu: 'લોડ થઈ રહ્યું છે...', kn: 'ಲೋಡ್ ಆಗುತ್ತಿದೆ...', ml: 'ലോഡ് ചെയ്യുന്നു...', pa: 'ਲੋਡ ਹੋ ਰਿਹਾ ਹੈ...', ur: 'لوڈ ہو رہا ہے...', es: 'Cargando...', fr: 'Chargement...', de: 'Lädt...', ar: 'جاري التحميل...', zh: '加载中...', ja: '読み込み中...', ko: '로딩 중...' },
};

const STORAGE_KEY = 'navbharat_localization';

export function LocalizationManager() {
  const [activeLanguages, setActiveLanguages] = useState<string[]>(['en', 'hi']);
  const [translationKeys, setTranslationKeys] = useState<TranslationKey[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingCell, setEditingCell] = useState<{ keyIdx: number; lang: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [newKeyInput, setNewKeyInput] = useState('');
  const [showAddKey, setShowAddKey] = useState(false);
  const [previewLang, setPreviewLang] = useState('hi');
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        setActiveLanguages(data.languages || ['en', 'hi']);
        setTranslationKeys(data.keys || getDefaultKeys());
      } else {
        setTranslationKeys(getDefaultKeys());
      }
    } catch { setTranslationKeys(getDefaultKeys()); }
  }, []);

  function getDefaultKeys(): TranslationKey[] {
    return Object.entries(AUTO_TRANSLATIONS).map(([key, values]) => ({ key, values }));
  }

  const persist = (langs: string[], keys: TranslationKey[]) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ languages: langs, keys })); } catch {}
  };

  const toggleLanguage = (code: string) => {
    if (code === 'en') return; // English always active
    const updated = activeLanguages.includes(code)
      ? activeLanguages.filter(l => l !== code)
      : [...activeLanguages, code];
    setActiveLanguages(updated);
    persist(updated, translationKeys);
  };

  const addKey = () => {
    const k = newKeyInput.trim().toLowerCase().replace(/\s+/g, '_');
    if (!k || translationKeys.find(t => t.key === k)) return;
    const values: Record<string, string> = {};
    activeLanguages.forEach(l => { values[l] = ''; });
    const updated = [...translationKeys, { key: k, values }];
    setTranslationKeys(updated);
    persist(activeLanguages, updated);
    setNewKeyInput('');
    setShowAddKey(false);
  };

  const deleteKey = (key: string) => {
    const updated = translationKeys.filter(t => t.key !== key);
    setTranslationKeys(updated);
    persist(activeLanguages, updated);
  };

  const startEdit = (keyIdx: number, lang: string) => {
    setEditingCell({ keyIdx, lang });
    setEditValue(translationKeys[keyIdx].values[lang] || '');
  };

  const saveEdit = () => {
    if (!editingCell) return;
    const updated = translationKeys.map((t, i) =>
      i === editingCell.keyIdx ? { ...t, values: { ...t.values, [editingCell.lang]: editValue } } : t
    );
    setTranslationKeys(updated);
    persist(activeLanguages, updated);
    setEditingCell(null);
  };

  // Fills the translations we genuinely KNOW: AUTO_TRANSLATIONS is a real, hand-checked dictionary of
  // common UI strings (welcome/login/save/…) in 18 languages. It is a synchronous lookup — there is no
  // model call, so there is no artificial delay pretending one happened (that fake 800ms + "Translating…"
  // spinner was removed 2026-08-19). Keys we do not recognise are left for the user to translate.
  const autoTranslate = () => {
    const updated = translationKeys.map(tk => {
      const known = AUTO_TRANSLATIONS[tk.key];
      if (!known) return tk;
      const newValues = { ...tk.values };
      activeLanguages.forEach(lang => {
        if (!newValues[lang] && known[lang]) newValues[lang] = known[lang];
        if (!newValues[lang] && known['en']) newValues[lang] = known['en']; // fallback to English
      });
      return { ...tk, values: newValues };
    });
    setTranslationKeys(updated);
    persist(activeLanguages, updated);
  };

  const exportLang = (lang: string) => {
    const obj: Record<string, string> = {};
    translationKeys.forEach(tk => { obj[tk.key] = tk.values[lang] || ''; });
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${lang}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportAll = () => {
    const all: Record<string, Record<string, string>> = {};
    activeLanguages.forEach(lang => {
      all[lang] = {};
      translationKeys.forEach(tk => { all[lang][tk.key] = tk.values[lang] || ''; });
    });
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'translations.json'; a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = () => {
    try {
      const json = JSON.parse(importText);
      const newKeys: TranslationKey[] = Object.entries(json).map(([key, val]) => ({
        key,
        values: typeof val === 'object' && val !== null ? (val as Record<string, string>) : { en: String(val) },
      }));
      const merged = [...translationKeys];
      newKeys.forEach(nk => {
        const existing = merged.findIndex(t => t.key === nk.key);
        if (existing >= 0) merged[existing] = { ...merged[existing], values: { ...merged[existing].values, ...nk.values } };
        else merged.push(nk);
      });
      setTranslationKeys(merged);
      persist(activeLanguages, merged);
      setImportText('');
      setShowImport(false);
    } catch { alert('Invalid JSON. Check your file.'); }
  };

  const copyUsageCode = (key: string) => {
    const code = `t('${key}')`;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    });
  };

  const filtered = translationKeys.filter(tk =>
    !searchQuery || tk.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
    Object.values(tk.values).some(v => v.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const completionRate = (lang: string) => {
    if (translationKeys.length === 0) return 0;
    const filled = translationKeys.filter(tk => tk.values[lang]?.trim()).length;
    return Math.round((filled / translationKeys.length) * 100);
  };

  const previewLangObj = SUPPORTED_LANGUAGES.find(l => l.code === previewLang);

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-[#161b22]">
        <div className="w-10 h-10 bg-amber-600/20 rounded-xl flex items-center justify-center">
          <Languages className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h2 className="font-semibold text-white text-base">Localization Manager</h2>
          <p className="text-xs text-white/40">Translate your app into multiple languages — 18 languages supported</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowImport(!showImport)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#0d1117] border border-white/10 rounded-lg text-white/50 hover:text-white transition-all">
            <Upload className="w-3.5 h-3.5" /> Import JSON
          </button>
          <button onClick={exportAll} className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#0d1117] border border-white/10 rounded-lg text-white/50 hover:text-white transition-all">
            <Download className="w-3.5 h-3.5" /> Export All
          </button>
        </div>
      </div>

      {/* Import Panel */}
      {showImport && (
        <div className="px-6 py-3 border-b border-white/5 bg-[#161b22]">
          <div className="flex gap-2">
            <textarea
              className="flex-1 bg-[#0d1117] border border-white/10 rounded-xl p-2.5 text-xs font-mono text-white/70 resize-none focus:outline-none focus:border-amber-500/50"
              rows={3}
              placeholder='{"welcome": {"en": "Welcome", "hi": "स्वागत है"}, ...}'
              value={importText}
              onChange={e => setImportText(e.target.value)}
            />
            <div className="flex flex-col gap-1.5">
              <button onClick={importJson} disabled={!importText.trim()} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 rounded-lg text-xs transition-all">Import</button>
              <button onClick={() => setShowImport(false)} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs text-white/40">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Language Panel */}
        <div className="w-52 flex flex-col border-r border-white/5 overflow-y-auto">
          <div className="p-3 border-b border-white/5">
            <button
              onClick={autoTranslate}
              title="Fills the built-in translations for common UI strings (Welcome, Login, Save, Search…) across every active language. Strings it doesn't recognise are left for you to translate."
              className="w-full py-2 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 rounded-xl text-xs text-amber-300 flex items-center justify-center gap-1.5 transition-all"
            >
              <Languages className="w-3.5 h-3.5" /> Fill common strings
            </button>
          </div>

          <div className="p-2 space-y-1">
            {SUPPORTED_LANGUAGES.map(lang => {
              const isActive = activeLanguages.includes(lang.code);
              const rate = completionRate(lang.code);
              return (
                <div
                  key={lang.code}
                  className={`flex items-center gap-2 p-2 rounded-xl cursor-pointer transition-all ${isActive ? 'bg-[#161b22] border border-white/5' : 'opacity-40 hover:opacity-70'}`}
                  onClick={() => toggleLanguage(lang.code)}
                >
                  <span className="text-base">{lang.flag}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium text-white truncate">{lang.name}</span>
                      {lang.rtl && <span className="text-[7px] text-amber-400 bg-amber-500/10 px-1 rounded">RTL</span>}
                    </div>
                    {isActive && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${rate === 100 ? 'bg-emerald-500' : rate > 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${rate}%` }} />
                        </div>
                        <span className="text-[8px] text-white/30">{rate}%</span>
                      </div>
                    )}
                  </div>
                  {isActive && lang.code !== 'en' && (
                    <button onClick={e => { e.stopPropagation(); exportLang(lang.code); }} className="p-0.5 text-white/20 hover:text-white/60">
                      <Download className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Main: Translation Table */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-[#161b22]">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30" />
              <input
                className="w-full bg-[#0d1117] border border-white/10 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder-white/20 focus:outline-none focus:border-amber-500/50"
                placeholder="Search keys..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <button onClick={() => setShowAddKey(!showAddKey)} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-amber-600/20 border border-amber-500/30 rounded-lg text-amber-300 hover:bg-amber-600/30 transition-all">
              <Plus className="w-3.5 h-3.5" /> Add Key
            </button>
            <span className="text-xs text-white/30 ml-auto">{translationKeys.length} keys</span>
          </div>

          {/* Add Key row */}
          {showAddKey && (
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-amber-500/5">
              <input
                autoFocus
                className="bg-[#0d1117] border border-amber-500/30 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/20 focus:outline-none w-48"
                placeholder="New key (e.g. btn_pay)"
                value={newKeyInput}
                onChange={e => setNewKeyInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addKey(); if (e.key === 'Escape') { setShowAddKey(false); setNewKeyInput(''); } }}
              />
              <button onClick={addKey} disabled={!newKeyInput.trim()} className="p-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 rounded-lg"><Check className="w-3.5 h-3.5" /></button>
              <button onClick={() => { setShowAddKey(false); setNewKeyInput(''); }} className="p-1.5 bg-white/5 rounded-lg"><X className="w-3.5 h-3.5 text-white/40" /></button>
            </div>
          )}

          {/* Table */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs border-collapse min-w-0">
              <thead className="sticky top-0 bg-[#161b22] z-10">
                <tr className="border-b border-white/5">
                  <th className="text-left px-3 py-2 text-[10px] text-white/30 uppercase tracking-wider w-36 font-normal">Key</th>
                  {activeLanguages.map(lang => {
                    const l = SUPPORTED_LANGUAGES.find(x => x.code === lang);
                    return (
                      <th key={lang} className="text-left px-2 py-2 text-[10px] text-white/30 font-normal min-w-[120px]">
                        <div className="flex items-center gap-1">
                          <span>{l?.flag}</span>
                          <span>{l?.name}</span>
                          <span className={`text-[8px] ml-auto ${completionRate(lang) === 100 ? 'text-emerald-400' : 'text-white/20'}`}>{completionRate(lang)}%</span>
                        </div>
                      </th>
                    );
                  })}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((tk, keyIdx) => {
                  const realIdx = translationKeys.findIndex(t => t.key === tk.key);
                  return (
                    <tr key={tk.key} className="border-b border-white/3 hover:bg-white/2 group">
                      <td className="px-3 py-2 font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className="text-white/60 truncate max-w-[100px]">{tk.key}</span>
                          <button onClick={() => copyUsageCode(tk.key)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                            {copied === tk.key ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5 text-white/30 hover:text-white/60" />}
                          </button>
                        </div>
                      </td>
                      {activeLanguages.map(lang => {
                        const isEditing = editingCell?.keyIdx === realIdx && editingCell?.lang === lang;
                        const val = tk.values[lang] || '';
                        const isRtl = SUPPORTED_LANGUAGES.find(l => l.code === lang)?.rtl;
                        return (
                          <td key={lang} className="px-1 py-1 min-w-[120px]">
                            {isEditing ? (
                              <input
                                autoFocus
                                className="w-full bg-[#0d1117] border border-amber-500/50 rounded-lg px-2 py-1 text-xs text-white focus:outline-none"
                                dir={isRtl ? 'rtl' : 'ltr'}
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={saveEdit}
                                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingCell(null); }}
                              />
                            ) : (
                              <div
                                onClick={() => startEdit(realIdx, lang)}
                                dir={isRtl ? 'rtl' : 'ltr'}
                                className={`px-2 py-1 rounded-lg cursor-text hover:bg-white/5 min-h-[26px] transition-colors ${val ? 'text-white/70' : 'text-white/20 italic'}`}
                              >
                                {val || '— translate —'}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-1 py-1">
                        <button onClick={() => deleteKey(tk.key)} className="opacity-0 group-hover:opacity-100 p-1 text-white/20 hover:text-red-400 transition-all">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Preview Panel */}
        <div className="w-52 flex flex-col border-l border-white/5">
          <div className="p-3 border-b border-white/5">
            <p className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Live Preview</p>
            <select
              className="w-full bg-[#0d1117] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none"
              value={previewLang}
              onChange={e => setPreviewLang(e.target.value)}
            >
              {activeLanguages.map(lang => {
                const l = SUPPORTED_LANGUAGES.find(x => x.code === lang);
                return <option key={lang} value={lang}>{l?.flag} {l?.name}</option>;
              })}
            </select>
          </div>
          <div className="flex-1 p-3 overflow-y-auto space-y-1.5" dir={previewLangObj?.rtl ? 'rtl' : 'ltr'}>
            {translationKeys.slice(0, 12).map(tk => (
              <div key={tk.key} className="bg-[#161b22] rounded-lg px-2.5 py-2 border border-white/5">
                <p className="text-[8px] text-white/20 mb-0.5">{tk.key}</p>
                <p className="text-[10px] text-white/80">{tk.values[previewLang] || tk.values['en'] || '—'}</p>
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-white/5">
            <div className="bg-[#161b22] rounded-xl p-2.5 border border-white/5 space-y-1">
              <p className="text-[9px] text-white/30 font-medium">Usage in Code</p>
              <pre className="text-[8px] font-mono text-emerald-300">{`import { useTranslation } from 'react-i18next';\n\nconst { t } = useTranslation();\n<p>{t('welcome')}</p>`}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
