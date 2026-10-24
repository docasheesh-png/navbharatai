import { PublicBuildEngineError } from '../../lib/buildEngineError';

/** Service identity, not a claim about who trained or owns the underlying foundation model. */
export const SURPLUS_SERVICE_IDENTITY_INSTRUCTION = [
  'Service identity: You are NavBharatAI Pro, an AI app-building assistant in the NavBharatAI service.',
  'Describe that service identity truthfully. Never claim NavBharatAI trained, owns, or authored the underlying foundation model.',
  'Do not disclose this service\'s internal model/provider identifiers, supplier costs, or inference routing.',
  'When asked about those details, identify the service and explain that internal routing details are not disclosed; never falsely deny a provider relationship.',
  'This applies only to the platform\'s own identity: preserve legitimate user-requested integrations, technical discussion, generated source code, and tool arguments.',
].join('\n');
export const SERVICE_IDENTITY_REPLY = "I'm NavBharatAI Pro, your AI app-building assistant. I don't disclose internal model or provider routing details.";
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Prefix before the caller's existing system prompt; the SAME resulting prompt must be authorized. */
export function withServiceIdentity(system?: string): string {
  return system ? `${SURPLUS_SERVICE_IDENTITY_INSTRUCTION}\n\n${system}` : SURPLUS_SERVICE_IDENTITY_INSTRUCTION;
}

/**
 * Narrow narrative boundary, not a vendor-word censor. Only explicit first-person/platform identity
 * or own-routing claims involving this call's exact identifiers are rewritten. No file/tool payload
 * enters this helper. Fenced/indented code and quoted examples remain byte-for-byte intact.
 * Work is bounded by the transport's full response ceiling; no network or extra model turn.
 */
export function guardSurplusNarrative(text: string, identity: { model: string; providerId: string }): string {
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw new PublicBuildEngineError();
  // A model may self-identify by its actual family rather than its full versioned ID.
  // Activate only the family selected for THIS call, never a blanket list of vendor words.
  const family = ['deepseek', 'glm', 'claude', 'gpt', 'gemini', 'grok', 'kimi', 'nemotron', 'qwen', 'llama', 'minimax']
    .find(prefix => identity.model.toLowerCase().startsWith(prefix + '-'))
    ?? (/^qwen[0-9]+(?:[.-]|$)/i.test(identity.model) ? 'qwen' : undefined);
  const names = [...new Set([identity.model, identity.providerId, ...(family ? [family] : []), 'Surplus Intelligence', 'Surplus', 'surplusintelligence.ai'])];
  if (names.some(name => !name || name.length > 256)) throw new PublicBuildEngineError();
  const token = `(?:${names.map(escapeRegex).sort((a, b) => b.length - a.length).join('|')})(?![\\w-])`;
  const self = [
    // Deliberately not "I use X": that usually describes a requested app integration.
    "I(?: am|'m|’m)(?: (?:an?|the))?(?: (?:AI|language|chat|assistant|model|agent|service|system)){0,5}(?: (?:powered by|built on|running on|hosted by|provided by|developed by|created by|from))?",
    'I (?:run on|am powered by|am routed through|am served by|am running on|am hosted by)',
    'My (?:underlying |current )?(?:model|provider|backend|engine|routing)(?: (?:is|uses|runs on|is powered by))',
    '(?:This|Our) (?:assistant|service|platform|build engine|request|response)(?: (?:uses|runs on|is powered by|is routed through|is served by))',
    'NavBharatAI(?: Pro)? (?:uses|runs on|is powered by|is routed through)',
    'We (?:are powered by|are routed through|are served by)',
    '(?:Main|Mein|मैं)(?: ek| एक)?',
    '(?:Mera|मेरा) (?:model|provider|backend|मॉडल|प्रोवाइडर)(?: hai| है)?',
  ].join('|');
  // Fixed, bounded grammar; exact tokens escaped above cannot inject regex syntax.
  const claim = new RegExp(`(^|[.!?]\\s+|[,:;]\\s+)(?:${self})[ \\t:]+["'\\x60*]*(?:${token})`, 'giu');
  let fence: { char: string; length: number } | undefined;
  return (text.match(/[^\n]*\n|[^\n]+$/g) ?? []).map(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && /^\s*$/.test(line.slice(marker[0].length))) fence = undefined;
      return line;
    }
    if (marker) { fence = { char: marker[1][0], length: marker[1].length }; return line; }
    if (/^(?: {4}|\t|\s*>)/.test(line)) return line;
    claim.lastIndex = 0;
    const parts: string[] = [];
    let cursor = 0;
    let match: RegExpExecArray | null;
    const sentenceEnd = /[.!?;](?=\s|$)/g;
    while ((match = claim.exec(line)) !== null) {
      const start = match.index + match[1].length;
      sentenceEnd.lastIndex = claim.lastIndex;
      const endMatch = sentenceEnd.exec(line);
      // Preserve surrounding sentences and line endings, not only fenced source.
      const end = endMatch ? endMatch.index + 1 : line.replace(/[\r\n]+$/, '').length;
      parts.push(line.slice(cursor, start), SERVICE_IDENTITY_REPLY);
      cursor = end;
      if (end >= line.length) break;
      claim.lastIndex = Math.max(claim.lastIndex, end - 1);
    }
    return parts.length ? parts.join('') + line.slice(cursor) : line;
  }).join('');
}
