# Nav App Store — Master Plan (agreed with the admin, 2026-08-15)

**Status: WRITTEN, NOT BUILT.** The admin's instruction: *"abhi app remix free rakho, paid service
coming soon kar do, aur pura plan bana kar rakh do — future me jab app chalne lagegi tab apply kar
denge."* Only the parking (free remix + "coming soon") is live today. Everything below is the
decided design for later, so a future session does not have to re-derive it — or worse, re-litigate
decisions the admin already made.

This document exists because the reasoning is worth more than the conclusions. Anyone can write
"use Cashfree split"; the value is knowing *why* the alternatives were rejected, so nobody
re-proposes them in six months.

---

## 0. What is live TODAY (2026-08-15)

| Thing | State |
|---|---|
| Publish an instant app | ✅ live (one click, from v5 Publish → "Put it on the Nav App Store") |
| Share link, private/password, unpublish, report | ✅ live |
| Remix ("Make it yours") | ✅ live, **free for everyone** |
| Shared data (`window.NavData`) | ✅ live, hard-quota'd |
| Game mode toggle in the player | ✅ live |
| **Paid remix** | 🔴 **PARKED** — `PAID_REMIX_ENABLED = false` in `navStoreRemixPurchase.ts` |
| Store appears in public Browse | ⚠️ after admin review (links work immediately) |
| APK store | ✅ live, separate from instant apps but **shown in the same screen** |

**Why paid remix is parked rather than shipped:** the wallet-to-wallet model that shipped in Kadam 3
answered "how does the buyer pay?" but never "how does the creator's money reach their **bank**?"
Wallet earnings are one-way by design — spendable on builds, never withdrawable — which is precisely
what keeps the wallet a closed system and out of payment-regulation territory. Calling that "earning"
while a creator cannot withdraw it would be profiting from a misunderstanding. So it waits for the
model in §4, which pays creators into their own bank.

---

## 1. Store redesign — make it look like a store

