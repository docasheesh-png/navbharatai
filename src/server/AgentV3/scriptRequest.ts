/**
 * 🔴 A REQUEST FOR A SCRIPT IS BUILT AS A WEB APP — AND THE USER IS TOLD SO BEFORE THE BUILD, NOT AFTER
 * (queue Q-274, autopsy 241215d1, admin chose option "a" on 2026-10-04).
 *
 * The request opened with *"Write a complete, self-contained Python script for a local Paper Trading
 * Application … (CLI interface or light Streamlit dashboard)"* and asked for live data from `yfinance`. The
 * build shipped a FastAPI + React web app with a SIMULATED price feed and called it "complete and working
 * end-to-end". The app worked, but nobody had said that a script had become a web app, or that the "live"
 * prices were invented.
 *
 * 🔑 THE CLASS: the deliverable's FORM is changed silently. NavBharatAI builds apps the user opens in the
 * preview. A script, a command-line tool, a Streamlit dashboard or a notebook cannot be shown there, so the
 * engine builds a web app instead — which is the right call, and the user must hear it before the build,
 * where they can still say "no, I only want the script".
 *
 * Two halves from one detector:
 *   • the builder is told to build the same inputs, logic and results as a web app, never to claim it is a
 *     script, and to label any sample/simulated data as such where the request asked for live data;
 *   • the user gets one line at the start of the build saying what they will get.
 * A summary that still calls simulated data "live" is caught by `claimAudit.ts` (`live-data-claimed`).
 *
 * ⚠️ PRECISION-FIRST. A film script, a JavaScript file, an npm/build/deploy script, "convert my Python
 * script to a web app" and any request that already asks for a web app or website stand down. A missed
 * request costs one unexplained web app (today's behaviour); a false one costs one unneeded sentence.
 * Kill switch: `AGENTV3_SCRIPT_REQUEST_NOTE=off`. PURE.
 */

export function scriptRequestNoteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_SCRIPT_REQUEST_NOTE ?? '').trim().toLowerCase() !== 'off';
}

interface FormRule { form: string; re: RegExp }

const FORMS: readonly FormRule[] = [
  { form: 'a Streamlit dashboard', re: /\bstreamlit\b/i },
  { form: 'a Jupyter notebook', re: /\bjupyter\b|\.ipynb\b|\bipython\s+notebook\b/i },
  { form: 'a Python script', re: /\bpython\s+script\b|\bscript\s+(?:in|using|written\s+in)\s+python\b|\b\.py\s+script\b/i },
  {
    form: 'a command-line tool',
    re: /\bcommand[\s-]?line\s+(?:tool|app|application|interface|program|utility|script)\b|\bcli\s+(?:tool|app|application|interface|program|utility|script)\b|\bterminal\s+(?:app|application|program|tool|utility)\b/i,
  },
];

/** The request asks for a web app or website itself — then building one is what was asked. */
const ASKS_FOR_WEB = /\bweb[\s-]?(?:app|application|site|page|ui|interface|dashboard)\b|\bwebsite\b|\bwebapp\b|\bin\s+the\s+browser\b|\b(?:react|next\.?js|vue|angular|svelte)\b/i;

/** A conversion names the OLD form ("convert my Python script into a web app"). */
const CONVERSION = /\b(?:convert|migrat|port(?:ing|ed)?\b|rewrit|turn)\w*\b[^.\n]{0,80}\b(?:to|into|from|as)\b/i;

/**
 * Does the request ask for a deliverable that cannot run in the preview (a script, a CLI, a Streamlit
 * dashboard, a notebook)? The form's name, or null. PURE.
 */
export function scriptDeliverableRequested(prompt: string | null | undefined): string | null {
  const p = String(prompt ?? '');
  if (!p.trim()) return null;
  if (ASKS_FOR_WEB.test(p) || CONVERSION.test(p)) return null;
  const hits = FORMS.filter((f) => f.re.test(p));
  if (hits.length === 0) return null;
  // "a Python script … (CLI interface or light Streamlit dashboard)" — the opening form is what was asked.
  const first = hits
    .map((f) => ({ f, at: p.search(f.re) }))
    .sort((a, b) => a.at - b.at)[0];
  return first.f.form;
}

/**
 * Does the request ask for LIVE data (a real-time feed, live prices, a market data library)? PURE.
 * "live chat" and "real-time collaboration" name no data, so they do not count.
 */
export function liveDataRequested(prompt: string | null | undefined): boolean {
  const p = String(prompt ?? '');
  return /\b(?:live|real[\s/-]?time)\b[^.\n]{0,30}?\b(?:data|feeds?|prices?|quotes?|ticks?|rates?|market\s+data|stock\s+prices?)\b/i.test(p)
    || /\byfinance\b|\bjugaad[\s-]?data\b|\bnsepy\b|\balpha\s*vantage\b|\bfinnhub\b/i.test(p);
}

/** The builder's instruction, prepended to the build prompt. Empty when nothing needs saying. PURE. */
export function scriptRequestBuilderNote(form: string | null, liveData: boolean): string {
  if (!form) return '';
  const lines = [
    `DELIVERABLE NOTE — the user asked for ${form}. NavBharatAI builds apps the user opens in the preview, so build this as a web app with the same inputs, the same logic and the same results, and keep the logic in its own module so it reads like the program they asked for.`,
    `- Never claim the result is ${form} — not in the UI, the README, a code comment or your reply. Say in the first sentence of your reply that it was built as a web app.`,
  ];
  if (liveData) {
    lines.push('- The request asks for LIVE data. Connect the real source only if it works from here without a paid key. Otherwise use clearly labelled sample data: the UI must show the words "Sample data", and your reply must say the data is sample data and how to switch to a real feed. Never call sample or simulated data "live" or "real-time".');
  }
  return lines.join('\n');
}

/** The one line the user reads at the START of the build. Empty when nothing needs saying. PURE. */
export function scriptRequestStartLine(form: string | null, liveData: boolean): string {
  if (!form) return '';
  const data = liveData
    ? ' If the live data source cannot be connected without a paid key, the app will use sample data and say so on screen — ask me any time to connect a real feed.'
    : '';
  return `ℹ️ You asked for ${form}. NavBharatAI builds apps you open in the preview, so this will be a web app with the same inputs and results.${data}`;
}

/** The admin-only report line. PURE. */
export function scriptRequestReportNote(form: string, liveData: boolean): string {
  return `The request asked for ${form}; built as a web app and told the user at the start${liveData ? ' (live data asked: sample data must be labelled)' : ''}.`;
}
