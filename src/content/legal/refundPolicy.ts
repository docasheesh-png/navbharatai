// NavBharatAI — Refund & Cancellation Policy.
//
// WHY THIS IS ITS OWN DOCUMENT rather than a paragraph inside the Terms (2026-09-20). The refund
// rules already existed and were already published — Terms of Service Section 4. What did not exist
// was a URL whose PAGE IS THE REFUND POLICY. A payment aggregator's onboarding check, and India's
// payment-aggregator norms behind it, ask for a separately addressable refund/cancellation policy,
// and "it is halfway down our Terms" is not an address anyone can check. The same reasoning that
// gave /privacy and /terms server-rendered URLs applies here, for the same audience: a reviewer or
// a crawler that may not run JavaScript.
//
// 🔴 REWRITTEN 2026-09-21 ON THE ADMIN'S OWN RULING, WHICH REVERSES THIS DOCUMENT'S CENTRAL TERM.
// The first version promised a refund of UNUSED purchased credit within 7 days, refunded IN FULL
// including the platform fee. Both halves were a SESSION'S ASSUMPTION, never the admin's decision —
// the header said so at the time ("assumed defaults the admin can change") and that warning sat in
// a code comment the admin never reads. Shown the arithmetic, they ruled, verbatim:
//
//   • *"jab cashfree wapas nahi karta to ham kyu kare"* — we do not absorb the gateway's fee.
//   • *"agar kisi user ke credit khatam ho gaye, navbharatai ki galti se to credit/token wapas
//     milenge? ₹ nahi."* — our own defect is repaid in CREDIT, never in cash.
//   • *"agar user ne ek bar navbharatai me payment kar diya to woh non refundable hai."*
//   • *"paise dete hi, user paid user ban jayega, navbharatai pro, ke sabhi teeno tier unlock ho
//     jayenge."* — the justification, and the reason this is not "money for nothing".
//
// 🔒 THE LAST POINT WAS VERIFIED IN CODE BEFORE IT WAS WRITTEN INTO A PUBLISHED LEGAL DOCUMENT,
// because a policy may not assert a behaviour the Platform does not have. The chain is:
//     powerUnlocked = isAgentV3FreeUser(uid, email) || (!!uid && !isFreeTierUser(wallet))
//     isFreeTierUser(w) = !hasEverPaid(w)                              [FreeTierBuildRouting.ts]
//     walletMayBuyWithItsBalance(w) = lifetimeMoneySpentInr(w) > 0 || w.lastRechargeAt  [giftSpend.ts]
//       (renamed from `hasEverPaid` 2026-09-21 — FreeTierBuildRouting exports that name for a
//        deliberately stricter rule, and one name for two money answers is a wrong import waiting.)
// `totalMoneySpent` is a LIFETIME gross total with exactly one writer (`computeCreditedWallet`, on a
// verified purchase) and it is never decremented. So one successful payment unlocks all three tiers
// PERMANENTLY — the entitlement survives the balance reaching zero. That is a real, irreversible
// benefit delivered at the instant of payment, and it is what the policy now says.
//
// ⚠️ TWO THINGS ARE DELIBERATELY *NOT* COVERED BY "NON-REFUNDABLE", and removing them would hurt
// NavBharatAI rather than protect it. Neither is a refund:
//   • a DUPLICATE charge — the customer made one purchase and was billed twice; the second was
//     never a purchase they made. Refusing it produces a CHARGEBACK, which costs the aggregator's
//     chargeback fee on top of the disputed amount and locks that amount for weeks.
//   • money taken with NO credit delivered — nothing was delivered, so there is nothing to keep.
//     The ordinary remedy is to complete the delivery (the reconciler already does this on the next
//     sign-in); a return is the fallback when crediting genuinely cannot be completed.
//
// 🔒 IT MUST NEVER CONTRADICT THE TERMS. Section 4 of the Terms is the contract; this document is
// that contract stated in full, in the order a person with a refund question actually asks. If one
// of them is ever changed, BOTH must change in the same commit — `theRefundPolicyHasItsOwnUrl`
// asserts that neither document offers a cash-refund window and that both state finality.
//
// ⚠️ NOT LEGAL ADVICE — for lawyer review before reliance. Statutory rights under the Consumer
// Protection Act, 2019 are not displaced by a "non-refundable" term, and the document says so; that
// sentence is kept deliberately, because it costs nothing (the law applies either way) and its
// absence is exactly what an aggregator's reviewer looks for.

export const REFUND_POLICY_TITLE = 'Refund & Cancellation Policy';
export const REFUND_POLICY_UPDATED = '21 September 2026';

