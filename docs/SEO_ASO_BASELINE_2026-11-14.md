# NavBharatAI SEO and Google Play ASO baseline

**Measured:** 2026-11-14 (Asia/Kolkata)
**Scope:** public website `https://navbharatai.com`, Android package `com.navbharat.ai`, and the Google Play listing.
**Status labels:** Verified = observed in source or public page; Implemented = landed in this branch; Pending external access = requires an account we cannot access.

## Architecture and deployment baseline

- **Verified:** The public website is an Express application with a Vite/React client. Public marketing and legal routes are server-rendered; the interactive application remains a SPA.
- **Verified:** Cloud Run deploys after a merge to `main` through the documented Cloud Build trigger. Firebase Hosting configuration also exists, but production route handling is owned by the Express service.
- **Verified:** Android is a bundled Capacitor application, not a remote website wrapper. Its published application ID is `com.navbharat.ai`.
- **Pending external access:** Google Search Console, GA4, Play Console, Cloud Build history, and production runtime logs were not available in this audit.

## Severity-ranked findings

| Severity | Finding | Evidence | Root cause / disposition |
| --- | --- | --- | --- |
| High | Organic performance cannot be measured from the repository. | No authorized Search Console, GA4, or Play Console access was available. | **Pending external access.** Connect read-only properties before making ranking, CTR, install, retention, or conversion claims. |
| High | Website robots and sitemap could not be independently fetched by the external inspection tool. | The source registers `/robots.txt` and `/sitemap.xml`; the public fetch tool reported them inaccessible. | **Pending production verification.** Check their HTTP status, content type, and XML after the next deployment from a normal browser/curl or Search Console. |
| Medium | The Google Play listing copy is generic and has inconsistent capitalization/grammar. | Public Play page observed title `navBharatAI`, about copy includes “Multiple AI professionals Models”. | **Ready-to-upload package below.** Updating Play Console requires authorized console write access. |
| Medium | The Play listing and website can be tied more explicitly in structured data. | The Organization graph links the Play listing, but did not identify the published Android application itself. | **Implemented in this branch:** a fact-only `MobileApplication` JSON-LD node with Android platform, Productivity category, package identifier, publisher and Play download URL. |
| Low | Sitemap entries have no `lastmod`. | `siteIndex.ts` emits only canonical locations. | Deliberately left unchanged: emitting guessed timestamps is worse than omitting them. Add real content revision timestamps only if a durable source of truth is introduced. |
| Low | Marketing pages are already server-rendered and linked internally. | `/about`, `/pricing`, `/ai-app-builder`, `/indian-ai-assistant`, and `/hindi-ai-assistant` have distinct titles, descriptions, canonicals, internal links and JSON-LD in the current source. | **Verified.** Do not duplicate these pages with thin keyword variants. |

## Public-site evidence

- **Verified:** A crawl of the homepage on 2026-11-14 exposed a descriptive H1, product text, and links to public product pages without requiring JavaScript.
- **Verified:** A crawl of `/about` exposed server-rendered content, internal links, contact information, and truthful product/billing language.
- **Verified:** The current source generates canonical URLs, Open Graph/Twitter metadata, Organization/WebSite JSON-LD, `robots.txt`, and `sitemap.xml`; regression tests cover the public-page identity and crawler-visible content.
- **Verified:** App Mart listing detail URLs are `noindex, follow` until each listing can have a verified, distinct server-rendered head. This prevents soft-404 and duplicate-title indexing.
- **Pending external access:** Mobile Core Web Vitals and real search coverage require Search Console/CrUX or a reproducible Lighthouse run against the deployed URL.

## Google Play ASO package

### English (India)

**App title (22 characters):** `NavBharatAI: Indian AI`
**Short description (78 characters):** `Indian AI chat and app builder. Chat, code and build apps in Hindi or English.`

**Full description (ready for Play Console):**

NavBharatAI is an Indian AI platform for chat, learning, coding and building apps. Ask questions in Hindi, English or Hinglish, get help with everyday work, and describe an app or website you want to create.

Use AI Chat for explanations, writing, study help, ideas and programming support. When you have an app idea, describe it in your own words. NavBharatAI can help plan it, generate it, show a live preview and help you publish it when that option is available in your account.

What you can do:

- Chat with an AI assistant in Hindi, English or Hinglish
- Get coding and programming help
- Explore AI-assisted app and website building
- Create ideas, summaries, drafts and learning notes
- Use professional AI assistants where available
- Preview and share apps you build

NavBharatAI is built in India for people who want practical AI help without changing how they naturally write. You can use it for study, work, small-business ideas, software projects and everyday questions.

