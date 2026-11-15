// /how-it-works — what NavBharatAI actually does, in Hindi and English.
//
// White-label: this page may say "NavBharatAI engine" and "several engines".
// It must not name an AI provider, model, or vendor. Free-answer numbers come
// from the same defaults the quota code uses. This file does not change those quotas.

import { escapeHtml, publicFooterHtml } from './legalMarkdown';
import { jsonLdScript, pageJsonLd } from './siteSchema';
import { GUEST_DAILY_DEFAULT, SIGNED_IN_DAILY_DEFAULT } from './unifiedWallet/policy';
import { imageFreePerDay } from './imageAllowance';

export const HOW_IT_WORKS_PATH = '/how-it-works';
export const HOW_IT_WORKS_TITLE = 'How NavBharatAI works — engines, language, checks, quota';
export const HOW_IT_WORKS_DESCRIPTION =
  'How NavBharatAI answers, switches engines without starting the chat over, matches your language, checks a build, and counts free answers. No foundation model of our own.';

const esc = escapeHtml;

export function howItWorksFacts() {
  return {
    guest: GUEST_DAILY_DEFAULT,
    signedIn: SIGNED_IN_DAILY_DEFAULT,
    images: imageFreePerDay({} as NodeJS.ProcessEnv),
  };
}

