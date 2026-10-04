/**
 * 🔴 A WORD WE DO NOT KNOW IS NOT A SERVICE TO CONNECT TO (Q-067, autopsy de3bb2bb, 2026-10-01).
 *
 * "Ye yese app banao jo data COACT oar sake" — almost certainly "collect kar sake", typed on a phone. The
 * plan read COACT as the name of a product and built a chat to "the COACT backend": `src/api/chatApi.ts`
 * calling `import.meta.env.VITE_COACT_API_URL`, beside the data collector the user asked for. Nothing in
 * NavBharatAI knows a service called COACT, so that client could only ever fail on the user's screen, and
 * the user was never told how the word had been read.
 *
 * 🔑 THE CLASS: an unknown all-caps word in the request becomes an imaginary backend — a client, an API
 * URL setting and an env variable for a service that nobody named as one. The fix is not to guess the typo
 * (guessing is how a real product name gets "corrected"); it is to stop the word becoming an INTEGRATION.
 * The builder is told: no client, no API URL and no env variable for an outside service by that name; build
 * the app self-contained; if the word reads as the app's name or a feature, use it that way; and say in one
 * sentence of the reply how the word was read, so the user can correct it.
 *
 * ⚠️ PRECISION-FIRST. Only ALL-CAPS words of 3–12 letters count. Stands down for: a known acronym (GST, KOT,
 * EMR, PDF, UPI …), a service NavBharatAI knows (STRIPE, RAZORPAY, FIREBASE …), an emphasis word (VERY,
 * BEST, MUST, BANAO …), and any word the request itself names as an outside service ("COACT API",
 * "integrate with COACT", "COACT se connect") — then the user asked for the integration and this note would
 * be wrong. A false positive costs one unneeded sentence to the builder; it never changes what is built for
 * a request that names a real service. Kill switch: `AGENTV3_UNKNOWN_NAME_NOTE=off`. PURE.
 */

export function unknownNameNoteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_UNKNOWN_NAME_NOTE ?? '').trim().toLowerCase() !== 'off';
}

/** Acronyms an Indian app request uses as ordinary words. Never a service to connect to. */
const COMMON_ACRONYMS = new Set([
  'API', 'APIS', 'APP', 'APPS', 'UI', 'UX', 'CSS', 'HTML', 'JSON', 'CSV', 'XML', 'SQL', 'URL', 'PDF', 'PNG', 'JPG',
  'SVG', 'GIF', 'MP3', 'MP4', 'OTP', 'KYC', 'PAN', 'IFSC', 'EMI', 'ATM', 'POS', 'SMS', 'QR', 'ID', 'IDS', 'FAQ',
  'GST', 'GSTIN', 'HSN', 'TDS', 'ITR', 'MRP', 'INR', 'USD', 'KOT', 'EMR', 'EHR', 'OPD', 'IPD', 'ICU', 'BMI', 'CRM',
  'ERP', 'HRMS', 'LMS', 'CMS', 'POS', 'HR', 'CEO', 'CTO', 'CFO', 'NGO', 'PWA', 'APK', 'AAB', 'IOS', 'MVP', 'SAAS',
  'AI', 'ML', 'NLP', 'OCR', 'TTS', 'STT', 'GPS', 'IOT', 'AR', 'VR', 'SEO', 'SDK', 'JWT', 'REST', 'CRUD', 'B2B',
  'B2C', 'D2C', 'KPI', 'OKR', 'ROI', 'EOD', 'ETA', 'FIR', 'NOC', 'RERA', 'PNR', 'AQI', 'GPA', 'CGPA', 'NEET', 'JEE',
  'UPSC', 'SSC', 'CBSE', 'ICSE', 'NCERT', 'IPL', 'BCCI', 'ISRO', 'RTO', 'RBI', 'SBI', 'HDFC', 'ICICI', 'LIC',
  'AIIMS', 'IIT', 'IIM', 'DIY', 'USA', 'UK', 'UAE', 'IND', 'DOB', 'PIN', 'OK', 'AM', 'PM', 'IST', 'UTC', 'TV',
  'PC', 'CPU', 'GPU', 'RAM', 'SSD', 'USB', 'LED', 'AC', 'DC', 'KM', 'KG', 'CM', 'MM', 'MB', 'GB', 'TB', 'TODO',
  'FIFO', 'LIFO', 'RSVP', 'ASAP', 'FYI', 'DM', 'PS', 'NB', 'VS', 'ETC', 'WIFI', 'NFC', 'UPI', 'NEFT', 'RTGS',
  'IMPS', 'BHIM', 'EPF', 'PF', 'ESI', 'CA', 'CS', 'MBA', 'BBA', 'BCA', 'MCA', 'BTECH', 'MTECH', 'PHD', 'MBBS',
]);

