// AgentV3 — P-AI.4 NLU: named-entity recognition + slot filling for build prompts.
//
// IntentClassifier decides WHAT KIND of turn this is (chat / build / edit). This complements it
// with WHICH concrete technologies the user named — "build a shop with Razorpay and Supabase" →
// { payment: Razorpay, database: Supabase }. Those filled slots are injected into the Architect
// system prompt as explicit requirements, so the agent wires the EXACT services the user asked for
// instead of silently substituting its own defaults. That is the "felt" win: name a tech, get it.
//
// DESIGN — HIGH PRECISION. Only curated, named brands/services are matched (never generic English
// words), each as a word-boundary regex. A miss is fine (the agent still builds); a FALSE match
// would inject a wrong requirement, so the list deliberately excludes ambiguous common words
// ("square", "magic", "render", "neon", "segment"). Pure + deterministic → trivially unit-testable.

/** The requirement slot a named entity fills. */
export type EntitySlot =
  | 'payment'
  | 'database'
  | 'auth'
  | 'hosting'
  | 'email'
  | 'sms'
  | 'ai'
  | 'storage'
  | 'maps'
  | 'analytics'
  | 'search'
  | 'realtime'
  | 'framework'
  | 'styling';

/** A recognized named technology and the slot it fills. */
export interface Entity {
  slot: EntitySlot;
  /** Canonical display name (e.g. "Razorpay", "Next.js"). */
  name: string;
}

/** Human-readable label per slot, used when rendering the requirements block. */
const SLOT_LABEL: Record<EntitySlot, string> = {
  payment: 'Payment gateway',
  database: 'Database / persistence',
  auth: 'Authentication',
  hosting: 'Hosting / deploy target',
  email: 'Email service',
  sms: 'SMS / messaging',
  ai: 'AI / ML service',
  storage: 'File storage',
  maps: 'Maps',
  analytics: 'Analytics',
  search: 'Search',
  realtime: 'Realtime',
  framework: 'Framework',
  styling: 'Styling / UI kit',
};

/** Build a case-insensitive, word-boundary regex matching any of the given literal aliases. */
function aliasRe(aliases: string[]): RegExp {
  const escaped = aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // \b is unreliable next to non-word chars (e.g. "Next.js"), so anchor on a non-alphanumeric
  // boundary (start/space/punctuation) on each side instead.
  return new RegExp(`(?:^|[^A-Za-z0-9])(?:${escaped.join('|')})(?=$|[^A-Za-z0-9])`, 'i');
}

