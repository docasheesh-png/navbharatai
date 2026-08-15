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