/** Services, platforms and stacks NavBharatAI knows by name — the request may really mean to connect them. */
const KNOWN_SERVICES = new Set([
  'STRIPE', 'RAZORPAY', 'CASHFREE', 'PAYTM', 'PHONEPE', 'PAYPAL', 'FIREBASE', 'SUPABASE', 'MONGODB', 'MYSQL',
  'POSTGRES', 'POSTGRESQL', 'REDIS', 'TWILIO', 'WHATSAPP', 'TELEGRAM', 'GOOGLE', 'GMAIL', 'YOUTUBE', 'OPENAI',
  'GEMINI', 'CLAUDE', 'CHATGPT', 'GPT', 'AWS', 'GCP', 'AZURE', 'VERCEL', 'NETLIFY', 'GITHUB', 'SHOPIFY', 'ZOHO',
  'TALLY', 'NOTION', 'SLACK', 'DISCORD', 'FACEBOOK', 'INSTAGRAM', 'TWITTER', 'LINKEDIN', 'SPOTIFY', 'ZOOM',
  'REACT', 'NEXT', 'NEXTJS', 'VUE', 'ANGULAR', 'SVELTE', 'NODE', 'NODEJS', 'EXPRESS', 'DJANGO', 'FLASK', 'PHP',
  'LARAVEL', 'TAILWIND', 'BOOTSTRAP', 'PRISMA', 'GRAPHQL', 'DOCKER', 'NAVBHARATAI', 'NAVBHARAT', 'POLLINATIONS',
  'CLOUDFLARE', 'SENDGRID', 'MAILCHIMP', 'RESEND', 'SHIPROCKET', 'DELHIVERY', 'SWIGGY', 'ZOMATO', 'IRCTC', 'OLA',
  'UBER', 'AMAZON', 'FLIPKART', 'MEESHO', 'JIO', 'AIRTEL', 'MAPBOX', 'LEAFLET', 'OPENSTREETMAP', 'ALGOLIA',
]);

/** All-caps words people use for emphasis (English and Hinglish). Never a name. */
const EMPHASIS = new Set([
  'VERY', 'BEST', 'MUST', 'NOT', 'ONLY', 'ALL', 'FREE', 'NEW', 'FULL', 'YES', 'AND', 'THE', 'FOR', 'WITH', 'NOW',
  'MORE', 'MOST', 'GOOD', 'GREAT', 'BIG', 'HUGE', 'REAL', 'TRUE', 'FAST', 'SIMPLE', 'EASY', 'NICE', 'COOL',
  'IMPORTANT', 'URGENT', 'PLEASE', 'NEVER', 'ALWAYS', 'NOTE', 'WARNING', 'STOP', 'DONT', 'DO', 'MAKE', 'BUILD',
  'CREATE', 'ADD', 'EVERY', 'EACH', 'ANY', 'NONE', 'SAME', 'TOP', 'MAIN', 'HOME', 'LOGIN', 'ADMIN', 'USER',
  'USERS', 'DATA', 'FILE', 'FILES', 'PAGE', 'PAGES', 'FORM', 'FORMS', 'LIST', 'DARK', 'LIGHT', 'MODE', 'END',
  'BANAO', 'BANA', 'JALDI', 'ACCHA', 'ACHHA', 'SABHI', 'SAB', 'BAHUT', 'KARO', 'HAI', 'NAHI', 'NAHIN', 'HAAN',
  'APNA', 'MERA', 'MERI', 'HAMARA', 'EK', 'AUR', 'BHI', 'KUCH', 'SIRF', 'BILKUL', 'ZAROOR', 'JARUR', 'POORA',
  'PURA', 'SAHI', 'GALAT', 'DHYAN', 'TOH', 'TO', 'JO', 'KO', 'SE', 'ME', 'MEIN', 'KA', 'KI', 'KE',
]);

