// STEP-BY-STEP STORE PUBLISHING GUIDE — written for a NON-TECHNICAL user (admin 2026-07-26:
// "user ko guide bhi kare ki kaise app ko app store ya play store me publish karni hai … ek ek step
// bata bata kar help karni hai, user non technical honge mere jaise").
//
// WHY THIS IS DATA AND NOT PROSE IN A COMPONENT: the same walkthrough has to drive THREE surfaces —
// the in-app checklist UI, the AI answering "meri app kaise publish karun?", and the SHIPPING.md that
// lands in the user's repo. Three hand-written copies would drift the moment a store changes a screen
// name (rule 4). One structured source, rendered three ways.
//
// TONE RULES encoded here (they are requirements, not style):
//   • Every step says WHERE to click, WHAT to type, and WHAT you should see afterwards — a user who has
//     never opened Play Console must not have to guess.
//   • Costs and waiting times are stated UP FRONT, never discovered halfway through.
//   • Anything NavBharatAI cannot do for the user is marked `youMustDoThis` and says plainly why, so
//     nobody waits for a button that is never coming (rule 6).
//   • No jargon without a plain-language gloss in the same sentence.
//
// PURE + deterministic (no I/O), fully unit-tested.

export type StorePlatform = 'android' | 'ios';

export interface PublishStep {
  /** Stable id — the UI persists per-step completion against this, so wording can change freely. */
  id: string;
  /** Short imperative title, plain language. */
  title: string;
  /** What to actually do, written for someone who has never seen the screen before. */
  detail: string;
  /** What the user should see once the step worked — so they can self-verify instead of guessing. */
  youShouldSee?: string;
  /** Real money this step costs, stated before they start. */
  cost?: string;
  /** Realistic waiting time, so a slow step doesn't read as a failure. */
  takes?: string;
  /** True when only the user can do it (their identity, their money, their account). */
  youMustDoThis?: boolean;
  /** True when NavBharatAI does it for them. */
  navbharatDoesThis?: boolean;
  /** Direct link to the exact page, when one exists. */
  link?: string;
}

export interface PublishGuide {
  platform: StorePlatform;
  title: string;
  /** One-line honest summary of money + time before the user commits to anything. */
  upfront: string;
  steps: PublishStep[];
}

const ANDROID_STEPS: PublishStep[] = [
  {
    id: 'android-account',
    title: 'Create a Google Play developer account',
    detail:
      'Go to Google Play Console and sign in with the Google account you want to own the app forever. Google charges a ONE-TIME fee of about $25 (roughly ₹2,000) — there is no yearly fee. You will have to enter your name and address, and Google verifies your identity, which can take a couple of days.',
    youShouldSee: 'A Play Console dashboard with an "Create app" button.',
    cost: 'About $25 (~₹2,000), one time, forever',
    takes: 'A few minutes to pay; identity verification can take 1–3 days',
    youMustDoThis: true,
    link: 'https://play.google.com/console/signup',
  },
  {
    id: 'android-keystore',
    title: 'Create your signing key (your app’s permanent identity)',
    detail:
      'A signing key is a file that proves future updates really come from you. NavBharatAI gives you the exact one-line command to create it in the SHIPPING.md file. Run it once, then keep the file safe — a password manager or a cloud drive you control.',
    youShouldSee: 'A file called release.keystore on your computer.',
    takes: '2 minutes',
    youMustDoThis: true,
  },
  {
    id: 'android-secrets',
    title: 'Put your key into GitHub as a secret',
    detail:
      'Open your repository on GitHub, then: Settings → Secrets and variables → Actions → New repository secret. Add the four secrets listed in SHIPPING.md. "Secret" means GitHub stores it encrypted — nobody, including NavBharatAI, can read it back.',
    youShouldSee: 'Four secrets listed on that page (their values stay hidden — that is correct).',
    takes: '5 minutes',
    youMustDoThis: true,
  },
  {
    id: 'android-build',
    title: 'Build the app',
    detail:
      'Press the build button in NavBharatAI (or on GitHub: Actions tab → "Build Android App Bundle" → Run workflow). GitHub’s computers compile and sign your app for you — your own computer does nothing.',
    youShouldSee: 'A green tick next to the build, after several minutes.',
    takes: '5–10 minutes',
    navbharatDoesThis: true,
  },
  {
    id: 'android-download',
    title: 'Download your app',
    detail:
      'When the build turns green, download it right here in NavBharatAI. You get two files: the .aab is the one Google Play requires, and the .apk is one you can send to your own phone and install immediately to try the app out.',
    youShouldSee: 'An .aab file and an .apk file downloaded to your device.',
    takes: 'Instant',
    navbharatDoesThis: true,
  },
  {
    id: 'android-create-listing',
    title: 'Create the app in Play Console and fill its store page',
    detail:
      'In Play Console press "Create app", enter your app name and language, and pick Free or Paid (this cannot be changed later if you pick Free). Then fill the store listing: a short description, a full description, at least 2 phone screenshots, an app icon (512×512), and a feature graphic (1024×500).',
    youShouldSee: 'Green ticks next to "Store listing" in Play Console’s task list.',
    takes: '30–60 minutes',
    youMustDoThis: true,
  },
  {
    id: 'android-policy',
    title: 'Answer Google’s questionnaires',
    detail:
      'Play Console asks about your app’s content rating, who your audience is, ads, and a Data Safety form describing what information your app collects. Answer honestly — a wrong answer here is the most common reason an app gets removed later. You also need a privacy policy web page and its link.',
    youShouldSee: 'All questionnaire sections marked complete.',
    takes: '30 minutes',
    youMustDoThis: true,
  },
  {
    id: 'android-upload',
    title: 'Upload the .aab and send it for review',
    detail:
      'Play Console → Production → Create new release → upload the .aab file you downloaded → write a short "what’s new" note → Review release → Start rollout to Production.',
    youShouldSee: 'Your release shown as "In review".',
    takes: '10 minutes to submit; Google’s review usually takes 1–7 days',
    youMustDoThis: true,
  },
  {
    id: 'android-live',
    title: 'You are live',
    detail:
      'Once Google approves it, your app appears on the Play Store. For every future update, just build again in NavBharatAI and upload the new .aab — the version number is increased automatically, so Google never rejects it as a duplicate.',
    youShouldSee: 'Your app’s public Play Store page.',
    takes: 'A few hours after approval',
  },
];

