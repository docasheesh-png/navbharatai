/**
 * AFTER A BUILD, SAY WHAT THE APP STILL NEEDS — in the language the user wrote in.
 *
 * Two facts only, both already measured elsewhere (never invented from the model's prose):
 *   • database — `databaseReadiness`: the app's own files save data, and nothing is connected
 *   • server   — `planDeployment`: the built files contain a real server a website host cannot run
 *
 * Keys stay in `appRequirementsNotice`. This module does not ask for a key, and it does not sell
 * anything that is not on sale. A server row's button opens Billing → Plans (Starter / Growth, the
 * live catalogue) ONLY when we know the user has no plan. A database row opens Settings → Database
 * so they connect their own — that is free from us, and it is not a charge. There is no button for
 * a ₹ per GB rate or a server seat that is not in the catalogue.
 *
 * PURE. No I/O, no clock, no model. Unknown / Latin script → English, same as the key checklist.
 */

import { HOSTING_TIERS } from '../../lib/hostingTiers';
import type { UserActionLink } from './userActions';

export type ServerPlanOffer = 'buy' | 'included' | 'none';

export interface ServerNeedFacts {
  /** The built files contain a real server process. */
  needsServer: boolean;
  /**
   * `buy` — plans are on and we KNOW they have none, so Billing → Plans is a real purchase.
   * `included` — they already hold a plan; say so, do not sell another.
   * `none` — plans are off, or the plan could not be read. Explain. Do not sell.
   */
  plan: ServerPlanOffer;
}

export interface DatabaseNeedFacts {
  needsDatabase: boolean;
  connected: boolean;
  canProvision: boolean;
}

interface NeedStrings {
  head: string;
  dbTitle: string;
  dbWhyOwn: string;
  dbWhyReady: string;
  dbButton: string;
  serverTitle: string;
  serverBuy: (plans: string) => string;
  serverIncluded: string;
  serverSelf: string;
  serverButton: string;
}

/** The live plan names and prices, read from the catalogue so this sentence cannot drift. */
export function liveHostingPlanList(): string {
  return HOSTING_TIERS.map((t) => `${t.name} ₹${t.priceInr}`).join(' or ');
}

const EN: NeedStrings = {
  head: 'What this app still needs:',
  dbTitle: 'Connect a database',
  dbWhyOwn: 'Your app saves data, and no database is connected yet — so nothing it saves will survive. Connect your own database account in Settings and this is done.',
  dbWhyReady: 'Your app saves data, and no database is connected yet — so nothing it saves will survive. Your database account is already connected, so this is one press.',
  dbButton: 'Open Database',
  serverTitle: 'This app needs a server',
  serverBuy: (plans) => `This app has a server a website cannot run. Host it yourself — that is free from us — or open Plans and buy ${plans}. Those plans include real servers. There is no separate server to buy on its own.`,
  serverIncluded: 'This app has a server a website cannot run. Your hosting plan already includes real servers, so publish it when you are ready. Hosting it yourself stays free from us.',
  serverSelf: 'This app has a server a website cannot run. Host that server yourself — that stays free from us.',
  serverButton: 'Open Plans',
};

