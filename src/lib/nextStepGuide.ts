// THE NEXT STEP — one line, always the single next thing (admin 2026-10-30).
//
// *"jaise aap guide karte ho, step by step, vaise guide karna chahiye. live website check kar kar ke,
// navbharatai user ko next step bataye"*. The tray (❗️) lists EVERYTHING the user may need to do and the
// navigator puts dots on buttons; neither SAYS, in words, "do this now". This module picks exactly one
// step from facts that were LOOKED UP (live domain state, live publish freshness, open tray rows) and
// says it in Hindi + English. Unknown facts are never guessed: an unchecked domain is not "pending".

export type NextStepTarget = 'tray' | 'publish' | 'database' | 'report' | 'none';

export interface NextStepFacts {
  building?: boolean;
  buildFinished?: boolean;
  buildOk?: boolean;
  /** Open tray rows that block the running build ("build waiting"). */
  blockingAsks?: number;
  /** Open, non-blocking tray rows (keys, database, rules…). */
  openAsks?: number;
  /** Title of the most important open row, shown verbatim. */
  topAskTitle?: string;
  /** The top open row is a database / Firebase connect row. */
  topAskIsDatabase?: boolean;
  publishFreshness?: 'never_published' | 'up_to_date' | 'changed' | 'unknown';
  /** A custom domain is saved for this app. undefined ⇒ not checked. */
  domain?: string | null;
  /** Live Firebase Hosting verdict for that domain. undefined ⇒ could not look. */
  domainActive?: boolean;
  liveUrl?: string | null;
}

export interface NextStep {
  id: string;
  tone: 'wait' | 'action' | 'urgent' | 'done';
  en: string;
  hi: string;
  cta?: { target: NextStepTarget; en: string; hi: string };
  /** The domain step re-checks itself; the card polls while this is true. */
  recheck?: boolean;
}

export function nextStep(f: NextStepFacts): NextStep | null {
  const asks = (f.blockingAsks ?? 0) + (f.openAsks ?? 0);

  // 1. The build is stopped on the user. Nothing else matters until that is answered.
  if ((f.blockingAsks ?? 0) > 0) {
    return {
      id: 'build.waiting', tone: 'urgent',
      en: `Your build is waiting for you: ${f.topAskTitle || 'one answer is needed'}.`,
      hi: `Build आपका इंतज़ार कर रहा है: ${f.topAskTitle || 'एक जवाब चाहिए'}।`,
      cta: { target: 'tray', en: 'Answer now', hi: 'अभी जवाब दें' },
    };
  }

  // 2. Building — the honest next step is "nothing, wait". Never invite a publish of a half-built app.
  if (f.building) {
    return {
      id: 'build.running', tone: 'wait',
      en: 'Building your app… nothing to do yet. I will tell you the next step.',
      hi: 'App बन रहा है… अभी कुछ नहीं करना। अगला कदम मैं बताऊँगा।',
    };
  }

  // 3. Failed build.
  if (f.buildFinished && f.buildOk === false) {
    return {
      id: 'build.failed', tone: 'urgent',
      en: 'This build did not finish. Tell NavBharatAI what to fix, or report it.',
      hi: 'यह build पूरा नहीं हुआ। चैट में बताइए क्या ठीक करना है, या Report करें।',
      cta: { target: 'report', en: 'Report', hi: 'Report करें' },
    };
  }

  // 4. Something the app needs from the user (Firebase connect, keys, rules copy…).
  if (asks > 0) {
    const db = f.topAskIsDatabase === true;
    return {
      id: db ? 'asks.database' : 'asks.open', tone: 'action',
      en: db ? `Connect your database: ${f.topAskTitle || 'Firebase'}.` : `Next: ${f.topAskTitle || `${asks} thing(s) need you`}.`,
      hi: db ? `अपना database जोड़ें: ${f.topAskTitle || 'Firebase'}।` : `अगला कदम: ${f.topAskTitle || `${asks} काम बाकी`}।`,
      cta: db
        ? { target: 'database', en: 'Open Database', hi: 'Database खोलें' }
        : { target: 'tray', en: 'Show me', hi: 'दिखाओ' },
    };
  }

  if (!f.buildFinished || f.buildOk !== true) return null;

  // 5. Publish.
  if (f.publishFreshness === 'never_published') {
    return {
      id: 'publish.first', tone: 'action',
      en: 'Your app works. Next: put it online with Publish.',
      hi: 'App तैयार है। अगला कदम: Publish करके online डालें।',
      cta: { target: 'publish', en: 'Publish', hi: 'Publish' },
    };
  }
  if (f.publishFreshness === 'changed') {
    return {
      id: 'publish.stale', tone: 'urgent',
      en: 'Your live site shows the OLD version. Publish again to update it.',
      hi: 'Live site पर पुराना version है। दोबारा Publish करें।',
      cta: { target: 'publish', en: 'Publish changes', hi: 'बदलाव Publish करें' },
    };
  }

  // 6. Domain — only from a LIVE check.
  if (f.domain && f.domainActive === false) {
    return {
      id: 'domain.pending', tone: 'action', recheck: true,
      en: `${f.domain}: add the DNS records at your domain company (e.g. Hostinger), then wait — I re-check automatically (can take up to a few hours).`,
      hi: `${f.domain}: अपनी domain company (जैसे Hostinger) में DNS records डालें, फिर रुकें — मैं अपने आप चेक करता रहूँगा (कुछ घंटे लग सकते हैं)।`,
      cta: { target: 'publish', en: 'See DNS records', hi: 'DNS records देखें' },
    };
  }
  if (f.domain && f.domainActive === true && f.publishFreshness === 'up_to_date') {
    return {
      id: 'all.done', tone: 'done',
      en: `All done — your app is live on ${f.domain}.`,
      hi: `सब हो गया — आपका app ${f.domain} पर live है।`,
    };
  }
  if (f.publishFreshness === 'up_to_date') {
    return {
      id: 'live.done', tone: 'done',
      en: 'Your app is live and up to date. Optional: connect your own domain.',
      hi: 'App live और updated है। चाहें तो अपना domain जोड़ें।',
      cta: { target: 'publish', en: 'Own domain', hi: 'अपना domain' },
    };
  }
  return null;
}

/** Poll cadence for a pending domain: fast at first, then gentle. Never while the tab is hidden. */
export function domainRecheckMs(attempt: number): number {
  return attempt < 5 ? 30_000 : 120_000;
}
