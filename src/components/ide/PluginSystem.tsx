import React, { useState, useEffect } from 'react';
import { Puzzle, Search, Zap, Check, X, Plus, Settings, Download, RefreshCw, Shield, Database, Globe, BarChart2, Layers, ChevronRight } from 'lucide-react';

interface Plugin {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  category: string;
  icon: string;
  stars: number;
  installs: number;
  free: boolean;
  popular: boolean;
  setupCode: string;
  configKeys: string[];
  tags: string[];
}

const PLUGINS: Plugin[] = [
  // Analytics
  { id: 'google-analytics', name: 'Google Analytics 4', author: 'Google', version: '4.0.0', description: 'Track user behavior, page views, events and conversions with GA4', category: 'Analytics', icon: '📊', stars: 4.8, installs: 125000, free: true, popular: true, setupCode: `<!-- GA4 Tag -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>`, configKeys: ['GA4_MEASUREMENT_ID'], tags: ['analytics', 'tracking'] },

  { id: 'hotjar', name: 'Hotjar Heatmaps', author: 'Hotjar', version: '3.2.1', description: 'User heatmaps, session recordings and feedback polls', category: 'Analytics', icon: '🔥', stars: 4.5, installs: 45000, free: false, popular: true, setupCode: `<!-- Hotjar Tracking Code -->
<script>
  (function(h,o,t,j,a,r){
    h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};
    h._hjSettings={hjid: YOUR_HOTJAR_ID, hjsv:6};
    a=o.getElementsByTagName('head')[0];
    r=o.createElement('script');r.async=1;
    r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;
    a.appendChild(r);
  })(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');
</script>`, configKeys: ['HOTJAR_ID'], tags: ['heatmap', 'ux'] },

  { id: 'mixpanel', name: 'Mixpanel Events', author: 'Mixpanel', version: '2.47.0', description: 'Product analytics — track custom events, funnels, retention', category: 'Analytics', icon: '📈', stars: 4.4, installs: 32000, free: false, popular: false, setupCode: `import mixpanel from 'mixpanel-browser';
mixpanel.init(process.env.MIXPANEL_TOKEN, { debug: false });

// Track event:
mixpanel.track('Button Clicked', { button: 'signup', page: 'home' });`, configKeys: ['MIXPANEL_TOKEN'], tags: ['events', 'funnel'] },

  { id: 'clarity', name: 'Microsoft Clarity', author: 'Microsoft', version: '1.0.0', description: 'Free session recordings and heatmaps — no data limits', category: 'Analytics', icon: '🎯', stars: 4.6, installs: 78000, free: true, popular: true, setupCode: `<script type="text/javascript">
  (function(c,l,a,r,i,t,y){
    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
  })(window,document,"clarity","script","YOUR_CLARITY_ID");
</script>`, configKeys: ['CLARITY_ID'], tags: ['heatmap', 'sessions', 'free'] },

  // Auth
  { id: 'firebase-auth-plugin', name: 'Firebase Auth UI', author: 'Firebase', version: '6.0.0', description: 'Pre-built auth UI — Google, Facebook, Twitter, GitHub login', category: 'Authentication', icon: '🔐', stars: 4.7, installs: 95000, free: true, popular: true, setupCode: `import * as firebaseui from 'firebaseui';

const ui = new firebaseui.auth.AuthUI(firebase.auth());
ui.start('#firebaseui-auth-container', {
  signInOptions: [
    firebase.auth.GoogleAuthProvider.PROVIDER_ID,
    firebase.auth.EmailAuthProvider.PROVIDER_ID,
    firebase.auth.PhoneAuthProvider.PROVIDER_ID,
  ],
  signInSuccessUrl: '/dashboard',
});`, configKeys: ['FIREBASE_API_KEY'], tags: ['auth', 'google', 'social'] },

  { id: 'clerk', name: 'Clerk Auth', author: 'Clerk', version: '4.29.0', description: 'Complete user management — beautiful pre-built auth components', category: 'Authentication', icon: '🔑', stars: 4.8, installs: 55000, free: false, popular: true, setupCode: `import { ClerkProvider, SignIn, UserButton } from '@clerk/nextjs';

// Wrap your app:
<ClerkProvider publishableKey={process.env.CLERK_PUBLISHABLE_KEY}>
  <App />
</ClerkProvider>

// Components:
<SignIn />  // Sign in page
<UserButton />  // Avatar + dropdown`, configKeys: ['CLERK_PUBLISHABLE_KEY'], tags: ['auth', 'ui-components'] },

  // Payment
  { id: 'razorpay-plugin', name: 'Razorpay Checkout', author: 'Razorpay', version: '1.6.0', description: 'India\'s best payment gateway — UPI, cards, EMI and more', category: 'Payments', icon: '💳', stars: 4.6, installs: 68000, free: false, popular: true, setupCode: `// Load Razorpay script
const script = document.createElement('script');
script.src = 'https://checkout.razorpay.com/v1/checkout.js';
document.body.appendChild(script);

const rzp = new window.Razorpay({
  key: process.env.RAZORPAY_KEY_ID,
  amount: 49900, // ₹499 in paise
  currency: 'INR',
  handler: (res) => console.log('Paid!', res.razorpay_payment_id)
});
rzp.open();`, configKeys: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'], tags: ['payment', 'india', 'upi'] },

  { id: 'stripe-plugin', name: 'Stripe Payments', author: 'Stripe', version: '3.5.0', description: 'Global payments — cards, wallets, subscriptions', category: 'Payments', icon: '💰', stars: 4.9, installs: 110000, free: false, popular: true, setupCode: `import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(process.env.STRIPE_PUBLISHABLE_KEY);

<Elements stripe={stripePromise}>
  <CheckoutForm />
</Elements>`, configKeys: ['STRIPE_PUBLISHABLE_KEY', 'STRIPE_SECRET_KEY'], tags: ['payment', 'global', 'subscription'] },

  // Storage
  { id: 'cloudinary-plugin', name: 'Cloudinary Media', author: 'Cloudinary', version: '2.5.0', description: 'Image/video upload, optimize and deliver — CDN included', category: 'Storage', icon: '🖼️', stars: 4.5, installs: 42000, free: true, popular: true, setupCode: `import { CldUploadWidget, CldImage } from 'next-cloudinary';

<CldUploadWidget uploadPreset="your_preset">
  {({ open }) => (
    <button onClick={() => open()}>Upload Image</button>
  )}
</CldUploadWidget>

<CldImage src="public_id" width="500" height="300" alt="Image" />`, configKeys: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY'], tags: ['images', 'cdn', 'upload'] },

  { id: 'supabase-storage', name: 'Supabase Storage', author: 'Supabase', version: '2.38.0', description: 'S3-compatible file storage with access controls', category: 'Storage', icon: '📦', stars: 4.6, installs: 38000, free: true, popular: false, setupCode: `const { data, error } = await supabase.storage
  .from('avatars')
  .upload('public/avatar.png', file, {
    cacheControl: '3600',
    upsert: false
  });

// Get public URL:
const { data: { publicUrl } } = supabase.storage
  .from('avatars')
  .getPublicUrl('public/avatar.png');`, configKeys: ['SUPABASE_URL', 'SUPABASE_ANON_KEY'], tags: ['storage', 's3', 'files'] },

  // UI
  { id: 'shadcn', name: 'shadcn/ui Components', author: 'shadcn', version: '0.8.0', description: 'Beautiful, accessible React components — ready to copy-paste', category: 'UI Library', icon: '🎨', stars: 5.0, installs: 200000, free: true, popular: true, setupCode: `npx shadcn-ui@latest init

# Add components:
npx shadcn-ui@latest add button
npx shadcn-ui@latest add dialog
npx shadcn-ui@latest add input

# Usage:
import { Button } from "@/components/ui/button"
<Button variant="outline">Click me</Button>`, configKeys: [], tags: ['ui', 'components', 'tailwind'] },

  { id: 'framer-motion', name: 'Framer Motion', author: 'Framer', version: '11.0.0', description: 'Smooth animations and gestures — production-grade React animations', category: 'UI Library', icon: '✨', stars: 4.9, installs: 180000, free: true, popular: true, setupCode: `import { motion, AnimatePresence } from 'framer-motion';

<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0 }}
  transition={{ duration: 0.3 }}
>
  Hello!
</motion.div>`, configKeys: [], tags: ['animation', 'gestures', 'ui'] },

  // Performance
  { id: 'swr', name: 'SWR Data Fetching', author: 'Vercel', version: '2.2.5', description: 'Stale-while-revalidate data fetching — caching, revalidation, deduplication', category: 'Performance', icon: '⚡', stars: 4.8, installs: 150000, free: true, popular: true, setupCode: `import useSWR from 'swr';

const fetcher = (url) => fetch(url).then(r => r.json());

function UserProfile() {
  const { data, error, isLoading } = useSWR('/api/user', fetcher);

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error!</div>;
  return <div>{data.name}</div>;
}`, configKeys: [], tags: ['data-fetching', 'cache', 'react'] },

  { id: 'react-query', name: 'TanStack Query', author: 'TanStack', version: '5.0.0', description: 'Powerful async state management — best for server state', category: 'Performance', icon: '🔄', stars: 4.9, installs: 170000, free: true, popular: true, setupCode: `import { useQuery, useMutation, QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

// Wrap app:
<QueryClientProvider client={queryClient}>
  <App />
</QueryClientProvider>

// Component mein:
const { data } = useQuery({ queryKey: ['users'], queryFn: fetchUsers });`, configKeys: [], tags: ['state', 'server-state', 'cache'] },

  // Security
  { id: 'recaptcha', name: 'reCAPTCHA v3', author: 'Google', version: '3.0.0', description: 'Invisible bot protection — for forms and sensitive actions', category: 'Security', icon: '🛡️', stars: 4.3, installs: 88000, free: true, popular: true, setupCode: `import { useGoogleReCaptcha } from 'react-google-recaptcha-v3';

const { executeRecaptcha } = useGoogleReCaptcha();

const handleSubmit = async () => {
  const token = await executeRecaptcha('submit');
  // Send token to backend for verification
  await fetch('/api/verify', { method: 'POST', body: JSON.stringify({ token }) });
};`, configKeys: ['RECAPTCHA_SITE_KEY'], tags: ['security', 'bot-protection', 'forms'] },

  { id: 'zod', name: 'Zod Validation', author: 'Colin McDonnell', version: '3.22.0', description: 'TypeScript-first schema validation — safe and declarative', category: 'Security', icon: '✅', stars: 4.9, installs: 220000, free: true, popular: true, setupCode: `import { z } from 'zod';

// Define your schema:
const UserSchema = z.object({
  name: z.string().min(2).max(50),
  email: z.string().email(),
  age: z.number().min(18).max(120),
});

// Validate:
const result = UserSchema.safeParse(formData);
if (!result.success) console.log(result.error.issues);`, configKeys: [], tags: ['validation', 'typescript', 'forms'] },
];

const CATEGORIES = ['All', 'Analytics', 'Authentication', 'Payments', 'Storage', 'UI Library', 'Performance', 'Security'];

export function PluginSystem({ onCodeInsert }: { onCodeInsert?: (code: string) => void } = {}) {
  const [installed, setInstalled] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('navbharat_plugins') || '[]'); } catch { return []; }
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null);
  const [copied, setCopied] = useState('');
  const [showInstalledOnly, setShowInstalledOnly] = useState(false);

  const persistInstalled = (list: string[]) => {
    setInstalled(list);
    try { localStorage.setItem('navbharat_plugins', JSON.stringify(list)); } catch {}
  };

  // ADD = actually insert the plugin's REAL setup code into the app (2026-08-19: previously "install"
  // only flipped a localStorage flag and did nothing to the app — a button that claimed to install but
  // did not). When there is no insert callback (e.g. opened standalone), it falls back to copying the
  // code so the action is never a no-op. The local list just remembers what was added, for the filter.
  const addPlugin = (plugin: Plugin) => {
    if (onCodeInsert) onCodeInsert('\n\n' + plugin.setupCode);
    else copyCode(plugin.setupCode);
    if (!installed.includes(plugin.id)) persistInstalled([...installed, plugin.id]);
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => { setCopied(code.slice(0, 30)); setTimeout(() => setCopied(''), 2000); });
  };

  const filtered = PLUGINS.filter(p => {
    if (showInstalledOnly && !installed.includes(p.id)) return false;
    if (selectedCategory !== 'All' && p.category !== selectedCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.tags.some(t => t.includes(q));
    }
    return true;
  });

  const catCounts: Record<string, number> = { All: PLUGINS.length };
  PLUGINS.forEach(p => { catCounts[p.category] = (catCounts[p.category] || 0) + 1; });

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 bg-[#161b22]">
        <div className="w-10 h-10 bg-violet-600/20 rounded-xl flex items-center justify-center">
          <Puzzle className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <h2 className="font-semibold text-white text-base">Plugin System</h2>
          <p className="text-xs text-white/40">{PLUGINS.length} integrations — add one to drop its real setup code into your app</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowInstalledOnly(!showInstalledOnly)} className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${showInstalledOnly ? 'border-violet-500/40 bg-violet-500/10 text-violet-300' : 'border-white/10 bg-white/5 text-white/40'}`}>
            <Check className="w-3 h-3" /> Installed ({installed.length})
          </button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="px-4 py-3 border-b border-white/5 bg-[#161b22] space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <input className="w-full bg-[#0d1117] border border-white/10 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50" placeholder="Search plugins..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setSelectedCategory(cat)} className={`shrink-0 text-[10px] px-2.5 py-1 rounded-full border transition-all whitespace-nowrap ${selectedCategory === cat ? 'border-violet-500/50 bg-violet-500/15 text-violet-300' : 'border-white/10 bg-white/5 text-white/40 hover:border-white/20'}`}>
              {cat} <span className="opacity-60">({catCounts[cat] || 0})</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Plugin Grid */}
        <div className="flex-1 overflow-y-auto p-3">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <Puzzle className="w-10 h-10 text-white/10" />
              <p className="text-sm text-white/30">{showInstalledOnly ? 'No plugins installed' : 'No plugins found'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {filtered.map(plugin => {
                const isInstalled = installed.includes(plugin.id);
                return (
                  <button key={plugin.id} onClick={() => setSelectedPlugin(plugin)} className={`text-left p-3.5 rounded-xl border transition-all ${selectedPlugin?.id === plugin.id ? 'border-violet-500/50 bg-violet-500/5' : 'border-white/5 bg-[#161b22] hover:border-white/10'}`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{plugin.icon}</span>
                        <div>
                          <p className="text-xs font-semibold text-white">{plugin.name}</p>
                          <p className="text-[9px] text-white/30">by {plugin.author} • v{plugin.version}</p>
                        </div>
                      </div>
                      <div className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${isInstalled ? 'bg-emerald-500/20 border border-emerald-500/40' : 'bg-white/5 border border-white/10'}`}>
                        {isInstalled ? <Check className="w-3 h-3 text-emerald-400" /> : <Plus className="w-3 h-3 text-white/30" />}
                      </div>
                    </div>
                    <p className="text-[10px] text-white/40 mb-2 line-clamp-2">{plugin.description}</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-md border ${plugin.free ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-amber-400 bg-amber-500/10 border-amber-500/20'}`}>{plugin.free ? 'Free' : 'Paid'}</span>
                      <span className="text-[9px] text-white/20 ml-auto">{plugin.category}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Plugin Detail */}
        <div className="w-[40%] border-l border-white/5 flex flex-col overflow-hidden">
          {!selectedPlugin ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
              <Puzzle className="w-12 h-12 text-white/5" />
              <p className="text-sm text-white/20">Select a plugin to see details</p>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-white/5">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{selectedPlugin.icon}</span>
                    <div>
                      <h3 className="font-semibold text-white">{selectedPlugin.name}</h3>
                      <p className="text-[10px] text-white/30">by {selectedPlugin.author} • v{selectedPlugin.version}</p>
                    </div>
                  </div>
                  <button onClick={() => setSelectedPlugin(null)} className="text-white/20 hover:text-white/50"><X className="w-4 h-4" /></button>
                </div>
                <p className="text-xs text-white/50 mb-3">{selectedPlugin.description}</p>
                <div className="flex gap-1.5 flex-wrap mb-3">
                  <span className={`text-[9px] px-2 py-0.5 rounded-full border ${selectedPlugin.free ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-amber-400 bg-amber-500/10 border-amber-500/20'}`}>{selectedPlugin.free ? 'Free' : 'Paid'}</span>
                  <span className="text-[9px] text-white/30 bg-white/5 px-2 py-0.5 rounded-full">{selectedPlugin.category}</span>
                  {selectedPlugin.tags.map(t => <span key={t} className="text-[9px] text-white/20 bg-white/5 px-1.5 py-0.5 rounded-md">{t}</span>)}
                </div>
                <button
                  onClick={() => addPlugin(selectedPlugin)}
                  className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all bg-violet-600 hover:bg-violet-500 text-white"
                >
                  {installed.includes(selectedPlugin.id) ? <><Check className="w-4 h-4" /> Added — add again</> : <><Plus className="w-4 h-4" /> Add to app</>}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Setup Code */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] text-white/40 uppercase tracking-wider">Setup Code</p>
                    <button onClick={() => copyCode(selectedPlugin.setupCode)} className={`text-[9px] flex items-center gap-1 px-2 py-0.5 rounded-lg transition-all ${copied === selectedPlugin.setupCode.slice(0, 30) ? 'text-emerald-400 bg-emerald-500/10' : 'text-white/30 bg-white/5 hover:text-white/60'}`}>
                      {copied === selectedPlugin.setupCode.slice(0, 30) ? <><Check className="w-2.5 h-2.5" /> Copied</> : <><Check className="w-2.5 h-2.5" /> Copy</>}
                    </button>
                  </div>
                  <pre className="bg-[#0d1117] border border-white/5 rounded-xl p-3 text-[9px] font-mono text-emerald-300 overflow-x-auto whitespace-pre-wrap">{selectedPlugin.setupCode}</pre>
                </div>

                {/* Config Keys */}
                {selectedPlugin.configKeys.length > 0 && (
                  <div>
                    <p className="text-[10px] text-white/40 uppercase tracking-wider mb-2">Required Config</p>
                    <div className="space-y-1.5">
                      {selectedPlugin.configKeys.map(k => (
                        <div key={k} className="flex items-center gap-2 bg-[#0d1117] border border-white/5 rounded-lg px-3 py-2">
                          <Shield className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <code className="text-xs text-amber-300 font-mono flex-1">{k}=your_value</code>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {installed.includes(selectedPlugin.id) && (
                  <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">
                    <p className="text-xs text-emerald-400 flex items-center gap-1.5 mb-1"><Check className="w-3.5 h-3.5" /> Added to your app</p>
                    <p className="text-[10px] text-white/40">Its setup code was inserted into your project — now set this integration&apos;s keys in .env.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