const STRINGS: Record<string, NeedStrings> = {
  hi: {
    head: 'इस ऐप को आपसे अभी यह चाहिए:',
    dbTitle: 'Database जोड़ें',
    dbWhyOwn: 'आपका ऐप डेटा सेव करता है, और अभी कोई database जुड़ा नहीं है — जो सेव होगा वह बना नहीं रहेगा। Settings में अपना database जोड़ें। यह हमसे मुफ़्त है।',
    dbWhyReady: 'आपका ऐप डेटा सेव करता है, और अभी कोई database जुड़ा नहीं है — जो सेव होगा वह बना नहीं रहेगा। आपका database account पहले से जुड़ा है, इसलिए यह एक press है।',
    dbButton: 'Database खोलें',
    serverTitle: 'इस ऐप को server चाहिए',
    serverBuy: (plans) => `इस ऐप में एक server है, जिसे सिर्फ़ वेबसाइट होस्टिंग नहीं चला सकती। खुद होस्ट करें — वह हमसे मुफ़्त है — या Plans खोलकर ${plans} लें। इन plans में असली server शामिल है। अलग से server खरीदने का बटन नहीं है।`,
    serverIncluded: 'इस ऐप में एक server है, जिसे सिर्फ़ वेबसाइट होस्टिंग नहीं चला सकती। आपके hosting plan में असली server पहले से है — तैयार हों तो Publish करें। खुद होस्ट करना हमसे मुफ़्त है।',
    serverSelf: 'इस ऐप में एक server है, जिसे सिर्फ़ वेबसाइट होस्टिंग नहीं चला सकती। इस server को खुद होस्ट करें — वह हमसे मुफ़्त है।',
    serverButton: 'Plans खोलें',
  },
  bn: {
    head: 'এই অ্যাপের এখনও আপনার কাছ থেকে দরকার:',
    dbTitle: 'Database যুক্ত করুন',
    dbWhyOwn: 'আপনার অ্যাপ ডেটা সেভ করে, এবং এখনও কোনো database যুক্ত নেই — যা সেভ হবে তা থাকবে না। Settings-এ নিজের database যুক্ত করুন। এটা আমাদের কাছ থেকে বিনামূল্যে।',
    dbWhyReady: 'আপনার অ্যাপ ডেটা সেভ করে, এবং এখনও কোনো database যুক্ত নেই — যা সেভ হবে তা থাকবে না। আপনার database account আগে থেকেই যুক্ত, তাই এটা এক press।',
    dbButton: 'Database খুলুন',
    serverTitle: 'এই অ্যাপের server দরকার',
    serverBuy: (plans) => `এই অ্যাপে একটি server আছে, যা শুধু ওয়েবসাইট হোস্টিং চালাতে পারে না। নিজে হোস্ট করুন — সেটা আমাদের কাছ থেকে বিনামূল্যে — অথবা Plans খুলে ${plans} নিন। এই plan-এ আসল server আছে। আলাদা করে server কেনার বোতাম নেই।`,
    serverIncluded: 'এই অ্যাপে একটি server আছে, যা শুধু ওয়েবসাইট হোস্টিং চালাতে পারে না। আপনার hosting plan-এ আসল server আগে থেকেই আছে — তৈরি হলে Publish করুন। নিজে হোস্ট করা বিনামূল্যে।',
    serverSelf: 'এই অ্যাপে একটি server আছে, যা শুধু ওয়েবসাইট হোস্টিং চালাতে পারে না। এই server নিজে হোস্ট করুন — সেটা আমাদের কাছ থেকে বিনামূল্যে।',
    serverButton: 'Plans খুলুন',
  },
  pa: {
    head: 'ਇਸ ਐਪ ਨੂੰ ਤੁਹਾਡੇ ਤੋਂ ਹਾਲੇ ਇਹ ਚਾਹੀਦਾ ਹੈ:',
    dbTitle: 'Database ਜੋੜੋ',
    dbWhyOwn: 'ਤੁਹਾਡੀ ਐਪ ਡਾਟਾ ਸੇਵ ਕਰਦੀ ਹੈ, ਅਤੇ ਅਜੇ ਕੋਈ database ਜੁੜਿਆ ਨਹੀਂ — ਜੋ ਸੇਵ ਹੋਵੇਗਾ ਉਹ ਰਹਿ ਨਹੀਂ ਸਕੇਗਾ। Settings ਵਿੱਚ ਆਪਣਾ database ਜੋੜੋ। ਇਹ ਸਾਡੇ ਤੋਂ ਮੁਫ਼ਤ ਹੈ।',
    dbWhyReady: 'ਤੁਹਾਡੀ ਐਪ ਡਾਟਾ ਸੇਵ ਕਰਦੀ ਹੈ, ਅਤੇ ਅਜੇ ਕੋਈ database ਜੁੜਿਆ ਨਹੀਂ — ਜੋ ਸੇਵ ਹੋਵੇਗਾ ਉਹ ਰਹਿ ਨਹੀਂ ਸਕੇਗਾ। ਤੁਹਾਡਾ database account ਪਹਿਲਾਂ ਤੋਂ ਜੁੜਿਆ ਹੈ, ਇਸ ਲਈ ਇਹ ਇੱਕ press ਹੈ।',
    dbButton: 'Database ਖੋਲ੍ਹੋ',
    serverTitle: 'ਇਸ ਐਪ ਨੂੰ server ਚਾਹੀਦਾ ਹੈ',
    serverBuy: (plans) => `ਇਸ ਐਪ ਵਿੱਚ ਇੱਕ server ਹੈ, ਜਿਸਨੂੰ ਸਿਰਫ਼ ਵੈੱਬਸਾਈਟ ਹੋਸਟਿੰਗ ਨਹੀਂ ਚਲਾ ਸਕਦੀ। ਖੁਦ ਹੋਸਟ ਕਰੋ — ਉਹ ਸਾਡੇ ਤੋਂ ਮੁਫ਼ਤ ਹੈ — ਜਾਂ Plans ਖੋਲ੍ਹ ਕੇ ${plans} ਲਵੋ। ਇਹਨਾਂ plans ਵਿੱਚ ਅਸਲੀ server ਸ਼ਾਮਲ ਹੈ। ਵੱਖਰਾ server ਖਰੀਦਣ ਦਾ ਬਟਨ ਨਹੀਂ ਹੈ।`,
    serverIncluded: 'ਇਸ ਐਪ ਵਿੱਚ ਇੱਕ server ਹੈ, ਜਿਸਨੂੰ ਸਿਰਫ਼ ਵੈੱਬਸਾਈਟ ਹੋਸਟਿੰਗ ਨਹੀਂ ਚਲਾ ਸਕਦੀ। ਤੁਹਾਡੇ hosting plan ਵਿੱਚ ਅਸਲੀ server ਪਹਿਲਾਂ ਤੋਂ ਹੈ — ਤਿਆਰ ਹੋਵੋ ਤਾਂ Publish ਕਰੋ। ਖੁਦ ਹੋਸਟ ਕਰਨਾ ਮੁਫ਼ਤ ਹੈ।',
    serverSelf: 'ਇਸ ਐਪ ਵਿੱਚ ਇੱਕ server ਹੈ, ਜਿਸਨੂੰ ਸਿਰਫ਼ ਵੈੱਬਸਾਈਟ ਹੋਸਟਿੰਗ ਨਹੀਂ ਚਲਾ ਸਕਦੀ। ਇਸ server ਨੂੰ ਖੁਦ ਹੋਸਟ ਕਰੋ — ਉਹ ਸਾਡੇ ਤੋਂ ਮੁਫ਼ਤ ਹੈ।',
    serverButton: 'Plans ਖੋਲ੍ਹੋ',
  },
  gu: {
    head: 'આ એપને તમારી પાસેથી હજી આ જોઈએ:',
    dbTitle: 'Database જોડો',
    dbWhyOwn: 'તમારી એપ ડેટા સેવ કરે છે, અને હજી કોઈ database જોડાયેલો નથી — જે સેવ થશે તે રહેશે નહીં। Settingsમાં પોતાનો database જોડો। આ અમારી તરફથી મફત છે।',
    dbWhyReady: 'તમારી એપ ડેટા સેવ કરે છે, અને હજી કોઈ database જોડાયેલો નથી — જે સેવ થશે તે રહેશે નહીં। તમારું database account પહેલેથી જોડાયેલું છે, એટલે આ એક press છે।',
    dbButton: 'Database ખોલો',
    serverTitle: 'આ એપને server જોઈએ',
    serverBuy: (plans) => `આ એપમાં એક server છે, જેને ફક્ત વેબસાઇટ હોસ્ટિંગ ચલાવી શકતી નથી। જાતે હોસ્ટ કરો — તે અમારી તરફથી મફત છે — અથવા Plans ખોલીને ${plans} લો। આ plansમાં અસલ server સામેલ છે। અલગથી server ખરીદવાનું બટન નથી।`,
    serverIncluded: 'આ એપમાં એક server છે, જેને ફક્ત વેબસાઇટ હોસ્ટિંગ ચલાવી શકતી નથી। તમારા hosting planમાં અસલ server પહેલેથી છે — તૈયાર થાઓ ત્યારે Publish કરો। જાતે હોસ્ટ કરવું મફત છે।',
    serverSelf: 'આ એપમાં એક server છે, જેને ફક્ત વેબસાઇટ હોસ્ટિંગ ચલાવી શકતી નથી। આ server જાતે હોસ્ટ કરો — તે અમારી તરફથી મફત છે।',
    serverButton: 'Plans ખોલો',
  },
  or: {
    head: 'ଏହି ଆପ୍‌କୁ ଆପଣଙ୍କଠାରୁ ଏବେ ଏହା ଦରକାର:',
    dbTitle: 'Database ଯୋଡ଼ନ୍ତୁ',
    dbWhyOwn: 'ଆପଣଙ୍କ ଆପ୍‌ ଡାଟା ସେଭ୍ କରେ, ଏବଂ ଏଯାଏଁ କୌଣସି database ଯୋଡ଼ାଯାଇନାହିଁ — ଯାହା ସେଭ୍ ହେବ ତାହା ରହିବ ନାହିଁ। Settingsରେ ନିଜ database ଯୋଡ଼ନ୍ତୁ। ଏହା ଆମ ଠାରୁ ମାଗଣା।',
    dbWhyReady: 'ଆପଣଙ୍କ ଆପ୍‌ ଡାଟା ସେଭ୍ କରେ, ଏବଂ ଏଯାଏଁ କୌଣସି database ଯୋଡ଼ାଯାଇନାହିଁ — ଯାହା ସେଭ୍ ହେବ ତାହା ରହିବ ନାହିଁ। ଆପଣଙ୍କ database account ପୂର୍ବରୁ ଯୋଡ଼ା ଅଛି, ତେଣୁ ଏହା ଗୋଟିଏ press।',
    dbButton: 'Database ଖୋଲନ୍ତୁ',
    serverTitle: 'ଏହି ଆପ୍‌କୁ server ଦରକାର',
    serverBuy: (plans) => `ଏହି ଆପ୍‌ରେ ଗୋଟିଏ server ଅଛି, ଯାହାକୁ କେବଳ ୱେବସାଇଟ୍ ହୋଷ୍ଟିଂ ଚଳାଇପାରିବ ନାହିଁ। ନିଜେ ହୋଷ୍ଟ କରନ୍ତୁ — ତାହା ଆମ ଠାରୁ ମାଗଣା — କିମ୍ବା Plans ଖୋଲି ${plans} ନିଅନ୍ତୁ। ଏହି planରେ ଅସଲ server ଅଛି। ଅଲଗା server କିଣିବାର ବଟନ୍ ନାହିଁ।`,
    serverIncluded: 'ଏହି ଆପ୍‌ରେ ଗୋଟିଏ server ଅଛି, ଯାହାକୁ କେବଳ ୱେବସାଇଟ୍ ହୋଷ୍ଟିଂ ଚଳାଇପାରିବ ନାହିଁ। ଆପଣଙ୍କ hosting planରେ ଅସଲ server ପୂର୍ବରୁ ଅଛି — ପ୍ରସ୍ତୁତ ହେଲେ Publish କରନ୍ତୁ। ନିଜେ ହୋଷ୍ଟ କରିବା ମାଗଣା।',
    serverSelf: 'ଏହି ଆପ୍‌ରେ ଗୋଟିଏ server ଅଛି, ଯାହାକୁ କେବଳ ୱେବସାଇଟ୍ ହୋଷ୍ଟିଂ ଚଳାଇପାରିବ ନାହିଁ। ଏହି server ନିଜେ ହୋଷ୍ଟ କରନ୍ତୁ — ତାହା ଆମ ଠାରୁ ମାଗଣା।',
    serverButton: 'Plans ଖୋଲନ୍ତୁ',
  },
  ta: {
    head: 'இந்த ஆப்புக்கு இப்போது உங்களிடமிருந்து இது தேவை:',
    dbTitle: 'Database இணைக்கவும்',
    dbWhyOwn: 'உங்கள் ஆப் தரவை சேமிக்கிறது, இன்னும் database இணையவில்லை — சேமிப்பது நிலைக்காது. Settings-இல் உங்கள் database-ஐ இணைக்கவும். இது எங்களிடம் இலவசம்.',
    dbWhyReady: 'உங்கள் ஆப் தரவை சேமிக்கிறது, இன்னும் database இணையவில்லை — சேமிப்பது நிலைக்காது. உங்கள் database account ஏற்கனவே இணைந்துள்ளது, அதனால் இது ஒரு press.',
    dbButton: 'Database திறக்கவும்',
    serverTitle: 'இந்த ஆப்புக்கு server தேவை',
    serverBuy: (plans) => `இந்த ஆப்பில் ஒரு server உள்ளது; வெறும் வலைத்தள ஹோஸ்டிங் அதை இயக்காது. நீங்களே ஹோஸ்ட் செய்யுங்கள் — அது எங்களிடம் இலவசம் — அல்லது Plans திறந்து ${plans} வாங்குங்கள். இந்த plan-களில் உண்மையான server உள்ளது. தனியாக server வாங்கும் பொத்தான் இல்லை.`,
    serverIncluded: 'இந்த ஆப்பில் ஒரு server உள்ளது; வெறும் வலைத்தள ஹோஸ்டிங் அதை இயக்காது. உங்கள் hosting plan-இல் உண்மையான server ஏற்கனவே உள்ளது — தயாரானதும் Publish செய்யுங்கள். நீங்களே ஹோஸ்ட் செய்வது இலவசம்.',
    serverSelf: 'இந்த ஆப்பில் ஒரு server உள்ளது; வெறும் வலைத்தள ஹோஸ்டிங் அதை இயக்காது. இந்த server-ஐ நீங்களே ஹோஸ்ட் செய்யுங்கள் — அது எங்களிடம் இலவசம்.',
    serverButton: 'Plans திறக்கவும்',
  },
  te: {
    head: 'ఈ యాప్‌కు ఇప్పుడు మీ నుండి ఇది కావాలి:',
    dbTitle: 'Database కలపండి',
    dbWhyOwn: 'మీ యాప్ డేటా సేవ్ చేస్తుంది, ఇంకా ఏ database కలవలేదు — సేవ్ అయినది ఉండదు. Settingsలో మీ database కలపండి. ఇది మా వైపు నుండి ఉచితం.',
    dbWhyReady: 'మీ యాప్ డేటా సేవ్ చేస్తుంది, ఇంకా ఏ database కలవలేదు — సేవ్ అయినది ఉండదు. మీ database account ఇప్పటికే కలిసి ఉంది, అందుకే ఇది ఒక press.',
    dbButton: 'Database తెరవండి',
    serverTitle: 'ఈ యాప్‌కు server కావాలి',
    serverBuy: (plans) => `ఈ యాప్‌లో ఒక server ఉంది, దాన్ని కేవలం వెబ్‌సైట్ హోస్టింగ్ నడపలేదు. మీరే హోస్ట్ చేయండి — అది మా వైపు నుండి ఉచితం — లేదా Plans తెరిచి ${plans} కొనండి. ఈ planల్లో నిజమైన server ఉంది. విడిగా server కొనే బటన్ లేదు.`,
    serverIncluded: 'ఈ యాప్‌లో ఒక server ఉంది, దాన్ని కేవలం వెబ్‌సైట్ హోస్టింగ్ నడపలేదు. మీ hosting planలో నిజమైన server ఇప్పటికే ఉంది — సిద్ధమైతే Publish చేయండి. మీరే హోస్ట్ చేయడం ఉచితం.',
    serverSelf: 'ఈ యాప్‌లో ఒక server ఉంది, దాన్ని కేవలం వెబ్‌సైట్ హోస్టింగ్ నడపలేదు. ఈ serverను మీరే హోస్ట్ చేయండి — అది మా వైపు నుండి ఉచితం.',
    serverButton: 'Plans తెరవండి',
  },
  kn: {
    head: 'ಈ ಆ್ಯಪ್‌ಗೆ ಈಗ ನಿಮ್ಮಿಂದ ಇದು ಬೇಕು:',
    dbTitle: 'Database ಸೇರಿಸಿ',
    dbWhyOwn: 'ನಿಮ್ಮ ಆ್ಯಪ್ ಡೇಟಾ ಉಳಿಸುತ್ತದೆ, ಇನ್ನೂ ಯಾವ database ಸೇರಿಲ್ಲ — ಉಳಿಸಿದ್ದು ಉಳಿಯುವುದಿಲ್ಲ. Settingsನಲ್ಲಿ ನಿಮ್ಮ database ಸೇರಿಸಿ. ಇದು ನಮ್ಮಿಂದ ಉಚಿತ.',
    dbWhyReady: 'ನಿಮ್ಮ ಆ್ಯಪ್ ಡೇಟಾ ಉಳಿಸುತ್ತದೆ, ಇನ್ನೂ ಯಾವ database ಸೇರಿಲ್ಲ — ಉಳಿಸಿದ್ದು ಉಳಿಯುವುದಿಲ್ಲ. ನಿಮ್ಮ database account ಈಗಾಗಲೇ ಸೇರಿದೆ, ಆದ್ದರಿಂದ ಇದು ಒಂದು press.',
    dbButton: 'Database ತೆರೆಯಿರಿ',
    serverTitle: 'ಈ ಆ್ಯಪ್‌ಗೆ server ಬೇಕು',
    serverBuy: (plans) => `ಈ ಆ್ಯಪ್‌ನಲ್ಲಿ ಒಂದು server ಇದೆ, ಅದನ್ನು ಕೇವಲ ವೆಬ್‌ಸೈಟ್ ಹೋಸ್ಟಿಂಗ್ ಓಡಿಸಲಾರದು. ನೀವೇ ಹೋಸ್ಟ್ ಮಾಡಿ — ಅದು ನಮ್ಮಿಂದ ಉಚಿತ — ಅಥವಾ Plans ತೆರೆದು ${plans} ತೆಗೆದುಕೊಳ್ಳಿ. ಈ planಗಳಲ್ಲಿ ನಿಜವಾದ server ಇದೆ. ಪ್ರತ್ಯೇಕವಾಗಿ server ಕೊಳ್ಳುವ ಬಟನ್ ಇಲ್ಲ.`,
    serverIncluded: 'ಈ ಆ್ಯಪ್‌ನಲ್ಲಿ ಒಂದು server ಇದೆ, ಅದನ್ನು ಕೇವಲ ವೆಬ್‌ಸೈಟ್ ಹೋಸ್ಟಿಂಗ್ ಓಡಿಸಲಾರದು. ನಿಮ್ಮ hosting planನಲ್ಲಿ ನಿಜವಾದ server ಈಗಾಗಲೇ ಇದೆ — ಸಿದ್ಧವಾದಾಗ Publish ಮಾಡಿ. ನೀವೇ ಹೋಸ್ಟ್ ಮಾಡುವುದು ಉಚಿತ.',
    serverSelf: 'ಈ ಆ್ಯಪ್‌ನಲ್ಲಿ ಒಂದು server ಇದೆ, ಅದನ್ನು ಕೇವಲ ವೆಬ್‌ಸೈಟ್ ಹೋಸ್ಟಿಂಗ್ ಓಡಿಸಲಾರದು. ಈ server ಅನ್ನು ನೀವೇ ಹೋಸ್ಟ್ ಮಾಡಿ — ಅದು ನಮ್ಮಿಂದ ಉಚಿತ.',
    serverButton: 'Plans ತೆರೆಯಿರಿ',
  },
  ml: {
    head: 'ഈ ആപ്പിന് ഇപ്പോൾ നിങ്ങളിൽ നിന്ന് ഇത് വേണം:',
    dbTitle: 'Database ചേർക്കുക',
    dbWhyOwn: 'നിങ്ങളുടെ ആപ്പ് ഡാറ്റ സേവ് ചെയ്യുന്നു, ഇതുവരെ database ചേർന്നിട്ടില്ല — സേവ് ചെയ്യുന്നത് നിലനിൽക്കില്ല. Settings-ൽ സ്വന്തം database ചേർക്കുക. ഇത് ഞങ്ങളിൽ നിന്ന് സൗജന്യം.',
    dbWhyReady: 'നിങ്ങളുടെ ആപ്പ് ഡാറ്റ സേവ് ചെയ്യുന്നു, ഇതുവരെ database ചേർന്നിട്ടില്ല — സേവ് ചെയ്യുന്നത് നിലനിൽക്കില്ല. നിങ്ങളുടെ database account മുൻപേ ചേർന്നിട്ടുണ്ട്, അതുകൊണ്ട് ഇത് ഒരു press.',
    dbButton: 'Database തുറക്കുക',
    serverTitle: 'ഈ ആപ്പിന് server വേണം',
    serverBuy: (plans) => `ഈ ആപ്പിൽ ഒരു server ഉണ്ട്, വെറും വെബ്സൈറ്റ് ഹോസ്റ്റിംഗ് അത് ഓടിക്കില്ല. സ്വയം ഹോസ്റ്റ് ചെയ്യുക — അത് ഞങ്ങളിൽ നിന്ന് സൗജന്യം — അല്ലെങ്കിൽ Plans തുറന്ന് ${plans} എടുക്കുക. ഈ plan-ുകളിൽ യഥാർത്ഥ server ഉണ്ട്. വേറെ server വാങ്ങാനുള്ള ബട്ടൺ ഇല്ല.`,
    serverIncluded: 'ഈ ആപ്പിൽ ഒരു server ഉണ്ട്, വെറും വെബ്സൈറ്റ് ഹോസ്റ്റിംഗ് അത് ഓടിക്കില്ല. നിങ്ങളുടെ hosting plan-ിൽ യഥാർത്ഥ server മുൻപേ ഉണ്ട് — തയ്യാറായാൽ Publish ചെയ്യുക. സ്വയം ഹോസ്റ്റ് ചെയ്യുന്നത് സൗജന്യം.',
    serverSelf: 'ഈ ആപ്പിൽ ഒരു server ഉണ്ട്, വെറും വെബ്സൈറ്റ് ഹോസ്റ്റിംഗ് അത് ഓടിക്കില്ല. ഈ server സ്വയം ഹോസ്റ്റ് ചെയ്യുക — അത് ഞങ്ങളിൽ നിന്ന് സൗജന്യം.',
    serverButton: 'Plans തുറക്കുക',
  },
  ar: {
    head: 'اس ایپ کو ابھی آپ سے یہ چاہیے:',
    dbTitle: 'Database جوڑیں',
    dbWhyOwn: 'آپ کی ایپ ڈیٹا محفوظ کرتی ہے، اور ابھی کوئی database جڑا نہیں — جو محفوظ ہوگا وہ رہے گا نہیں۔ Settings میں اپنا database جوڑیں۔ یہ ہم سے مفت ہے۔',
    dbWhyReady: 'آپ کی ایپ ڈیٹا محفوظ کرتی ہے، اور ابھی کوئی database جڑا نہیں — جو محفوظ ہوگا وہ رہے گا نہیں۔ آپ کا database account پہلے سے جڑا ہے، اس لیے یہ ایک press ہے۔',
    dbButton: 'Database کھولیں',
    serverTitle: 'اس ایپ کو server چاہیے',
    serverBuy: (plans) => `اس ایپ میں ایک server ہے، جسے صرف ویب سائٹ ہوسٹنگ نہیں چلا سکتی۔ خود ہوسٹ کریں — وہ ہم سے مفت ہے — یا Plans کھول کر ${plans} لیں۔ ان plans میں اصلی server شامل ہے۔ الگ سے server خریدنے کا بٹن نہیں ہے۔`,
    serverIncluded: 'اس ایپ میں ایک server ہے، جسے صرف ویب سائٹ ہوسٹنگ نہیں چلا سکتی۔ آپ کے hosting plan میں اصلی server پہلے سے ہے — تیار ہوں تو Publish کریں۔ خود ہوسٹ کرنا مفت ہے۔',
    serverSelf: 'اس ایپ میں ایک server ہے، جسے صرف ویب سائٹ ہوسٹنگ نہیں چلا سکتی۔ اس server کو خود ہوسٹ کریں — وہ ہم سے مفت ہے۔',
    serverButton: 'Plans کھولیں',
  },
};

