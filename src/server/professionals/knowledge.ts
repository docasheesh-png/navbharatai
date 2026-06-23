import type { KnowledgeCard } from './types';

/** Generic keyword retrieval — returns the most relevant cards for a query. */
export function retrieveKnowledge(cards: KnowledgeCard[] | undefined, query: string, max = 4): KnowledgeCard[] {
  if (!cards || !cards.length) return [];
  const q = (query || '').toLowerCase();
  if (!q.trim()) return [];
  const scored = cards
    .map((card) => {
      let score = 0;
      for (const kw of card.keywords) {
        if (q.includes(kw.toLowerCase())) score += kw.includes(' ') ? 3 : 2;
      }
      for (const w of card.topic.toLowerCase().split(/[^a-z]+/)) {
        if (w.length > 3 && q.includes(w)) score += 1;
      }
      return { card, score };
    })
    .filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.card);
}

/** Format retrieved cards as a prompt block the model must use and cite. */
export function formatKnowledge(cards: KnowledgeCard[]): string {
  if (!cards.length) return '';
  const lines = cards.map((c) => `• [${c.topic}] ${c.content} (Source: ${c.source})`);
  return `GROUNDED REFERENCES (use these where relevant and cite the source; if you go beyond them, say so):\n${lines.join('\n')}`;
}
