/**
 * 🛡️ A BUILD PROMPT THAT ASKS TO BREAK INTO OTHER PEOPLE'S SYSTEMS IS REFUSED AT THE PROMPT (admin 2026-11-27, failedbr #2555,
 * Q-3721: "apki salah ke anusar banao" — block prompts that ask to break into systems the user does not own: unauthorised
 * access, malware, password theft, DDoS; defensive, educational and own-system security tools stay allowed).
 *
 * #2555 asked for a website for offensive "hacking" access to networks. Prompt triage had no category for it — the publish
 * scanner's malware / phishing rules (CONTENT_RULES) read a published app's CODE, never the request — so the platform let
 * the build start and only the model's own judgement reframed it. A weaker or more compliant model would have built it.
 *
 * PROMPT-ONLY, ON PURPOSE. ILLEGAL_RULES also drives the App Mart publish scanner; a rule there would hold every honest
 * security app whose code names "ransomware" for review. This rule is read by triagePrompt alone.
 *
 * PRECISION FIRST, read as a sentence, like every rule here:
 *   • subject — an OFFENSIVE capability, in words a defender rarely needs to say as a thing to build ("hack into", "a hacking
 *     tool", "ransomware", "keylogger", "botnet", "a phishing page", "password stealer", "DDoS", "crack wifi passwords",
 *     "unauthorised access", "kisi ka … hack karo"). Never "hack" alone (life hacks, hackathons) and never "virus" (a corona
 *     tracker) or "crack" alone (Diwali crackers).
 *   • context — a TARGET or a harmful PURPOSE: someone else's account / phone / network, "without permission", "secretly",
 *     "steal", "spread", "victims", "take control", "access to networks".
 *   • protective stand-down — a security-education, detection, protection or own-system purpose ("learn", "awareness",
 *     "detect", "antivirus", "ethical", "CTF", "my own network") stands it down, UNLESS the request also carries a word such
 *     an app has no reason to use ("without permission", "someone's", "victims", "secretly", "steal", "spread", "sell").
 */
import type { IllegalRule } from '../AgentV3/illegalContentRules';

const D = '(?<![\\w\\u0900-\\u097F])';   // a Devanagari word start (the Latin \b does not see Devanagari letters)
const either = (latin: string, deva: readonly string[]): RegExp => new RegExp(`\\b(?:${latin})\\b|${D}(?:${deva.join('|')})`, 'i');

const SUBJECT = either(
  [
    'hack(?:s|ed|ing)?\\s+into', 'hack\\s+(?:someone|somebody|any(?:one)?|their|his|her|other|others|wifi|wi-fi|whatsapp|instagram|facebook|gmail|accounts?|phones?|mobiles?|networks?|servers?|websites?|cameras?|cctv)',
    'hack\\s*(?:kar\\w*|karo|karna|karne)', 'hacking\\s+(?:tool|tools|app|software|website|site|access|panel|service|kit|into)', 'hacker\\s+(?:tool|tools|app|panel|kit)',
    'break(?:ing)?\\s+into\\s+(?:\\w+\\s+){0,2}(?:accounts?|networks?|systems?|servers?|phones?|computers?|wifi|websites?|databases?)',
    'unauthori[sz]ed\\s+access', 'crack(?:ing)?\\s+(?:wifi|wi-fi|passwords?|accounts?)',
    'ransomware', 'keylogg\\w*', 'botnets?', 'spyware', 'stalkerware', 'remote\\s+access\\s+trojans?',
    'credential\\s+(?:stealer|stealing|harvest\\w*)', 'password\\s+(?:stealer|grabber|cracker|stealing)', 'otp\\s+(?:bypass|grabber|stealer)',
    'ddos(?:\\s+(?:attack|tool|panel|service|booter))?', 'phishing\\s+(?:page|pages|kit|site|website|link|links|app)', 'malware',
  ].join('|'),
  ['हैक\\s*कर', 'हैकिंग', 'पासवर्ड\\s*चुर', 'फ़िशिंग', 'फिशिंग', 'रैनसमवेयर', 'मैलवेयर', 'कीलॉगर', 'डीडीओएस', 'स्पाइवेयर'],
);