**The problem (admin's screenshot):** the Browse screen is a flat list with "Instant apps" at the top
and "No apps published yet" below it (that second line is the APK section, which is empty). To anyone
looking at it, the screen appears broken.

**Decided:**
- Browse splits into two clearly-labelled halves: **"Play instantly"** (web apps, nothing to install)
  and **"Install (Android)"** (APKs). Two different products; they must never share one list again.
- App cards get: icon, name, one-line description, category, run count. An app page gets screenshots
  and a big primary action (Play / Install).
- Categories (Games, Tools, Education, …) — the APK store already has `STORE_CATEGORIES`; instant
  apps should reuse the same list rather than inventing a second taxonomy.

**The design constraint that actually matters:** the store has ONE app in it today. A Play-Store grid
looks broken with one app and great with a hundred. The layout must be built to look deliberate at
both ends — that is the real design work, not "add a grid".

---

## 2. Publish straight to the store (post-moderation)

**Admin's ask:** publishing should put the app on the store immediately, not wait for review.

**Decided: yes, with the safety moved rather than removed.**
- Publish → the app is **listed immediately**.
- Automated pre-checks at publish time (the existing secret scan, plus a phishing-shaped check: does
  the app ask for a password, OTP, card or bank detail?). A hit holds the app for review instead of
  blocking publish outright.
- Report button on every app (already live), an admin queue, and a one-tap takedown that really
  deletes the bytes (already live).

**The honest risk, stated once so it is not forgotten:** these apps run on `navbharatai.com`. A fake
login page published by a stranger wears NavBharatAI's domain and NavBharatAI's trust. That is a
different risk from an APK (which cannot touch the device here) but it is not zero — it is a
reputational and legal one. Post-moderation is the accepted trade; it is only acceptable *with* the
automated checks and a fast takedown, not on its own.

---

## 3. Mobile app: what it may and may not do

**Decided:**
- Free apps: full experience in the phone app, including remix. No money, no rules engaged.
- Paid apps (once §4 ships): the phone app **plays** them, and shows **no price, no buy button, and
  no link or text pointing anywhere to buy**.
- Instead: a **"Save for later"** button. It saves the app to the user's own list; when they next
  open NavBharatAI in a browser, the app is waiting there with its price and buy button.

**Why not the alternatives the admin proposed (all considered, all rejected on evidence):**

| Idea | Verdict |
|---|---|
| Rename "Buy" → "Edit this app", open Chrome to the purchase page | ❌ Review looks at what the flow *does*, not the label. Disguising it reads as deliberate circumvention, which both stores treat more harshly than an honest mistake. |
| Plain text "purchase on navbharatai.com" + a copy button | ❌ The rule covers "buttons, external links, **or other calls to action**". Naming the destination *is* the call to action — which is why Netflix's app does not name its website. A clipboard copy is a link with an extra step. |
| Google/Apple in-app billing with +30% on the price | ❌ Pricing higher in-app is legitimate and common, but their money **comes to NavBharatAI first** and cannot be split at source. That drags back the entire payout/KYC/TDS burden §4 exists to avoid — and means building two payment systems instead of one. |
| **"Save for later" (no price, no link, no purchase in-app)** | ✅ **Chosen.** Saving is an ordinary app feature no store objects to, and it preserves the user's intent better than a line of text they would have to remember. Safer *and* more effective. |

**What CAN be said safely in the app:** a statement of fact with no destination — *"Paid apps can't be
bought in the app."* What cannot: anything that names where to go.

**Uncertainty recorded honestly:** Apple loosened anti-steering in the US (2025) and the EU (DMA);
Google was forced to allow alternative billing in India after the CCI case. Whether India currently
permits an in-app external purchase link could not be verified from a Claude session, and it changes.
The chosen design **does not depend on the answer** — which is exactly why it was chosen. If it later
becomes clearly permitted on Android in India, opening it there is easy; closing it again is not.

---

## 4. Paid remix — money straight to the creator's bank

**The model (replaces the shipped wallet-to-wallet one):**

1. The creator connects **their own Cashfree account** once (bank + PAN). Until they do, they cannot
   set a price — this is what the admin originally asked for, attached to the right price.
2. A buyer on the **web** taps buy → makes a **fresh payment** (UPI/card) → Cashfree **splits it at
   that moment**: the creator's share to the creator's account, the platform's share to ours.
3. Money reaches the creator's bank on Cashfree's normal settlement cycle (T+1/T+2).

**Why this and not the wallet:** NavBharatAI never holds the creator's money. No payout system, no
KYC storage burden on us, no "we owe creators ₹X" liability on the books, and no wallet-to-bank
question at all. The one-way wallet stays exactly as it is: top-ups buy builds, and nothing else.

**What this costs:** the buyer pays freshly each time (not from wallet — the admin confirmed:
*"wallet se kuch purchase nahi ho sakta, wallet ka paisa keval app banane me use hoga"*), and the
creator must complete a one-time onboarding. A student who made a game for fun will not bother — which
is correct: they publish free, and free is the store's growth engine.

**What survives from the parked code (do NOT rewrite these):** the undercut rule
(`resalePriceCheck` / `resalePriceFloor`), one-purchase-per-buyer idempotency (`purchaseDocId`),
remix lineage (`recordRemixOrigin`), the `.env.example` key delivery, and the "deliver files first,
charge after" order. Only the *payment rail* changes.

**Must be verified before building (not guessable from here):**
- Whether Cashfree's split product needs each creator to hold a full merchant account or a lighter
  "vendor" registration — read Cashfree's own documentation, do not assume.
- TDS (as an e-commerce operator) and GST on the platform's commission — **a CA decides this**, not a
  Claude session and not the admin's guess.
- Whether the platform's share can be taken at split time or must be invoiced separately.

---

## 5. Monetize credentials — three doors, one destination

**Already true (verified in code):** the Monetize wizard (`MonetizationWizard.tsx`) already captures
the user's payment credentials and already writes them, encrypted, into **Settings → App Settings →
Secrets & API Keys** — the same pattern `DatabaseSettings.tsx` uses. The admin's requirement is
therefore ~80% built.

**Still to do:**
- Add a **Monetize** tile to App Settings (its tiles today: Domain, Hosting & Deploy, Database,
  Authentication, Storage, Secrets & API Keys, Logs, Git — no Monetize). This is the second door.
- Keep all doors writing to the one vault. Never introduce a second store of payment credentials.

**One technical truth that must reach the user, not be hidden:** an INSTANT app has no server of its
own. Razorpay and Cashfree checkouts need a small server, so inside an instant app only **UPI** and
**AdSense** can work today — which the Monetize screen already labels "No server needed". If we want
card payments inside instant apps, NavBharatAI has to provide that small server. That is a separate
piece of work and must not be implied as working before it exists.

---

## 6. Order of work, and what triggers each part

| # | Work | Build it when |
|---|---|---|
| 1 | Store redesign + APK/Instant split | Whenever — it is pure product quality and carries no risk. Highest value per rupee right now. |
| 2 | Publish-immediately + automated abuse checks | With #1. They belong to the same screen. |
| 3 | Monetize tile in App Settings | Small; bundle with #1 or #2. |
| 4 | "Save for later" | Only meaningful once paid apps exist — build it **with** #5, not before. |
| 5 | Cashfree split + creator onboarding | **When there is real demand**: creators actually asking to sell, or enough store traffic that a sale is plausible. Needs a CA and Cashfree's documentation first. |

**The sequencing rule behind this table:** #5 is the expensive one (legal counsel, a new payment
integration, creator onboarding UX) and today its revenue is exactly ₹0 — nobody has sold a remix.
Building payment rails before the first sale is spending real money on a hypothesis. #1–#3 make the
store worth visiting, which is what produces the demand that justifies #5.

