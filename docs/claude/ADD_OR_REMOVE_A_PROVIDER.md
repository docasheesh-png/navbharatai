# How to add or remove an AI provider

Owner t407u. A provider is added or removed from one registry row plus the admin switch. Chat, a build, and a fallback must keep working when a row is removed: that rung drops out, and the next rung runs.

This is incremental. Image generation and vision (including PDFs) already take their membership from `src/server/AI/ProviderHealth/mediaCatalogue.ts`. Chat, professional AI, and the builder still have their own ladders. Do not rewrite those ladders in the same change as a new provider.

## Add a provider

1. **Admin on/off.** Add one row to `PROVIDER_FAMILIES` in `src/server/lib/providerSwitches.ts`: the id, the env key names, and the hosts to refuse while it is off. Switching it off in Admin → AI Engines withdraws those keys. Every ladder already skips a rung that has no key, so the rest of the ladder runs. Do not add a second switch.
2. **What it depends on.** Add the same id to `PROVIDER_UPSTREAM` in `src/server/AI/TrafficRegistry/upstreamFamilies.ts`. The census test fails until this exists.
3. **Billing link, if it has one.** Add one row to `API_PROVIDERS` in `src/server/lib/apiProviderDirectory.ts`. Names only. Never a key value.
4. **Image or vision membership.** Add one row to `MEDIA_CATALOGUE` in `src/server/AI/ProviderHealth/mediaCatalogue.ts`: id, health name, kill-switch family, key names, and which door (`vision`, `generator`, or `app`). The door tries the row only when that door already has an adapter for the id. A row with no adapter is skipped.
5. **The adapter, once.** One function in the door that already speaks that protocol (`visionChain.ts`, `routes/imageGen.ts`, or `navbharatImageEngine.ts`). It returns no picture or no text on failure. It does not throw out of the ladder.

Chat and the builder are not edited for an image or vision provider. A chat or builder provider is still a rung in `src/server/AI/FreeChain/config.ts` or `src/server/AgentV3/tierLadder.ts`, plus the same family row in steps 1–3. Those two ladders are the next consolidation, one ladder per change, after this catalogue.

## Remove a provider

- **Turn it off, no deploy.** Admin → AI Engines, switch that family off. Keys are withdrawn and the network refuses its hosts. Rungs that used it are skipped. Fallback is the next rung.
- **Turn one path off.** The Traffic Manager drain/disable control skips the family on a path only when that path's coverage is on. Coverage defaults off. Image and vision already ask `legacyPathAllows` before a new attempt.
- **Remove it from the product.** Delete its `MEDIA_CATALOGUE` row. Image doors and vision then skip that id and keep every other rung in order. Leave the adapter in place until a later cleanup; an unlisted id is never called. Do not delete a shared helper that another rung still uses.

## What is still hard-wired

| Ladder | Where the rung list lives | Safe next step |
|---|---|---|
| Image Generator and app images | `mediaCatalogue.ts` | Done. Both doors read it. |
| Vision, including PDFs | `visionProviderOrder`, then `keepListed` | Membership is the catalogue. The tier rules stay in `visionProviderOrder`. |
| AI Chat | `FreeChain/config.ts` | Point that list at the catalogue in its own change. |
| Professional AI | `AIRouterManager` `buildProfessional` | Same. The last-resort rung stays last. |
| Builder | `tierLadder.ts` | Same. The owner prefix (Surplus, Router One, and the other always-on rungs) stays in front. |

A guessed token price is not a provider's price. Image engines stay unpriced in the health order, so a faster expensive engine cannot pass a cheaper one.