const IOS_STEPS: PublishStep[] = [
  {
    id: 'ios-account',
    title: 'Join the Apple Developer Program',
    detail:
      'Go to the Apple Developer site and enrol with your Apple ID. Apple charges about $99 (roughly ₹8,000) EVERY YEAR — if you stop paying, your app is removed from the App Store. Apple verifies your identity, and for a company account they also ask for business documents.',
    youShouldSee: 'Your membership shown as active, with a Team ID.',
    cost: 'About $99 (~₹8,000) per year, recurring',
    takes: 'A few minutes to pay; approval can take 1–2 days',
    youMustDoThis: true,
    link: 'https://developer.apple.com/programs/enroll/',
  },
  {
    id: 'ios-no-mac',
    title: 'You do NOT need a Mac or an iPhone to build',
    detail:
      'Building an iPhone app normally requires a Mac. NavBharatAI works around this honestly: the build runs on a real Apple computer rented by the minute inside GitHub, so you never have to buy one. You will still want an iPhone (or a friend’s) to actually test the app.',
    navbharatDoesThis: true,
  },
  {
    id: 'ios-app-record',
    title: 'Create the app entry in App Store Connect',
    detail:
      'Go to App Store Connect → My Apps → the + button → New App. Give it a name and select the bundle id that matches your app (NavBharatAI shows you this id). This creates the empty shelf your builds will land on.',
    youShouldSee: 'Your app listed under My Apps.',
    takes: '5 minutes',
    youMustDoThis: true,
    link: 'https://appstoreconnect.apple.com/apps',
  },
  {
    id: 'ios-api-key',
    title: 'Create an App Store Connect API key',
    detail:
      'App Store Connect → Users and Access → Integrations → App Store Connect API → generate a key and choose the "Admin" role (a lower role cannot sign the app). Download the .p8 file — Apple lets you download it only ONCE, so save it carefully. Note the Key ID and the Issuer ID shown on that page.',
    youShouldSee: 'A downloaded AuthKey_XXXXXX.p8 file, plus a Key ID and an Issuer ID.',
    takes: '5 minutes',
    youMustDoThis: true,
  },
  {
    id: 'ios-secrets',
    title: 'Put the Apple key into GitHub as secrets',
    detail:
      'On GitHub: Settings → Secrets and variables → Actions → New repository secret. Add the four iOS secrets listed in SHIPPING.md, including pasting the whole contents of that .p8 file. GitHub stores them encrypted.',
    youShouldSee: 'Four iOS secrets listed (values hidden — that is correct).',
    takes: '5 minutes',
    youMustDoThis: true,
  },
  {
    id: 'ios-build',
    title: 'Build and send it to TestFlight',
    detail:
      'Press the iOS build button in NavBharatAI with "upload" turned on. GitHub builds and signs the app on a real Apple computer and uploads it to TestFlight — Apple’s official app for trying an app before it is public.',
    youShouldSee: 'A green tick, then the build appears in App Store Connect → TestFlight.',
    takes: '15–25 minutes',
    navbharatDoesThis: true,
  },
  {
    id: 'ios-testflight',
    title: 'Try the app on a real iPhone',
    detail:
      'Install the TestFlight app from the App Store on your iPhone and sign in with the same Apple ID. Your build appears there and you can install it like a normal app. Anyone you invite as a tester can too.',
    youShouldSee: 'Your app installed on the phone through TestFlight.',
    takes: '10 minutes',
    youMustDoThis: true,
  },
  {
    id: 'ios-listing',
    title: 'Fill the App Store page',
    detail:
      'In App Store Connect, fill your app’s description, keywords, support URL, and privacy policy link, and upload screenshots for the required iPhone sizes (6.7-inch and 6.1-inch, at least 3 each). Also complete the App Privacy section describing what data you collect.',
    youShouldSee: 'No remaining red warnings on the app’s page.',
    takes: '45–90 minutes',
    youMustDoThis: true,
  },
  {
    id: 'ios-submit',
    title: 'Submit for review',
    detail:
      'Select the build you sent to TestFlight, then press "Add for Review" and "Submit". Apple reviews apps by hand and is stricter than Google — if they reject it, they tell you exactly which guideline, and you fix it and submit again. A rejection is normal and not a failure.',
    youShouldSee: 'Status changing to "Waiting for Review".',
    takes: 'Apple’s review usually takes 1–3 days',
    youMustDoThis: true,
  },
  {
    id: 'ios-live',
    title: 'You are live',
    detail:
      'After approval your app appears on the App Store. For updates, build again in NavBharatAI — the build number increases automatically, so Apple never rejects it as a duplicate.',
    youShouldSee: 'Your app’s public App Store page.',
    takes: 'A few hours after approval',
  },
];