---

## 7. Decisions that are CLOSED (do not re-open without the admin)

- The wallet is **one-way**. Top-ups buy builds. Nothing is ever withdrawn from it, and nothing is
  ever bought with it except builds.
- Paid remix = **fresh payment every time**, on the **web**, split by Cashfree into the creator's own
  bank. Not wallet-to-wallet.
- **No purchases inside the Android/iOS app**, and no link or text pointing to where to buy.
- Free remix stays free and stays the default — it is the store's growth engine.
- The undercut rule stands: a resale must cost **more** than the original, however much it was edited.
- API keys are never sold with an app; the buyer always brings their own.

---
---

# PART B — "App Mart": the ad-funded creator economy (agreed 2026-08-16)

**Status: WRITTEN, NOT BUILT — and deliberately so.** The admin's instruction: *"abhi app me build
nahi karna, plan bana kar ready rakho — jab app chalne lag jayegi tab apply kar denge. App Mart bhi
baad me karna."*

**Read this first, because it reframes everything in Part A:** NavBharatAI is **not launched yet**.
It is in a testing phase with ~12 testers. Any argument of the form "the store only has 4 runs" is
therefore a statement about a pre-launch product, not evidence that nobody wants this. The correct
conclusion is exactly what the admin drew: design it now, build it when there is traffic to fund.

## B0. The idea, in one line

The YouTube model, for apps: **creators publish, users play free, ads pay for it, and creators earn a
share** — settled monthly. Three parties: the **admin** (platform), the **creator** (built the app),
the **user** (plays it).

The reason this model is worth building is that it aligns all three: the creator wants plays, the
platform wants plays, the advertiser wants attention. Nobody wins by cheating the others. The paid
remix of Part A stays as the creator's second income stream — ads are the first, because they need
nothing from the user.

## B1. Where App Mart lives

- **Rename:** "Nav App Store" → **"App Mart"**. Short, memorable, and "mart" reads as familiar and
  Indian rather than borrowed.
- **Placement:** OUT of "Other" — a **5th tile on the homepage**, alongside the existing four.
  This is the single highest-value change in this whole document: a store buried two taps deep does
  not get visited, and every other item here depends on people actually arriving.
- Both halves live under it: **Play instantly** (web apps) and **Install (Android)** (APKs), still
  clearly separated per Part A §1.

## B2. When an ad plays — the admin's rules, and why they are right

**The rules, as decided:**
1. An ad plays **when an app is opened**. Never inside the app, never mid-play.
2. If an app has **multiple levels or stages, the whole thing plays uninterrupted** — no ad between
   levels. One ad, then the app is theirs.
3. **The first 3 apps a user opens are ad-free**, ever — a new visitor must not meet an ad wall.
4. **Pro Pass holders see no ads at all.** (This also gives the Pass a reason to exist that a user can
   feel, which is worth more than the ad revenue lost.)