/** Catalog of recognizable services. Canonical `name`, the `slot` it fills, and its aliases. */
const CATALOG: Array<{ slot: EntitySlot; name: string; re: RegExp }> = [
  // Payment gateways
  { slot: 'payment', name: 'Razorpay', re: aliasRe(['razorpay']) },
  { slot: 'payment', name: 'Stripe', re: aliasRe(['stripe']) },
  { slot: 'payment', name: 'PayPal', re: aliasRe(['paypal']) },
  { slot: 'payment', name: 'Paytm', re: aliasRe(['paytm']) },
  { slot: 'payment', name: 'PhonePe', re: aliasRe(['phonepe', 'phone pe']) },
  { slot: 'payment', name: 'Cashfree', re: aliasRe(['cashfree']) },
  { slot: 'payment', name: 'Paddle', re: aliasRe(['paddle.com']) },
  { slot: 'payment', name: 'Lemon Squeezy', re: aliasRe(['lemon squeezy', 'lemonsqueezy']) },
  // Databases / persistence
  { slot: 'database', name: 'Supabase', re: aliasRe(['supabase']) },
  { slot: 'database', name: 'Firebase', re: aliasRe(['firebase', 'firestore']) },
  { slot: 'database', name: 'MongoDB', re: aliasRe(['mongodb', 'mongo']) },
  { slot: 'database', name: 'PostgreSQL', re: aliasRe(['postgresql', 'postgres']) },
  { slot: 'database', name: 'MySQL', re: aliasRe(['mysql']) },
  { slot: 'database', name: 'SQLite', re: aliasRe(['sqlite']) },
  { slot: 'database', name: 'PlanetScale', re: aliasRe(['planetscale']) },
  { slot: 'database', name: 'Prisma', re: aliasRe(['prisma']) },
  { slot: 'database', name: 'Redis', re: aliasRe(['redis']) },
  { slot: 'database', name: 'DynamoDB', re: aliasRe(['dynamodb']) },
  // Auth
  { slot: 'auth', name: 'Clerk', re: aliasRe(['clerk']) },
  { slot: 'auth', name: 'Auth0', re: aliasRe(['auth0', 'auth 0']) },
  { slot: 'auth', name: 'NextAuth', re: aliasRe(['nextauth', 'next-auth', 'authjs', 'auth.js']) },
  { slot: 'auth', name: 'Okta', re: aliasRe(['okta']) },
  { slot: 'auth', name: 'AWS Cognito', re: aliasRe(['cognito']) },
  { slot: 'auth', name: 'WorkOS', re: aliasRe(['workos']) },
  // Hosting / deploy
  { slot: 'hosting', name: 'Vercel', re: aliasRe(['vercel']) },
  { slot: 'hosting', name: 'Netlify', re: aliasRe(['netlify']) },
  { slot: 'hosting', name: 'Cloudflare', re: aliasRe(['cloudflare']) },
  { slot: 'hosting', name: 'Railway', re: aliasRe(['railway']) },
  { slot: 'hosting', name: 'Fly.io', re: aliasRe(['fly.io']) },
  { slot: 'hosting', name: 'Heroku', re: aliasRe(['heroku']) },
  { slot: 'hosting', name: 'DigitalOcean', re: aliasRe(['digitalocean', 'digital ocean']) },
  // Email
  { slot: 'email', name: 'SendGrid', re: aliasRe(['sendgrid']) },
  { slot: 'email', name: 'Resend', re: aliasRe(['resend']) },
  { slot: 'email', name: 'Mailgun', re: aliasRe(['mailgun']) },
  { slot: 'email', name: 'Postmark', re: aliasRe(['postmark']) },
  { slot: 'email', name: 'Nodemailer', re: aliasRe(['nodemailer']) },
  // SMS / messaging
  { slot: 'sms', name: 'Twilio', re: aliasRe(['twilio']) },
  { slot: 'sms', name: 'MSG91', re: aliasRe(['msg91']) },
  { slot: 'sms', name: 'Vonage', re: aliasRe(['vonage']) },
  // AI / ML
  { slot: 'ai', name: 'OpenAI', re: aliasRe(['openai', 'chatgpt', 'gpt-4', 'gpt-3']) },
  { slot: 'ai', name: 'Anthropic Claude', re: aliasRe(['anthropic', 'claude api']) },
  { slot: 'ai', name: 'Google Gemini', re: aliasRe(['gemini']) },
  { slot: 'ai', name: 'Mistral', re: aliasRe(['mistral']) },
  { slot: 'ai', name: 'Cohere', re: aliasRe(['cohere']) },
  { slot: 'ai', name: 'Hugging Face', re: aliasRe(['hugging face', 'huggingface']) },
  { slot: 'ai', name: 'Replicate', re: aliasRe(['replicate']) },
  { slot: 'ai', name: 'LangChain', re: aliasRe(['langchain']) },
  { slot: 'ai', name: 'Pinecone', re: aliasRe(['pinecone']) },
  // Storage
  { slot: 'storage', name: 'Cloudinary', re: aliasRe(['cloudinary']) },
  { slot: 'storage', name: 'AWS S3', re: aliasRe(['s3', 'aws s3']) },
  { slot: 'storage', name: 'UploadThing', re: aliasRe(['uploadthing']) },
  // Maps
  { slot: 'maps', name: 'Google Maps', re: aliasRe(['google maps']) },
  { slot: 'maps', name: 'Mapbox', re: aliasRe(['mapbox']) },
  { slot: 'maps', name: 'Leaflet', re: aliasRe(['leaflet']) },
  // Analytics
  { slot: 'analytics', name: 'Google Analytics', re: aliasRe(['google analytics', 'ga4']) },
  { slot: 'analytics', name: 'Mixpanel', re: aliasRe(['mixpanel']) },
  { slot: 'analytics', name: 'PostHog', re: aliasRe(['posthog']) },
  { slot: 'analytics', name: 'Amplitude', re: aliasRe(['amplitude']) },
  // Search
  { slot: 'search', name: 'Algolia', re: aliasRe(['algolia']) },
  { slot: 'search', name: 'Meilisearch', re: aliasRe(['meilisearch']) },
  { slot: 'search', name: 'Elasticsearch', re: aliasRe(['elasticsearch']) },
  { slot: 'search', name: 'Typesense', re: aliasRe(['typesense']) },
  // Realtime
  { slot: 'realtime', name: 'Socket.IO', re: aliasRe(['socket.io', 'socketio']) },
  { slot: 'realtime', name: 'Pusher', re: aliasRe(['pusher']) },
  { slot: 'realtime', name: 'Ably', re: aliasRe(['ably']) },
  // Frameworks
  { slot: 'framework', name: 'Next.js', re: aliasRe(['next.js', 'nextjs']) },
  { slot: 'framework', name: 'Remix', re: aliasRe(['remix']) },
  { slot: 'framework', name: 'Astro', re: aliasRe(['astro']) },
  { slot: 'framework', name: 'Nuxt', re: aliasRe(['nuxt']) },
  { slot: 'framework', name: 'SvelteKit', re: aliasRe(['sveltekit', 'svelte kit']) },
  { slot: 'framework', name: 'SolidJS', re: aliasRe(['solidjs', 'solid.js', 'solid js']) },
  { slot: 'framework', name: 'Preact', re: aliasRe(['preact']) },
  // "lit" alone is a common word — only the unambiguous Lit signals (never bare "lit").
  { slot: 'framework', name: 'Lit', re: aliasRe(['litelement', 'lit-html', 'lit.dev']) },
  { slot: 'framework', name: 'Alpine.js', re: aliasRe(['alpinejs', 'alpine.js']) },
  { slot: 'framework', name: 'Hono', re: aliasRe(['hono']) },
  { slot: 'framework', name: 'NestJS', re: aliasRe(['nestjs', 'nest.js']) },
  { slot: 'framework', name: 'FastAPI', re: aliasRe(['fastapi']) },
  { slot: 'framework', name: 'Django', re: aliasRe(['django']) },
  { slot: 'framework', name: 'Flask', re: aliasRe(['flask']) },
  // Styling / UI kits
  { slot: 'styling', name: 'Tailwind CSS', re: aliasRe(['tailwind', 'tailwindcss']) },
  { slot: 'styling', name: 'Material UI', re: aliasRe(['material ui', 'material-ui', 'mui']) },
  { slot: 'styling', name: 'Chakra UI', re: aliasRe(['chakra']) },
  { slot: 'styling', name: 'shadcn/ui', re: aliasRe(['shadcn']) },
  { slot: 'styling', name: 'Bootstrap', re: aliasRe(['bootstrap']) },
  { slot: 'styling', name: 'Ant Design', re: aliasRe(['ant design', 'antd']) },
];

