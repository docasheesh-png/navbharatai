import React, { useState, useEffect } from 'react';
import { Wand2, Sparkles, Download, Palette, RefreshCw, Copy, Trash2, Clock, Layers, Star, Check, Image as ImageIcon } from 'lucide-react';

interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  style: string;
  size: string;
  timestamp: number;
}

interface Props {
  onImageGenerated?: (imageUrl: string, prompt: string) => void;
}

const STYLES = [
  { id: 'minimal', label: 'Minimal', desc: 'Clean & simple', emoji: '⬜' },
  { id: 'vibrant', label: 'Vibrant', desc: 'Bold colors', emoji: '🌈' },
  { id: 'dark', label: 'Dark', desc: 'Dark aesthetic', emoji: '🌑' },
  { id: 'gradient', label: 'Gradient', desc: 'Smooth gradients', emoji: '🌅' },
  { id: 'flat', label: 'Flat', desc: 'Flat design', emoji: '📐' },
  { id: '3d', label: '3D', desc: 'Three dimensional', emoji: '🎯' },
];

const SIZES = [
  { id: 'square', label: 'Square', w: 512, h: 512, desc: '512×512' },
  { id: 'wide', label: 'Wide / OG', w: 1200, h: 630, desc: '1200×630' },
  { id: 'portrait', label: 'Portrait', w: 400, h: 700, desc: '400×700' },
  { id: 'icon', label: 'App Icon', w: 192, h: 192, desc: '192×192' },
];

const QUICK_PROMPTS = [
  'Modern app logo',
  'Website banner',
  'App icon',
  'UI screenshot',
  'Illustration',
  'Avatar',
  'Background',
  'Thumbnail',
];

const COLOR_HINTS = [
  { color: '#6366f1', label: 'Indigo' },
  { color: '#10b981', label: 'Emerald' },
  { color: '#f59e0b', label: 'Amber' },
  { color: '#ef4444', label: 'Red' },
  { color: '#3b82f6', label: 'Blue' },
  { color: '#8b5cf6', label: 'Purple' },
];

const STYLE_ENHANCERS: Record<string, string> = {
  minimal: 'minimalist, clean white background, simple shapes, ',
  vibrant: 'vibrant colors, high contrast, bold, colorful, ',
  dark: 'dark background, neon accents, moody, cinematic, ',
  gradient: 'smooth gradient, colorful gradient background, ',
  flat: 'flat design, 2D, vector style, no shadows, ',
  '3d': '3D render, isometric, depth, shadows, realistic, ',
};