**Why the "one ad at open" rule is stronger than it looks:** an instant app has to compile and load
anyway, and that wait is dead time the user already pays. Putting the ad exactly there means the ad
costs the user *nothing they were not already spending* — the loading bar becomes the ad. This is the
rare case where the monetisation and the experience improve together, and it is the reason not to
"optimise" this later into more ad slots.

**The honest trade-off, recorded so nobody is surprised:** one ad per session earns far less than
YouTube-style repeated ads. That is a deliberate purchase of retention over per-session revenue. If
revenue ever has to rise, the next slot to consider is **game-over** (a natural pause, not an
interruption) — but that is a future decision, not a shipped default, and it needs the admin.

## B3. The technical fact that shapes the whole design: the ad cannot live inside the app

Store apps run in a **sandboxed, opaque-origin iframe** with no `allow-same-origin` — that is what
makes running a stranger's code in a viewer's browser safe (Part A / `WebAppPlayer.tsx`). Ad networks
need cookies and storage that an opaque origin denies, so **an ad script simply will not work inside
the app frame**, and weakening the sandbox to make it work is not an option that will ever be taken.

**So the ad runs in OUR player shell, outside the app frame** — full screen, before the app is
handed over. This is not a workaround; it is better in every direction: our origin, our ad code, our
control over frequency, and the app's security envelope untouched. It also happens to be exactly what
rule B2.1 describes, so the design and the constraint agree.

## B4. Ad source: Google now, direct advertisers later — and the slot must not care

**DECIDED (admin, 2026-08-16): start with Google** (AdMob for the Android app, AdSense for the web).
It fills inventory automatically, pays per impression, and needs no sales team.

**Direct advertisers stay the destination, not the starting point.** Selling ads directly is a
separate business — finding advertisers, rate cards, invoices, creative approval, campaign reports —
and no advertiser buys space on a platform before it has an audience. The engineering decision that
matters is therefore this one:

> **Build the ad slot so it does not care where the ad comes from.** One interface: "give me an ad,
> tell me it was seen." Google fills it on day one; a direct advertiser fills the same slot later
> without a rebuild.

Getting this one interface right at the start is what makes the switch a configuration change instead
of a rewrite.

## B5. The money: wallet credit now, bank later — and why the order is forced

**DECIDED (admin, 2026-08-16): ad earnings go to the creator's NavBharatAI wallet for now. When the
platform is genuinely running, a CA and an engineer settle the payout design and "send to the
creator's bank" is enabled then.**

**Why this order is not a shortcut but the only sane one:** ad money is fundamentally different from
a remix sale. A sale can be **split at the moment of payment** so the money never touches us (Part A
§4). Ad money **cannot** — it arrives once a month, in one lump, from Google. There is no way to make
it bypass NavBharatAI. Which means any ad revenue share is, by construction, a **payout business**:
creator KYC, bank details, TDS, minimum thresholds, and the platform holding other people's money.

Sending earnings to the wallet as **build credit** sidesteps all of that on day one, and it is
genuinely useful rather than a token — every creator here is also a builder, so credit funds their
next app. Bank payout gets built when there is enough money in the system to be worth the machinery.

**The one condition that makes this honest:** the UI must say plainly that this is **NavBharatAI
build credit, not cash**, from the first screen a creator sees. Saying "earnings" and revealing later
that it cannot be withdrawn would be the platform profiting from a misunderstanding — the same reason
the wallet-based paid remix was parked in Part A.

## B6. Counting, and the creator's dashboard

Before any money moves, the creator must be able to **see their numbers and believe them**: plays,
ad impressions, and what each is worth, per app, per day. Trust in the count is the product; the
payout is just its consequence.

- Count **impressions**, not opens — an ad that failed to load must never be paid for.
- One honest **monthly statement** per creator, matching what the dashboard showed all month.
- The platform's share and the creator's share stated as a plain percentage, not buried.

## B7. The thing that will actually bite: fraud and spam farming

**The moment "a play = money", plays get manufactured.** This is the single biggest operational risk
in this entire document, and it is not hypothetical — it is what every ad-revenue-share platform
fights permanently.