const GUIDES: Record<StorePlatform, PublishGuide> = {
  android: {
    platform: 'android',
    title: 'Publishing your app on the Google Play Store',
    upfront:
      'You need a Google Play developer account (about $25 / ₹2,000, paid once — no yearly fee). Expect roughly 2 hours of your own work, then 1–7 days for Google to review. You do not need any special computer — NavBharatAI builds the app for you.',
    steps: ANDROID_STEPS,
  },
  ios: {
    platform: 'ios',
    title: 'Publishing your app on the Apple App Store',
    upfront:
      'You need an Apple Developer account (about $99 / ₹8,000 EVERY year — the app is removed if you stop paying). Expect roughly 3 hours of your own work, then 1–3 days for Apple to review. You do NOT need a Mac or an iPhone to build it — NavBharatAI builds it on a real Apple computer inside GitHub for you.',
    steps: IOS_STEPS,
  },
};

/** The full step-by-step guide for one store. */
export function getPublishGuide(platform: StorePlatform): PublishGuide {
  return GUIDES[platform];
}

/** Both guides, for the UI and for the AI to answer "how do I publish?". */
export function getAllPublishGuides(): PublishGuide[] {
  return [GUIDES.android, GUIDES.ios];
}

/**
 * Render a guide as plain text — used for the AI's answer and for the SHIPPING.md that lands in the
 * user's repo, so all three surfaces read from this one source and can never drift.
 */
export function renderPublishGuideText(platform: StorePlatform): string {
  const g = GUIDES[platform];
  const lines: string[] = [`${g.title}`, '', `Before you start: ${g.upfront}`, ''];
  g.steps.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.title}`);
    lines.push(`   ${s.detail}`);
    if (s.youShouldSee) lines.push(`   You should see: ${s.youShouldSee}`);
    const meta: string[] = [];
    if (s.cost) meta.push(`Cost: ${s.cost}`);
    if (s.takes) meta.push(`Takes: ${s.takes}`);
    if (s.navbharatDoesThis) meta.push('NavBharatAI does this for you');
    if (s.youMustDoThis) meta.push('Only you can do this');
    if (meta.length) lines.push(`   (${meta.join(' · ')})`);
    if (s.link) lines.push(`   Link: ${s.link}`);
    lines.push('');
  });
  return lines.join('\n');
}