const CAPS_WORD = /(?<![A-Za-z0-9])[A-Z]{3,12}(?![A-Za-z0-9])/g;

function escape(w: string): string { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** True when the request itself names the word as an outside service to connect to. */
function namedAsService(prompt: string, word: string): boolean {
  const w = escape(word);
  const after = new RegExp(String.raw`\b${w}\b\s*(?:'s\s+)?(?:api|apis|sdk|integration|account|server|backend|back-end|webhook|endpoint|portal|platform|login|key|token|database|db)\b`, 'i');
  const before = new RegExp(String.raw`\b(?:integrate|integration|connect|connected|sync|link|linked|fetch|pull|push|import|export|send)\s+(?:it\s+|data\s+|this\s+)?(?:with|to|from|into|in)?\s*(?:the\s+|our\s+|my\s+)?\b${w}\b`, 'i');
  const hinglish = new RegExp(String.raw`\b${w}\b\s+(?:se|ke\s+saath|ke\s+sath|me|mein|ko)\s+(?:connect|link|sync|jod|jodo|judo|integrate)`, 'i');
  return after.test(prompt) || before.test(prompt) || hinglish.test(prompt);
}

/**
 * The all-caps words in a request that name nothing NavBharatAI knows and that the request does not ask to
 * connect to. At most three, in order of first appearance. [] for an ordinary request. PURE.
 */
export function unknownNamesInRequest(prompt: string): string[] {
  const text = String(prompt ?? '');
  if (!text.trim()) return [];
  // A request typed entirely in capitals carries no signal in its case.
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length > 0 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.6) return [];
  const out: string[] = [];
  for (const m of text.matchAll(CAPS_WORD)) {
    const w = m[0];
    if (out.includes(w)) continue;
    if (COMMON_ACRONYMS.has(w) || KNOWN_SERVICES.has(w) || EMPHASIS.has(w)) continue;
    if (namedAsService(text, w)) continue;
    out.push(w);
    if (out.length >= 3) break;
  }
  return out;
}

/** The note prepended to the builder's (and planner's) request. '' when there is nothing to say. PURE. */
export function unknownNameBuilderNote(names: readonly string[]): string {
  const list = [...new Set((names ?? []).filter(Boolean))];
  if (list.length === 0) return '';
  const quoted = list.map((n) => `"${n}"`).join(', ');
  const one = list.length === 1;
  return `NOTE ON ${one ? 'A WORD' : 'SOME WORDS'} IN THIS REQUEST: ${quoted} ${one ? 'is not a service' : 'are not services'} `
    + 'NavBharatAI knows, and the request does not ask to connect to one. Do NOT build a client, an API URL '
    + `setting, an environment variable or a "backend" for an outside service called ${quoted} — such a client `
    + 'could only fail. Build the app self-contained. If the word reads as the app\'s own name or a feature, use '
    + 'it that way; if it reads as a typo (on a phone keyboard, "COACT" is likely "collect"), build what the rest '
    + `of the sentence asks for. In your reply, say in one short sentence how you read ${quoted}, so the user can `
    + 'correct it.';
}

/** One sentence for the admin report — never user-facing. */
export function unknownNameReportNote(names: readonly string[]): string {
  return `The request uses ${names.map((n) => `"${n}"`).join(', ')}, which names no service NavBharatAI knows; `
    + 'the builder was told not to build a client for it and to say how it read the word.';
}