const CONTEXT = either(
  [
    'someone(?:\'s)?', 'somebody(?:\'s)?', 'others?(?:\'s)?', 'other\\s+people(?:\'s)?', 'anyone(?:\'s)?', 'any\\s+(?:account|phone|mobile|network|wifi|system|website|server|device)s?',
    'victims?', 'targets?', 'girlfriend(?:\'s)?', 'boyfriend(?:\'s)?', 'wife(?:\'s)?', 'husband(?:\'s)?', 'neighbou?rs?(?:\'s)?', 'friends?(?:\'s)?',
    'without\\s+(?:their\\s+)?(?:permission|consent|knowledge|authori[sz]ation)', 'secretly', 'undetect\\w*', 'steal\\w*', 'spread\\w*', 'infect\\w*',
    'take\\s+(?:over|control)', 'remotely\\s+control', 'access\\s+to\\s+(?:\\w+\\s+)?(?:networks?|accounts?|phones?|systems?|servers?|wifi|cameras?|devices?)', 'networks?', 'sell\\w*',
    'kisi\\s+(?:ka|ki|ke)', 'dusr\\w*', 'bina\\s+(?:permission|ijazat|bataye)', 'chupke',
  ].join('|'),
  ['किसी\\s+(?:का|की|के)', 'दूसर', 'बिना\\s+(?:इजाज़त|इजाजत|अनुमति|बताए)', 'चुपके', 'चोरी', 'चुरा', 'नेटवर्क'],
);

const PROTECTIVE = either(
  [
    'detect\\w*', 'protect\\w*', 'prevent\\w*', 'defen[cs]\\w*', 'awareness', 'educat\\w*', 'learn\\w*', 'course', 'tutorials?', 'quiz\\w*', 'training',
    'labs?', 'ctf', 'capture\\s+the\\s+flag', 'ethical', 'white[-\\s]?hat', 'antivirus', 'anti[-\\s]?malware', 'anti[-\\s]?phishing', 'scanner', 'firewall',
    'my\\s+own', 'our\\s+own', 'own\\s+(?:network|system|website|app|server|wifi|devices?)', 'authori[sz]ed\\s+(?:pentest\\w*|penetration\\s+test\\w*|test\\w*)',
    'bug\\s+bount\\w*', 'report\\w*', 'security\\s+(?:audit|checklist|tips|score)', 'simulat\\w*', 'spam\\s+filter',
  ].join('|'),
  ['सुरक्ष', 'बचाव', 'जागरूक', 'सीख', 'पहचान', 'एंटीवायरस'],
);

const UNAMBIGUOUS = either(
  [
    'without\\s+(?:their\\s+)?(?:permission|consent|knowledge|authori[sz]ation)', 'someone\'s', 'somebody\'s', 'other\\s+people\'s', 'victims?', 'secretly',
    'undetect\\w*', 'steal\\w*', 'spread\\w*', 'girlfriend\'s', 'boyfriend\'s', 'wife\'s', 'husband\'s', 'neighbou?r\'s', 'sell\\w*', 'kisi\\s+(?:ka|ki|ke)', 'chupke',
  ].join('|'),
  ['किसी\\s+(?:का|की|के)', 'बिना\\s+(?:इजाज़त|इजाजत|अनुमति|बताए)', 'चुपके', 'चोरी', 'चुरा'],
);

export const CYBER_INTRUSION_RULE: IllegalRule = {
  id: 'CYBER_INTRUSION',
  contentClass: 'illegal',
  description: 'asks to build a tool for breaking into systems the user does not own — unauthorised access, malware, credential theft or DDoS.',
  subject: SUBJECT,
  context: CONTEXT,
  protective: { purpose: PROTECTIVE, unambiguous: UNAMBIGUOUS },
};

/** The rules only the PROMPT is read against (never the publish scanner — see the header). */
export const PROMPT_ONLY_RULES: readonly IllegalRule[] = [CYBER_INTRUSION_RULE];

/** The refusal for CYBER_INTRUSION: why, and the app the person CAN have. */
export function cyberIntrusionMessage(hindi: boolean): string {
  return hindi
    ? 'दूसरों के सिस्टम, अकाउंट या नेटवर्क में बिना इजाज़त घुसने वाले ऐप यहाँ नहीं बनते (मैलवेयर, पासवर्ड चोरी, DDoS भी नहीं)।\n\n'
      + 'मैं साइबर-सुरक्षा सिखाने वाला ऐप बना सकता हूँ — अपने अकाउंट और नेटवर्क को सुरक्षित रखने के तरीके, फ़िशिंग पहचानने का क्विज़, पासवर्ड की मज़बूती जाँचने वाला टूल। ऐसा बना दूँ?'
    : 'Apps for breaking into other people\'s systems, accounts or networks without permission are not built here (nor malware, password theft or DDoS tools).\n\n'
      + 'I can build a cybersecurity app instead — how to protect your own accounts and network, a phishing-spotting quiz, a password-strength checker. Shall I build that?';
}