export const REFUND_POLICY = `# Refund & Cancellation Policy

**Last updated: ${REFUND_POLICY_UPDATED}**

This policy explains what happens to your money once you pay, what you receive in return, and what we do when something goes wrong. It applies to everything you can pay for on **NavBharatAI** — wallet credit, hosting plans, and purchases in **App Mart**, our in-app store.

It is the full statement of the rules summarised in **Section 4 of our [Terms of Service](/terms)**. Where this page and the Terms describe the same rule, they mean the same thing.

**The short version:** payments are **final and non-refundable**, because what you buy is delivered to your account immediately. A build that fails is never charged in the first place. If our own defect consumes your credit, we put the credit back. Nothing you have made is ever deleted over a payment question.

---

## 1. What you are buying, and when you receive it

NavBharatAI sells **prepaid usage credit** ("tokens"). Credit is not a subscription and not money held in a bank: you add it to your wallet, and building an app or using an AI assistant draws it down according to what the work actually cost.

**Your first successful payment does something permanent and immediate.** It makes your account a paid account, and that unlocks **all three build tiers** — including the highest one — for as long as the account exists. This is not tied to your balance: spend every last token and the tiers stay unlocked. You also keep the credit itself, and purchased credit does not expire.

So the moment a payment succeeds, you have received two things in full: the credit, and a permanent upgrade to your account. **That is why payments are final** — the thing you paid for has already been handed over.

## 2. Payments are final

**Once a payment succeeds it is non-refundable.** Purchased credit cannot be exchanged back into money, in whole or in part, used or unused.

Please add credit in the amount you actually intend to use. If you are unsure whether NavBharatAI suits you, **try it before you pay**: a new account can build and publish without spending a rupee, and every app in App Mart can be run for free before it is bought.

**A payment made by mistake is final too.** If you meant to add ₹500 and added ₹5,000, or you topped up when you did not mean to, the full amount is credited to your wallet and stays there — usable, and it does not expire. We cannot turn it back into money. **Please check the amount on the payment screen before you confirm it.**

This is about a mistake *you* made with an amount. A payment you **did not authorise at all** is a different matter entirely, and section 5 covers it.

This applies equally to:

- **purchased credit you have not spent** — it stays in your wallet and remains usable, but it is not returnable as cash;
- **credit already spent** on work that was delivered;
- **gift, welcome, referral and promotional credit** — this has no cash value and is not refundable at any time, and is always spent before credit you paid for, so your own money is never consumed while a bonus sits unused;
- **hosting and other plans**, for the period already paid for.

## 3. What protects you instead

A refund window is the wrong instrument for the thing customers actually worry about, so NavBharatAI answers that worry inside the product rather than after the fact. These are enforced by the Platform, not merely promised here:

- **A build that was meant to produce an app and did not succeed is not charged.** You are not billed for a failure.
- **Where usage cannot be measured, nothing is charged.** We absorb it rather than estimate a number and bill you for a guess.
- **If a defect on our side consumed your credit without delivering what was promised, we re-credit those tokens to your wallet.** There is no time limit on this, because the fault is ours.

**That correction is made in credit, not in money.** It restores you to exactly where you were before our mistake — with the tokens you had — which is the loss you actually suffered.

If you believe you were charged for something that did not work, write to us. Tell us what you expected and what happened, and we will look at the build's own record before answering.

## 4. Cancelling

- **Before you pay:** close the payment page. No order is created until a payment succeeds, and an abandoned checkout charges nothing at all.
- **Plans:** a plan renews as described when you buy it, from your wallet, with reminders before each renewal. **You can turn renewal off at any time** and keep the plan until the period you have already paid for ends. A lapsed or cancelled plan **never deletes anything** — it suspends only that plan's own feature, and your apps, files and account remain yours.
- **Your account:** you can stop using NavBharatAI at any time and can delete your account yourself from [Account & data deletion](/delete-account). Deleting an account does not convert unused credit into money.

## 5. When a payment goes wrong

These are **not refunds**. In each case something failed on the payment rail or on our side, and correcting it is not the same as returning money for a purchase you completed.

- **Money taken, credit not added.** This normally corrects itself: the Platform reconciles unfinished payments automatically and credits them the next time you sign in, so an interrupted UPI payment is not lost. If the credit has not appeared within 24 hours, email us with the order ID and we will settle it by hand. Where crediting genuinely cannot be completed, we return the money.
- **Charged twice for one purchase.** Send us both order IDs — you made one purchase, and the second charge was never a purchase you made, so you do not keep it. You choose how it comes back: **the full amount added to your wallet as credit**, which is immediate, or **the full amount returned to the original payment method**, which takes your bank a few working days. Either way it is the whole of the duplicate charge.
- **A payment you do not recognise.** Please write to us before raising a chargeback if you can. We can usually identify a payment the same day, whereas a chargeback locks the amount for weeks while the banks work through it.

## 6. Purchases made through an app store

If you bought credit **inside our mobile app using the app store's own billing**, that payment belongs to the store, not to us — we never see your card. Any request about it is made to the store itself, under its own policy and timelines, and the store's decision governs.

## 7. App Mart purchases

Apps sold by their creators in **App Mart** are **not refundable**, and the reason is built into the product: every such app can be **run for free before you buy it**, so you are never buying something you have not tried.

If an app you bought does not work as described, or its listing misled you, tell us. We act against listings that misrepresent themselves, and where the listing was at fault we will make it right.

## 8. How to reach us

Email **info@navbharatai.com** from the address on your NavBharatAI account, with the **order ID** — or the date and amount — which you can see in **Billing → Invoice Records**, and one line on what happened. Our [Contact](/contact) page lists what to write about where.

We acknowledge within **2 working days** and answer with a decision and the reason for it within **5 working days**.

## 9. If you are not satisfied with our answer

Write to our Grievance Officer. The [Grievance Redressal](/grievance) page names the officer, gives the address, and states the timelines we are required to answer within under the Information Technology (Intermediary Guidelines) Rules, 2021.

**Nothing in this policy limits your rights under the Consumer Protection Act, 2019 or any other Indian law that applies to you.** Where this policy and your statutory rights differ, your statutory rights win.

## 10. Changes to this policy

We may update this policy. A change applies to purchases made **after** it is published — never retroactively to credit you already hold. The "last updated" date at the top of this page always reflects the version in force.

---

**Contact:** info@navbharatai.com · [Terms of Service](/terms) · [Privacy Policy](/privacy) · [Grievance Redressal](/grievance)
`;
