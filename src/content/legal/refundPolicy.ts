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
// 🔒 IT MUST NEVER CONTRADICT THE TERMS. Section 4 of the Terms is the contract; this document is
// that contract stated in full, in the order a person with a refund question actually asks. Every
// number here — the 7-day window, "unused", "a failed build is never charged", "where usage cannot
// be measured nothing is charged" — is the same number the Terms carry and the same behaviour the
// code enforces. If one of them is ever changed, BOTH must change in the same commit; the Terms now
// link here, so a reader will see the two side by side.
//
// ⚠️ NOT LEGAL ADVICE — for lawyer review before reliance. Assumed defaults the admin can change,
// carried over from the Terms plus two this document has to state that the Terms left open:
//   • refund of UNUSED purchased credit within 7 days of purchase, on request;
//   • a purchase whose credit is ENTIRELY unused is refunded IN FULL, platform fee included — we
//     absorb the gateway's own charge rather than return a number smaller than the one on the
//     customer's statement. A PARTLY used purchase refunds the unused credit only;
//   • money reaches the original payment method within 7 working days of approval, plus whatever
//     the customer's own bank adds.
// Change any of these and change Terms Section 4 with it.

export const REFUND_POLICY_TITLE = 'Refund & Cancellation Policy';
export const REFUND_POLICY_UPDATED = '20 September 2026';

export const REFUND_POLICY = `# Refund & Cancellation Policy

**Last updated: ${REFUND_POLICY_UPDATED}**

This policy explains when you can cancel, when you get your money back, how long it takes, and what to do if you think we got it wrong. It applies to everything you can pay for on **NavBharatAI** — wallet credit, hosting plans, and purchases in **App Mart**, our in-app store.

It is the full statement of the refund rules summarised in **Section 4 of our [Terms of Service](/terms)**. Where this page and the Terms describe the same rule, they mean the same thing.

**The short version:** credit you have not used is refundable within 7 days. A build that fails is never charged in the first place. Nothing you have made is ever deleted because of a payment question.

---

## 1. What you are buying

NavBharatAI sells **prepaid usage credit** ("tokens"). Credit is not a subscription and not money in a bank: you add it to your wallet, and building an app or using an AI assistant draws it down according to what the work actually cost.

Two consumer-protection rules are built into the Platform itself, not just promised here:

- **A build that was meant to produce an app and did not succeed is not charged.**
- **Where usage cannot be measured, nothing is charged** — we absorb it rather than estimate a number and bill you for a guess.

So the commonest reason people ask for a refund elsewhere — "it did not work and I was still charged" — is handled before it becomes a refund at all. If you were charged for a build that did not work, that is a defect on our side: tell us and we will re-credit it.

## 2. Cancelling

- **Before you pay:** close the payment page. No order is created until the payment succeeds, and an abandoned checkout charges nothing.
- **Your account:** you can stop using NavBharatAI at any time, and you can delete your account yourself from [Account & data deletion](/delete-account). Deleting your account does not forfeit a refund you are already entitled to — ask for the refund first, or in the same email, so we can reach you about it.
- **Hosting and other plans:** a plan renews as described when you buy it, from your wallet, with reminders before each renewal. You can turn renewal off at any time and keep the plan until the period you have paid for ends. **A lapsed or cancelled plan never deletes anything** — it suspends only that plan's own feature, and your apps, files and account remain yours.

## 3. Refunds on wallet credit

- **Unused credit is refundable within 7 days of the purchase**, on request. "Unused" means the credit from that purchase is still sitting in your wallet.
- **Partly used purchase:** we refund the part you have not used. The part already spent on delivered work is not refundable.
- **Entirely unused purchase:** we refund **the full amount you paid**, including the platform fee shown at checkout. We absorb our own processing cost rather than hand back a smaller number than the one on your statement.
- **After 7 days** your credit does not expire — it stays in your wallet and remains usable. It simply stops being returnable as cash.
- **If a Platform defect consumed your credit without delivering what was promised, we re-credit it** — and that is not limited to 7 days, because the fault is ours.
- **Gift, welcome, referral and promotional credit** has no cash value and is not refundable. It is spent before your purchased credit, so a refund of purchased credit is never quietly reduced by a bonus you were given.

## 4. How to ask for a refund

Email **info@navbharatai.com** from the email address on your NavBharatAI account, with:

1. the **order ID** or the date and amount of the payment (you can see both in **Billing → Invoice Records**);
2. one line on **why** — you do not have to justify an unused-credit request inside the window, but if something went wrong we would like the chance to fix it.

**What happens next:** we acknowledge within **2 working days** and tell you the decision, with the reason, within **5 working days**. If we approve it, the money is sent back **to the original payment method within 7 working days**. Your own bank or card issuer may take a further 2–5 working days to show it — that part is outside our control, and we will give you the reference number so you can ask them.

## 5. Payments that went wrong

- **Money taken, credit not added.** This should correct itself: the Platform reconciles unfinished payments automatically and credits them the next time you sign in, so an interrupted UPI payment is not lost. If it has not appeared within 24 hours, email us with the order ID and we will settle it by hand.
- **Charged twice.** Send both order IDs; a genuine duplicate is refunded in full, and the 7-day window does not apply to it — a duplicate was never a purchase you made.
- **A payment you do not recognise.** Write to us before raising a chargeback if you can. We can usually identify it the same day, and a chargeback locks the amount for weeks while the banks work through it, which helps neither of us.

## 6. Purchases made inside the Android or iOS app

If you bought credit **inside our mobile app through the app store's own billing**, that payment belongs to the store, not to us — we never see your card. Refunds for those purchases are requested from the store itself, under its own policy and timelines. Write to us anyway if the store refuses and you believe the request was fair: we can credit your wallet directly instead, which is often faster than arguing with a store.

## 7. App Mart purchases

Apps sold by their creators in **App Mart** are **not refundable**, and the reason is built into the product: every such app can be **run for free before you buy it**, so you are never buying something you have not tried. If an app you bought does not work as described, or its listing misled you, tell us — we act against listings that misrepresent themselves, and we will refund you where the listing was at fault.

## 8. If you are not satisfied with our decision

Write to our Grievance Officer. The [Grievance Redressal](/grievance) page names the officer, gives the address, and states the timelines we are required to answer within under the Information Technology (Intermediary Guidelines) Rules, 2021.

Nothing in this policy limits your rights under the **Consumer Protection Act, 2019** or any other Indian law that applies to you. Where this policy and your statutory rights differ, your statutory rights win.

## 9. Changes to this policy

We may update this policy. A change applies to purchases made **after** it is published — never retroactively to credit you already hold. The "last updated" date at the top of this page always reflects the version in force.

---

**Contact:** info@navbharatai.com · [Terms of Service](/terms) · [Privacy Policy](/privacy) · [Grievance Redressal](/grievance)
`;
