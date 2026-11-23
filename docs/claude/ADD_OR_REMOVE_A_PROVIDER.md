# How to add or remove an AI provider

Owner t407u. One file decides whether a provider is in the product: `src/server/AI/ProviderHealth/providerPlug.ts`. Chat, professional AI, the builder tier, and image/vision each ask that file before they try a rung. A removed provider drops out. The next rung runs. A door that does not know the adapter skips that id, so a half-finished add cannot take the reply down.

The admin on/off switch is unchanged. Admin → AI Engines still withdraws a family's keys with no code change. That is the way to turn a provider off without a deploy.

## Add a provider

1. Open `PLUG_OVERLAY` in `providerPlug.ts`. Add one row: the family id, what it can do (`chat`, `build`, `vision`, `image`), `priceIn` (null when it has no single token rate), and the adapter name (`free-chain`, `tier-ladder`, `professional`, `vision-chain`, or `image-ladder`). Key names are read from the kill switch. Do not put a key value in this file.
2. If that family is not already in `PROVIDER_FAMILIES` (`src/server/lib/providerSwitches.ts`), add one row there too: id, key names, and hosts. The API Providers page must list the same id (`src/server/lib/apiProviderDirectory.ts`). Those two rows are the admin switch, not a second ladder.
3. If that family is already a rung on the ladder you want (free chat, the builder tier, professional AI, or the image/vision catalogue), stop. The ladder already calls it. If the protocol is new, add one function in the door that owns that adapter, and one rung in that door's existing list. The function returns no text or no picture on failure. It does not throw out of the ladder. A missing adapter is skipped.

A provider the product already calls is turned back on in **one file** (`providerPlug.ts`). A brand-new host is **two files** when you also add its kill-switch row, plus the one door that learns the protocol. It is not a separate edit in chat, the builder, and image.

## Remove a provider

1. In `PLUG_OVERLAY`, set `unplugged: true` on that family's row. If it has no row yet, add one with `unplugged: true`.
2. Leave the adapter in place. Chat, professional AI, the builder tier, and image/vision skip that family and keep every other rung in order.

Or, with no deploy: Admin → AI Engines, switch the family off. Keys are withdrawn and the rung's existing "no key" path skips it.

## What stays where it is

The order of each ladder is still the ladder's own file (free-chain config, the professional router, `tierLadder.ts`, `mediaCatalogue.ts`). This file does not reorder them and does not invent a price. Health order inside one price is unchanged. The owner prefix on a Weak build (Surplus, Router One, and the other always-on rungs) is still assembled around the tier list.