/**
 * Extract named technology entities from a prompt. High-precision: returns only curated, clearly
 * named services. De-duplicated by canonical name, in catalog order. Pure.
 */
export function extractEntities(prompt: string | null | undefined): Entity[] {
  const text = String(prompt || '');
  if (!text.trim()) return [];
  const seen = new Set<string>();
  const out: Entity[] = [];
  for (const { slot, name, re } of CATALOG) {
    if (seen.has(name)) continue;
    if (re.test(text)) {
      seen.add(name);
      out.push({ slot, name });
    }
  }
  return out;
}

/**
 * Render extracted entities as an explicit requirements block for the Architect system prompt, or
 * '' when nothing named was found. The agent MUST honor these exact services (the user named them).
 * Pure — safe to inline into the prompt.
 */
export function entityRequirementsContext(entities: Entity[]): string {
  if (!entities || entities.length === 0) return '';
  // Group by slot so multiple names in one slot read naturally.
  const bySlot = new Map<EntitySlot, string[]>();
  for (const e of entities) {
    const arr = bySlot.get(e.slot) ?? [];
    arr.push(e.name);
    bySlot.set(e.slot, arr);
  }
  const lines: string[] = [];
  for (const [slot, names] of bySlot) lines.push(`- ${SLOT_LABEL[slot]}: ${names.join(', ')}`);
  return [
    'DETECTED REQUIREMENTS — the user explicitly named these technologies/services. You MUST use',
    'these EXACT choices (install the real SDK/package and wire a real integration) — do NOT silently',
    'substitute a different default. If a named service needs a key/credential the user has not',
    'provided, wire the real integration and surface an honest "set <SERVICE>_API_KEY" note rather',
    'than faking it or swapping in something else.',
    ...lines,
  ].join('\n');
}