Some features need sign-in, available wallet credit or supported account settings. Prices and eligibility are shown in the app before paid use. AI can make mistakes, so review important information and test apps before relying on them.

### Hindi (India)

**App title:** `NavBharatAI: Indian AI`
**Short description:** `Hindi, English और Hinglish में AI चैट, कोडिंग मदद और AI app building.`

**Full description:**

NavBharatAI एक Indian AI platform है जहाँ आप Hindi, English या Hinglish में AI से बात कर सकते हैं, पढ़ाई और काम में मदद ले सकते हैं, और अपने app या website का idea लिखकर उसे बनाना शुरू कर सकते हैं।

AI Chat से सवालों के जवाब, writing, summaries, ideas और coding help पाएं। अगर आपके पास app का कोई idea है, तो उसे अपने शब्दों में बताइए। उपलब्ध होने पर NavBharatAI उस idea को plan करने, app बनाने, live preview देखने और publish करने में मदद करता है।

आप क्या कर सकते हैं:

- Hindi, English और Hinglish में AI chatbot से बात करें
- Coding और programming में मदद लें
- AI app builder और website builder को explore करें
- Study notes, drafts, summaries और ideas बनाएं
- उपलब्ध professional AI assistants का उपयोग करें
- अपने बनाए apps का preview और share करें

NavBharatAI भारत में बनाया गया है और उन लोगों के लिए है जो अपनी प्राकृतिक भाषा में practical AI help चाहते हैं। इसे पढ़ाई, काम, small-business ideas, software projects और रोज़मर्रा के सवालों के लिए इस्तेमाल किया जा सकता है।

कुछ features के लिए sign-in, wallet credit या supported account settings की जरूरत हो सकती है। Paid use से पहले कीमत और eligibility app में दिखाई जाती है। AI गलतियाँ कर सकता है, इसलिए ज़रूरी जानकारी को जाँचें और apps को इस्तेमाल से पहले test करें।

## Store creative specification

Use genuine screenshots from the released Android app. Do not use mock UI, invented performance claims, ratings, or unavailable features.

1. **AI Chat in your language** — show a Hindi/Hinglish prompt and a useful answer; headline: “AI chat in Hindi, English and Hinglish”.
2. **Describe an app idea** — show the app-builder prompt; headline: “Describe your app in your own words”.
3. **See a live preview** — show a real preview of a generated app; headline: “See your app running before you share it”.
4. **Coding and professional help** — show a real available assistant; headline: “Help for coding, study and work”.
5. **Publish or share** — only if the current release genuinely supports it; otherwise replace with a real existing workflow.

Prepare portrait phone screenshots with readable copy at small sizes, a consistent in-app visual system, no unsupported badges or superlatives, and a feature graphic that repeats the app name plus one real proposition. Validate current Google Play asset dimensions in Play Console before export because policy requirements can change.

## Keyword and measurement plan

No search volume, difficulty, ranking, or install metric is claimed here because no authorized source was available. Validate these queries with Search Console and Play Console before prioritization:

- Indian AI, Indian AI chatbot, Indian AI app, Made in India AI
- AI chatbot India, Bharat AI, Hindi AI, AI assistant India
- AI app builder, AI website builder, build apps with AI
- Hindi AI chatbot, Hinglish AI assistant, AI for Indian students, AI for Indian developers

Create a weekly baseline export with query, country, device, impressions, clicks, CTR, average position, landing page and conversion where consented analytics supports it. Separate branded from non-branded queries. Track Play store-listing visitors, acquisitions, conversion, uninstall rate, crashes, ANRs and country/language performance in Play Console.

## 30/60/90 day roadmap

- **Days 0–30:** submit the sitemap in Search Console; confirm index coverage and canonical selection; replace the Play listing text and screenshots after policy review; record baseline query and store-acquisition data.
- **Days 31–60:** improve the two public pages with the highest non-branded impressions but weak CTR, using evidence from Search Console; publish one original, experience-backed guide per target intent; add contextual links from relevant existing public pages.
- **Days 61–90:** retain only content that attracts qualified organic visits; run one Play Store listing experiment where the account supports it; review crash/ANR and conversion data by language/country; publish an evidence-based quarterly report.

## External actions required

1. Grant read-only Google Search Console access for `https://navbharatai.com/`.
2. Grant read-only GA4 access if configured.
3. Grant Play Console listing/analytics access, or upload the ASO package manually.
4. Submit `https://navbharatai.com/sitemap.xml` after live verification.
5. Verify robots and sitemap responses in production after the SEO change ships.
