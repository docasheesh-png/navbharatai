# BR1976 — the prompt was "App" and a billed stub was invented

Scope: BR1976 only, inside the frozen audit boundary 1951..2105. Branched from `5a529fbb794b2ad41e67bf75e71d6d5462b2c799` (the #4168 squash-merge of exact BR1975 head `dbdf68bb1`, which is origin/main at branch creation). The parent reviews and merges this PR; BR1977 is not started. Nothing was replayed, deployed or reconfigured; no provider was called. `get_failed_build_autopsy` is a failed-build endpoint and returned "Failed report not found" for this succeeded report — read only via `get_build_report`, no remote autopsy write.

## What the user asked

"App" (3 characters / 1 word). The whole prompt is that category noun. Full text is in the evidence file.

## What happened (IST, 2026-11-08)

1. **09:47:22.** FREE_BUILD_TIME_CAP 25 min. APP_SCOPE ordinary one-shot (not a mega-project). TIER_LADDER Weak default. COMPLEXITY_ROUTING simple score 15 (source=model) — opens on the first rung. Surplus admitted (qwen3-coder). ETA ~4–10 min (midpoint ~5.9, blended, confidence 0.86). PROJECT_MODE is ON for the account, but the prompt is not a mega-project — normal path. REQUEST_SCOPE_NOTE: no sign-in words, so no login/accounts were added. CHANGE_CLASSIFIED: "New app (0 part(s) named) — no earlier app on record to preserve".
2. **09:47:28–09:48:31.** No clarify, no offer, no `OUTCOME_ASKED_USER`. The planner was told "Plan the file list for this app:" and then the single word `App`. Fast lane 60.3 s (plan 6.2 / contract 2.8 / generate 28 / verify 8.1 / repair 0). SIMPLE_BUILD_SUCCESS, 7 files. DESIGN_KIT_KEPT (stylesheet rewrite dropped kit rules; they were restored). WRITE_TIME_TYPECHECK never ran (fast-lane bulk write). READY_BEFORE_END: "The app was never judged finished during the build."
3. **09:48:42.** First real-browser render at 80 s. IN_BUILD_GREEN_RACED (a file was written while the preview was opening; no snapshot; will try again). Later PREVIEW_SNAPSHOT_SAVED / PREVIEW_SNAPSHOT_CURRENT / GREEN_GUARD_SAVE. This race is the existing Q-024 / BR1960 D09 class, not a new DNA defect.
4. **09:48:44–09:49:15.** OUTCOME_BUILD_SUCCESS. JOURNEY_NOT_DERIVED (no data-entry surface). MOBILE_LAYOUT_OK at 390×844. EXPLORE_PASSED: pressed "Get Started" — "it responded (nothing visibly changed)". RELEASE_GATE GREEN. Charged: billed ₹0.10, wallet debited ₹0.09 after the 10% BUILD_DISCOUNT (9 tokens). Sandbox cost $0.005127. Ended 09:49:15 (112705 ms / 1.88 min). ETA ratio 0.319, UNDER the 4.0–9.9 min band.

Outcome **succeeded** (`ok=true`). Truncation complete. counts.unresolved is 1 (`IN_BUILD_GREEN_RACED`, info, autoResolved false). Manifest 15 files, including the delivered `src/App.tsx`.

## The real delivered tree (not a reconstructed model)

The Surplus generate call wrote this exact `src/App.tsx` (llmCalls[6], 615 response chars, `<<<FILE src/App.tsx>>>`):

```tsx
import { AppProps } from './types'
import './index.css'

export default function App({}: AppProps) {
  return (
    <div className="container">
      <div className="stack center" style={{ minHeight: '100vh' }}>
        <div className="card stack center" style={{ maxWidth: '400px', width: '100%' }}>
          <h1>Welcome to Your App</h1>
          <p className="muted">This is the main screen of your application.</p>
          <div className="row">
            <button className="btn-primary">Get Started</button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

DOM: `div.container` > `div.stack.center` (minHeight 100vh) > `div.card.stack.center` (maxWidth 400px) > `h1` "Welcome to Your App" + `p.muted` + `div.row` > `button.btn-primary` "Get Started". The button has no `onClick` (or any other handler). There is no site header and no `.nb-header`. `index.html` title is `App`. `package.json` name is `project`. Commands: `npm install` (up to date, 883 ms) and `npm run dev` (Vite 8.3.2 on 5173).

The user-facing DNA is not a phone-layout failure. It is that a category word produced a billed generic shell whose only control does nothing.

## Root cause (F1)

`assessBuildInput('App')` already returns `{ buildable: false, reason: 'no-object' }` — `'app'` has been a placeholder noun since the 2026-09-17 objectless-ask ruling (`"agar koi user send karega 'app banao' to navbharatai kon sa app banayega?"`). `shouldAskWhatToBuild` would ask on an empty or starter-only workspace with no earlier buildable turn. The route already ORs that with the reader's `unclear` and converts the turn to chat + chips.

That gate did not save this turn. A second, earlier layer disagreed with it:

- `classifyIntentWithConfidence('App')` is `{ intent: 'new_build', confidence: 'low', signal: 'build-signal' }` because `BUILD_SIGNALS` lists the noun `app`. Unlike `"Bnao"` (chat / low / short), the keyword pass itself names a build.
- `buildConfirmation('App')` then confirmed the build with reason `names-something-to-build`, because `PRODUCT_NOUN` matches `\bapps?\b` (and website / application / site). High-confidence orders are not the path here — confidence is low, so the match falls through to the product-noun rule.
- `offerToBuild` is therefore false. The only remaining protection is `askWhatToBuild`'s four narrowing conditions (starter-only workspace by content, no edit intent, no earlier buildable turn, no import or attachment). When any one of those misses, `"Bnao"` is still unconfirmed and becomes an offer; `"App"` proceeds to the Surplus fast lane and invents a stub.

The contradiction was locked as a feature: `AppKnowledgeBase` told users `say "app"` if they wanted an app with Excel export instead of a spreadsheet file, and `tests/aPromiseToTheUserHasAHandler.test.ts` required `reachesConfirmedWork('app')` for that extracted promise.

## Prevention classes in this PR

| Fix | Class | Where | Locks |
|---|---|---|---|
| F1 | A category word is not a deliverable — `buildConfirmation` must not treat a `namesNoObject` message as `names-something-to-build`, even when `PRODUCT_NOUN` matches. | `buildConfirmation.ts` (after the high-confidence and question branches; `namesNoObject` from `buildableInput.ts`) | `tests/aBuildStartsOnlyWhenAskedFor.test.ts` (`App` / `app` / `APP` / `website` / `application` / `an app` are `names-nothing-to-build`; `calculator`, `todo app`, `shop app banao`, `build a notes app`, `ek billing app banao`, `continue`, `fix the login button colour`, `make it real` still confirm). `tests/objectlessBuildAsks.test.ts` (bare category words are `no-object`). `tests/aWordThatNamesNothingIsAskedAbout.test.ts` (`App` on a starter workspace is still asked about). The knowledge-base line no longer says `say "app"`; the promise-handler census no longer treats `app` as confirmed work. |

High-confidence orders (`make an app`, `app banao`, `build a website`) stay `explicit-order` in `buildConfirmation` — the existing ask-what-to-build gate still asks about them, and widening the confirmation change into that branch would also touch platform suggested replies such as "add it to this app". That is left alone on purpose.

## Side-effect review (owner rule t311u)

| Fix | Adjacent behaviour checked | Side-effect risk | Decision |
|---|---|---|---|
| F1 `namesNoObject` rejects confirmation after the high-confidence block | Happy-path `App` on a starter workspace still hits `askWhatToBuild` (chips, not a generic offer — `clarifyWhatToBuild` beats `answerThenOffer`). If that gate misses, the turn now offers instead of building a stub. `calculator` / `todo app` / `shop app banao` / `build a notes app` / `ek billing app banao` / `continue` / `fix the login button colour` / `make it real` still confirm. `"make an app"` / `"app banao"` remain high-confidence explicit-order (unchanged) and are still asked about downstream. Suggested replies that are high-confidence edits stay confirmed. `MIN_INSTRUCTION_WORDS` stays 2; `too-short` is still not diverted (`calculator` still builds). Spreadsheet guidance still points at `"build an app with Excel export"` without telling the user to send the word `app`. | A user who types only `App` and expected a generic shell will now be asked what to make (or offered, if the ask gate misses). That is the admin ruling. | Ship. Mutations: drop the `namesNoObject` check (bare `App` confirms again); also confirm `calculator` / `todo app` neighbours must stay green. |
| Repair the dead "Get Started" button, or add a default onClick | Symptom of the invented stub. The real `App.tsx` has no handler because nothing was specified to start. | Teaching the fast lane a prettier empty shell keeps billing people for category words. | Do not ship. |
| Retune the ETA band or the under-band verdict | The stub finished in 1.88 min against a 4.0–9.9 min unsized-app band *because* almost nothing was asked for. | Billing / ETA policy. | Do not ship. |
| Treat `IN_BUILD_GREEN_RACED` as new DNA | A later snapshot was saved and became current. Same race as Q-024 / BR1960 D09 / BR1967. | Bookkeeping-only churn. | Do not ship. |
| Change the GREEN release gate so a no-op CTA cannot pass explore | Explore reported the truth: the button responded and nothing visibly changed. The gate was green because the stub did not crash. | Changing a measured verdict. | Do not ship. |
| BR1975 optional residuals (24 px tap targets, the 641–649 px band, `nav > ul` tightening) | This report is a 390 px phone-ok generic card with no header nav. The same reasons BR1975 did not ship them still apply (`min-height` does nothing on inline `a`; the sliver is 9 px and was not this report). | CSS neighbour risk for no evidence here. | Do not ship. Do not queue. |
| Q-2649..Q-2652 and earlier carried rows | None of them appear in this report (no store-open language; not a path-only game prompt; not an unexplained asked-user empty build; not a project-mode game module). | Out of scope. | Carry unchanged. Do not implement. |

## Queue

This commit closes no earlier row and opens no new row. Q-2649, Q-2650, Q-2651, Q-2652, Q-2648, Q-2647, Q-2646, Q-2645, Q-2644, Q-2643, Q-2642, Q-2640, Q-2621, Q-2611, Q-2375 / Q-1068 and earlier blockers stay open. Q-2238 stays open as the parent of Q-2651.
