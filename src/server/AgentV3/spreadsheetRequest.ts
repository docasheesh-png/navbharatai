// A SPREADSHEET IS A FILE, NOT AN APP (admin 2026-10-01: "A karo!!").
//
// 🔴 WHAT HAPPENED. A user asked NavBharatAI Pro for a sample Excel file. Nothing in the build engine
// asked whether that was a FILE or an APP, so it was an app: the builder wrote a React dashboard that
// showed a table, and the user still had no .xlsx to open. Every other assistant would have answered
// with the file; the one surface that builds things could not make the simplest thing of all.
//
// 🔑 THE CLASS is the one `pictureRequest.ts` closed for pictures: a request for a DELIVERABLE (a
// picture, a spreadsheet) reaching a surface that only knows how to build software. The answer is the
// same — read the request before the builder does — but here NavBharatAI can make the deliverable
// itself: the engine writes the rows, our server writes a real .xlsx and .csv, and the chat line carries
// a Download button (`spreadsheetFile.ts`, `routes/spreadsheetFiles.ts`).
//
// PRECISION FIRST, because the cost of a wrong answer is asymmetric the other way round from pictures:
// "build an app with Excel export" is a very common request here, and answering it with a sample file
// would refuse a real build. So a request is a file request only when:
//   • it names a spreadsheet (excel / xlsx / csv / spreadsheet / google sheet), AND
//   • it asks for one to be MADE (a create verb, or "sample/dummy/demo data"), AND
//   • it names NOTHING that is software (app, website, dashboard, tool, button, script, formula …), AND
//   • it is not a how-to question ("excel me vlookup kaise lagaye"), and not about handling a file the
//     user already has ("is csv ko analyse karo").
// Anything else builds exactly as before. Wrong toward the file costs one message, and the reply offers
// to build an app instead; wrong toward the build costs minutes, money and still no file.
//
// PURE. Kill switch: AGENTV3_SPREADSHEET_FILE=off builds as before.

export function spreadsheetFileEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_SPREADSHEET_FILE ?? '').trim().toLowerCase() !== 'off';
}

/** A spreadsheet, named. English, Hinglish and Devanagari. */
const SHEET_NOUN = new RegExp(
  '\\b(?:excel|xlsx|xls|csv|spread\\s?sheets?|google\\s+sheets?|workbook)\\b'
  + '|\\.(?:xlsx|xls|csv)\\b'
  + '|एक्सेल|स्प्रेडशीट|सीएसवी',
  'i',
);

/** Asked to be MADE (or handed over). "do" is Hinglish "give" — it only counts beside a sheet noun. */
const CREATE = new RegExp(
  '\\b(?:make|create|generate|build|prepare|produce|give|send|provide|share|write|fill|need|want|download|convert|'
  + 'bana|banao|banaao|banado|banade|banake|banaye|banaiye|banaen|banayein|de|do|dedo|dena|dijiye|'
  + 'chahiye|chaiye|chahie|taiyar|tayyar|tayar|likho|likhdo|bhejo|bhejdo)\\b'
  + '|बनाओ|बना दो|बना दे|बनाकर|बनाइए|चाहिए|दीजिए|दे दो|भेजो|तैयार',
  'i',
);

/** "sample data in Excel" asks for a file even with no verb at all. */
const SAMPLE_DATA = /\b(?:sample|dummy|demo|mock|test|fake|example|random)\b/i;

/**
 * The request is about SOFTWARE (or about Excel itself, not a file): any one of these sends it down
 * the build or chat path exactly as before.
 */
const NOT_A_FILE = new RegExp(
  '\\b(?:apps?|application|applications|webapp|website|websites|site|web\\s?page|webpage|landing|dashboard|tool|tools|'
  + 'software|system|platform|portal|feature|features|button|buttons|page|pages|screen|screens|form|forms|'
  + 'component|module|plugin|extension|addon|add-on|api|backend|frontend|server|database|db|bot|chatbot|'
  + 'generator|converter|reader|parser|viewer|editor|importer|exporter|uploader|clone|project|'
  + 'script|code|coding|program|programme|function|macro|macros|vba|python|javascript|typescript|java|node|react|sql|'
  + 'formula|formulas|vlookup|xlookup|hlookup|pivot|shortcut|shortcuts|chart\\s+in|tutorial|course|'
  + 'wala|wali|vala|vali)\\b'
  + '|ऐप|एप|वेबसाइट|सॉफ्टवेयर|वाला|वाली',
  'i',
);

/** A question about HOW, not an order for a file. */
const HOW_TO = new RegExp(
  '\\b(?:how\\s+(?:to|do|can|should|does)|kaise|kese|kaisey|sikha|sikhao|sikhaiye|samjha|samjhao|samjhaiye|'
  + 'explain|what\\s+is|what\\s+are|difference|kya\\s+hai|kya\\s+hota|kya\\s+hote|meaning)\\b'
  + '|कैसे|क्या है|समझाओ|सिखाओ',
  'i',
);

/**
 * Another document format: "convert this excel to pdf", "excel ko word me badlo". That is a file the
 * user HAS turned into something we do not write here — never a new spreadsheet.
 */
const OTHER_FORMAT = /\b(?:pdf|docx?|word|ppt|pptx|powerpoint|jpe?g|png|image|html|json|xml)\b/i;

/** About a file the user already HAS — reading or handling it, not making one. */
const HANDLING = new RegExp(
  '\\b(?:open|opens|opening|read|reads|import|imports|upload|uploads|uploaded|attach|attached|analy[sz]e|analysis|'
  + 'summari[sz]e|summary|check|fix|repair|recover|merge|compare|password|unlock|corrupt|corrupted|error)\\b',
  'i',
);

/** Does this message ask for a spreadsheet FILE (and nothing that is software)? PURE. */
export function isSpreadsheetFileRequest(prompt: string): boolean {
  const text = String(prompt ?? '').trim();
  if (!text || text.length > 2000) return false;
  if (!SHEET_NOUN.test(text)) return false;
  if (!(CREATE.test(text) || SAMPLE_DATA.test(text))) return false;
  if (NOT_A_FILE.test(text) || HOW_TO.test(text) || HANDLING.test(text) || OTHER_FORMAT.test(text)) return false;
  return true;
}

export interface SpreadsheetAnswerInput {
  prompt: string;
  /** A zip or a repository is being imported this turn — that is never a file request. */
  importing: boolean;
  env?: NodeJS.ProcessEnv;
}

/**
 * Should Pro make the file instead of building? PURE.
 *
 * Unlike a picture, this does NOT stand down when the workspace already holds an app: "make a sample
 * Excel file of 50 students" means the same thing in a calculator's workspace as in an empty one, and
 * a request that means "for this app" names the app (or a button, a page, an export), which
 * `NOT_A_FILE` already sends to the builder.
 */
export function shouldAnswerSpreadsheetRequest(input: SpreadsheetAnswerInput): boolean {
  if (!spreadsheetFileEnabled(input.env)) return false;
  if (input.importing) return false;
  return isSpreadsheetFileRequest(input.prompt);
}
