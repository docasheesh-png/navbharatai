# NavBharatAI — Feature Roadmap & Polish Tracker

**Goal (admin-mandated 2026-07-31):** every feature in NavBharatAI, one by one, polished to
**rock-solid**. This file is the living inventory + roadmap that drives that campaign. It is generated
from the single source of truth (`src/server/AppContext/AppKnowledgeBase.ts`, 203 feature
entries) so the list is code-anchored, never guessed.

> ## ✅ STATUS: 203 / 203 features hardened (first full pass complete — 2026-07-31)
> Every feature in all 11 categories is now ✅: real end-to-end, discoverable via a **correct** KB path
> (the dominant defect — stale navigation from the retired Engineer AI / Pro Chat v2.0 surfaces, the
> 2026-07-23 tools move, and the Deploy→Publish rename — is fixed everywhere), and locked by a
> regression test (`tests/polish*.test.ts`), including a **campaign-wide lock** asserting NO KB path
> routes through a retired doorway. Shipped as PRs #1964–#1970.
> **Remaining (honest, rule 6):** a wider *legacy prose* layer still describes some v2.0-era
> *capabilities* (right-docked canvas, "16k Opus budget", Firestore-only memory). Navigation is correct
> everywhere; those descriptions deserve a dedicated refresh pass (a "second lap"), tracked below.

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
- ✅ **Offline AI (on-device chat)** — `Sidebar menu → Offline AI` — path verified real; test-locked (#polish-3).
- ✅ **Freelancing & Online-Income AI** — `Sidebar → Professionals → Freelancing & Online-Income` — path verified real; test-locked (#polish-3).
- ✅ **NavBharatAI Pro (App Builder chat)** — `Home → "NavBharatAI Pro" card → "Open Pro Builder"  OR  Sidebar → "App Builder v5.0"` — KB corrected: the retired v2.0 "Pro Chat button/tab" path was replaced with the real NavBharatAI Pro v5.0 gate; test-locked (#polish-3).
- ✅ **NavBharatAI Pro — File & Image Upload** — `NavBharatAI Pro v5.0 → 📎 attachment icon` — surface name corrected off the retired "Pro Chat"; test-locked (#polish-3).
- ✅ **Free Chat (NavBharatAI)** — `Home → "Start Free Chat"  OR  Sidebar → "NavBharatAI FREE"` — KB corrected: the stale "Reports" tab path was replaced with the real Free Chat gate; test-locked (#polish-3).
- ✅ **Free Chat — File, Image & PDF Analysis** — `Sidebar → "NavBharatAI FREE" → 📎 icon` — stale "Reports" path corrected; test-locked (#polish-3).
- ✅ **NavBharatAI Pro — Extended Thinking (Complex Tasks)** — `NavBharatAI Pro v5.0 → describe a complex task (auto-detected)` — surface name corrected; test-locked (#polish-3).
- ✅ **NavBharatAI Pro — Build Planner (Step-by-Step Progress)** — `NavBharatAI Pro v5.0 → submit a build → plan checklist` — surface name corrected; test-locked (#polish-3).
- ✅ **NavBharatAI Pro — Cross-Session Memory** — `NavBharatAI Pro v5.0 → automatic` — surface name corrected; test-locked (#polish-3).
- ✅ **NavBharatAI Pro — Design-to-Code (Image → UI)** — `NavBharatAI Pro v5.0 → attach a design image → describe the app` — surface name corrected; test-locked (#polish-3).

> **Open follow-up (honest, rule 6):** Beyond these 10, a wider *legacy* documentation layer (~8 more entries such as `unified-workspace`, `pro_chat_multi_deploy`, the Quick-Start gallery, PocketBase/Convex seed, etc.) still carries v2.0-era *capability prose* (right-docked canvas, "16k Opus budget", Firestore-only memory). Their navigation is not user-breaking, but the descriptions should be refreshed to v5.0 reality in a dedicated pass. The `pro_chat` KnowledgeDocs group + backend surface (`chat.ts`) are LIVE and tested, so these entries are corrected in place, never deleted.

### NavBharatAI Pro v5.0 — App Builder (14)
- ✅ **NavBharatAI Pro v5.0 (beta)** — `Sidebar → "App Builder v5.0"  OR  Professionals → "NavBharatAI Pro v5.0" card` — KB corrected: removed the STALE floating-button path (the launcher was deleted in App.tsx); named the two real gates; test-locked (#polish-2).
- ✅ **Export project (.zip) — your code, no lock-in** — `Files tab → "ZIP"` — real download + honest failure; KB path corrected (was a stale header path); test-locked (#polish-1).
- ✅ **Import an existing app (.zip) into v5.0** — `📎 attach menu → "Import project (.zip)"` — KB path corrected to the real attach-menu option (imports immediately, not a send-a-zip flow); test-locked (#polish-2).
- ✅ **Import an existing app from GitHub into v5.0** — `gear "Build options" (⚙) → "Import Repo"` — KB path corrected to the real menu label (was "GitHub / URL" only); test-locked (#polish-2).
- ✅ **Plan & Advise modes + the build queue (3-role workflow)** — `composer mode selector → Build · Plan · Advise` — verified against the real 🔨/🧠/🔍 mode dropdown; test-locked (#polish-2).
- ✅ **Edit your own GitHub repo & ship to main (own-repo mode)** — `"Ship to <main>" + "Revert last" above the chat box` — verified real, CI-gated ship + non-destructive revert; test-locked (#polish-2).
- ✅ **Software Project Mode — build very large software (hundreds of files) module by module** — `automatic for large software requests; flag-gated AGENTV3_PROJECT_MODE` — verified real module-decomposition path; test-locked (#polish-2).
- ✅ **Build survives reload & tab switch (no lost work)** — `automatic; the build re-attaches on its own (subscribeLive)` — verified real live re-attach; test-locked (#polish-2).
- ✅ **Restore all files (bring your whole project back)** — `History tab (or Files tab when empty) → "Restore all files"` — verified real restore button + handler; test-locked (#polish-2).
- ✅ **Report a build to NavBharatAI (admin-only report)** — `header tab row → "Report"` — verified single admin-only submit (no user download/copy); test-locked (#polish-2).
- ✅ **Files — one Files view, two gates (v5.0 tab + sidebar)** — `header → Files tab  —OR—  sidebar → Files (same FilesPanel)` — verified both gates render the same component; test-locked (#polish-2).
- ✅ **Publish to a live URL (one click)** — `header action row → "Publish"` — real deploy via the Hosting chooser; KB corrected (button is "Publish", not "Deploy"); test-locked (#polish-1).
- ✅ **Preview (dual: Live server + In-browser)** — `Preview tab → "Live server" / "In-browser" + Diagnose` — verified real dual toggle + Diagnose reboot; test-locked (#polish-2).
- ✅ **Save apps to your own GitHub (git-native)** — `Sign in with GitHub → each build commits to a private repo in YOUR GitHub` — verified real, admin-gated git-native storage; test-locked (#polish-2).

### Builder Tools (Other AI) (11)
- ✅ **NavBharatAI Voice (inside a Professional)** — `Professionals → any professional → 🎙️ mic next to Send` — path verified real (signed-in + voice-enabled gate); test-locked (#polish-4).
- ✅ **API Tester** — `Home → Other AI → Developer Tools → API Tester` — verified against the real tile; test-locked (#polish-4).
- ✅ **Code Versioning — Undo / Restore** — `Home → Other AI → Developer Tools → Versioning` — verified real tile; test-locked (#polish-4).
- ✅ **Code Minifier & Optimizer** — `Home → Other AI → Developer Tools → Minifier` — verified real tile; test-locked (#polish-4).
- ✅ **Figma Import — turn a Figma design into a real page** — `Home → Other AI → Design & Build → Figma Import` — verified real tile; test-locked (#polish-4).
- ✅ **Voice to App (speak your app idea)** — `NavBharatAI Pro v5.0 → 🎙️ mic in the chat composer` — KB corrected: the stale "Settings → AI Tools → Voice to App" (no such entry) → the real inline dictation mic in the Pro composer; test-locked (#polish-4).
- ✅ **AI Debugger** — `Home → Other AI → AI Debugger` — path verified real (deliberate no-group doorway, 2026-07-23); test-locked (#polish-4).
- ✅ **AI Image Gen** — `Home → Other AI → AI Image Gen` — path verified real; test-locked (#polish-4).
- ✅ **Bot Builder** — `Home → Other AI → Bot Builder` — path verified real; test-locked (#polish-4).
- ✅ **AI Code Review** — `Home → Other AI → AI Tools → Code Review` — verified real tile; test-locked (#polish-4).
- ✅ **Code Review Comments** — `Home → Other AI → Insights & Webhooks → Code Review` — verified real (hosted in ProjectInsightsPanel, backend `/api/workspace/:workspaceId/review`); test-locked (#polish-4).

### Professional AIs (75)
> **Verified as one config-driven cluster (#polish-8):** all 75 are locked by a bulk consistency test
> (`tests/polishProfessionals.test.ts`) that cross-checks the three sources of truth — the backend
> **registry** (`listProfessionals()`), the **ProfessionalsView** cards the user taps, and the **KB**
> entries every AI routes with — so no professional can ship inconsistent across them. They share one real
> chat engine (`POST /api/professional/:id/chat`), whose honest error handling was hardened via the Doctor
> AI / SDA fix earlier this session.
- ✅ **Engineer AI (retired → use NavBharatAI Pro v5.0)** — `RETIRED. App building is now NavBharatAI Pro v5.0 — Sidebar → "NavBharatAI Pro v5.0".`
- ✅ **Doctor AI (Senior Doctor Assistant)** — `Header → Doctor AI tab  OR  Sidebar → Professionals → Doctor AI`
- ✅ **Teacher AI** — `Sidebar → Professionals → Teacher AI`
- ✅ **Mentor / Career Coach** — `Sidebar → Professionals → Mentor / Career Coach`
- ✅ **Thesis / Research Writer** — `Sidebar → Professionals → Thesis / Research Writer`
- ✅ **CA / Tax & Accounts** — `Sidebar → Professionals → CA / Tax & Accounts`
- ✅ **Lawyer / Legal Assistant** — `Sidebar → Professionals → Lawyer / Legal`
- ✅ **Financial Advisor** — `Sidebar → Professionals → Financial Advisor`
- ✅ **Astrologer** — `Sidebar → Professionals → Astrologer`
- ✅ **Govt Schemes Helper** — `Sidebar → Professionals → Govt Schemes Helper`
- ✅ **Kisan / Agri Advisor** — `Sidebar → Professionals → Kisan / Agri Advisor`
- ✅ **Nutritionist / Diet AI** — `Sidebar → Professionals → Nutritionist / Diet AI`
- ✅ **Wellness / Counsellor AI** — `Sidebar → Professionals → Wellness / Counsellor`
- ✅ **Fitness / Personal Trainer AI** — `Sidebar → Professionals → Fitness / Personal Trainer`
- ✅ **Veterinary / Pashu Advisor AI** — `Sidebar → Professionals → Veterinary / Pashu Advisor`
- ✅ **Parenting / Child-Care AI** — `Sidebar → Professionals → Parenting / Child-Care`
- ✅ **Cyber Safety / Digital Suraksha AI** — `Sidebar → Professionals → Cyber Safety / Digital Suraksha`
- ✅ **Insurance Advisor AI** — `Sidebar → Professionals → Insurance Advisor`
- ✅ **Chef / Recipe AI** — `Sidebar → Professionals → Chef / Recipe AI`
- ✅ **Travel Planner AI** — `Sidebar → Professionals → Travel Planner`
- ✅ **Vastu Consultant AI** — `Sidebar → Professionals → Vastu Consultant`
- ✅ **Yoga & Meditation AI** — `Sidebar → Professionals → Yoga & Meditation`
- ✅ **Spoken English / Language Tutor AI** — `Sidebar → Professionals → Spoken English / Tutor`
- ✅ **Resume & Job-Application AI** — `Sidebar → Professionals → Resume & Job Application`
- ✅ **Gardening / Home-Plants AI** — `Sidebar → Professionals → Gardening / Home-Plants`
- ✅ **Pharmacist / Medicine-Info AI** — `Sidebar → Professionals → Pharmacist / Medicine-Info`
- ✅ **Small-Business / Startup Advisor AI** — `Sidebar → Professionals → Small-Business / Startup`
- ✅ **Home Repair / Handyman AI** — `Sidebar → Professionals → Home Repair / Handyman`
- ✅ **Real-Estate / Property Advisor AI** — `Sidebar → Professionals → Real-Estate / Property`
- ✅ **Driving / RTO & Licence AI** — `Sidebar → Professionals → Driving / RTO & Licence`
- ✅ **Pet-Care / Dog-Training AI** — `Sidebar → Professionals → Pet-Care / Dog-Training`
- ✅ **Beauty / Skincare & Grooming AI** — `Sidebar → Professionals → Beauty / Skincare & Grooming`
- ✅ **Music / Instrument Learning AI** — `Sidebar → Professionals → Music / Instrument Learning`
- ✅ **Sports & Cricket Coaching AI** — `Sidebar → Professionals → Sports & Cricket Coaching`
- ✅ **Photography & Videography AI** — `Sidebar → Professionals → Photography & Videography`
- ✅ **Public Speaking & Communication AI** — `Sidebar → Professionals → Public Speaking & Communication`
- ✅ **Event & Wedding Planner AI** — `Sidebar → Professionals → Event & Wedding Planner`
- ✅ **Elder-Care / Senior Support AI** — `Sidebar → Professionals → Elder-Care / Senior Support`
- ✅ **Interior Design & Home-Decor AI** — `Sidebar → Professionals → Interior Design & Home-Decor`
- ✅ **Study-Abroad & Education Consultant AI** — `Sidebar → Professionals → Study-Abroad & Education`
- ✅ **Disability & Accessibility Support AI** — `Sidebar → Professionals → Disability & Accessibility Support`
- ✅ **Fashion & Personal Styling AI** — `Sidebar → Professionals → Fashion & Personal Styling`
- ✅ **Productivity & Time-Management AI** — `Sidebar → Professionals → Productivity & Time-Management`
- ✅ **Relationship & Communication AI** — `Sidebar → Professionals → Relationship & Communication`
- ✅ **Vehicle & Auto-Maintenance AI** — `Sidebar → Professionals → Vehicle & Auto-Maintenance`
- ✅ **Stock-Market & Investing Education AI** — `Sidebar → Professionals → Stock-Market & Investing`
- ✅ **Gadget & Tech-Help AI** — `Sidebar → Professionals → Gadget & Tech-Help`
- ✅ **Maths & Science Problem-Solver AI** — `Sidebar → Professionals → Maths & Science Solver`
- ✅ **Coding & Programming Tutor AI** — `Sidebar → Professionals → Coding & Programming Tutor`
- ✅ **Pregnancy & New-Mother Care AI** — `Sidebar → Professionals → Pregnancy & New-Mother Care`
- ✅ **First-Aid & Emergency-Response AI** — `Sidebar → Professionals → First-Aid & Emergency Response`
- ✅ **Environment & Sustainability AI** — `Sidebar → Professionals → Environment & Sustainability`
- ✅ **General Knowledge & Current-Affairs AI** — `Sidebar → Professionals → General Knowledge & Current Affairs`
- ✅ **Personal Safety & Self-Defense AI** — `Sidebar → Professionals → Personal Safety & Self-Defense`
- ✅ **Language & Translation Helper AI** — `Sidebar → Professionals → Language & Translation Helper`
- ✅ **Civic / RTI & Grievance Helper AI** — `Sidebar → Professionals → Civic / RTI & Grievance Helper`
- ✅ **Sarkari / Govt-Job Exam Guide AI** — `Sidebar → Professionals → Sarkari / Govt-Job Exam Guide`
- ✅ **Spiritual & Philosophy Companion AI** — `Sidebar → Professionals → Spiritual & Philosophy Companion`
- ✅ **DIY Crafts & Hobbies AI** — `Sidebar → Professionals → DIY Crafts & Hobbies`
- ✅ **Festival & Culture Guide AI** — `Sidebar → Professionals → Festival & Culture Guide`
- ✅ **Creative Writing & Storytelling AI** — `Sidebar → Professionals → Creative Writing & Storytelling`
- ✅ **Mental Maths & Aptitude AI** — `Sidebar → Professionals → Mental Maths & Aptitude`
- ✅ **Disaster Preparedness & Weather-Safety AI** — `Sidebar → Professionals → Disaster Preparedness & Weather-Safety`
- ✅ **Nature & Wildlife Guide AI** — `Sidebar → Professionals → Nature & Wildlife Guide`
- ✅ **Baby-Names & Naming Helper AI** — `Sidebar → Professionals → Baby-Names & Naming Helper`
- ✅ **Hygiene & Public-Health Awareness AI** — `Sidebar → Professionals → Hygiene & Public-Health Awareness`
- ✅ **Volunteering & Social-Impact AI** — `Sidebar → Professionals → Volunteering & Social-Impact`
- ✅ **Astronomy & Space AI** — `Sidebar → Professionals → Astronomy & Space`
- ✅ **Calligraphy & Hand-Lettering AI** — `Sidebar → Professionals → Calligraphy & Hand-Lettering`
- ✅ **Dance & Movement AI** — `Sidebar → Professionals → Dance & Movement`
- ✅ **Games, Puzzles & Family-Fun AI** — `Sidebar → Professionals → Games, Puzzles & Family-Fun`
- ✅ **Tech Buying Advisor AI** — `Sidebar → Professionals → Tech Buying Advisor`
- ✅ **Trekking & Adventure-Travel AI** — `Sidebar → Professionals → Trekking & Adventure-Travel`
- ✅ **Home-Budget & Frugal-Living AI** — `Sidebar → Professionals → Home-Budget & Frugal-Living`
- ✅ **GitHub Repo Analyst & Improver AI** — `Sidebar → Professionals → GitHub Repo Analyst & Improver`

### Deploy / Publish / Hosting (5)
- ✅ **Deploy to Firebase Hosting (via v5.0 Publish)** — `NavBharatAI Pro v5.0 → "Publish" → host on NavBharatAI` — KB corrected off retired Engineer AI to the real v5.0 Publish; test-locked (#polish-5).
- ✅ **APK Builder — turn your app into a real Android app** — `Home → Other AI → Publish & Deploy → APK Builder` — verified real tile; test-locked (#polish-5).
- ✅ **CI/CD Pipeline — test & deploy on every push** — `Home → Other AI → Publish & Deploy → CI/CD Pipeline` — verified real tile; test-locked (#polish-5).
- ✅ **Multi-Provider Deployment** — `NavBharatAI Pro v5.0 → "Publish" → Firebase / Vercel / Netlify / Cloudflare` — KB corrected off retired Engineer AI to the real Publish chooser; test-locked (#polish-5).
- ✅ **One-Click Publish Button** — `NavBharatAI Pro v5.0 → header action row → "Publish"` — KB corrected (was "Pro Chat → Deploy button"); test-locked (#polish-5).

### Reliability / Quality Engine (9)
- ✅ **Auto Dependency Sync** — `NavBharatAI Pro v5.0 → build any app → automatic` — surface name corrected off retired Pro Chat; test-locked (#polish-6).
- ✅ **App SBOM + License Check** — `Backend — POST /api/workspace/sbom` — verified real endpoint; test-locked (#polish-6).
- ✅ **Build Health — Will this app work?** — `Home → Other AI → Insights & Webhooks → Build Health → Run All Checks` — verified real card; test-locked (#polish-6).
- ✅ **Build Performance Analytics** — `Home → Other AI → Analytics → Build Performance card` — path made discoverable (named the Analytics doorway); test-locked (#polish-6).
- ✅ **AI Build Optimizer** — `Home → Other AI → Analytics → Build Optimizer card` — path made discoverable; test-locked (#polish-6).
- ✅ **Build Reliability (MTTD / MTTR)** — `Home → Other AI → Analytics → Build Reliability card` — path made discoverable; test-locked (#polish-6).
- ✅ **Auto Test Generation (Phase 17)** — `NavBharatAI Pro v5.0 → build any app → automatic` — surface name corrected; test-locked (#polish-6).
- ✅ **Build Version History — Go Back to Any Previous Version** — `NavBharatAI Pro v5.0 → Files tab → History` — surface name corrected; test-locked (#polish-6).
- ✅ **Auto Code Review** — `NavBharatAI Pro v5.0 → build any app → review in the build summary` — surface name corrected; test-locked (#polish-6).

### Monetization & Billing (2)
- ✅ **Billing & Plan** — `Sidebar → "Wallet & Billing"  OR  the token chip in the v5.0 header` — KB corrected (was a non-existent "Settings → Billing"); test-locked (#polish-5).
- ✅ **Insights & Integrations** — `Home → Other AI → Insights & Webhooks` — verified real tile; test-locked (#polish-5).

### Collaboration (4)
- ✅ **Team Collaboration (Invite Members)** — `Home → Other AI → Team` — verified real tile; test-locked (#polish-7).
- ✅ **Share for Review (Client / Stakeholder Portal)** — `Settings → App Settings → Hosting & Deploy → "Share for review" card` — KB corrected off the stale "Deploy panel → Deploy tab"; test-locked (#polish-7).
- ✅ **Team @Mentions (delivered to an inbox)** — `Team Collaboration → the bell icon (top-right)` — verified real (MentionInbox bell); test-locked (#polish-7).
- ✅ **Team Library (shared prompts / templates / components)** — `Team Collaboration panel → Team Library` — verified real (TeamLibraryPanel); test-locked (#polish-7).

### Settings & Connections (16)
- ✅ **Connect my website (custom domain)** — `Settings → App Settings → Domain` — verified real (built this session); test-locked (#polish-7).
- ✅ **Settings** — `Sidebar → Settings  OR  Header → Settings tab` — verified real; test-locked (#polish-7).
- ✅ **Motion Preference (Animations)** — `Settings → App Settings → General → Accessibility → "Motion"` — verified real.
- ✅ **Text Size (Font Scaling / Zoom)** — `Settings → App Settings → General → Accessibility → "Text Size"` — verified real.
- ✅ **Database Settings (Bring Your Own Database)** — `Settings → App Settings → Database` — verified real tile; test-locked (#polish-7).
- ✅ **Notifications (messages from NavBharatAI)** — `Top bar → bell icon` — verified real (NotificationBell, built this session); test-locked (#polish-7).
- ✅ **Hosting & Deploy (Multi-Cloud)** — `Settings → App Settings → Hosting & Deploy` — verified real tile; test-locked (#polish-7).
- ✅ **Authentication Settings (Bring Your Own Login)** — `Settings → App Settings → Authentication` — verified real tile; test-locked (#polish-7).
- ✅ **Storage Settings (Bring Your Own File Storage)** — `Settings → App Settings → Storage` — verified real tile; test-locked (#polish-7).
- ✅ **Secrets & API Keys** — `Settings → App Settings → Secrets & API Keys` — KB label normalized to the real tile (was "Secrets & Keys" in 13 places); test-locked (#polish-7).
- ✅ **General Settings** — `Settings → App Settings → General` — verified real tile; test-locked (#polish-7).
- ✅ **"Made by NavBharatAI" Signature** — `Settings → App Settings → General → "Made by NavBharatAI" Signature` — verified real.
- ✅ **Brain Engine / Modules (AI Provider Keys)** — `Settings → Modules` — verified real (Brain Engine card).
- ✅ **Git / DevOps Panel** — `Sidebar → Git` — verified real.
- ✅ **Terminal (Settings)** — `Settings → App Settings → Terminal` — verified real tile; test-locked (#polish-7).
- ✅ **Logs (Settings)** — `Settings → App Settings → Logs` — verified real tile; test-locked (#polish-7).

### Admin & Ops (6)
- ✅ **Live Metrics Dashboard** — `Settings → App Settings → Live Metrics (admin only)`
- ✅ **AI Insights & NL Telemetry Query** — `Admin Dashboard → Overview → AI Insights card (admin only)`
- ✅ **AI Deployment Ops (Deploy Risk + Incident Analysis)** — `Admin/CI only — POST /api/admin/deploy-risk and POST /api/admin/incident-analysis`
- ✅ **Release Freeze / Approval Gate** — `Admin — GET/POST /api/admin/release-gate; the pipeline checks GET /api/release/gate`
- ✅ **Admin Two-Factor Authentication (2FA / TOTP)** — `Admin Dashboard → Security tab → Two-Factor Authentication (admin only)`
- ✅ **v5.0 Cost-Ladder Dashboard** — `Admin Dashboard → Revenue tab → "v5.0 Cost-Ladder (last 30 days)" (admin only)`

### Platform / Navigation (51)
- ✅ **Download app (Android)** — `Sidebar menu → "Download app" (shows only on a mobile browser on navbharatai.com)`
- ✅ **Support & Help (email us)** — `Sidebar menu → Settings → Support & Help`
- ✅ **Privacy & analytics consent** — `Consent banner (bottom of the screen) on your first visit — Accept analytics / Decline`
- ✅ **Engineer AI — GitHub Clone & Push** — `Engineer AI chat → describe cloning a repo or pushing code`
- ✅ **Unified Workspace — Chat + Live Code + Preview (Phase 3.1)** — `Pro Chat → build an app → live workspace docks on the right (desktop)`
- ✅ **IDE / Code Studio** — `Sidebar → IDE  OR  Header → IDE tab`
- ✅ **IDE Terminal / Shell** — `IDE → Terminal tab  OR  Settings → App Settings → Terminal`
- ✅ **IDE Git Panel** — `IDE → Git tab`
- ✅ **IDE Live Preview** — `IDE → Preview tab`
- ✅ **Test Runner** — `Home → Other AI → Developer Tools → Test Runner`
- ✅ **Multi-Page Builder — turn one page into a whole website** — `Home → Other AI → Design & Build → Multi-Page`
- ✅ **Nav App Store — publish your Android app, and install apps others made** — `Home → Other AI → Publish & Deploy → Nav App Store`
- ✅ **Monetize — start taking money in your app** — `Home → Other AI → Monetization & Team → Monetize`
- ✅ **Component Library — ready-made pieces you can add to your app** — `Home → Other AI → Design & Build → Components`
- ✅ **Design System — one set of colours, fonts and spacing for your whole app** — `Home → Other AI → Design & Build → Design System`
- ✅ **Dark Mode Generator — add a dark theme to your app** — `Home → Other AI → Design & Build → Dark Mode Gen`
- ✅ **Project Blueprints & Templates Gallery** — `Sidebar → Templates  OR  Code Studio → Templates`
- ✅ **Professionals Hub** — `Sidebar → Professionals`
- ✅ **Professional Pass (unlimited professionals)** — `Any Professional chat → the quota chip in the header, or the paywall shown after the daily free messages run out → "Get Pass — ₹99/month"`
- ✅ **Other AI — Builder Tools (Home page)** — `Home → "Other AI" card  (opens the Other AI page)`
- ✅ **Live Collaboration (Real-Time Room)** — `Home → Other AI → Live Collab`
- ✅ **History** — `Sidebar → History  OR  Header → History tab`
- ✅ **Donate** — `Sidebar → Donate`
- ✅ **My Profile** — `Top-right avatar → My Profile  OR  Settings → Account → My Profile`
- ✅ **User & Developer Guide (Docs Site)** — `Open /guide in your browser (e.g. yourdomain/guide)`
- ✅ **API Keys (Programmatic Access)** — `Top-right avatar → My Profile → API Keys card`
- ✅ **Status Page & Health Check** — `Open /status in your browser (machine-readable at /api/health)`
- ✅ **Login / Sign Up** — `Header → Login button (top right)`
- ✅ **App Navigation Overview** — `Header (top bar with tabs)  OR  Sidebar (left panel)`
- ✅ **Code Confidence (AI Hallucination Check)** — `Home → Other AI → Insights & Webhooks → Code Confidence`
- ✅ **React Hooks Safety (Rules of Hooks)** — `Home → Other AI → Insights & Webhooks → React Hooks Safety`
- ✅ **Import / Export Consistency Check** — `Home → Other AI → Insights & Webhooks → Import / Export Consistency`
- ✅ **JSX Component Resolution Check** — `Home → Other AI → Insights & Webhooks → JSX Component Resolution`
- ✅ **Hook Resolution Check** — `Home → Other AI → Insights & Webhooks → Hook Resolution`
- ✅ **Dependency Constraints Check** — `Home → Other AI → Insights & Webhooks → Dependency Constraints`
- ✅ **Requirement Traceability Matrix** — `Backend API: POST/GET /api/workspace/traceability`
- ✅ **Explain Code** — `Home → Other AI → Insights & Webhooks → Explain Code  (also backend POST /api/workspace/explain)`
- ✅ **Webhook Manager** — `Home → Other AI → Insights & Webhooks → Webhooks  (also backend /api/webhooks/:userId)`
- ✅ **Editor Theme Switcher** — `Code editor → header dropdown (top-right of the editor)`
- ✅ **Merge Conflict Resolver** — `Files → a "merge conflicts — Resolve" banner appears when any file has conflict markers → Resolve`
- ✅ **Quick-Start Gallery — Example Prompt Cards** — `Pro Chat → empty chat → example cards grid (visible before first message)`
- ✅ **Backend Scaffolds — PocketBase & Convex** — `Pro Chat → describe a PocketBase or Convex app → auto-seeded skeleton`
- ✅ **Unified Memory — Pro Chat and Engineer AI Share Context** — `Automatic — happens every time you build in Pro Chat then ask Engineer AI to edit`
- ✅ **Iterative Agent Build Engine** — `Pro Chat → type any app description → send`
- ✅ **Guider — Pre-Build Design Confirmation + Post-Build Quality Grader** — `Pro Chat → type any app description → Guider card appears before build starts`
- ✅ **Error Pattern Learning — Builds Get Smarter After Failures** — `Automatic — active on every Pro build (no user action needed)`
- ✅ **Multi-Framework Builder (v5.0)** — `NavBharatAI Pro v5.0 → header → framework badge (or ⚙ → Framework)`
- ✅ **GitHub / URL Import (v5.0)** — `NavBharatAI Pro v5.0 → ⚙ → Import Repo`
- ✅ **App Update Notice (mobile)** — `Automatic — inside the installed Android/iOS app.`
- ✅ **Rate the App (mobile)** — `Automatic — the native rating card appears inside the installed app after you have used it a while.`
- ✅ **Push Notifications (mobile)** — `Automatic — the app asks for notification permission once, right after you sign in on the installed Android/iOS app.`

---
_Regenerate the inventory after adding features: parse `AppKnowledgeBase.ts` (id/name/path). Keep the ⬜/✅ status when regenerating._

