# Flexible provider load tests: 1 to 10,00,000 (10 lakh)

Admin → AI Engines → Provider testing bots → **Concurrent CheaperInference batch**.

- **Attempts** and **Concurrent requests** can each be any number from 1 to 1,000,000. The old fixed caps (32 at runtime, 160 / 10,000 in the store) are gone.
- Ops can **lower** the ceiling per deployment with `PROVIDER_LOAD_MAX_ATTEMPTS` and `PROVIDER_LOAD_MAX_CONCURRENCY`. They can never raise it past 1,000,000.
- **Budget guard (unchanged and binding):** every attempt reserves `maxAttemptNanoUsd` against `totalBudgetNanoUsd` before it is dispatched. Save is rejected (`invalid`) when `concurrency x max attempt cost + prior spend > budget`, so a concurrency setting the budget cannot fund is refused up front.
- **Waves / lanes:** a Firestore transaction allows 500 writes, so one wave claims at most 400 attempts. The admin UI runs `ceil(concurrency / 400)` parallel waves (up to 2,500 lanes, enough for 10 lakh).
- **Distinct questions (t117u):** every attempt gets its own synthetic prompt (`synthetic-v1-<ordinal>`, numbers derived from the ordinal). `loadCorpusHash` rejects any corpus with a repeated prompt, so a cache cannot fake success. Any external script must also send a unique prompt per request, for example the attempt index plus a random id.
- The corpus and its hash are memoized per count, so parallel waves do not rebuild 10 lakh prompts.
- **Surplus:** stays **single-test only** (no concurrent batch path). This PR does not add one. Concurrent Surplus load needs a separate admin-token script that sends distinct prompts.
- Realistic limits: supplier RPM/429, Cloud Run instance limits and Firestore contention will throttle very high concurrency long before 10 lakh. The budget is still the hard spend stop.
