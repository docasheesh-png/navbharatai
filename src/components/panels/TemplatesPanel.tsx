/**
 * Phase 1.7 — App.tsx split, Part 1: TemplatesPanel
 *
 * Extracted from App.tsx (was lines 8814–8917 + template data at 5928–5938).
 * Renders the "Project Blueprints" gallery and the user's saved templates.
 * All side effects remain in App.tsx — this component receives state via props.
 */
import React from 'react';
import { motion } from 'motion/react';
import {
  Sparkles, Activity, Cpu, Clock, Smartphone, Globe, ShieldCheck, LayoutDashboard,
  Package, Plus, X, IndianRupee, Languages, FileText, Building2, Gamepad2, Rocket,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TemplateDefinition {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  prompt: string;
  isPro?: boolean;
}

export interface SavedTemplate {
  id: string;
  name: string;
  html: string;
  savedAt: string;
}

export interface TemplatesPanelProps {
  user: { uid: string } | null;
  /**
   * The gallery to show. OPTIONAL, defaulting to this module's own `CURATED_TEMPLATES`
   * (2026-08-24): App.tsx used to import that constant purely to hand it straight back here,
   * which pinned this whole ~80 KB module to the first-paint bundle and made lazy-loading the
   * panel pointless. The data lives beside the component that renders it; the prop stays for a
   * caller that genuinely wants a different list.
   */
  templates?: TemplateDefinition[];
  savedTemplates: SavedTemplate[];
  hasGeneratedCode: boolean;
  onSelectTemplate: (prompt: string) => void;
  onRequireAuth: () => void;
  onSaveCurrentTemplate: () => void;
  onDeleteSavedTemplate: (id: string) => void;
  onLoadSavedTemplate: (html: string) => void;
}

// ─── Curated template list ────────────────────────────────────────────────────

export const CURATED_TEMPLATES: TemplateDefinition[] = [
  { id: 'intro', name: 'Introduction', icon: Sparkles, prompt: 'hey 👋 , tell me about yourself!' },
  {
    id: 'analytics', name: 'Smart Analytics', icon: Activity,
    prompt: 'Create a high-performance Data Analytics Dashboard for a modern business. I want real-time visualization of key performance indicators (KPIs) including monthly revenue, user growth, and churn rate. Use a sophisticated dark-glassmorphism theme with SVG charts and interactive data tables. Ensure the UI is fully responsive and supports dynamic data filtering.',
  },
  {
    id: 'calc', name: 'Simple Calculator', icon: Cpu,
    prompt: 'I want you to act as a World-Class Software Architect. Build a Professional High-Precision Scientific Calculator. \n\n### MANDATORY FUNCTIONAL REQUIREMENTS:\n1. **Core Logic**: You MUST implement a robust JavaScript evaluation engine in `script.js`. It should handle click events for all buttons, manage a screen buffer, and accurately calculate results for basic (+, -, *, /) and scientific (sqrt, sin, cos, tan, log) operations. Ensure the calculator works perfectly upon loading.\n2. **UI Architecture**: In `style.css`, create a premium "Space-Age Glass" design with deep shadows and tactile hover animations. Use a responsive grid layout.\n3. **History System**: Implement a history list that records the last 5 operations.\n4. **Checklist**: All button IDs in `index.html` must match the selectors used in `script.js`. Ensure NO empty functions.',
  },
  {
    id: 'clock', name: 'Simple Clock', icon: Clock,
    prompt: 'Create a fully functional, production-grade analog clock/watch application for Android + Web (responsive mobile-first UI).\n\n### PRIMARY GOAL\nBuild an ultra-realistic, smooth, accurate analog watch application with professional mechanics, synchronized with the device time down to the millisecond. It must look and behave like a real luxury wristwatch.\n\n### CRITICAL FUNCTIONAL REQUIREMENTS\n1. **REAL TIME SYNC**: Automatically sync with device local time, hours, minutes, and seconds. The clock MUST NOT freeze or use hardcoded angles. Use `requestAnimationFrame` for continuous updates.\n2. **SMOOTH MOVEMENT**: Second hand must move smoothly every frame (not teleport). Minute and Hour hands must move proportionally as seconds progress.\n3. **HAND ALIGNMENT**: All hands MUST originate from EXACTLY the same center pivot point (0,0 center). No misaligned axes.\n4. **DESIGN**: Premium luxury watch face with metallic frame, realistic dial texture, and inner shadows. Include 12 hour markers and minute ticks.\n5. **GEOMETRY**: Perfectly circular (1:1 aspect ratio) and centered on all screens (Android/Desktop).\n6. **FORMULAS**:\n   - Seconds: `seconds * 6` degrees\n   - Minutes: `(minutes * 6) + (seconds * 0.1)` degrees\n   - Hours: `(hours % 12 * 30) + (minutes * 0.5)` degrees\n7. **TECHNICAL**: Use HTML/CSS/JS with SVG or Canvas for real-time rendering. Provide separate code for index.html, style.css, and script.js with NO placeholders.',
  },
  {
    // WAS "React Native App", and it promised something this platform cannot do (verified 2026-08-08):
    // `react-native`/`expo` are in no framework registry, nothing in the analyser or the drift guards
    // recognises them, and the E2B image ships no Expo tooling. The prompt went straight to the builder,
    // which would scaffold vite-react, write React Native files into it, and produce an app whose
    // preview can never run — the user picks "React Native App", waits, and gets something broken.
    //
    // That is the same trap ROADMAP.md already forbids for frameworks ("a 'Rust' build that 403s = a
    // fake feature"), sitting in the TEMPLATE list where the framework guard does not reach.
    //
    // Deleting it would have thrown away what the user actually wanted. NavBharatAI really does ship
    // installable Android apps — the APK Builder wraps the built app with Capacitor and produces a REAL
    // signed .apk/.aab for the Play Store. So the template now builds the mobile-first app that path
    // needs, and its name says what the user will genuinely end up holding.
    id: 'rn_app', name: 'Mobile App (installable)', icon: Smartphone, isPro: true,
    prompt: 'Build a MOBILE-FIRST app designed to be installed on a phone. Requirements:\n1. Phone-sized layout first (single column, 360-430px), scaling up gracefully on tablet/desktop\n2. Bottom tab navigation between a Home screen and a Detail screen (real routing, not a mock)\n3. Touch-sized targets (min 44x44px), no hover-only interactions, safe-area padding for notches\n4. Local persistence so state survives a reload\n5. Works offline for already-loaded screens\n\nApp theme: dark mode with indigo accent. Include sample data and list rendering.\nAfter it is built, tell me I can turn this into a real installable Android app from More → Your App → Download APK.',
  },
  {
    id: 'portfolio', name: 'Portfolio Site', icon: Globe,
    prompt: 'Build a stunning personal portfolio website with: hero section with animated gradient, about me, skills grid, projects showcase (3 cards), contact form with validation. Dark theme with glassmorphism cards, smooth scroll animations, mobile-first responsive. HTML/CSS/JS only.',
  },
  {
    id: 'ecommerce', name: 'E-Commerce UI', icon: ShieldCheck, isPro: true,
    prompt: 'Build a modern e-commerce product listing page: navbar with cart counter, hero banner, product grid (8 items with images, prices, add-to-cart), cart sidebar with total calculation. Tailwind CSS style with indigo/white palette. Full JavaScript interactions.',
  },
  {
    id: 'dashboard', name: 'Admin Dashboard', icon: LayoutDashboard, isPro: true,
    prompt: 'Build a professional admin dashboard: sidebar navigation, header with user info, metric cards (4 KPIs), recent activity table (10 rows), line chart using Chart.js CDN. Dark theme, responsive. All data should be realistic sample data.',
  },
  // ── Bharat-First templates (Phase 6.1) ──────────────────────────────────────
  {
    id: 'upi_payment', name: 'UPI Payment App', icon: IndianRupee, isPro: true,
    prompt: `Build a complete UPI payment integration app using React + Vite + Tailwind CSS with Razorpay.

### TECH STACK
- React 18 + Vite + Tailwind CSS
- Razorpay Web SDK (load from https://checkout.razorpay.com/v1/checkout.js)
- Environment: VITE_RAZORPAY_KEY_ID (read via import.meta.env)

### FEATURES TO BUILD

1. **Payment Form** (src/components/PaymentForm.tsx)
   - Fields: Amount (₹), Customer Name, Email, Phone (10-digit Indian mobile)
   - Amount presets: ₹99, ₹199, ₹499, ₹999 quick-select buttons
   - "Pay Now" button that triggers Razorpay checkout

2. **Razorpay Integration** (src/lib/razorpay.ts)
   - loadRazorpay(): dynamically loads the SDK script, returns Promise<boolean>
   - openCheckout(options): creates Razorpay instance and opens the modal
   - Options: key, amount (in paise), currency='INR', name, description, prefill

3. **Payment Status UI** (src/components/PaymentStatus.tsx)
   - Success state: green check, transaction ID, amount paid
   - Failure state: red X, error message, retry button
   - Pending state: loading spinner

4. **Order Summary** (src/components/OrderSummary.tsx)
   - Show what's being purchased, GST breakdown (18% GST), total

### IMPORTANT IMPLEMENTATION NOTES
- amount in Razorpay is in PAISE (multiply ₹ amount by 100)
- Use import.meta.env.VITE_RAZORPAY_KEY_ID for the API key
- Add a .env.example file with VITE_RAZORPAY_KEY_ID=rzp_test_xxxx
- handler callback receives { razorpay_payment_id, razorpay_order_id, razorpay_signature }
- For test mode: any card number 4111111111111111, CVV 123, expiry any future date
- Style with Tailwind, saffron/green Indian flag color accent
- Show ₹ (Indian Rupee) symbol throughout`,
  },
  {
    id: 'hindi_app', name: 'Hindi Language App', icon: Languages, isPro: true,
    prompt: `Build a bilingual Hindi/English React app with full Devanagari font support.

### TECH STACK
- React 18 + Vite + Tailwind CSS
- Google Fonts: Noto Sans Devanagari (for Hindi) + Inter (for English)
- i18next + react-i18next for translations

### APP: Bharat Job Board (नौकरी खोजें)
A simple job listing app that shows in both Hindi and English.

### FEATURES

1. **Language Toggle** (top-right header button)
   - Switch between हिन्दी and English instantly
   - Persist choice in localStorage
   - Button shows current language: "हिन्दी | EN"

2. **Translation Setup** (src/i18n.ts)
   - Initialize i18next with two languages: 'hi' and 'en'
   - Resources object with both languages inline (no JSON files needed)
   - Hindi translations for: app title, search placeholder, job titles, locations, apply button, filter labels

3. **Job Cards** (src/components/JobCard.tsx)
   - Company logo placeholder (colored circle with initials)
   - Job title (translated), company name, location (city in Hindi/English)
   - Salary range in ₹/month, job type (Full-time/Part-time/Remote)
   - "Apply Now" / "अभी आवेदन करें" button

4. **Search & Filter** (src/components/SearchBar.tsx)
   - Search by job title or company
   - Filter by location: Delhi, Mumbai, Bangalore, Chennai, Hyderabad, Pune
   - Filter by job type

5. **Sample Data** (src/data/jobs.ts)
   - 8 realistic Indian job listings (Software Engineer, CA, Teacher, etc.)
   - Include popular Indian cities, salary ranges in ₹

### FONT SETUP
- In index.html: <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
- CSS: font-family: 'Noto Sans Devanagari', 'Inter', sans-serif
- Tailwind config: extend fontFamily with devanagari

### STYLE
- Saffron (#FF9933) + white + green (#138808) — Indian flag palette
- Clean, mobile-first card layout`,
  },
  {
    id: 'gst_invoice', name: 'GST Invoice', icon: FileText, isPro: true,
    prompt: `Build a GST-compliant invoice generator using React + Vite + Tailwind CSS. This must generate real, legally-valid GST invoices that Indian businesses can use.

### FEATURES

1. **Invoice Form** (src/components/InvoiceForm.tsx)
   - Seller details: Business Name, GSTIN (15-char format: 22AAAAA0000A1Z5), Address, State
   - Buyer details: Name, GSTIN (optional for B2C), Address, State
   - Line items table: Description, HSN/SAC Code, Qty, Unit, Rate (₹), Discount %
   - Add/remove line items dynamically
   - Invoice No. (auto-increment), Invoice Date, Due Date, Place of Supply

2. **GST Calculation Logic** (src/lib/gstCalculator.ts)
   - If seller state === buyer state: split into CGST (half) + SGST (half)
   - If different states: full IGST
   - GST rates: 0%, 5%, 12%, 18%, 28% (per item)
   - Calculate: subtotal, discount, taxable value, tax amounts, total
   - Round off to nearest rupee

3. **Invoice Preview** (src/components/InvoicePreview.tsx)
   - Professional A4 layout with company letterhead
   - Table with all line items, HSN codes, tax columns
   - Tax summary table at bottom (CGST/SGST or IGST)
   - Amount in words (e.g., "Rupees Five Thousand Only")
   - QR code placeholder for e-invoice
   - "Print Invoice" button using window.print()
   - Print CSS: hide form, show only invoice

4. **GSTIN Validator** (src/lib/gstin.ts)
   - Validate 15-char GSTIN format: 2-digit state code + 10-char PAN + 1 entity + 1 Z + 1 check
   - State codes map (01=J&K, 06=Haryana, 07=Delhi, 09=UP, 19=WB, 27=Maharashtra, 29=Karnataka, 33=Tamil Nadu, 36=Telangana)
   - Real-time validation as user types

5. **Amount in Words** (src/lib/numberToWords.ts)
   - Convert number to Indian English words (lakh/crore system)
   - "12,50,000" → "Twelve Lakh Fifty Thousand Rupees Only"

### STYLE
- Clean white/grey professional design
- Orange accent (GST Portal colors: #E77817)
- Responsive for both screen and print`,
  },
  {
    id: 'startup_tracker', name: 'Startup Tracker', icon: Building2, isPro: true,
    prompt: `Build a React + Vite + Tailwind CSS app for Indian startup founders to track their company registration journey.

### APP: Startup India Registration Tracker

1. **Registration Checklist** (src/components/Checklist.tsx)
   Track completion of these real steps in order:
   - [ ] PAN Card (for business owner)
   - [ ] Aadhaar Card linking
   - [ ] Digital Signature Certificate (DSC) — Class 3
   - [ ] Director Identification Number (DIN)
   - [ ] Company Name Reservation (RUN - Reserve Unique Name)
   - [ ] Certificate of Incorporation (MCA21 portal)
   - [ ] PAN + TAN for company
   - [ ] GST Registration (mandatory if turnover > ₹20L)
   - [ ] MSME/Udyam Registration (udyamregistration.gov.in)
   - [ ] Startup India Recognition (startupindia.gov.in)
   - [ ] Bank Account Opening

2. **Progress Dashboard** (src/components/Dashboard.tsx)
   - Circular progress ring showing % complete
   - Estimated time to next milestone
   - Days since incorporation (from stored date)
   - Important deadlines (e.g., GST filing due dates)

3. **Document Vault** (src/components/DocumentVault.tsx)
   - List of required documents with status (Pending/Uploaded/Verified)
   - Each document: name, description, where to get it, typical cost/time
   - Mark as obtained button (stored in localStorage)

4. **Compliance Calendar** (src/components/Calendar.tsx)
   - Monthly view of filing deadlines:
     - GST: GSTR-1 (11th), GSTR-3B (20th)
     - TDS return: quarterly
     - ROC Annual Filing: September 30
     - Income Tax: July 31
   - Highlight overdue items in red, upcoming in amber, completed in green

5. **Cost Tracker** (src/components/CostTracker.tsx)
   - Track registration costs: CA fees, govt fees, DSC cost, etc.
   - Total spent vs. budget
   - Typical cost ranges for each step

### DATA
- Store all state in localStorage (no backend needed)
- Pre-populate with realistic default values
- Use Indian date format: DD/MM/YYYY

### STYLE
- Dark theme with saffron accent (#FF9933)
- Mobile-first (founders use phones)
- Progress indicators with green checkmarks`,
  },
  {
    id: 'game_3d', name: '3D Game', icon: Gamepad2, isPro: true,
    prompt: `Build a playable 3D action game that runs in the browser.

### THE GAME
A third-person arena survival game. You control a character in a stylised low-poly world and survive
waves of enemies for as long as you can.

### MUST BE PLAYABLE, NOT A DEMO
1. **Movement that feels good** — run, sprint and jump with a camera that follows and does not clip
   through walls. Steep slopes slide; small ledges are stepped over.
2. **Enemies** that notice you at a sensible distance, chase you, spread out instead of merging into
   one clump, and attack on a cooldown.
3. **Combat** — a ranged attack, health for you and for them, and a brief protection window after
   every hit so an adjacent enemy cannot drain the whole health bar at once.
4. **Waves** that get harder: more enemies, tougher, but never faster than you can escape.
5. **Impact** — every hit fires a particle burst, a sound and a small camera shake together.
6. **HUD + flow** — score, health bar, pause (Esc) and a game-over screen with Play Again that really
   restarts. Save the high score so it survives a reload.
7. **Phone playable** — on-screen stick and buttons on touch devices.

### LOOK
Stylised low-poly where simple shapes ARE the art style — one colour palette for the whole scene,
strong lighting and fog, procedurally generated terrain with scattered rocks and trees. Pick a sunset
or night mood and commit to it. Do not aim for photo-realism; a confident stylised world reads far
better than a half-realistic one.

Keep it smooth on a mid-range Android phone — that matters more than any visual detail.`,
  },
  {
    id: 'game_2d', name: '2D Arcade Game', icon: Rocket,
    prompt: `Build a complete 2D arcade game that runs in the browser and works on a phone.

### THE GAME
An endless side-scrolling runner. Jump and duck through obstacles, collect coins, and survive as long
as you can while it steadily speeds up.

### MUST BE FULLY PLAYABLE
1. **Controls that forgive** — the jump still works for a split second after you run off a ledge, and
   a jump pressed just before landing fires the moment you touch down. Tapping the screen jumps;
   holding jumps higher.
2. **Endless generation** — obstacles and gaps generated as you run, always clearable, never an
   impossible pattern.
3. **Difficulty curve** — speed rises gradually and caps, so it stays hard but fair.
4. **Score + high score** saved between sessions, with a coin counter.
5. **Sound and feel** — a jump sound, a coin sound, a crash sound, plus a small screen shake and a
   brief freeze on impact.
6. **Full flow** — a start screen explaining the controls in one line, pause, and a game-over screen
   showing the score, the best score, and Play Again.

### LOOK
Crisp 2D with a bold, limited colour palette and a parallax background of two or three layers. Big,
readable score text. Design it portrait-first for a phone and let it scale up on desktop.

It must hold a steady frame rate on a cheap Android phone.`,
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function TemplatesPanel({
  user,
  templates = CURATED_TEMPLATES,
  savedTemplates,
  hasGeneratedCode,
  onSelectTemplate,
  onRequireAuth,
  onSaveCurrentTemplate,
  onDeleteSavedTemplate,
  onLoadSavedTemplate,
}: TemplatesPanelProps) {
  return (
    <div className="flex-1 p-8 bg-[#0d1117] overflow-y-auto custom-scrollbar">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col mb-10">
          <h3 className="text-2xl font-bold text-white mb-2">Project Blueprints</h3>
          <p className="text-sm text-[#8b949e]">Accelerate your development with AI-optimized templates</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {templates.map(t => {
            const isLocked = t.isPro && !user;
            return (
              <motion.button
                whileHover={{ y: -5 }}
                key={t.id}
                onClick={() => {
                  if (isLocked) { onRequireAuth(); return; }
                  onSelectTemplate(t.prompt);
                }}
                className={`flex flex-col items-start p-6 bg-[#161b22] border rounded-2xl transition-all text-left group shadow-xl relative overflow-hidden ${
                  isLocked ? 'border-amber-500/20 hover:border-amber-500/40' : 'border-white/5 hover:border-indigo-500/50 hover:bg-indigo-500/5'
                }`}
              >
                {t.isPro && (
                  <span className="absolute top-3 right-3 text-[8px] font-black px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 text-amber-400 uppercase tracking-widest">
                    {isLocked ? '🔒 Pro' : '⭐ Pro'}
                  </span>
                )}
                <div className={`w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center mb-6 transition-colors ${isLocked ? 'group-hover:bg-amber-600' : 'group-hover:bg-indigo-600'}`}>
                  <t.icon className={`w-6 h-6 ${isLocked ? 'text-amber-400 group-hover:text-white' : 'text-indigo-400 group-hover:text-white'}`} />
                </div>
                <h4 className="font-bold text-white mb-2">{t.name}</h4>
                <p className="text-[11px] text-[#8b949e] leading-relaxed mb-6 opacity-70">Pre-configured scaffolding for modern responsive web applications.</p>
                <div className="mt-auto w-full flex items-center justify-between">
                  <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${isLocked ? 'text-amber-400 bg-amber-500/10' : 'text-indigo-400 bg-indigo-500/10'}`}>
                    {isLocked ? 'Sign In to Use' : 'Fast Build'}
                  </span>
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* My Saved Templates */}
        <div className="mt-12">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl font-bold text-white">My Templates</h3>
              <p className="text-sm text-[#8b949e]">Your saved apps — reuse, remix, and share</p>
            </div>
            {hasGeneratedCode && (
              <button
                onClick={onSaveCurrentTemplate}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg active:scale-95"
              >
                <Plus className="w-4 h-4" />
                Save Current App
              </button>
            )}
          </div>
          {savedTemplates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 border border-dashed border-white/10 rounded-2xl text-center gap-3">
              <Package className="w-10 h-10 text-white/20" />
              <p className="text-[#484f58] text-sm font-medium">No saved templates yet</p>
              <p className="text-[10px] text-[#484f58]">Build an app and click "Save Current App" to save it here</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {savedTemplates.map(t => (
                <div key={t.id} className="flex flex-col bg-[#161b22] border border-white/5 rounded-2xl p-5 gap-3 hover:border-indigo-500/30 transition-all group">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-white font-bold text-sm">{t.name}</h4>
                      <p className="text-[9px] text-[#484f58] mt-0.5">Saved {t.savedAt}</p>
                    </div>
                    <button
                      onClick={() => onDeleteSavedTemplate(t.id)}
                      className="p-1.5 hover:bg-red-500/10 rounded-lg text-[#484f58] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="text-[9px] text-[#8b949e] font-mono bg-black/30 rounded-lg p-2 truncate">
                    {t.html.slice(0, 80)}...
                  </div>
                  <button
                    onClick={() => onLoadSavedTemplate(t.html)}
                    className="w-full py-2 bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/20 text-indigo-400 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                  >
                    Load & Preview
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