export function AIImageGenerator({ onImageGenerated }: Props) {
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('minimal');
  const [size, setSize] = useState('square');
  const [isLoading, setIsLoading] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [imageError, setImageError] = useState(false);
  const [history, setHistory] = useState<GeneratedImage[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('navbharat_image_history');
      if (saved) setHistory(JSON.parse(saved));
    } catch {}
  }, []);

  const saveHistory = (items: GeneratedImage[]) => {
    setHistory(items);
    try { localStorage.setItem('navbharat_image_history', JSON.stringify(items)); } catch {}
  };

  const handleGenerate = () => {
    if (!prompt.trim()) return;
    const selectedSize = SIZES.find(s => s.id === size) || SIZES[0];
    const enhancer = STYLE_ENHANCERS[style] || '';
    const fullPrompt = enhancer + prompt.trim();
    const seed = Math.floor(Math.random() * 999999);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=${selectedSize.w}&height=${selectedSize.h}&nologo=true&seed=${seed}`;
    setGeneratedUrl('');
    setImageError(false);
    setIsLoading(true);

    const img = new window.Image();
    img.onload = () => {
      setIsLoading(false);
      setGeneratedUrl(url);
      const newItem: GeneratedImage = {
        id: Date.now().toString(),
        url,
        prompt: prompt.trim(),
        style,
        size,
        timestamp: Date.now(),
      };
      const updated = [newItem, ...history].slice(0, 6);
      saveHistory(updated);
      if (onImageGenerated) onImageGenerated(url, prompt.trim());
    };
    img.onerror = () => {
      setIsLoading(false);
      setImageError(true);
    };
    img.src = url;
  };

  const handleEnhance = () => {
    const enhancer = STYLE_ENHANCERS[style] || '';
    if (!prompt.startsWith(enhancer)) {
      setPrompt(enhancer + prompt);
    }
  };

  const handleCopyUrl = () => {
    if (!generatedUrl) return;
    navigator.clipboard.writeText(generatedUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleClearHistory = () => {
    saveHistory([]);
    setGeneratedUrl('');
  };

  const relativeTime = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Abhi';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m pehle`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h pehle`;
    return `${Math.floor(diff / 86400000)}d pehle`;
  };

  const selectedSize = SIZES.find(s => s.id === size) || SIZES[0];

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-[#161b22]">
        <div className="w-10 h-10 bg-violet-600/20 rounded-xl flex items-center justify-center">
          <Wand2 className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <h2 className="font-semibold text-white text-base">AI Image Generator</h2>
          <p className="text-xs text-white/40">Prompt likhkar images generate karo — logos, banners, icons</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] bg-violet-500/20 text-violet-300 px-2 py-1 rounded-full border border-violet-500/30">Pollinations AI</span>
          <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-1 rounded-full border border-emerald-500/30">Free</span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel */}
        <div className="w-[60%] flex flex-col gap-4 p-5 overflow-y-auto border-r border-white/5">
          {/* Prompt */}
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Prompt</label>
            <textarea
              className="w-full bg-[#161b22] border border-white/10 rounded-xl p-3 text-sm text-white placeholder-white/20 resize-none focus:outline-none focus:border-violet-500/50 transition-colors"
              rows={4}
              placeholder="Describe karo kya banana hai... e.g. 'Modern fintech app logo with blue gradient and rupee symbol'"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
            />
            <div className="flex items-center justify-between mt-2">
              <div className="flex flex-wrap gap-1.5">
                {QUICK_PROMPTS.map(q => (
                  <button
                    key={q}
                    onClick={() => setPrompt(q)}
                    className="text-[10px] px-2 py-0.5 bg-white/5 hover:bg-violet-500/20 rounded-full text-white/50 hover:text-violet-300 transition-colors border border-white/5"
                  >
                    {q}
                  </button>
                ))}
              </div>
              <button
                onClick={handleEnhance}
                className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1 shrink-0"
              >
                <Sparkles className="w-3 h-3" /> Enhance
              </button>
            </div>
          </div>

          {/* Style */}
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Style</label>
            <div className="grid grid-cols-3 gap-2">
              {STYLES.map(s => (
                <button
                  key={s.id}
                  onClick={() => setStyle(s.id)}
                  className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-all ${
                    style === s.id
                      ? 'border-violet-500/60 bg-violet-500/10'
                      : 'border-white/5 bg-[#161b22] hover:border-white/10'
                  }`}
                >
                  <span className="text-lg">{s.emoji}</span>
                  <div>
                    <div className="text-xs font-medium text-white">{s.label}</div>
                    <div className="text-[10px] text-white/30">{s.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Size */}
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Size / Format</label>
            <div className="grid grid-cols-4 gap-2">
              {SIZES.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSize(s.id)}
                  className={`flex flex-col items-center p-2.5 rounded-xl border text-center transition-all ${
                    size === s.id
                      ? 'border-violet-500/60 bg-violet-500/10'
                      : 'border-white/5 bg-[#161b22] hover:border-white/10'
                  }`}
                >
                  <div className={`mb-1 border border-white/20 ${
                    s.id === 'wide' ? 'w-8 h-4' : s.id === 'portrait' ? 'w-4 h-7' : 'w-5 h-5'
                  } rounded-sm`} />
                  <div className="text-[10px] font-medium text-white">{s.label}</div>
                  <div className="text-[9px] text-white/30">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Color Hints */}
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block flex items-center gap-1.5">
              <Palette className="w-3 h-3" /> Color Hints
            </label>
            <div className="flex gap-2">
              {COLOR_HINTS.map(c => (
                <button
                  key={c.color}
                  onClick={() => setPrompt(p => p + ` in ${c.label.toLowerCase()} tones`)}
                  title={`Add ${c.label}`}
                  className="w-7 h-7 rounded-full border-2 border-white/20 hover:scale-110 transition-transform"
                  style={{ backgroundColor: c.color }}
                />
              ))}
              <span className="text-xs text-white/30 self-center ml-1">Click to add to prompt</span>
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || isLoading}
            className="w-full py-3.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors mt-2"
          >
            {isLoading ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> Generating...</>
            ) : (
              <><Wand2 className="w-4 h-4" /> Generate Image</>
            )}
          </button>
        </div>

        {/* Right Panel */}
        <div className="flex-1 flex flex-col gap-4 p-5 overflow-y-auto">
          {/* Generated Image */}
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider mb-2 block">Generated Image</label>
            <div className="relative bg-[#161b22] border border-white/5 rounded-xl overflow-hidden" style={{ minHeight: '240px' }}>
              {isLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <div className="w-12 h-12 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-white/40">AI image generate ho raha hai...</p>
                  <p className="text-[10px] text-white/20">Size: {selectedSize.w}×{selectedSize.h}</p>
                </div>
              )}
              {!isLoading && imageError && (
                <div className="flex flex-col items-center justify-center h-60 gap-2">
                  <ImageIcon className="w-10 h-10 text-white/10" />
                  <p className="text-xs text-red-400">Image load nahi hui. Retry karo ya prompt change karo.</p>
                  <button onClick={handleGenerate} className="text-xs text-violet-400 hover:underline">Retry</button>
                </div>
              )}
              {!isLoading && !imageError && !generatedUrl && (
                <div className="flex flex-col items-center justify-center h-60 gap-2">
                  <Wand2 className="w-10 h-10 text-white/10" />
                  <p className="text-xs text-white/30">Prompt likhkar Generate dabao</p>
                </div>
              )}
              {!isLoading && !imageError && generatedUrl && (
                <>
                  <img
                    src={generatedUrl}
                    alt="Generated"
                    className="w-full object-cover rounded-xl"
                    onError={() => { setImageError(true); setGeneratedUrl(''); }}
                  />
                  <div className="absolute bottom-2 right-2 flex gap-1.5">
                    <button
                      onClick={handleCopyUrl}
                      className="p-1.5 bg-black/60 hover:bg-black/80 rounded-lg transition-colors"
                      title="Copy URL"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-white/70" />}
                    </button>
                    <a
                      href={generatedUrl}
                      download="navbharat-ai-image.jpg"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 bg-black/60 hover:bg-black/80 rounded-lg transition-colors"
                      title="Download"
                    >
                      <Download className="w-3.5 h-3.5 text-white/70" />
                    </a>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Recent History */}
          {history.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-3 h-3" /> Recent ({history.length})
                </label>
                <button onClick={handleClearHistory} className="text-[10px] text-white/30 hover:text-red-400 flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Clear
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {history.map(item => (
                  <button
                    key={item.id}
                    onClick={() => { setGeneratedUrl(item.url); setPrompt(item.prompt); setStyle(item.style); setSize(item.size); }}
                    className="group relative rounded-lg overflow-hidden border border-white/5 hover:border-violet-500/40 transition-all aspect-square bg-[#161b22]"
                  >
                    <img src={item.url} alt={item.prompt} className="w-full h-full object-cover" loading="lazy" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 p-1">
                      <p className="text-[8px] text-white text-center line-clamp-2">{item.prompt}</p>
                      <p className="text-[7px] text-white/50">{relativeTime(item.timestamp)}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tips */}
          <div className="bg-violet-500/5 border border-violet-500/10 rounded-xl p-3">
            <p className="text-xs text-violet-300 font-medium mb-1.5 flex items-center gap-1.5">
              <Star className="w-3 h-3" /> Pro Tips
            </p>
            <ul className="text-[10px] text-white/40 space-y-1">
              <li>• Specific prompts = better results ("blue gradient tech logo" not just "logo")</li>
              <li>• Style + Color hints add extra quality</li>
              <li>• "Enhance" button adds style-specific keywords automatically</li>
              <li>• Image URL directly use kar sakte ho img tag mein</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