Expected attacks, and the defences the design must carry from the start:

| Attack | Defence |
|---|---|
| Creator opens their own app 10,000 times | The creator's own views never earn. Per-device and per-IP dedup; a hard daily cap per user per app. |
| A farm of devices / scripted opens | Rate limits, impression verification from the ad network's own callback (not our word), outlier review before payout. |
| 500 junk apps published to harvest impressions | A per-creator publishing limit, and earnings eligibility only after an app clears review. |
| Someone republishes another creator's app | Lineage already exists (`recordRemixOrigin`); a copy must not out-earn its original. The undercut rule's spirit applies here too. |

**⚠️ AND A DECISION FROM PART A HAS TO BE REVISITED.** Part A §2 decided apps get **published
immediately** with post-moderation. That was correct when publishing earned nothing. With money
attached to plays, "publish instantly, review later" becomes a spam farmer's front door — and worse,
Google's ad policies hold **us** responsible for what runs next to their ads. An ad account
suspension would end the whole model overnight.

**OPEN QUESTION FOR THE ADMIN (not decided):** should review return for all new apps, or only for
apps that are **earning** (i.e. free-to-publish, but a human check before an app becomes
ad-eligible)? The second keeps publishing frictionless and puts the gate exactly where the money is —
that is the recommendation, but the admin decides.

## B8. Honest economics — so expectations are sized correctly

Rough Indian rates: **₹20–₹80 per 1,000 impressions** for display; rewarded video pays several times
more. Google keeps its cut before we split anything. These are ballpark figures that move with
category, season and traffic quality — they must be re-measured against real numbers, never quoted as
promises to a creator.

What that means in practice: a creator needs roughly **25,000–100,000 plays a month to earn ~₹1,000**.

Two conclusions follow, and they are the reason this whole part is scheduled after Part A §1:
1. **Audience first, monetisation second.** An ad system on a platform with no traffic is a toll booth
   on an empty road.
2. **Never promise a creator an amount.** Show them their real numbers (B6) and let the number speak.

## B9. Build order for Part B

| # | Work | Build it when |
|---|---|---|
| 1 | Rename to **App Mart** + 5th homepage tile + the Part A §1 redesign | First. Zero risk, and it is the fuel every later item burns. |
| 2 | The **ad slot** in the player shell — source-agnostic, first-3-free, Pass = ad-free | After #1, when there is traffic worth showing an ad to. |
| 3 | **Google (AdMob/AdSense) fill** + impression verification | With #2 — it is the first source plugged into that slot. |
| 4 | **Counting + creator dashboard** | With #3. Creators see numbers before any money exists. |
| 5 | **Earnings → wallet build credit**, labelled honestly | After #4 has run long enough to trust the numbers. |
| 6 | **Fraud defences** (B7) | NOT last — they must ship WITH #5, because #5 is what creates the incentive to cheat. |
| 7 | **Bank payout** (CA + engineer, per B5) | When real money is in the system and the admin says go. |
| 8 | **Direct advertisers** | When traffic can command a rate card. |

## B10. Must be verified before building (not guessable from a session)

- **AdMob/AdSense policy on user-generated content.** Ads running beside apps strangers uploaded is
  exactly the situation those policies scrutinise. Read the current policy; an account suspension is
  an extinction-level event for this model, not a setback.
- **Play Store policy** on an app that shows ads over third-party content.
- Whether **rewarded ads** (opt-in, much higher paying) fit rule B2 better than a plain interstitial —
  a user choosing to watch an ad is not an interruption at all.
- Real CPM once traffic exists — replace B8's ballpark with measurements before anyone is paid.

## B11. Part B decisions that are CLOSED (do not re-open without the admin)

- Ads play **at app open only** — never inside the app, never between levels of a multi-stage app.
- **First 3 apps ad-free**; **Pro Pass = no ads**.
- Ad money goes to the creator's **wallet as build credit** now; **bank payout is enabled later**,
  after a CA and an engineer settle it.
- **Google is the first ad source**; direct advertisers come later, into the same slot.
- The ad **never runs inside the app's sandbox** — the sandbox is not weakened for revenue.