export function renderHowItWorksPage(origin: string): string {
  const n = howItWorksFacts();
  const url = `${origin}${HOW_IT_WORKS_PATH}`;
  const title = esc(HOW_IT_WORKS_TITLE);
  const description = esc(HOW_IT_WORKS_DESCRIPTION);
  const body = `
<h1>NavBharatAI कैसे काम करता है</h1>
<p>यह पेज वही बताता है जो उत्पाद में है। हम अपनी फाउंडेशन मॉडल ट्रेन नहीं करते। हम यह भी नहीं कहते कि कोई खास तरह से ट्रेन किया हुआ राउटर या चेकर है। जवाब और ऐप NavBharatAI engine बनाता है।</p>
<h2>कई engines, वही बातचीत</h2>
<p>NavBharatAI engine एक से ज्यादा engines इस्तेमाल करता है। अगर एक engine जवाब नहीं दे पाता, तो दूसरा engine उसी बातचीत के साथ पूछा जाता है। आपको चैट फिर से शुरू नहीं करनी पड़ती। अगर सब व्यस्त हों, तो ऐप साफ कहता है कि अभी जवाब नहीं बना — वह हरा निशान नहीं लगाता।</p>
<h2>भाषा</h2>
<p>आप देवनागरी में लिखें तो जवाब हिंदी में आता है। हिंग्लिश लिखें तो जवाब उसी लहजे में। अंग्रेज़ी लिखें तो जवाब अंग्रेज़ी में। आप चैट में यह भी कह सकते हैं कि किस भाषा में जवाब चाहिए। engine बदलने पर भी वही बातचीत साथ जाती है।</p>
<h2>कम खर्च, जाँच के बाद</h2>
<p>एक रास्ते पर NavBharatAI engine उन engines में से सस्ता वाला चुनता है जो जाँच पास कर चुके हों। जाँच में लिखा हुआ जवाब, हिंदी, सफल होने की दर और गति देखी जाती है। जो जाँच पास नहीं है, वह उस रास्ते पर नहीं चुना जाता। यह हमारी ट्रेन की हुई मॉडल नहीं है। यह समीक्षा की हुई सूची है।</p>
<h2>ऐप बनाते समय जाँच</h2>
<p>फाइलें लिख देना ही “ऐप बन गया” नहीं है। बिल्ड के बाद प्रोजेक्ट जाँचा जाता है, और चलाने लायक कुछ हो तो प्रीव्यू खोला जाता है। बिल्ड रुक जाए या फेल हो तो रिपोर्ट रहती है: आपने क्या माँगा और कहाँ रुका। वह रिपोर्ट सुधार के लिए है। वह यह वादा नहीं है कि हर स्क्रीन पहली बार परफेक्ट होगी।</p>
<h2>मुफ़्त जवाब की गिनती</h2>
<p>साइन-इन से पहले दिन में ${n.guest} मुफ़्त जवाब। साइन-इन के बाद दिन में ${n.signedIn} मुफ़्त जवाब, एक ही साझा गिनती। उसमें कुछ मुफ़्त तस्वीरें भी आती हैं (आज की डिफ़ॉल्ट सीमा ${n.images} है), और हर ऐसी तस्वीर एक मुफ़्त जवाब भी गिनती है। गिनती रात 12 बजे IST पर रीसेट होती है। ${n.signedIn} के बाद साइन-इन यूज़र वॉलेट से आगे बढ़ सकता है। गेस्ट को साइन-इन के लिए कहा जाता है। अगर सर्वर पर संख्या बदली गई हो, तो ऐप में जो संदेश दिखे वही मान्य है।</p>
<h2>निजता</h2>
<p>आपका प्रॉम्प्ट, ज़रूरी फाइलें और बातचीत का संदर्भ केवल आपका जवाब या बिल्ड बनाने के लिए प्रोसेस होता है। हम अनुबंध में यह रखते हैं कि इस डेटा से उन engines को ट्रेन न किया जाए। हम अपनी फाउंडेशन मॉडल ट्रेन नहीं करते। विस्तार <a href="/privacy">Privacy Policy</a> के सेक्शन 4 में है।</p>
<p><a class="cta" href="/">NavBharatAI खोलें</a></p>
<h2>In English</h2>
<p>This page describes what the product does. NavBharatAI has not trained a foundation model of its own. We also do not claim a specially trained router or a specially trained checker. Answers and apps come from the NavBharatAI engine.</p>
<h3>Several engines, the same conversation</h3>
<p>The NavBharatAI engine uses more than one engine. If one engine cannot answer, another is asked, and the same conversation is sent with that request. You do not start the chat again. If every engine is busy, the app says so. It does not show a success mark.</p>
<h3>Language</h3>
<p>Devanagari is answered in Hindi. Hinglish is answered in that mix. English is answered in English. You can also tell the chat which language to use. When an engine is switched, the conversation so far goes with the request.</p>
<h3>A lower cost only after a quality check</h3>
<p>On one path, the NavBharatAI engine prefers the lower-cost engine among those that have already passed quality checks. The checks look at the written answer, Hindi, how often the engine succeeds, and how fast it is. An engine that has not passed is not chosen on that path. The list is reviewed. It is not a model we trained.</p>
<h3>Checks while an app is built</h3>
<p>Writing files is not the same as a finished app. After a build, the project is checked, and a preview is opened when there is something to run. If a build stops or fails, a report is kept: what you asked for, and where it stopped. The report is for fixing the product. It is not a promise that every screen is perfect the first time.</p>
<h3>Free answers</h3>
<p>Before sign-in, ${n.guest} free answers a day. After sign-in, ${n.signedIn} free answers a day, in one shared count. A few free images are included (the default today is ${n.images}), and each of those images also uses one free answer. The count resets at 12:00 AM IST. After the free answers, a signed-in person can continue from the wallet. A guest is asked to sign in. If a server setting changes the number, the message in the app is the one that applies.</p>
<h3>Privacy</h3>
<p>Your prompt, the project files that are needed, and the conversation context are processed only to produce the answer or the build you asked for. Our contracts require that this data is not used to train those engines. We do not train a foundation model of our own. The detail is in Section 4 of the <a href="/privacy">Privacy Policy</a>.</p>`;

  return `<!doctype html>
<html lang="hi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${esc(url)}">
<link rel="alternate" hreflang="hi" href="${esc(url)}">
<link rel="alternate" hreflang="en" href="${esc(url)}">
<link rel="alternate" hreflang="x-default" href="${esc(url)}">
<link rel="icon" type="image/png" href="/logo-160.png">
<meta property="og:site_name" content="NavBharatAI">
<meta property="og:type" content="article">
<meta property="og:locale" content="hi_IN">
<meta property="og:locale:alternate" content="en_IN">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(origin + '/og-image.png')}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${esc(origin + '/og-image.png')}">
${jsonLdScript(pageJsonLd({ url, name: HOW_IT_WORKS_TITLE, description: HOW_IT_WORKS_DESCRIPTION }))}
<style>
  body { margin: 0; background: #fff; color: #16161d; font: 17px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Devanagari", sans-serif; }
  header.top, main, .site-foot { max-width: 46rem; margin: 0 auto; padding-left: 1.25rem; padding-right: 1.25rem; }
  header.top { padding-top: 1rem; display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
  header.top a.brand { font-weight: 800; color: inherit; text-decoration: none; }
  main { padding-top: 1rem; padding-bottom: 2rem; }
  h1 { font-size: 1.8rem; line-height: 1.25; }
  a { color: #4f46e5; }
  .cta { display: inline-flex; align-items: center; min-height: 44px; margin: 1rem 0; padding: .75rem 1.2rem; border-radius: 12px; background: #4f46e5; color: #fff; text-decoration: none; font-weight: 700; }
  @media (prefers-color-scheme: dark) {
    body { background: #101017; color: #e9e9f2; }
    a { color: #b3adff; }
    .cta { background: #6d66ff; color: #fff; }
  }
</style>
</head>
<body>
<header class="top"><a class="brand" href="/">NavBharatAI</a><nav><a href="/pricing">Pricing</a> <a href="/privacy">Privacy</a></nav></header>
<main>${body}</main>
${publicFooterHtml()}
</body>
</html>`;
}
