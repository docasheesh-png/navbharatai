/** Reviewed canonical queries and official category vocabulary; never derive endpoints from prompts. */
export const DISCOVERY_POLICY = Object.freeze({
  table: { height: 0.8, categories: ['table'] },
  chair: { height: 1, categories: ['chair', 'seating'] },
  bench: { height: 0.9, categories: ['bench', 'seating'] },
  rock: { height: 1, categories: ['rock', 'rocks'] },
  tree: { height: 4, categories: ['tree', 'trees'] },
  plant: { height: 0.5, categories: ['plant', 'plants'] },
  stool: { height: 0.7, categories: ['seating'] },
  sofa: { height: 1, categories: ['seating'] },
  cabinet: { height: 1.5, categories: ['furniture'] },
  lamp: { height: 0.6, categories: ['lighting'] },
});
export function isDiscoverySubject(value: string): value is keyof typeof DISCOVERY_POLICY {
  return Object.hasOwn(DISCOVERY_POLICY, value);
}
