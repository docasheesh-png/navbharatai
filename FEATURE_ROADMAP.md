# NavBharatAI — Feature Roadmap & Polish Tracker

**Goal (admin-mandated 2026-07-31):** every feature in NavBharatAI, one by one, polished to
**rock-solid**. This file is the living inventory + roadmap that drives that campaign. It is generated
from the single source of truth (`src/server/AppContext/AppKnowledgeBase.ts`, 203 feature
entries) so the list is code-anchored, never guessed.

## What "rock-solid" means (the polish checklist for each feature)
A feature is marked ✅ **DONE** only when ALL of these hold:
1. **Works end-to-end** — the button/flow does exactly what it says, with real data (absolute rule #2).
2. **Honest failure** — every error path shows the real reason (never a blanket "unavailable"); no fake success.
3. **Mobile-friendly** — usable on a phone (≥44px touch targets, no clipped/scroll-broken layout).
4. **No dead ends** — every shortcut/button/link reaches a real destination.
5. **Locked by a test** — a regression test encodes the real behaviour so it can't silently break.
6. **Discoverable** — a correct `AppKnowledgeBase.ts` entry so every AI can point users to it.

## How the roadmap runs
- Polish **one feature (or one tight cluster) per PR**: branch → verification gate → PR → CI green → merge.
- Tick the box here in the SAME PR. Status legend: ⬜ not yet hardened · 🟡 in progress · ✅ done.
- Priority = **most-used / most-revenue-critical first**, then breadth. Tier order below.

## Priority tiers (polish order)
1. **Tier 1 — the money & trust core:** NavBharatAI Pro v5.0 (App Builder), Core AI Chat, Billing, Deploy/Hosting.
2. **Tier 2 — the daily tools:** Builder Tools (Other AI), Reliability/Quality Engine, Settings.
3. **Tier 3 — breadth:** Professional AIs (77), Collaboration, Admin & Ops, Platform/Navigation.

---

## Feature inventory (203) — polish status

### Core AI Chat (10)
- ⬜ **Offline AI (on-device chat)** — `Sidebar menu → Offline AI`
- ⬜ **Freelancing & Online-Income AI** — `Sidebar → Professionals → Freelancing & Online-Income`
- ⬜ **NavBharatAI Pro Chat** — `Home → Pro Chat button  OR  Header → Pro Chat tab`
- ⬜ **Pro Chat — File & Image Upload** — `Pro Chat → paperclip / attachment icon in the chat input`
- ⬜ **Free Chat (NavBharatAI)** — `Sidebar → Reports  OR  Header → Reports tab`
- ⬜ **Free Chat — File, Image & PDF Analysis** — `Sidebar → Reports → attachment icon in the chat input`
- ⬜ **Pro Chat — Extended Thinking (Complex Tasks)** — `Pro Chat → just describe a complex task (auto-detected)`
- ⬜ **Pro Chat — Build Planner (Step-by-Step Progress)** — `Pro Chat → submit a build request → see step progress bar`
- ⬜ **Pro Chat — Cross-Session Memory** — `Pro Chat → automatic (no user action needed)`
- ⬜ **Pro Chat — Design-to-Code (Image → UI)** — `Pro Chat → attach a design image → describe the app`

### NavBharatAI Pro v5.0 — App Builder (14)
- ⬜ **NavBharatAI Pro v5.0 (beta)** — `Sidebar → "App Builder v5.0"  OR  the floating "v5.0" button (bottom-right when enabled for your account).`
- ⬜ **Export project (.zip) — your code, no lock-in** — `NavBharatAI Pro v5.0 → header tab row → "Export .zip" button`
- ⬜ **Import an existing app (.zip) into v5.0** — `NavBharatAI Pro v5.0 → chat composer → 📎 attach → pick your app's .zip → send`
- ⬜ **Import an existing app from GitHub into v5.0** — `NavBharatAI Pro v5.0 → chat composer → options (⚙) → "GitHub / URL" → pick a repo from your list (1 click) or paste a URL`
- ⬜ **Plan & Advise modes + the build queue (3-role workflow)** — `NavBharatAI Pro v5.0 → mode selector at the message box (bottom-left, next to the settings button) — a small "🔨 Build" dropdown that opens upward with Build · Plan · Advise (+ the Queue chip)`
- ⬜ **Edit your own GitHub repo & ship to main (own-repo mode)** — `NavBharatAI Pro v5.0 → import YOUR OWN GitHub repo → edit → "Ship to main" button above the chat box`
- ⬜ **Software Project Mode — build very large software (hundreds of files) module by module** — `NavBharatAI Pro v5.0 → chat — automatic for large software requests (a full ERP/CRM/management system, an explicit "200+ screens" scale, or a spec listing many features)`
- ⬜ **Build survives reload & tab switch (no lost work)** — `NavBharatAI Pro v5.0 — automatic; the build keeps running and re-attaches on its own`
- ⬜ **Restore all files (bring your whole project back)** — `NavBharatAI Pro v5.0 → header → History tab (or Files tab when empty) → "Restore all files" button`
- ⬜ **Report a build to NavBharatAI (admin-only report)** — `NavBharatAI Pro v5.0 → header tab row → "Report" button`
- ⬜ **Files — one Files view, two gates (v5.0 tab + sidebar)** — `NavBharatAI Pro v5.0 → header → Files tab  —OR—  sidebar menu → Files (both open the SAME Files view)`
- ⬜ **Deploy to a live URL (one click)** — `NavBharatAI Pro v5.0 → header tab row → "Deploy" button (the live link then shows as "Live site")`
- ⬜ **Preview (dual: Live server + In-browser)** — `NavBharatAI Pro v5.0 → header → Preview tab → "Live server" / "In-browser" switch`
- ⬜ **Save apps to your own GitHub (git-native)** — `Sign in with GitHub → build in NavBharatAI Pro v5.0 → your project is committed to a private repo in YOUR GitHub account`

### Builder Tools (Other AI) (11)
- ⬜ **NavBharatAI Voice (inside a Professional)** — `Sidebar → Professionals → open any professional (Doctor, Lawyer, Teacher, …) → tap the 🎙️ microphone button next to the Send box. Signed-in users only, when voice is enabled.`
- ⬜ **API Tester** — `Home → Other AI → Developer Tools → API Tester`
- ⬜ **Code Versioning — Undo / Restore** — `Home → Other AI → Developer Tools → Versioning`
- ⬜ **Code Minifier & Optimizer — make your app smaller and faster** — `Home → Other AI → Developer Tools → Minifier`
- ⬜ **Figma Import — turn a Figma design into a real page** — `Home → Other AI → Design & Build → Figma Import`
- ⬜ **Voice to App** — `Settings → AI Tools → Voice to App`
- ⬜ **AI Debugger** — `Home → Other AI → AI Debugger`
- ⬜ **AI Image Gen** — `Home → Other AI → AI Image Gen`
- ⬜ **Bot Builder** — `Home → Other AI → Bot Builder`
- ⬜ **AI Code Review** — `Home → Other AI → AI Tools → Code Review`
- ⬜ **Code Review Comments** — `Home → Other AI → Insights & Webhooks → Code Review  (also backend /api/workspace/:workspaceId/review)`

### Professional AIs (75)
- ⬜ **Engineer AI (retired → use NavBharatAI Pro v5.0)** — `RETIRED. App building is now NavBharatAI Pro v5.0 — Sidebar → "NavBharatAI Pro v5.0".`
- ⬜ **Doctor AI (Senior Doctor Assistant)** — `Header → Doctor AI tab  OR  Sidebar → Professionals → Doctor AI`
- ⬜ **Teacher AI** — `Sidebar → Professionals → Teacher AI`
- ⬜ **Mentor / Career Coach** — `Sidebar → Professionals → Mentor / Career Coach`
- ⬜ **Thesis / Research Writer** — `Sidebar → Professionals → Thesis / Research Writer`
- ⬜ **CA / Tax & Accounts** — `Sidebar → Professionals → CA / Tax & Accounts`
- ⬜ **Lawyer / Legal Assistant** — `Sidebar → Professionals → Lawyer / Legal`
- ⬜ **Financial Advisor** — `Sidebar → Professionals → Financial Advisor`
- ⬜ **Astrologer** — `Sidebar → Professionals → Astrologer`
- ⬜ **Govt Schemes Helper** — `Sidebar → Professionals → Govt Schemes Helper`
- ⬜ **Kisan / Agri Advisor** — `Sidebar → Professionals → Kisan / Agri Advisor`
- ⬜ **Nutritionist / Diet AI** — `Sidebar → Professionals → Nutritionist / Diet AI`
- ⬜ **Wellness / Counsellor AI** — `Sidebar → Professionals → Wellness / Counsellor`
- ⬜ **Fitness / Personal Trainer AI** — `Sidebar → Professionals → Fitness / Personal Trainer`
- ⬜ **Veterinary / Pashu Advisor AI** — `Sidebar → Professionals → Veterinary / Pashu Advisor`
- ⬜ **Parenting / Child-Care AI** — `Sidebar → Professionals → Parenting / Child-Care`
- ⬜ **Cyber Safety / Digital Suraksha AI** — `Sidebar → Professionals → Cyber Safety / Digital Suraksha`
- ⬜ **Insurance Advisor AI** — `Sidebar → Professionals → Insurance Advisor`
- ⬜ **Chef / Recipe AI** — `Sidebar → Professionals → Chef / Recipe AI`
- ⬜ **Travel Planner AI** — `Sidebar → Professionals → Travel Planner`
- ⬜ **Vastu Consultant AI** — `Sidebar → Professionals → Vastu Consultant`
- ⬜ **Yoga & Meditation AI** — `Sidebar → Professionals → Yoga & Meditation`
- ⬜ **Spoken English / Language Tutor AI** — `Sidebar → Professionals → Spoken English / Tutor`
- ⬜ **Resume & Job-Application AI** — `Sidebar → Professionals → Resume & Job Application`
- ⬜ **Gardening / Home-Plants AI** — `Sidebar → Professionals → Gardening / Home-Plants`
- ⬜ **Pharmacist / Medicine-Info AI** — `Sidebar → Professionals → Pharmacist / Medicine-Info`
- ⬜ **Small-Business / Startup Advisor AI** — `Sidebar → Professionals → Small-Business / Startup`
- ⬜ **Home Repair / Handyman AI** — `Sidebar → Professionals → Home Repair / Handyman`
- ⬜ **Real-Estate / Property Advisor AI** — `Sidebar → Professionals → Real-Estate / Property`
- ⬜ **Driving / RTO & Licence AI** — `Sidebar → Professionals → Driving / RTO & Licence`
- ⬜ **Pet-Care / Dog-Training AI** — `Sidebar → Professionals → Pet-Care / Dog-Training`
- ⬜ **Beauty / Skincare & Grooming AI** — `Sidebar → Professionals → Beauty / Skincare & Grooming`
- ⬜ **Music / Instrument Learning AI** — `Sidebar → Professionals → Music / Instrument Learning`
- ⬜ **Sports & Cricket Coaching AI** — `Sidebar → Professionals → Sports & Cricket Coaching`
- ⬜ **Photography & Videography AI** — `Sidebar → Professionals → Photography & Videography`
- ⬜ **Public Speaking & Communication AI** — `Sidebar → Professionals → Public Speaking & Communication`
- ⬜ **Event & Wedding Planner AI** — `Sidebar → Professionals → Event & Wedding Planner`
- ⬜ **Elder-Care / Senior Support AI** — `Sidebar → Professionals → Elder-Care / Senior Support`
- ⬜ **Interior Design & Home-Decor AI** — `Sidebar → Professionals → Interior Design & Home-Decor`
- ⬜ **Study-Abroad & Education Consultant AI** — `Sidebar → Professionals → Study-Abroad & Education`
- ⬜ **Disability & Accessibility Support AI** — `Sidebar → Professionals → Disability & Accessibility Support`
- ⬜ **Fashion & Personal Styling AI** — `Sidebar → Professionals → Fashion & Personal Styling`
- ⬜ **Productivity & Time-Management AI** — `Sidebar → Professionals → Productivity & Time-Management`
- ⬜ **Relationship & Communication AI** — `Sidebar → Professionals → Relationship & Communication`
- ⬜ **Vehicle & Auto-Maintenance AI** — `Sidebar → Professionals → Vehicle & Auto-Maintenance`
- ⬜ **Stock-Market & Investing Education AI** — `Sidebar → Professionals → Stock-Market & Investing`
- ⬜ **Gadget & Tech-Help AI** — `Sidebar → Professionals → Gadget & Tech-Help`
- ⬜ **Maths & Science Problem-Solver AI** — `Sidebar → Professionals → Maths & Science Solver`
- ⬜ **Coding & Programming Tutor AI** — `Sidebar → Professionals → Coding & Programming Tutor`
- ⬜ **Pregnancy & New-Mother Care AI** — `Sidebar → Professionals → Pregnancy & New-Mother Care`
- ⬜ **First-Aid & Emergency-Response AI** — `Sidebar → Professionals → First-Aid & Emergency Response`
- ⬜ **Environment & Sustainability AI** — `Sidebar → Professionals → Environment & Sustainability`
- ⬜ **General Knowledge & Current-Affairs AI** — `Sidebar → Professionals → General Knowledge & Current Affairs`
- ⬜ **Personal Safety & Self-Defense AI** — `Sidebar → Professionals → Personal Safety & Self-Defense`
- ⬜ **Language & Translation Helper AI** — `Sidebar → Professionals → Language & Translation Helper`
- ⬜ **Civic / RTI & Grievance Helper AI** — `Sidebar → Professionals → Civic / RTI & Grievance Helper`
- ⬜ **Sarkari / Govt-Job Exam Guide AI** — `Sidebar → Professionals → Sarkari / Govt-Job Exam Guide`
- ⬜ **Spiritual & Philosophy Companion AI** — `Sidebar → Professionals → Spiritual & Philosophy Companion`
- ⬜ **DIY Crafts & Hobbies AI** — `Sidebar → Professionals → DIY Crafts & Hobbies`
- ⬜ **Festival & Culture Guide AI** — `Sidebar → Professionals → Festival & Culture Guide`
- ⬜ **Creative Writing & Storytelling AI** — `Sidebar → Professionals → Creative Writing & Storytelling`
- ⬜ **Mental Maths & Aptitude AI** — `Sidebar → Professionals → Mental Maths & Aptitude`
- ⬜ **Disaster Preparedness & Weather-Safety AI** — `Sidebar → Professionals → Disaster Preparedness & Weather-Safety`
- ⬜ **Nature & Wildlife Guide AI** — `Sidebar → Professionals → Nature & Wildlife Guide`
- ⬜ **Baby-Names & Naming Helper AI** — `Sidebar → Professionals → Baby-Names & Naming Helper`
- ⬜ **Hygiene & Public-Health Awareness AI** — `Sidebar → Professionals → Hygiene & Public-Health Awareness`
- ⬜ **Volunteering & Social-Impact AI** — `Sidebar → Professionals → Volunteering & Social-Impact`
- ⬜ **Astronomy & Space AI** — `Sidebar → Professionals → Astronomy & Space`
- ⬜ **Calligraphy & Hand-Lettering AI** — `Sidebar → Professionals → Calligraphy & Hand-Lettering`
- ⬜ **Dance & Movement AI** — `Sidebar → Professionals → Dance & Movement`
- ⬜ **Games, Puzzles & Family-Fun AI** — `Sidebar → Professionals → Games, Puzzles & Family-Fun`
- ⬜ **Tech Buying Advisor AI** — `Sidebar → Professionals → Tech Buying Advisor`
- ⬜ **Trekking & Adventure-Travel AI** — `Sidebar → Professionals → Trekking & Adventure-Travel`
- ⬜ **Home-Budget & Frugal-Living AI** — `Sidebar → Professionals → Home-Budget & Frugal-Living`
- ⬜ **GitHub Repo Analyst & Improver AI** — `Sidebar → Professionals → GitHub Repo Analyst & Improver`

### Deploy / Publish / Hosting (5)
- ⬜ **Engineer AI — Deploy to Firebase Hosting** — `Engineer AI chat → type "deploy" or the agent calls deploy automatically`
- ⬜ **APK Builder — turn your app into a real Android app you can download** — `Home → Other AI → Publish & Deploy → APK Builder`
- ⬜ **CI/CD Pipeline — make your app test and deploy itself on every push** — `Home → Other AI → Publish & Deploy → CI/CD Pipeline`
- ⬜ **Pro Chat — Multi-Provider Deployment** — `Engineer AI can deploy to Vercel/Netlify/GitHub Pages (via agentic loop)`
- ⬜ **One-Click Deploy Button** — `Pro Chat → header bar → Deploy button (visible after app is built)`

### Reliability / Quality Engine (9)
- ⬜ **Auto Dependency Sync** — `Pro Chat → Build any app → automatic (no user action needed)`
- ⬜ **App SBOM + License Check** — `Backend capability — POST /api/workspace/sbom (returns a Software Bill of Materials for your built app)`
- ⬜ **Build Health — Will this app work?** — `Home → Other AI → Insights & Webhooks → Build Health (top card) → Run All Checks`
- ⬜ **Build Performance Analytics** — `Analytics view → Build Performance card`
- ⬜ **AI Build Optimizer** — `Analytics view → Build Optimizer card`
- ⬜ **Build Reliability (MTTD / MTTR)** — `Analytics view → Build Reliability card`
- ⬜ **Auto Test Generation (Phase 17)** — `Pro Chat → Build any app → automatic (no user action needed)`
- ⬜ **Build Version History — Go Back to Any Previous Version** — `Pro Chat → sidebar → Files → History tab`
- ⬜ **Auto Code Review** — `Pro Chat → Build any app → review appears in build summary`

### Monetization & Billing (2)
- ⬜ **Billing & Plan** — `Settings → Billing  OR  Header → user area`
- ⬜ **Insights & Integrations** — `Home → Other AI → Insights & Webhooks`

### Collaboration (4)
- ⬜ **Team Collaboration (Invite Members)** — `Home → Other AI → Team`
- ⬜ **Share for Review (Client / Stakeholder Portal)** — `Deploy panel → Deploy tab → "Share for review"`
- ⬜ **Team @Mentions (delivered to an inbox)** — `Team Collaboration → the bell icon (top-right) shows your mentions`
- ⬜ **Team Library (shared prompts / templates / components)** — `Team Collaboration panel → Team Library`

### Settings & Connections (16)
- ⬜ **Connect my website (custom domain)** — `Settings → App Settings → Domain  (also: Sidebar → More menu → "Connect my website", or Home → Other AI → Publish & Deploy → "Custom Domain" — all the same real flow)`
- ⬜ **Settings** — `Sidebar → Settings  OR  Header → Settings tab`
- ⬜ **Motion Preference (Animations)** — `Settings → App Settings → General → Accessibility → "Motion"`
- ⬜ **Text Size (Font Scaling / Zoom)** — `Settings → App Settings → General → Accessibility → "Text Size"`
- ⬜ **Database Settings (Bring Your Own Database)** — `Settings → App Settings → Database`
- ⬜ **Notifications (messages from NavBharatAI)** — `Top bar → bell icon (next to your profile)`
- ⬜ **Hosting & Deploy (Multi-Cloud)** — `Settings → App Settings → Hosting & Deploy`
- ⬜ **Authentication Settings (Bring Your Own Login)** — `Settings → App Settings → Authentication`
- ⬜ **Storage Settings (Bring Your Own File Storage)** — `Settings → App Settings → Storage`
- ⬜ **Secrets & Keys** — `Settings → App Settings → Secrets & Keys`
- ⬜ **General Settings** — `Settings → App Settings → General`
- ⬜ **"Made by NavBharatAI" Signature** — `Settings → App Settings → General → "Made by NavBharatAI" Signature`
- ⬜ **Brain Engine / Modules (AI Provider Keys)** — `Settings → Modules`
- ⬜ **Git / DevOps Panel** — `Sidebar → Git`
- ⬜ **Terminal (Settings)** — `Settings → App Settings → Terminal  (also Code Studio → Terminal tab)`
- ⬜ **Logs (Settings)** — `Settings → App Settings → Logs`

### Admin & Ops (6)
- ⬜ **Live Metrics Dashboard** — `Settings → App Settings → Live Metrics (admin only)`
- ⬜ **AI Insights & NL Telemetry Query** — `Admin Dashboard → Overview → AI Insights card (admin only)`
- ⬜ **AI Deployment Ops (Deploy Risk + Incident Analysis)** — `Admin/CI only — POST /api/admin/deploy-risk and POST /api/admin/incident-analysis`
- ⬜ **Release Freeze / Approval Gate** — `Admin — GET/POST /api/admin/release-gate; the pipeline checks GET /api/release/gate`
- ⬜ **Admin Two-Factor Authentication (2FA / TOTP)** — `Admin Dashboard → Security tab → Two-Factor Authentication (admin only)`
- ⬜ **v5.0 Cost-Ladder Dashboard** — `Admin Dashboard → Revenue tab → "v5.0 Cost-Ladder (last 30 days)" (admin only)`

### Platform / Navigation (51)
- ⬜ **Download app (Android)** — `Sidebar menu → "Download app" (shows only on a mobile browser on navbharatai.com)`
- ⬜ **Support & Help (email us)** — `Sidebar menu → Settings → Support & Help`
- ⬜ **Privacy & analytics consent** — `Consent banner (bottom of the screen) on your first visit — Accept analytics / Decline`
- ⬜ **Engineer AI — GitHub Clone & Push** — `Engineer AI chat → describe cloning a repo or pushing code`
- ⬜ **Unified Workspace — Chat + Live Code + Preview (Phase 3.1)** — `Pro Chat → build an app → live workspace docks on the right (desktop)`
- ⬜ **IDE / Code Studio** — `Sidebar → IDE  OR  Header → IDE tab`
- ⬜ **IDE Terminal / Shell** — `IDE → Terminal tab  OR  Settings → App Settings → Terminal`
- ⬜ **IDE Git Panel** — `IDE → Git tab`
- ⬜ **IDE Live Preview** — `IDE → Preview tab`
- ⬜ **Test Runner** — `Home → Other AI → Developer Tools → Test Runner`
- ⬜ **Multi-Page Builder — turn one page into a whole website** — `Home → Other AI → Design & Build → Multi-Page`
- ⬜ **Nav App Store — publish your Android app, and install apps others made** — `Home → Other AI → Publish & Deploy → Nav App Store`
- ⬜ **Monetize — start taking money in your app** — `Home → Other AI → Monetization & Team → Monetize`
- ⬜ **Component Library — ready-made pieces you can add to your app** — `Home → Other AI → Design & Build → Components`
- ⬜ **Design System — one set of colours, fonts and spacing for your whole app** — `Home → Other AI → Design & Build → Design System`
- ⬜ **Dark Mode Generator — add a dark theme to your app** — `Home → Other AI → Design & Build → Dark Mode Gen`
- ⬜ **Project Blueprints & Templates Gallery** — `Sidebar → Templates  OR  Code Studio → Templates`
- ⬜ **Professionals Hub** — `Sidebar → Professionals`
- ⬜ **Professional Pass (unlimited professionals)** — `Any Professional chat → the quota chip in the header, or the paywall shown after the daily free messages run out → "Get Pass — ₹99/month"`
- ⬜ **Other AI — Builder Tools (Home page)** — `Home → "Other AI" card  (opens the Other AI page)`
- ⬜ **Live Collaboration (Real-Time Room)** — `Home → Other AI → Live Collab`
- ⬜ **History** — `Sidebar → History  OR  Header → History tab`
- ⬜ **Donate** — `Sidebar → Donate`
- ⬜ **My Profile** — `Top-right avatar → My Profile  OR  Settings → Account → My Profile`
- ⬜ **User & Developer Guide (Docs Site)** — `Open /guide in your browser (e.g. yourdomain/guide)`
- ⬜ **API Keys (Programmatic Access)** — `Top-right avatar → My Profile → API Keys card`
- ⬜ **Status Page & Health Check** — `Open /status in your browser (machine-readable at /api/health)`
- ⬜ **Login / Sign Up** — `Header → Login button (top right)`
- ⬜ **App Navigation Overview** — `Header (top bar with tabs)  OR  Sidebar (left panel)`
- ⬜ **Code Confidence (AI Hallucination Check)** — `Home → Other AI → Insights & Webhooks → Code Confidence`
- ⬜ **React Hooks Safety (Rules of Hooks)** — `Home → Other AI → Insights & Webhooks → React Hooks Safety`
- ⬜ **Import / Export Consistency Check** — `Home → Other AI → Insights & Webhooks → Import / Export Consistency`
- ⬜ **JSX Component Resolution Check** — `Home → Other AI → Insights & Webhooks → JSX Component Resolution`
- ⬜ **Hook Resolution Check** — `Home → Other AI → Insights & Webhooks → Hook Resolution`
- ⬜ **Dependency Constraints Check** — `Home → Other AI → Insights & Webhooks → Dependency Constraints`
- ⬜ **Requirement Traceability Matrix** — `Backend API: POST/GET /api/workspace/traceability`
- ⬜ **Explain Code** — `Home → Other AI → Insights & Webhooks → Explain Code  (also backend POST /api/workspace/explain)`
- ⬜ **Webhook Manager** — `Home → Other AI → Insights & Webhooks → Webhooks  (also backend /api/webhooks/:userId)`
- ⬜ **Editor Theme Switcher** — `Code editor → header dropdown (top-right of the editor)`
- ⬜ **Merge Conflict Resolver** — `Files → a "merge conflicts — Resolve" banner appears when any file has conflict markers → Resolve`
- ⬜ **Quick-Start Gallery — Example Prompt Cards** — `Pro Chat → empty chat → example cards grid (visible before first message)`
- ⬜ **Backend Scaffolds — PocketBase & Convex** — `Pro Chat → describe a PocketBase or Convex app → auto-seeded skeleton`
- ⬜ **Unified Memory — Pro Chat and Engineer AI Share Context** — `Automatic — happens every time you build in Pro Chat then ask Engineer AI to edit`
- ⬜ **Iterative Agent Build Engine** — `Pro Chat → type any app description → send`
- ⬜ **Guider — Pre-Build Design Confirmation + Post-Build Quality Grader** — `Pro Chat → type any app description → Guider card appears before build starts`
- ⬜ **Error Pattern Learning — Builds Get Smarter After Failures** — `Automatic — active on every Pro build (no user action needed)`
- ⬜ **Multi-Framework Builder (v5.0)** — `NavBharatAI Pro v5.0 → header → framework badge (or ⚙ → Framework)`
- ⬜ **GitHub / URL Import (v5.0)** — `NavBharatAI Pro v5.0 → ⚙ → Import Repo`
- ⬜ **App Update Notice (mobile)** — `Automatic — inside the installed Android/iOS app.`
- ⬜ **Rate the App (mobile)** — `Automatic — the native rating card appears inside the installed app after you have used it a while.`
- ⬜ **Push Notifications (mobile)** — `Automatic — the app asks for notification permission once, right after you sign in on the installed Android/iOS app.`

---
_Regenerate the inventory after adding features: parse `AppKnowledgeBase.ts` (id/name/path). Keep the ⬜/✅ status when regenerating._

