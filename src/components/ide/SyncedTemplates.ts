export interface SyncedProject {
  id: string;
  name: string;
  description: string;
  files: Record<string, string>;
}

export const TEMPLATE_PROJECTS: Record<string, SyncedProject> = {
  'my-ecommerce-app': {
    id: 'my-ecommerce-app',
    name: 'Saffron Craft E-Commerce',
    description: 'A premium handmade crafts and saffron storefront with shopping cart, filtering, and responsive checkout.',
    files: {
      'src/App.tsx': `import React, { useState } from 'react';
import { ShoppingBag, ArrowRight, Heart, Star, ShoppingCart, Trash2, X, Sparkles, ShieldCheck } from 'lucide-react';

interface Product {
  id: number;
  name: string;
  price: number;
  category: string;
  rating: number;
  image: string;
  desc: string;
}

const PRODUCTS: Product[] = [
  { id: 1, name: "Premium Kashmiri Organic Saffron (1g)", price: 29.99, category: "Saffron", rating: 4.9, image: "https://images.unsplash.com/photo-1615485290382-441e4d049cb5?auto=format&fit=crop&q=80&w=400", desc: "Handpicked premium organic saffron from the fields of Pampore." },
  { id: 2, name: "Terracotta Handcrafted Serving Bowl", price: 34.50, category: "Handicrafts", rating: 4.8, image: "https://images.unsplash.com/photo-1612196808214-b8e1d6145a8c?auto=format&fit=crop&q=80&w=400", desc: "Traditionally baked organic clay serving platter with floral details." },
  { id: 3, name: "Handicrafted Walnut Wood Jewelry Box", price: 49.00, category: "Woodwork", rating: 4.7, image: "https://images.unsplash.com/photo-1590736704728-f4730bb30770?auto=format&fit=crop&q=80&w=400", desc: "Intricately carved native walnut wood with velvet lining inside." },
  { id: 4, name: "Pure Saffron Infused Honey (250g)", price: 18.99, category: "Saffron", rating: 4.9, image: "https://images.unsplash.com/photo-1587049352846-4a222e784d38?auto=format&fit=crop&q=80&w=400", desc: "Pure Himalayan honey aged with organic saffron filaments." },
  { id: 5, name: "Pashmina Hand-woven Royal Shawl", price: 120.00, category: "Handicrafts", rating: 5.0, image: "https://images.unsplash.com/photo-1584030373081-f37b7bb4fa8e?auto=format&fit=crop&q=80&w=400", desc: "Genuine premium hand-woven Cashmere Pashmina artisan craft shawl." }
];

export default function App() {
  const [cart, setCart] = useState<{product: Product, qty: number}[]>([]);
  const [filter, setFilter] = useState<string>('All');
  const [showCart, setShowCart] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);

  const filtered = filter === 'All' ? PRODUCTS : PRODUCTS.filter(p => p.category === filter);

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item => item.product.id === product.id ? { ...item, qty: item.qty + 1 } : item);
      }
      return [...prev, { product, qty: 1 }];
    });
    setShowCart(true);
  };

  const removeFromCart = (id: number) => {
    setCart(prev => prev.filter(item => item.product.id !== id));
  };

  const updateQty = (id: number, amt: number) => {
    setCart(prev => prev.map(item => {
      if (item.product.id === id) {
        const nQ = item.qty + amt;
        return nQ > 0 ? { ...item, qty: nQ } : item;
      }
      return item;
    }));
  };

  const total = cart.reduce((sum, item) => sum + (item.product.price * item.qty), 0);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-800 font-sans">
      {/* Top Banner and Navigation */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="p-2 bg-amber-600 rounded-xl text-white">
              <ShoppingBag className="w-5 h-5" />
            </span>
            <span className="font-extrabold uppercase tracking-wider text-stone-900 text-base">Saffron & Craft Co.</span>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowCart(true)}
              className="p-2 relative bg-stone-100 hover:bg-stone-200 rounded-xl transition-all flex items-center gap-1.5 px-3"
            >
              <ShoppingCart className="w-4 h-4 text-stone-700" />
              <span className="text-xs font-black bg-amber-600 text-white rounded-full px-1.5 py-0.5">{cart.reduce((s, i) => s + i.qty, 0)}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Hero Banner */}
      <section className="bg-gradient-to-tr from-amber-900 via-stone-900 to-amber-950 text-white py-16 px-4 text-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#d97706_1px,transparent_1px)] [background-size:16px_16px]"></div>
        <div className="max-w-3xl mx-auto space-y-4 relative">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full text-xs font-black uppercase tracking-widest mx-auto">
            <Sparkles className="w-3.5 h-3.5" />
            Authentic Artisan Sourcing
          </div>
          <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tight leading-none">Organic Saffron & Native Handicrafts</h1>
          <p className="text-stone-300 text-xs md:text-sm max-w-xl mx-auto">
            100% pure organic harvesting exported globally from local farms. Direct fair-trade support for indigenous woodcarvers & terracotta potters.
          </p>
        </div>
      </section>

      {/* Filter and Shop Section */}
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between border-b border-stone-200 pb-4">
          <h2 className="text-lg font-black uppercase tracking-wide text-stone-900">Artisan Collections</h2>
          <div className="flex items-center gap-1.5">
            {['All', 'Saffron', 'Handicrafts', 'Woodwork'].map((cat) => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={\`px-3 py-1.5 rounded-lg text-xs font-bold transition-all \${filter === cat ? 'bg-amber-600 text-white' : 'bg-stone-200 hover:bg-stone-300 text-stone-700'}\`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Products Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {filtered.map(product => (
            <div key={product.id} className="bg-white border border-stone-200 rounded-2xl overflow-hidden hover:shadow-xl transition-all flex flex-col group">
              <div className="h-48 overflow-hidden bg-stone-100 relative">
                <img src={product.image} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                <span className="absolute top-3 left-3 bg-white/90 backdrop-blur-md px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-amber-800 border border-amber-800/10 rounded-full">
                  ★ {product.rating}
                </span>
              </div>
              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <div className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-stone-400">{product.category}</span>
                  <h3 className="text-sm font-black text-stone-900 line-clamp-1">{product.name}</h3>
                  <p className="text-xs text-stone-500 line-clamp-2 leading-relaxed">{product.desc}</p>
                </div>
                <div className="flex items-center justify-between pt-2">
                  <span className="text-base font-extrabold text-stone-900">\${product.price.toFixed(2)}</span>
                  <button 
                    onClick={() => addToCart(product)}
                    className="bg-stone-900 hover:bg-amber-600 text-white text-[10px] font-black uppercase tracking-wider py-2 px-3 rounded-xl transition-all cursor-pointer"
                  >
                    Add Component Bag
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Slide-over cart popup drawer */}
      {showCart && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex justify-end">
          <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col p-6 animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between border-b border-stone-200 pb-4">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-amber-600" />
                <span className="font-extrabold uppercase tracking-wide text-stone-900 text-sm">Your Saffron Basket</span>
              </div>
              <button onClick={() => setShowCart(false)} className="p-1 hover:bg-stone-100 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>

            {orderPlaced ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4 p-8">
                <div className="w-16 h-16 bg-emerald-100 rounded-full border border-emerald-300 flex items-center justify-center text-emerald-600">
                  <ShieldCheck className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-black uppercase tracking-tight text-stone-900">Artisan Order Booked!</h3>
                <p className="text-xs text-stone-500 leading-relaxed">
                  Your premium craft order has been safely placed. We have sent the confirmation packet containing transaction codes to your profile mailer.
                </p>
                <button 
                  onClick={() => { setOrderPlaced(false); setCart([]); setShowCart(false); }}
                  className="px-6 py-2.5 bg-stone-900 hover:bg-amber-600 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all"
                >
                  Continue Shopping
                </button>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto py-4 space-y-4">
                  {cart.length === 0 ? (
                    <div className="text-center py-12 space-y-2">
                      <ShoppingBag className="w-10 h-10 text-stone-300 mx-auto" />
                      <p className="text-xs font-bold text-stone-400">Your basket is entirely empty.</p>
                    </div>
                  ) : (
                    cart.map(item => (
                      <div key={item.product.id} className="flex gap-4 border-b border-stone-100 pb-4">
                        <div className="w-16 h-1d6 rounded-xl bg-stone-100 overflow-hidden shrink-0">
                          <img src={item.product.image} alt={item.product.name} className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1 flex flex-col justify-between">
                          <div>
                            <h4 className="text-xs font-black text-stone-900 truncate">{item.product.name}</h4>
                            <span className="text-[10px] text-stone-500">\${item.product.price.toFixed(2)} Each</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center border border-stone-200 rounded-lg">
                              <button onClick={() => updateQty(item.product.id, -1)} className="px-2 py-0.5 hover:bg-stone-50">-</button>
                              <span className="px-2.5 text-xs font-bold">{item.qty}</span>
                              <button onClick={() => updateQty(item.product.id, 1)} className="px-2 py-0.5 hover:bg-stone-50">+</button>
                            </div>
                            <button onClick={() => removeFromCart(item.product.id)} className="text-red-500 hover:text-red-700">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {cart.length > 0 && (
                  <div className="border-t border-stone-200 pt-4 space-y-3 shrink-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-stone-500">Subtotal</span>
                      <span className="text-lg font-extrabold text-stone-900">\${total.toFixed(2)}</span>
                    </div>
                    <button 
                      onClick={() => setOrderPlaced(true)}
                      className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg active:scale-95 flex items-center justify-center gap-1.5"
                    >
                      Safe Checkout Gateway
                      <ArrowRight className="w-4 h-4" />
                    </button>
                    <p className="text-[9px] text-[#8b949e] text-center">Protected under secure 256-bit SSL financial transaction tunnels.</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
`
    }
  },
  'mitrify': {
    id: 'mitrify',
    name: 'Mitrify Music Studio',
    description: 'A dark-themed premium music player UI with dynamic playlist control and media bar play slider.',
    files: {
      'src/App.tsx': `import React, { useState, useEffect } from 'react';
import { Play, Pause, SkipForward, SkipBack, Volume2, Search, Heart, Music, ListMusic, Sparkles, Disc, Layers } from 'lucide-react';

interface Track {
  id: number;
  title: string;
  artist: string;
  album: string;
  duration: string;
  cover: string;
}

const DECK_TRACKS: Track[] = [
  { id: 1, title: "Saffron Dawn Flow", artist: "Bharat Ambient", album: "Mystic Valley Recs", duration: "3:42", cover: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&q=80&w=200" },
  { id: 2, title: "Urban Sitar Echoes", artist: "Ravi Modernist", album: "Vedic Anthems Vol. 4", duration: "4:15", cover: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&q=80&w=200" },
  { id: 3, title: "Himalayan Breeze", artist: "Yogi Synthesizer", album: "Starlight Rituals", duration: "5:20", cover: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=200" },
  { id: 4, title: "Fintech Grid Pulse", artist: "Terminal Beats", album: "Node Runner Compilation", duration: "2:58", cover: "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&q=80&w=200" }
];

export default function App() {
  const [currentTrack, setCurrentTrack] = useState<Track>(DECK_TRACKS[0]);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(30);
  const [loved, setLoved] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let timer: any;
    if (isPlaying) {
      timer = setInterval(() => {
        setProgress(prev => (prev >= 100 ? 0 : prev + 1));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isPlaying]);

  const toggleLove = (id: number) => {
    setLoved(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleNext = () => {
    const idx = DECK_TRACKS.findIndex(t => t.id === currentTrack.id);
    const nextIdx = (idx + 1) % DECK_TRACKS.length;
    setCurrentTrack(DECK_TRACKS[nextIdx]);
    setProgress(0);
  };

  const handlePrev = () => {
    const idx = DECK_TRACKS.findIndex(t => t.id === currentTrack.id);
    const prevIdx = idx === 0 ? DECK_TRACKS.length - 1 : idx - 1;
    setCurrentTrack(DECK_TRACKS[prevIdx]);
    setProgress(0);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans flex flex-col">
      {/* Top Banner Header */}
      <header className="border-b border-white/5 bg-black/40 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Disc className="w-5 h-5 text-indigo-500 animate-spin" />
          <span className="font-sans font-black tracking-widest text-[#efeff1] text-sm uppercase">Mitrify Stream Studio</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded bg-indigo-500/15 border border-indigo-500/25 text-[9px] font-black uppercase text-indigo-400">
            Premium Audio Layer
          </span>
        </div>
      </header>

      {/* Main Split Interface */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left Side: Playlist Panel */}
        <aside className="w-80 border-r border-white/5 bg-neutral-900/40 p-4 space-y-4 shrink-0 flex flex-col justify-between hidden md:flex">
          <div className="space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
              <input 
                type="text" 
                placeholder="Search ambient track..." 
                className="w-full bg-neutral-950/80 border border-white/5 rounded-xl pl-9 pr-4 py-2 text-xs focus:outline-none focus:border-indigo-500/50"
              />
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-black text-neutral-500 uppercase tracking-widest block px-1">Curated Playlists</span>
              <div className="space-y-1">
                {DECK_TRACKS.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setCurrentTrack(t); setProgress(0); }}
                    className={\`w-full p-2.5 rounded-xl flex items-center gap-3 transition-all text-left group \${currentTrack.id === t.id ? 'bg-indigo-600/10 border border-indigo-500/30' : 'bg-transparent border border-transparent hover:bg-white/5'}\`}
                  >
                    <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0">
                      <img src={t.cover} alt="Cover" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold truncate group-hover:text-indigo-400">{t.title}</h4>
                      <p className="text-[10px] text-neutral-400 truncate mt-0.5">{t.artist}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Connected Device Card */}
          <div className="p-3 bg-neutral-950 rounded-2xl border border-white/5 space-y-2.5">
            <div className="flex items-center gap-2 text-[9px] font-black uppercase text-indigo-400">
              <Layers className="w-3.5 h-3.5" />
              Device Synced
            </div>
            <p className="text-[11px] text-neutral-400 leading-normal">
              Workspace speaker stream active over local virtual loop.
            </p>
          </div>
        </aside>

        {/* Right Side: Active Player Console */}
        <main className="flex-1 p-6 md:p-12 flex flex-col justify-center items-center relative overflow-y-auto">
          <div className="max-w-md w-full space-y-8 flex flex-col items-center">
            {/* Ambient Disk Glow */}
            <div className="relative">
              <div className="absolute inset-0 bg-indigo-500/25 rounded-full blur-3xl transform scale-110" />
              <div className={\`relative w-64 h-64 md:w-80 md:h-80 rounded-full border-4 border-neutral-800 p-8 shadow-2xl flex items-center justify-center bg-zinc-900 transition-transform duration-1000 \${isPlaying ? 'rotate-[360deg] duration-[12000ms] ease-linear infinite' : 'rotate-0'}\`}>
                <div className="w-full h-full rounded-full overflow-hidden border border-black/40 shadow-inner">
                  <img src={currentTrack.cover} alt="Disk" className="w-full h-full object-cover" />
                </div>
                {/* Center Spindle Hole */}
                <div className="absolute w-8 h-8 rounded-full bg-neutral-950 border border-neutral-700 flex items-center justify-center">
                  <div className="w-3 h-3 bg-zinc-900 rounded-full" />
                </div>
              </div>
            </div>

            {/* Title Block */}
            <div className="text-center space-y-1 w-full">
              <h1 className="text-xl md:text-2xl font-black tracking-tight">{currentTrack.title}</h1>
              <p className="text-sm text-[#8b949e] font-medium">{currentTrack.artist} — {currentTrack.album}</p>
            </div>

            {/* Media Control HUD */}
            <div className="w-full space-y-4">
              {/* Progress Slider Bar */}
              <div className="space-y-1">
                <div className="h-1.5 w-full bg-neutral-800 rounded-full overflow-hidden cursor-pointer relative">
                  <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all" style={{ width: \`\${progress}%\` }} />
                </div>
                <div className="flex justify-between text-[10px] text-neutral-500 font-mono">
                  <span>0:{(Math.floor(progress * 2.5) % 60).toString().padStart(2, '0')}</span>
                  <span>{currentTrack.duration}</span>
                </div>
              </div>

              {/* Player Toggles */}
              <div className="flex items-center justify-center gap-6">
                <button 
                  onClick={() => toggleLove(currentTrack.id)}
                  className={\`p-3 hover:bg-white/5 rounded-full transition-all \${loved[currentTrack.id] ? 'text-red-500' : 'text-neutral-400 hover:text-white'}\`}
                >
                  <Heart className="w-5 h-5 fill-current" />
                </button>

                <button onClick={handlePrev} className="p-3 text-neutral-400 hover:text-white bg-white/5 rounded-full transition-all active:scale-95">
                  <SkipBack className="w-5 h-5" />
                </button>

                <button 
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="p-5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full transition-all shadow-xl shadow-indigo-600/20 active:scale-90"
                >
                  {isPlaying ? <Pause className="w-6 h-6 fill-white" /> : <Play className="w-6 h-6 fill-white ml-0.5" />}
                </button>

                <button onClick={handleNext} className="p-3 text-neutral-400 hover:text-white bg-white/5 rounded-full transition-all active:scale-95">
                  <SkipForward className="w-5 h-5" />
                </button>

                <button className="p-3 text-neutral-400 hover:text-white bg-white/5 rounded-full transition-all">
                  <Volume2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
`
    }
  },
  'navbharat-dashboard': {
    id: 'navbharat-dashboard',
    name: 'Enterprise Analytics Engine',
    description: 'An administrative bento-grid panel with D3 metrics, system utilization graphs, and active mock console pipelines.',
    files: {
      'src/App.tsx': `import React, { useState } from 'react';
import { Sparkles, Cpu, Globe, ArrowUpRight, Search, Zap, RefreshCcw, Database, Cloud } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string;
  change: string;
  isUp: boolean;
  icon: React.ComponentType<any>;
}

function MetricCard({ label, value, change, isUp, icon: Icon }: MetricCardProps) {
  return (
    <div className="bg-[#161b22] border border-white/5 p-5 rounded-2xl space-y-3 relative group overflow-hidden">
      <div className="absolute top-0 right-0 w-16 h-16 bg-indigo-500/5 rounded-full blur-xl group-hover:bg-indigo-500/10 transition-all duration-300" />
      <div className="flex justify-between items-center">
        <span className="text-[10px] font-black text-[#8b949e] uppercase tracking-wider">{label}</span>
        <span className="p-2 bg-neutral-900 rounded-xl text-indigo-400 border border-white/5">
          <Icon className="w-4 h-4" />
        </span>
      </div>
      <div>
        <h4 className="text-xl font-extrabold text-white">{value}</h4>
        <div className="flex items-center gap-1.5 mt-1">
          <span className={\`text-[10px] font-bold \${isUp ? 'text-emerald-400' : 'text-rose-400'}\`}>
            {isUp ? '▲' : '▼'} {change}
          </span>
          <span className="text-[9px] text-[#484f58]">this current hour</span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [activeTab, setActiveTab2] = useState<string>('overview');

  const connections = [
    { ip: "192.168.1.109", region: "Mumbai, IN", latency: "14ms", load: "High", port: "3000" },
    { ip: "45.112.92.3", region: "Singapore, SG", latency: "28ms", load: "Normal", port: "443" },
    { ip: "102.32.18.25", region: "Frankfurt, DE", latency: "112ms", load: "Low", port: "8080" },
    { ip: "213.9.4.112", region: "Iowa, US", latency: "145ms", load: "Normal", port: "3000" }
  ];

  return (
    <div className="min-h-screen bg-[#07090e] text-white flex flex-col font-sans">
      {/* Header Container */}
      <header className="border-b border-white/5 bg-[#161b22]/50 backdrop-blur-md px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between shrink-0 gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-indigo-600 rounded-xl text-white shadow-lg shadow-indigo-600/15">
            <Database className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-sm font-black uppercase tracking-widest text-[#efeff1] leading-none">Enterprise Architect Panel</h1>
            <span className="text-[10px] text-indigo-400 tracking-wide font-medium mt-1 inline-block uppercase">Sovereign Cluster Controller</span>
          </div>
        </div>

        {/* Navigation tabs */}
        <div className="flex bg-[#0d1117] p-1 rounded-xl border border-white/5 shrink-0 select-none">
          {['overview', 'connections', 'pipelines'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab2(tab)}
              className={\`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer \${activeTab === tab ? 'bg-indigo-600/15 text-indigo-400 border border-indigo-500/20' : 'text-[#8b949e] hover:text-white hover:bg-white/5 border border-transparent'}\`}
            >
              {tab}
            </button>
          ))}
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6 overflow-y-auto no-scrollbar">
        {activeTab === 'overview' && (
          <>
            {/* Bento statistics grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <MetricCard label="Active Memory Workers" value="44.2 GB / 64 GB" change="8.4%" isUp={true} icon={Cpu} />
              <MetricCard label="Edge API Queries" value="1,248,890" change="12.2%" isUp={true} icon={Zap} />
              <MetricCard label="Virtual Databases" value="9 active pods" change="0.0%" isUp={true} icon={Cloud} />
              <MetricCard label="SSL Core Nodes" value="99.99%" change="0.02%" isUp={true} icon={Globe} />
            </div>

            {/* Charts section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Dynamic Chart Container */}
              <div className="bg-[#161b22] border border-white/5 rounded-2xl p-6 space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-black uppercase tracking-wider text-white">Edge Node Load Capacity</h3>
                  <button className="p-1.5 hover:bg-white/5 rounded-lg border border-white/5">
                    <RefreshCcw className="w-3.5 h-3.5 text-[#8b949e]" />
                  </button>
                </div>
                {/* SVG mock Chart */}
                <div className="h-48 flex items-end justify-between gap-1 border-b border-l border-white/5 pb-2 pl-2">
                  {[20, 45, 30, 80, 50, 95, 60, 40, 85, 90, 75, 100].map((h, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center">
                      <div className="w-full bg-gradient-to-t from-indigo-700 via-indigo-500 to-amber-500 rounded-t" style={{ height: \`\${h * 1.5}px\` }} />
                      <span className="text-[8px] font-mono text-[#8b949e] mt-1.5">T{i+1}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Serverless Live Log Terminal */}
              <div className="bg-black/90 border border-white/5 rounded-2xl p-6 flex flex-col justify-between h-full font-mono text-[10px] text-zinc-400 space-y-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-2xl" />
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <span className="text-[9px] font-sans font-black text-indigo-400 uppercase tracking-widest">Live telemetry pipeline logs</span>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
                    <span className="text-[8px] font-sans text-neutral-500 uppercase tracking-widest">ONLINE</span>
                  </div>
                </div>
                <div className="space-y-2 overflow-y-auto pr-1 flex-1 leading-relaxed max-h-[160px] no-scrollbar">
                  <div>[12:30:11] DB-PROD: Initializing virtual container core on port 3000...</div>
                  <div>[12:30:14] SYSTEM: SSL auth cert established for client 192.168.1.109.</div>
                  <div className="text-amber-400">[12:30:25] GATEWAY: Warning - High bandwidth throughput on Bombay interface.</div>
                  <div className="text-emerald-400">[12:31:01] DB-PROD: Database connection established securely (CORS true).</div>
                  <div>[12:32:15] NODE-SG: Edge routing cache flushed automatically.</div>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'connections' && (
          <div className="bg-[#161b22] border border-white/5 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-white">Cluster Active Connections</h3>
                <p className="text-[10px] text-[#8b949e] mt-0.5 font-medium">Verify edge nodes and direct loop clients securely in real-time.</p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
                <input 
                  type="text" 
                  placeholder="Filter nodes ip..." 
                  className="w-full bg-[#0d1117] border border-white/5 rounded-xl pl-9 pr-4 py-2 text-xs focus:outline-none focus:border-indigo-500/50"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-white/5 text-[9px] font-sans font-black text-neutral-500 uppercase tracking-wider bg-black/10">
                    <th className="p-4">IP Address</th>
                    <th className="p-4">Geographic Node</th>
                    <th className="p-4">Ping Latency</th>
                    <th className="p-4">Server Load</th>
                    <th className="p-4">Active Port</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {connections.map((c, i) => (
                    <tr key={i} className="hover:bg-white/5 transition-colors">
                      <td className="p-4 font-mono text-zinc-300 font-bold">{c.ip}</td>
                      <td className="p-4 font-medium text-white">{c.region}</td>
                      <td className="p-4 text-indigo-400 font-bold">{c.latency}</td>
                      <td className="p-4">
                        <span className={\`px-2 py-0.5 rounded-full text-[9px] font-black uppercase \${c.load === 'High' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : c.load === 'Normal' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}\`}>
                          {c.load}
                        </span>
                      </td>
                      <td className="p-4 font-mono text-neutral-500">{c.port}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Pipelines placeholder */}
        {activeTab === 'pipelines' && (
          <div className="p-12 border border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center text-center space-y-4">
            <Cloud className="w-12 h-12 text-zinc-500 animate-pulse" />
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-white uppercase tracking-wider">Pipelines Console</h4>
              <p className="text-[10.5px] text-[#8b949e] max-w-md mx-auto leading-relaxed font-semibold">
                CI/CD configuration established and managed by Vishwakarma DevOps orchestration layer naturally. There is no pending deployment queue.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
`
    }
  },
  'portfolio-site': {
    id: 'portfolio-site',
    name: 'Artisan Portfolio Canvas',
    description: 'A responsive visual profile with scroll anchors, bento grid experience, project cards, and active contacts form.',
    files: {
      'src/App.tsx': `import React, { useState } from 'react';
import { Mail, Github, Compass, Code, Layers, MessageSquare, ArrowUpRight, CheckCircle2, ChevronRight, User } from 'lucide-react';

export default function App() {
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [activeTab, setActiveTab3] = useState('projects');

  const projects = [
    { name: "Saffron Craft Gateway", type: "Full stack SaaS", tag: "React, Tailwind, Node.js", desc: "A premium fair-trade merchant loop for organic Kashmiri farmers." },
    { name: "Mitrify Audio Studio", type: "Visual Widget UI", tag: "Typescript, Audio API, Glass", desc: "Slick immersive retro interface looping local audio loop feeds." },
    { name: "Cluster Analytics Pod", type: "Fintech Dashboard", tag: "D3, SVG, Docker Core", desc: "Admin portal graphing performance counters directly." }
  ];

  return (
    <div className="min-h-screen bg-stone-900 text-stone-100 flex flex-col font-sans selection:bg-amber-600 selection:text-white">
      {/* Visual Navigation header */}
      <header className="sticky top-0 z-50 bg-stone-900/80 backdrop-blur-md border-b border-stone-800">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Compass className="w-5 h-5 text-amber-500" />
            <span className="font-extrabold uppercase tracking-widest text-white text-xs">Arun Devs</span>
          </div>
          <nav className="flex items-center gap-5 text-[10px] font-black uppercase tracking-wider">
            <a href="#about" className="hover:text-amber-500 transition-colors">Biography</a>
            <a href="#projects" className="hover:text-amber-500 transition-colors">Portfolio</a>
            <a href="#contact" className="hover:text-amber-500 transition-colors">Write me</a>
          </nav>
        </div>
      </header>

      {/* Hero Presentation Card */}
      <section id="about" className="max-w-4xl mx-auto px-6 py-16 md:py-24 text-center space-y-6">
        <div className="w-20 h-20 rounded-2xl bg-amber-600/10 border border-amber-500/25 flex items-center justify-center text-amber-500 mx-auto shadow-inner">
          <User className="w-10 h-10" />
        </div>
        <div className="space-y-3">
          <span className="text-[10px] font-black uppercase text-amber-500 tracking-widest block">Senior Full-Stack Architect</span>
          <h1 className="text-3xl md:text-5xl font-black text-white leading-none uppercase tracking-tight">Designing Robust Digital Experiences</h1>
          <p className="text-stone-400 text-xs md:text-sm max-w-xl mx-auto leading-relaxed">
            I craft ultra-responsive web architectures using Next.js 15, React, and server-side virtualization engines. Guided by beautiful grids and modern typography.
          </p>
        </div>
        <div className="flex justify-center gap-3">
          <a href="#projects" className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-stone-950 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-amber-600/15">
            Active Workspace Projects
          </a>
          <a href="#contact" className="px-5 py-2.5 bg-stone-800 hover:bg-stone-700 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border border-stone-700">
            Secure Session Request
          </a>
        </div>
      </section>

      {/* Selected Works Portfolio Grid */}
      <section id="projects" className="bg-stone-950 py-16 border-t border-stone-800">
        <div className="max-w-5xl mx-auto px-6 space-y-8">
          <div className="border-b border-stone-800 pb-4">
            <h2 className="text-sm font-black uppercase text-white tracking-widest">Active Workspace Deployments</h2>
            <p className="text-[11px] text-stone-500 mt-0.5">Explore digital products fully synchronised by the Vishwakarma platform.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {projects.map((p, i) => (
              <div key={i} className="bg-stone-900 border border-stone-800 p-5 rounded-2xl hover:border-amber-500/40 hover:-translate-y-1 transition-all group flex flex-col justify-between h-56">
                <div className="space-y-2">
                  <div className="flex justify-between items-start">
                    <span className="text-[9px] font-black text-amber-500 uppercase tracking-wider">{p.type}</span>
                    <ArrowUpRight className="w-4 h-4 text-stone-600 group-hover:text-amber-500 transition-colors" />
                  </div>
                  <h3 className="text-xs md:text-sm font-black text-white">{p.name}</h3>
                  <p className="text-[10px] text-stone-400 leading-normal font-semibold">{p.desc}</p>
                </div>
                <div className="text-[9.5px] font-mono text-stone-600 border-t border-stone-800 pt-3 flex items-center gap-1.5 font-bold">
                  <Code className="w-3.5 h-3.5 text-stone-500" />
                  {p.tag}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Active Secure Contact Form Area */}
      <section id="contact" className="max-w-2xl mx-auto px-6 py-16 w-full space-y-6">
        <div className="text-center space-y-1.5">
          <h2 className="text-sm font-black uppercase text-white tracking-widest">Connect Workspace</h2>
          <p className="text-[11px] text-stone-400 font-semibold">Submit a message directly into our active database repository.</p>
        </div>

        {formSubmitted ? (
          <div className="p-6 bg-amber-600/5 border border-amber-500/20 rounded-2xl flex flex-col items-center text-center space-y-3 shadow-xl">
            <div className="w-12 h-12 bg-amber-500/10 rounded-full flex items-center justify-center text-amber-500 border border-amber-500/20">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="text-xs font-black uppercase text-white tracking-wider">Message Logged Successfully!</h3>
            <p className="text-[10px] text-stone-400 max-w-sm font-semibold leading-relaxed">
              Arun has safely stored your message parameters in local memory buffers. Expect our response in 24 business hours.
            </p>
            <button 
              onClick={() => setFormSubmitted(false)}
              className="mt-2.5 px-4 py-1.5 bg-stone-800 hover:bg-stone-700 text-white rounded-lg text-[9px] font-black uppercase transition-all"
            >
              Flush Form Buffers
            </button>
          </div>
        ) : (
          <form 
            onSubmit={(e) => { e.preventDefault(); setFormSubmitted(true); }}
            className="bg-stone-950 border border-stone-800 rounded-3xl p-6 md:p-8 space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1 text-left">
                <label className="text-[9px] font-black uppercase text-stone-400 tracking-wider">Name</label>
                <input required type="text" placeholder="Your name" className="w-full bg-stone-900 border border-stone-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500/50" />
              </div>
              <div className="space-y-1 text-left">
                <label className="text-[9px] font-black uppercase text-stone-400 tracking-wider">Email Address</label>
                <input required type="email" placeholder="email@address.com" className="w-full bg-stone-900 border border-stone-800 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500/50" />
              </div>
            </div>
            <div className="space-y-1 text-left">
              <label className="text-[9px] font-black uppercase text-stone-400 tracking-wider">Message Content</label>
              <textarea required rows={4} placeholder="Describe your web design requirements..." className="w-full bg-stone-900 border border-stone-800 rounded-xl p-3 text-xs text-white resize-none focus:outline-none focus:border-amber-500/50 text-left font-serif leading-relaxed" />
            </div>
            <button type="submit" className="w-full py-3.5 bg-amber-600 hover:bg-amber-500 text-stone-950 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all shadow-lg shadow-amber-600/10">
              Submit Message Buffer
              <ChevronRight className="w-4 h-4" />
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
`
    }
  }
};