function stringsFor(lang?: string | null): NeedStrings {
  return (lang && STRINGS[lang]) || EN;
}

export function databaseNeedText(
  facts: DatabaseNeedFacts,
  lang?: string | null,
): { title: string; why: string; cta: UserActionLink } | null {
  if (!facts.needsDatabase || facts.connected) return null;
  const s = stringsFor(lang);
  return {
    title: s.dbTitle,
    why: facts.canProvision ? s.dbWhyReady : s.dbWhyOwn,
    cta: { view: 'settings', settingsScreen: 'database', label: s.dbButton },
  };
}

export function serverNeedText(
  facts: ServerNeedFacts | null | undefined,
  lang?: string | null,
): { title: string; why: string; cta?: UserActionLink } | null {
  if (!facts?.needsServer) return null;
  const s = stringsFor(lang);
  if (facts.plan === 'buy') {
    return {
      title: s.serverTitle,
      why: s.serverBuy(liveHostingPlanList()),
      cta: { view: 'billing', label: s.serverButton },
    };
  }
  if (facts.plan === 'included') {
    return { title: s.serverTitle, why: s.serverIncluded };
  }
  return { title: s.serverTitle, why: s.serverSelf };
}

/**
 * The lines appended to the build summary (and then spoken as the last chat line).
 * `''` when the app needs neither — a plain app stays quiet.
 */
export function buildNeedsNotice(
  input: { database?: DatabaseNeedFacts | null; server?: ServerNeedFacts | null },
  lang?: string | null,
): string {
  const db = input.database ? databaseNeedText(input.database, lang) : null;
  const server = serverNeedText(input.server, lang);
  const lines = [db, server].filter((x): x is NonNullable<typeof x> => !!x).map((x) => `• ${x.title} — ${x.why}`);
  if (lines.length === 0) return '';
  return [stringsFor(lang).head, ...lines].join('\n');
}
