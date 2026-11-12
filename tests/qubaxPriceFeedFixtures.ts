import { vi } from 'vitest';
import { QUBAX_PRICE_SOURCES, type QubaxPriceSource } from '../src/server/lib/qubaxPriceFeed';

export const FEED_NOW = 1_800_000_000_000;
export const marketFixture = (updatedAt = FEED_NOW) => JSON.stringify({ object: 'list', updated_at: new Date(updatedAt).toISOString(), data: [
  { id: 'fixture-text', modality: 'TEXT', unit: null, input_per_1m: 0.0000037, output_per_1m: 0.1, context_length: 8_000, benchmark: 999, discount_pct: 99.99 },
  { id: 'fixture-multimodal', modality: 'MULTIMODAL', unit: null, input_per_1m: null, output_per_1m: null },
  { id: 'fixture-image', modality: 'IMAGE', unit: 'image', price: 1 },
] });
const bands = ['Short', 'Long'].flatMap(b => ['input', 'output', 'cached input', '30m write', '12h write'].map(k => `${b} context ${k}`));
export const openaiFixture = `<a id="latest-models"></a>
Flagship models
Prices per 1M tokens.
### Standard pricing data
| Model | ${bands.join(' | ')} |
| ${Array(11).fill('---').join(' | ')} |
| gpt-fixture | $2 | $10 | $0.1 | $2.5 | $5 | $4 | $15 | $0.2 | $5 | $10 |

| Model | Input | Output | Cached input |
| --- | --- | --- | --- |
| gpt-fixture-mini | $0.2 | $1.1 | - |
### Batch pricing data
| Model | Input | Output | Cached input |
| --- | --- | --- | --- |
| gpt-fixture-mini | $0.1 | $0.55 | - |
`;
export const zaiFixture = `# Pricing
All prices are in USD.
## Models
### Latest Models
Prices per 1M tokens.
| Model | Input | Cached Input | Cached Input Storage | Output |
| :- | :- | :- | :- | :- |
| GLM-Fixture | \\$1.4 | \\$0.26 | Limited-time Free | \\$4.4 |
### Text Models
Prices per 1M tokens.
| Model | Input | Cached Input | Cached Input Storage | Output |
| :- | :- | :- | :- | :- |
| GLM-Fixture-Previous | $0.6 | - | - | $2.2 |
### Built-in Tools
| Tool | Cost |
| :- | :- |
| Web Search | $0.01 / use |
`;
export const feedHeaders = (source: QubaxPriceSource = 'qubax', at = FEED_NOW) => new Headers({
  'content-type': source === 'qubax' ? 'application/json' : 'text/markdown; charset=utf-8', date: new Date(at).toUTCString(),
});
export const sourceFixtures = { qubax: marketFixture(), openai: openaiFixture, zai: zaiFixture };
export function feedFetch() {
  return vi.fn(async (url: string | URL | Request, _options?: RequestInit) => {
    const source = (Object.entries(QUBAX_PRICE_SOURCES).find(([, v]) => v === url)?.[0]) as QubaxPriceSource | undefined;
    if (!source) throw new Error('Unexpected network target');
    return new Response(sourceFixtures[source], { headers: feedHeaders(source) });
  });
}
