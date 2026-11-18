// CURATED USE-CASE PAGES. These are NavBharatAI's own examples of Indian small-business
// apps. They are not generated from anyone's published app and they contain no user
// data. Every sample screen uses made-up names and numbers.
//
// White-label: a public page may say "NavBharatAI engine" only. It must not name an
// AI provider, model, or vendor. The builder prompt is text the person will see.

export const USE_CASE_INDEX_PATH = '/apps';
export const USE_CASE_CTA_HI = 'अपने लिए यह app 2 मिनट में बनाओ';
export const USE_CASE_CTA_EN = 'Build this app for yourself';

export interface UseCaseMockRow { item: string; detail: string }
export interface UseCaseFaq { q: string; a: string }

export interface UseCasePage {
  slug: string;
  title: string;
  description: string;
  h1: string;
  storyHi: string;
  stepsHi: string[];
  forWhomHi: string;
  limitHi: string;
  storyEn: string;
  features: string[];
  faqs: UseCaseFaq[];
  mockTitle: string;
  mockRows: UseCaseMockRow[];
  mockFoot: string;
  prompt: string;
}

const prompt = (what: string, fields: string) =>
  `Ek ${what} banao, Hindi mein. ${fields} Data isi phone ke browser mein save ho. Login, OTP, payment gateway, ya koi aisa button mat lagana jo sach mein kaam na kare. Shuru mein 4 kaalpanik records dikhao, aur screen par likho ki yeh numbers sirf udaharan hain.`;

export const USE_CASES: readonly UseCasePage[] = [
  {
    slug: 'kirana-billing-app',
    title: 'Kirana Dukaan Billing App — Hindi mein, bina coding',
    description: 'Kirana billing in Hindi: item, rate, quantity, cash or udhaar, and today\'s sale. Make it on NavBharatAI without writing code.',
    h1: 'Kirana dukaan billing app',
    storyHi: 'किराना काउंटर पर बिल अक्सर एक कॉपी में लिखा जाता है। आधा किलो चीनी, एक साबुन, और “बाकी कल दे देंगे”। शाम को यह पता नहीं चलता कि आज नकद कितना आया और उधार कितना रह गया। यह पेज उसी काउंटर के लिए एक छोटा बिलिंग ऐप बताता है। दुकानदार सामान, रेट और मात्रा डालता है, बिल पर कुल आता है, और हर बिल नकद या उधार में बँटता है।',
    stepsHi: ['बिल पर सामान का नाम, मात्रा और रेट। कुल अपने आप।', 'नकद और उधार अलग। उधार पर ग्राहक का नाम और बकाया।', 'आज की बिक्री: कितने बिल, कितना नकद, कितना उधार।', 'कल का बकाया खोलकर आज की अदायगी दर्ज कर सकें।'],
    forWhomHi: 'अपनी दुकान खुद चलाने वाले किराना, जनरल स्टोर और पान-कॉर्नर वाले। जिनके पास बारकोड स्कैनर या बड़ा सॉफ्टवेयर नहीं है, और जिन्हें शाम को एक साफ हिसाब चाहिए।',
    limitHi: 'यह सरकारी टैक्स रिटर्न फाइल नहीं करता और न ही बैंक से जुड़ता है। यह दुकान का अपना बिल और उधार रजिस्टर है।',
    storyEn: 'A neighbourhood grocery counter needs a bill, not a warehouse system. The app lists each item with quantity and rate, splits cash from credit, and shows today\'s total. The sample below is Shyam Kirana, a made-up shop.',
    features: ['Item, quantity and rate on one bill', 'Cash and udhaar kept apart', 'Customer name on credit bills', 'Today\'s sale in one total'],
    faqs: [
      { q: 'क्या इसमें बारकोड स्कैनर चाहिए?', a: 'नहीं। नाम और रेट टाइप होते हैं। स्कैनर बाद में जोड़ा जा सकता है, पर इस पेज का ऐप बिना स्कैनर के चलने के लिए है।' },
      { q: 'उधार का हिसाब कैसे दिखेगा?', a: 'हर उधार बिल पर ग्राहक का नाम रहता है। अलग सूची में दिखता है कि किसका कितना बाकी है। नमूने में रामू लाल का ₹340 बकाया है — यह काल्पनिक है।' },
      { q: 'क्या यह GST पोर्टल पर रिटर्न भर देगा?', a: 'नहीं। GST चालान के लिए अलग पेज है। यह किराना का दैनिक बिल और उधार है।' },
      { q: 'डेटा कहाँ रहेगा?', a: 'जो ऐप बनेगा वह आपके फोन के ब्राउज़र में हिसाब रखेगा। इस पेज पर किसी दुकान का असली डेटा नहीं है।' },
    ],
    mockTitle: 'श्याम किराना — आज का बिल',
    mockRows: [{ item: 'चीनी 1 किलो', detail: '₹44' }, { item: 'सरफ एक नग', detail: '₹20' }, { item: 'अरहर दाल 500 ग्राम', detail: '₹72' }, { item: 'उधार — रामू लाल', detail: 'बाकी ₹340' }],
    mockFoot: 'नकद आज ₹1,280 · उधार आज ₹340 · नमूना',
    prompt: prompt('kirana dukaan billing app', 'Dukaan ka naam Shyam Kirana. Bill par item, matra, rate aur kul. Har bill cash ya udhaar. Udhaar par grahak ka naam aur bakaya. Aaj ki sale: kitne bill, kitna cash, kitna udhaar. Hindi labels.'),
  },
  {
    slug: 'clinic-appointment-app',
    title: 'Clinic Appointment App — Hindi mein, bina coding',
    description: 'A small clinic appointment book in Hindi: patient, time, doctor and a waiting list. No hospital software. Built on NavBharatAI.',
    h1: 'Clinic appointment app',
    storyHi: 'छोटी क्लिनिक में रिसेप्शन एक रजिस्टर रखता है। मरीज का नाम, समय, और डॉक्टर अंदर हैं या नहीं। दो लोग एक ही स्लॉट पर आ जाते हैं, और इंतज़ार की लाइन कागज पर बिखर जाती है। यह ऐप उसी मेज़ के लिए है: आज की अपॉइंटमेंट, एक समय पर एक नाम, और बाहर बैठी लाइन।',
    stepsHi: ['तारीख, समय, मरीज का नाम और मोबाइल।', 'एक स्लॉट पर दूसरा नाम न बैठे — खाली समय दिखें।', 'बाहर की वेटिंग लिस्ट: कौन आया, कौन बुलाया गया।', 'डॉक्टर का नाम, अगर क्लिनिक में एक से ज्यादा हों।'],
    forWhomHi: 'एकल चिकित्सक की क्लिनिक, छोटे नर्सिंग होम का ओपीडी डेस्क, और वह रिसेप्शन जो अभी डायरी में नाम लिखता है। बड़े अस्पताल का वार्ड सिस्टम यह नहीं है।',
    limitHi: 'यह इलाज नहीं बताता, दवाई नहीं लिखता, और लैब रिपोर्ट नहीं रखता। केवल मुलाकात का समय और इंतज़ार की सूची।',
    storyEn: 'A one-doctor clinic needs today\'s book: a name, a time, and who is waiting outside. Slots should not double-book. It is not a hospital information system.',
    features: ['One name per time slot', 'Waiting list for people who have arrived', 'Doctor name when there is more than one', 'Phone number only for the clinic\'s own reminder'],
    faqs: [
      { q: 'क्या मरीज खुद ऑनलाइन बुक कर सकेगा?', a: 'इस पेज का ऐप क्लिनिक की मेज़ के लिए है। मरीज का सार्वजनिक बुकिंग पेज बाद में कहा जा सकता है। पहले वाला ऐप रिसेप्शन का रजिस्टर है।' },
      { q: 'क्या यह प्रिस्क्रिप्शन लिखेगा?', a: 'नहीं। पर्चे के लिए अलग पेज है। यहाँ सिर्फ समय और नाम हैं।' },
      { q: 'दो डॉक्टर हों तो?', a: 'हर अपॉइंटमेंट पर डॉक्टर का नाम रहता है, ताकि सुबह की लिस्ट अलग-अलग दिखे।' },
      { q: 'नमूने के नाम असली मरीज हैं?', a: 'नहीं। “मीना देवी, 10:30” काल्पनिक है। किसी क्लिनिक का डेटा इस पेज पर नहीं है।' },
    ],
    mockTitle: 'डॉ. वर्मा क्लिनिक — आज',
    mockRows: [{ item: '10:30 मीना देवी', detail: 'आ गईं' }, { item: '10:45 रमेश यादव', detail: 'समय खाली नहीं' }, { item: '11:00 अनिता कुमारी', detail: 'इंतज़ार में' }, { item: 'डॉ. वर्मा', detail: 'ओपीडी सुबह' }],
    mockFoot: 'तीन नाम · एक स्लॉट खाली नहीं · नमूना',
    prompt: prompt('clinic appointment register', 'Clinic ka naam Dr Verma Clinic. Aaj ki list: samay, mareez ka naam, mobile, doctor. Ek slot par do naam na hon. Jo aa chuka hai use waiting list par dikhao. Koi diagnosis, dawai ya lab report nahi.'),
  },
  {
    slug: 'tuition-fee-register',
    title: 'Tuition Fee Register App — Hindi mein, bina coding',
    description: 'Tuition fee register in Hindi: student, month, fee due and fee paid. A home tutor\'s book, not a school ERP. On NavBharatAI.',
    h1: 'Tuition fee register',
    storyHi: 'घर पर पढ़ाने वाले शिक्षक के पास दस-बीस बच्चे होते हैं। हर महीने कॉपी में नाम के आगे “दिया” या “बाकी” लिखा जाता है। तीन महीने बाद यह याद नहीं रहता कि किस अभिभावक ने जून की फीस दी थी। यह रजिस्टर उसी कॉपी की जगह है: बच्चा, महीना, तय फीस, और जो मिला।',
    stepsHi: ['बच्चे का नाम, कक्षा और महीने की फीस।', 'महीना चुनकर “मिला” या “बाकी”।', 'अभिभावक का नाम, ताकि रसीद समझ आए।', 'इस महीने कितना आया और कितना बाकी, एक जोड़।'],
    forWhomHi: 'होम ट्यूटर, छोटे कोचिंग के बैच मालिक, और संगीत या अबेकस की क्लास। स्कूल का पूरा फीस ऑफिस नहीं — उसके लिए अलग पेज है।',
    limitHi: 'यह स्कूल का एडमिशन, रिपोर्ट कार्ड या स्टाफ सैलरी नहीं है। केवल ट्यूशन की मासिक फीस।',
    storyEn: 'A tutor who teaches at home tracks a fee per child per month. The register shows what was agreed, what was paid, and what is still due. It is not a school accounts office.',
    features: ['Fee agreed and fee received, per month', 'Parent name next to the child', 'This month\'s collected and pending totals', 'Class or batch on each child'],
    faqs: [
      { q: 'क्या रसीद प्रिंट होगी?', a: 'ऐप में रसीद नंबर और तारीख दिख सकती है, जिसे शिक्षक दिखा या प्रिंट कर सके। यह बैंक की रसीद नहीं है।' },
      { q: 'एक बच्चे की दो कक्षाएँ?', a: 'हर लाइन पर बैच का नाम रखें, जैसे “गणित शाम” और “विज्ञान सुबह”, ताकि फीस अलग रहे।' },
      { q: 'स्कूल की फीस भी इसी में?', a: 'स्कूल की कक्षा-वार फीस और रसीद बुक के लिए “School fees” पेज है। यह पेज घर के ट्यूटर के लिए है।' },
      { q: 'क्या आंकड़े असली बच्चों के हैं?', a: 'नहीं। “आरव, कक्षा 6, जून बाकी ₹800” नमूना है।' },
    ],
    mockTitle: 'शर्मा ट्यूशन — जून',
    mockRows: [{ item: 'आरव · कक्षा 6', detail: 'बाकी ₹800' }, { item: 'सिया · कक्षा 8', detail: 'मिला ₹1,500' }, { item: 'अभिभावक: सुनील', detail: 'जून की रसीद 14' }, { item: 'इस महीने मिला', detail: '₹4,500' }],
    mockFoot: 'बाकी ₹800 · रसीद नमूना 14 · काल्पनिक',
    prompt: prompt('home tuition fee register', 'Tutor ka naam Sharma Tuition. Bachcha, class, mahine ki fees, mila ya bakaya, abhibhavak ka naam, rasid number. Is mahine ka total. School admission, report card ya salary mat banana.'),
  },
  {
    slug: 'attendance-register',
    title: 'Attendance Register App — Hindi mein, bina coding',
    description: 'A daily attendance register in Hindi for one class: present, absent, late. Not a school ERP. Make it on NavBharatAI.',
    h1: 'Attendance register',
    storyHi: 'कक्षा में हाजिरी एक रजिस्टर के पन्ने पर लगती है। छुट्टी के बाद यह गिनना पड़ता है कि इस महीने कौन कितने दिन गैरहाजिर रहा। यह ऐप एक कक्षा की रोज की हाजिरी है: हाजिर, गैरहाजिर, या देर से। पूरे स्कूल के टाइम-टेबल और सैलरी के लिए यह नहीं है।',
    stepsHi: ['कक्षा और तारीख चुनें। हर बच्चे के आगे हाजिर या गैरहाजिर।', 'देर से आने का निशान, मिनट लिखे बिना।', 'महीने में कितने दिन हाजिर, एक गिनती।', 'छुट्टी का दिन हाजिरी की गिनती में न आए।'],
    forWhomHi: 'एक बैच पढ़ाने वाले शिक्षक, कोचिंग की एक कक्षा, और खेल या संगीत की छोटी क्लास। स्कूल के प्रिंसिपल वाला पूरा सिस्टम अलग काम है।',
    limitHi: 'यह वेतन, प्रवेश परीक्षा या रिपोर्ट कार्ड नहीं बनाता। केवल उपस्थिति।',
    storyEn: 'One class, one date, a mark for each student: present, absent or late. A monthly count follows. Holidays are not counted as absences. It is a register, not a school ERP.',
    features: ['Present, absent or late for one class', 'A date at a time, not a mixed week', 'Monthly present-day count', 'A holiday is marked and not counted as absent'],
    faqs: [
      { q: 'क्या माता-पिता को मैसेज जाएगा?', a: 'इस पेज का ऐप संदेश नहीं भेजता। वह बाद का काम है और बिना असली एसएमएस सेवा के बटन नहीं लगना चाहिए।' },
      { q: 'कई कक्षाएँ?', a: 'हर हाजिरी पर कक्षा का नाम रहता है, ताकि कक्षा 7 और कक्षा 8 की लिस्ट मिल न जाए।' },
      { q: 'देर से आने को गैरहाजिर गिनें?', a: 'नहीं। देर एक अलग निशान है। महीने की गिनती में हाजिर और देर दोनों “आया” हैं।' },
      { q: 'नाम असली हैं?', a: 'नहीं। कक्षा 7 की सूची काल्पनिक है।' },
    ],
    mockTitle: 'कक्षा 7-ब — 11 नवम्बर',
    mockRows: [{ item: 'मोहित', detail: 'हाजिर' }, { item: 'फरीदा', detail: 'देर से' }, { item: 'इमरान', detail: 'गैरहाजिर' }, { item: 'इस महीने हाजिर', detail: 'मोहित 18 दिन' }],
    mockFoot: 'छुट्टी की तारीख गिनती में नहीं · नमूना',
    prompt: prompt('class attendance register', 'Ek class ka naam 7-B. Tareekh chuno. Har bachche par hajir, gairhajir ya der. Mahine mein kitne din hajir. Chhutti ki tareekh absent mein mat ginna. SMS, salary ya report card nahi.'),
  },
  {
    slug: 'gst-invoice-app',
    title: 'GST Invoice App — Hindi mein, bina coding',
    description: 'A GST tax invoice draft in Hindi: GSTIN, HSN, rate and tax split. It does not file the return. Built on NavBharatAI.',
    h1: 'GST invoice app',
    storyHi: 'छोटे व्यापारी को चालान पर GSTIN, सामान, HSN और टैक्स का बँटवारा चाहिए। कई लोग इसे दस्तावेज़ में बनाते हैं और CGST/SGST का जोड़ हाथ से करते हैं। यह ऐप एक चालान का मसौदा है जिसे व्यापारी खुद जाँच सके। यह सरकार के पोर्टल पर रिटर्न दाखिल नहीं करता।',
    stepsHi: ['अपना GSTIN और ग्राहक का GSTIN, दोनों खाली रह सकते हैं अगर रिटेल बिल हो।', 'सामान, HSN, मात्रा, रेट, और 5%, 12%, 18% या 28% में से एक दर।', 'CGST और SGST आधा-आधा, या IGST अगर राज्य अलग हो।', 'चालान नंबर और तारीख, जो व्यापारी खुद बढ़ाए।'],
    forWhomHi: 'दुकानदार और छोटे सप्लायर जो अपने ग्राहक को टैक्स चालान देते हैं और रिटर्न अपने सलाहकार या पोर्टल पर अलग से भरते हैं।',
    limitHi: 'यह GST पोर्टल, ई-वे बिल या ई-इनवॉइस नहीं है। चालान छपने से पहले आंकड़े व्यापारी को खुद मिलाने चाहिए।',
    storyEn: 'The app drafts a tax invoice: GSTIN, HSN, a rate, and the split between CGST and SGST or a single IGST line. Filing the return stays with the trader or their accountant.',
    features: ['GSTIN on the seller and, when needed, the buyer', 'HSN, quantity, rate and one tax rate', 'CGST + SGST, or IGST when the state differs', 'Invoice number and date the trader controls'],
    faqs: [
      { q: 'क्या यह रिटर्न फाइल कर देगा?', a: 'नहीं। यह केवल चालान का मसौदा है। रिटर्न GST पोर्टल पर अलग से भरना होता है।' },
      { q: 'IGST कब?', a: 'जब ग्राहक दूसरे राज्य का हो। उसी राज्य में CGST और SGST आधे-आधे होते हैं। ऐप में यह एक साफ चुनाव होना चाहिए।' },
      { q: 'क्या दरें कानून का आखिरी शब्द हैं?', a: 'नहीं। 5, 12, 18 और 28 सामान्य स्लैब हैं। सही दर व्यापारी या सलाहकार तय करते हैं।' },
      { q: 'नमूना चालान असली है?', a: 'नहीं। GSTIN और राशियाँ काल्पनिक हैं।' },
    ],
    mockTitle: 'चालान मसौदा 018',
    mockRows: [{ item: 'LED बल्ब · HSN 8539', detail: '₹200' }, { item: 'दर 18%', detail: 'CGST ₹18 + SGST ₹18' }, { item: 'खरीदार GSTIN', detail: 'काल्पनिक 27AAAAA0000A1Z5' }, { item: 'कुल', detail: '₹236' }],
    mockFoot: 'रिटर्न फाइल नहीं होता · आंकड़े काल्पनिक',
    prompt: prompt('GST invoice draft', 'Invoice number, date, seller GSTIN, buyer GSTIN optional. Item, HSN, qty, rate, tax 5/12/18/28. Same state: CGST aur SGST aadha-aadha. Doosra state: IGST. Screen par likho ki yeh return file nahi karta. Koi portal login nahi.'),
  },
  {
    slug: 'school-fees-app',
    title: 'School Fees Register App — Hindi mein, bina coding',
    description: 'School fee register in Hindi by class: admission no, term fee, receipt. A clerk\'s book, not a full school ERP. On NavBharatAI.',
    h1: 'School fees register',
    storyHi: 'छोटे स्कूल का क्लर्क हर तिमाही एक रजिस्टर भरता है। एडमिशन नंबर, कक्षा, फीस और रसीद नंबर। ट्यूशन वाले मासिक रजिस्टर से यह अलग है: यहाँ कक्षा की पूरी सूची और तिमाही की रसीद है, घर के एक ट्यूटर की डायरी नहीं।',
    stepsHi: ['कक्षा चुनें। हर बच्चे का एडमिशन नंबर दिखे।', 'तिमाही की फीस, छूट अगर कोई हो, और जो जमा हुआ।', 'रसीद नंबर अगली रसीद पर बढ़े, दोबारा न मिले।', 'कक्षा का जोड़: कितने बच्चों ने जमा किया।'],
    forWhomHi: 'छोटे प्राइवेट स्कूल का फीस काउंटर, जहाँ एक क्लर्क रसीद काटता है। बड़े विश्वविद्यालय का खाता विभाग नहीं।',
    limitHi: 'यह परीक्षा, बस रूट या शिक्षकों की सैलरी नहीं संभालता। केवल फीस और रसीद।',
    storyEn: 'A school clerk picks a class, sees each admission number, records the term fee and a receipt number that does not repeat. It is the fee counter, not the whole school.',
    features: ['Class list with admission numbers', 'Term fee, concession and amount received', 'Receipt numbers that do not repeat', 'A class total of who has paid'],
    faqs: [
      { q: 'ट्यूशन रजिस्टर से यह कैसे अलग है?', a: 'ट्यूशन पेज घर के शिक्षक की मासिक डायरी है। यह पेज स्कूल की कक्षा और एडमिशन नंबर वाली तिमाही रसीद है।' },
      { q: 'ऑनलाइन पेमेंट?', a: 'नहीं। क्लर्क नकद या जो तरीका स्कूल पहले से इस्तेमाल करता है, उसकी रसीद काटता है। नकली पेमेंट बटन नहीं।' },
      { q: 'छूट कैसे लिखें?', a: 'भाई-बहन या स्टाफ छूट एक अलग राशि हो, ताकि तय फीस और जमा राशि दोनों दिखें।' },
      { q: 'क्या यह असली स्कूल है?', a: 'नहीं। “कक्षा 4, एडमिशन 1042” नमूना है।' },
    ],
    mockTitle: 'कक्षा 4 — जुलाई तिमाही',
    mockRows: [{ item: 'एडमिशन 1042 · पल्लवी', detail: 'रसीद 221' }, { item: 'तय फीस ₹3,000', detail: 'छूट ₹300' }, { item: 'जमा', detail: '₹2,700' }, { item: 'कक्षा में जमा', detail: '28 में से 21' }],
    mockFoot: 'रसीद नंबर दोबारा नहीं · नमूना',
    prompt: prompt('school fee counter register', 'Class chuno. Har bachche ka admission number, term fee, concession, jama rashi, rasid number jo dohraaye nahi. Class ka total. Exam, bus ya salary mat banana. Payment gateway nahi.'),
  },
  {
    slug: 'gym-membership-app',
    title: 'Gym Membership App — Hindi mein, bina coding',
    description: 'Gym membership in Hindi: member, plan, end date and fee due. A desk register for one gym. Make it on NavBharatAI.',
    h1: 'Gym membership app',
    storyHi: 'जिम की रिसेप्शन पर पूछा जाता है कि आपका महीना कब खत्म है। जवाब एक रजिस्टर में होता है जो कई हाथों से भरा गया है। यह ऐप एक जिम की मेज़ के लिए है: सदस्य, प्लान, शुरू और खत्म की तारीख, और बकाया फीस।',
    stepsHi: ['सदस्य का नाम और प्लान: महीना, तिमाही या साल।', 'खत्म होने की तारीख साफ दिखे, और शब्द में “समाप्त”।', 'फीस मिली या बाकी।', 'आज जिनका प्लान खत्म हो रहा है, उनकी छोटी सूची।'],
    forWhomHi: 'एक हॉल वाला जिम, योग स्टूडियो, या मार्शल आर्ट की कक्षा, जहाँ मालिक खुद रिसेप्शन पर बैठा है।',
    limitHi: 'यह बायोमेट्रिक ताला, ट्रेनर की डाइट चार्ट या सप्लीमेंट की दुकान नहीं है। केवल सदस्यता और फीस।',
    storyEn: 'One gym desk: who the member is, which plan they bought, when it ends, and whether the fee is still due. People whose plan ends today sit in a short list.',
    features: ['Monthly, quarterly or yearly plan', 'End date and a clear ended state', 'Fee paid or still due', 'A list of plans ending today'],
    faqs: [
      { q: 'क्या फिंगरप्रिंट मशीन जुड़ेगी?', a: 'इस पेज का ऐप मशीन से नहीं जुड़ता। दरवाज़े पर नाम देखकर एंट्री का निशान हाथ से लग सकता है।' },
      { q: 'प्लान रोकना?', a: 'हाँ, एक “रुका हुआ” निशान, ताकि खत्म की तारीख रुकने के दिनों से आगे बढ़े। बिना इस निशान के तारीख झूठी हो जाती है।' },
      { q: 'कई शाखाएँ?', a: 'यह एक जिम के लिए है। शाखा का नाम एक फील्ड हो सकता है, पर यह चेन का हेड ऑफिस नहीं है।' },
      { q: 'नमूना सदस्य?', a: '“कविता, मासिक, 30 नवम्बर” काल्पनिक है।' },
    ],
    mockTitle: 'पावर हॉल जिम',
    mockRows: [{ item: 'कविता · मासिक', detail: 'समाप्त 30 नवम्बर' }, { item: 'इरफान · तिमाही', detail: 'आज खत्म' }, { item: 'फीस बाकी', detail: '₹500' }, { item: 'रुका हुआ प्लान', detail: 'अमित · 12 दिन' }],
    mockFoot: 'एक जिम · काल्पनिक सदस्य',
    prompt: prompt('gym membership desk', 'Ek gym Power Hall. Sadasya, plan month/quarter/year, start, end, fees paid ya due. Aaj jinka plan khatam ho raha hai unki list. Freeze ka din end date aage badhaye. Biometric lock ya diet chart nahi.'),
  },
  {
    slug: 'salon-booking-app',
    title: 'Salon Booking App — Hindi mein, bina coding',
    description: 'Salon booking in Hindi: service, stylist, time and a gap so two clients do not overlap. One shop. On NavBharatAI.',
    h1: 'Salon booking app',
    storyHi: 'सैलून में हेयरकट बीस मिनट का होता है और ब्लो-ड्राई चालीस का। अगर दोनों को एक ही कुर्सी पर एक ही समय दे दिया जाए तो अगला ग्राहक खड़ा रहता है। यह ऐप एक सैलून की कुर्सी और समय का चार्ट है।',
    stepsHi: ['सेवा चुनें। हर सेवा का अपना समय हो, जैसे कट 20 मिनट।', 'स्टाइलिस्ट और कुर्सी। एक स्टाइलिस्ट एक समय पर एक ग्राहक।', 'नाम और फोन, ताकि दुकान याद रखे।', 'दिन की पट्टी: खाली और भरा समय।'],
    forWhomHi: 'एक दुकान वाला सैलून, बार्बर शॉप, या ब्यूटी पार्लर। कई शहरों की चेन का कॉल सेंटर नहीं।',
    limitHi: 'यह प्रोडक्ट इन्वेंटरी या ऑनलाइन पेमेंट नहीं है। केवल बुकिंग।',
    storyEn: 'Each service takes a fixed number of minutes. A stylist cannot have two clients in the same slot. The day is a strip of free and taken times.',
    features: ['A duration on every service', 'One client per stylist at a time', 'Name and phone for the shop\'s own book', 'The day\'s free and taken slots'],
    faqs: [
      { q: 'ग्राहक घर से बुक कर सके?', a: 'पहला ऐप दुकान की मेज़ का है। सार्वजनिक बुकिंग लिंक बाद में कहा जा सकता है, जब मेज़ वाला चार्ट सही चलने लगे।' },
      { q: 'दो सेवाएँ एक साथ?', a: 'कट के बाद ब्लो-ड्राई अगले स्लॉट में जुड़नी चाहिए, उसी मिनट में ओवरलैप नहीं।' },
      { q: 'क्या एसएमएस जाएगा?', a: 'नहीं, जब तक दुकान की अपनी एसएमएस सेवा न हो। खाली “रिमाइंडर भेजें” बटन नहीं।' },
      { q: 'नमूना?', a: '“नेहा, हेयरकट, 4:20, रीना” काल्पनिक है।' },
    ],
    mockTitle: 'रीना सैलून — आज',
    mockRows: [{ item: '4:20 हेयरकट · 20 मि', detail: 'नेहा · रीना' }, { item: '4:40 ब्लो-ड्राई', detail: 'वही कुर्सी खाली नहीं' }, { item: '5:20 दाढ़ी', detail: 'अजय · खाली था' }, { item: 'स्टाइलिस्ट रीना', detail: 'अगला खाली 6:00' }],
    mockFoot: 'एक दुकान · समय ओवरलैप नहीं · नमूना',
    prompt: prompt('salon booking board', 'Ek salon Reena Salon. Seva, uska minutes, stylist, grahak ka naam aur phone. Ek stylist ek time par ek grahak. Din ki patti: khali aur bhara. SMS ya payment nahi.'),
  },
  {
    slug: 'mandi-hisaab-app',
    title: 'Mandi Hisaab App — Hindi mein, bina coding',
    description: 'Mandi hisaab in Hindi: lot, weight, rate and the farmer\'s amount. A commission agent\'s day book. On NavBharatAI.',
    h1: 'Mandi hisaab app',
    storyHi: 'मंडी में आढ़ती दिन भर लॉट लिखता है। किसान का नाम, फसल, वजन, भाव, और कमीशन काटने के बाद बची रकम। शाम को किसान पूछता है कि मेरा क्या बना। यह ऐप उसी दिन की बही है, मंडी कमेटी का सरकारी सॉफ्टवेयर नहीं।',
    stepsHi: ['किसान, फसल और लॉट नंबर।', 'वजन कुंतल या किलो में, और भाव।', 'कमीशन प्रतिशत काटकर किसान को देय राशि।', 'दिन के सारे लॉट का जोड़।'],
    forWhomHi: 'एक आढ़ती या छोटा कमीशन एजेंट जो अपनी बही खुद रखता है। मंडी कमेटी का पूरा नीलामी तंत्र नहीं।',
    limitHi: 'यह सरकारी मंडी पोर्टल नहीं है और न ही भुगतान का वादा करता है। यह आढ़ती की अपनी गणना है।',
    storyEn: 'A commission agent records a farmer, a crop, a lot, a weight and a rate, then subtracts commission. The farmer can be shown what remains. It is a private day book.',
    features: ['Farmer, crop and lot number', 'Weight and rate', 'Commission taken off before the amount due', 'A total for the day\'s lots'],
    faqs: [
      { q: 'भाव कौन तय करता है?', a: 'आढ़ती। ऐप भाव नहीं सुझाता और न ही आज का सरकारी भाव दिखाने का दावा करता है।' },
      { q: 'किलो और कुंतल?', a: 'एक लॉट में एक ही इकाई। जोड़ते समय इकाई लिखी रहनी चाहिए ताकि 1 कुंतल और 1 किलो मिल न जाएँ।' },
      { q: 'किसान को पैसे ऐप भेजेगा?', a: 'नहीं। ऐप रकम दिखाता है। भुगतान आढ़ती अपने तरीके से करता है।' },
      { q: 'नमूना लॉट?', a: '“सोहन, गेहूँ, लॉट 12, 8 कुंतल” काल्पनिक है।' },
    ],
    mockTitle: 'आढ़ती रामनिवास — आज',
    mockRows: [{ item: 'सोहन · गेहूँ · लॉट 12', detail: '8 कुंतल' }, { item: 'भाव ₹2,100 / कुंतल', detail: 'कुल ₹16,800' }, { item: 'कमीशन 2%', detail: '₹336' }, { item: 'देय', detail: '₹16,464' }],
    mockFoot: 'भुगतान ऐप नहीं करता · नमूना',
    prompt: prompt('mandi commission day book', 'Aadhti ka naam Ramniwas. Kisan, fasal, lot number, wajan with unit, bhav, commission percent, deya rashi. Din ka jod. Koi sarkari bhav ya payment button nahi.'),
  },
  {
    slug: 'dairy-milk-record',
    title: 'Dairy Milk Record App — Hindi mein, bina coding',
    description: 'Dairy milk record in Hindi: member, morning and evening litres, fat and amount. One collection centre. On NavBharatAI.',
    h1: 'Dairy milk record',
    storyHi: 'दूध संग्रह केंद्र पर सुबह और शाम दो बार लीटर लिखे जाते हैं। फैट के हिसाब से रेट बदलता है। महीने के अंत में सदस्य पूछता है कि इस बार कितना दूध गया और कितने पैसे बने। यह ऐप उसी केंद्र की दैनिक चिट्ठी है।',
    stepsHi: ['सदस्य नंबर और नाम।', 'सुबह और शाम के लीटर अलग कॉलम।', 'फैट और उसी दिन का रेट, राशि अपने आप।', 'महीने का लीटर और राशि।'],
    forWhomHi: 'गाँव या कस्बे का एक दूध संग्रह केंद्र, या डेयरी का छोटा बूथ। बड़ी डेयरी कंपनी का प्लांट सॉफ्टवेयर नहीं।',
    limitHi: 'यह फैट की मशीन से अपने आप नहीं पढ़ता। जो आंकड़ा ऑपरेटर लिखे, वही रहता है। भुगतान का बटन नहीं।',
    storyEn: 'Morning litres and evening litres stay in separate columns. Fat and the day\'s rate produce an amount. The month can be totalled. The operator types the numbers; nothing is read from a machine.',
    features: ['Member number and name', 'Morning and evening litres apart', 'Fat and rate for the amount', 'A monthly litre and rupee total'],
    faqs: [
      { q: 'फैट मशीन जुड़ेगी?', a: 'इस ऐप में नहीं। ऑपरेटर फैट लिखता है। मशीन का दावा बिना मशीन के झूठ होगा।' },
      { q: 'सुबह का दूध शाम में जुड़ जाए तो?', a: 'दो कॉलम इसलिए हैं ताकि शिफ्ट अलग रहे। दिन का जोड़ दोनों का योग है।' },
      { q: 'पैसे खाते में जाएँगे?', a: 'नहीं। ऐप राशि दिखाता है। भुगतान केंद्र अपने हिसाब से करता है।' },
      { q: 'नमूना?', a: '“सदस्य 22, सुबह 4.5 लीटर, फैट 6.2” काल्पनिक है।' },
    ],
    mockTitle: 'गोकुल संग्रह — आज',
    mockRows: [{ item: 'सदस्य 22 · कमला', detail: 'सुबह 4.5 लि' }, { item: 'शाम', detail: '3.0 लि' }, { item: 'फैट 6.2 · रेट ₹42', detail: '₹315' }, { item: 'इस महीने', detail: '186 लि' }],
    mockFoot: 'मशीन से नहीं जुड़ा · नमूना',
    prompt: prompt('milk collection register', 'Centre ka naam Gokul. Sadasya number, naam, subah litre, shaam litre alag. Fat aur rate se rashi. Mahine ka litre aur rupaye. Machine connect ya payment nahi.'),
  },
  {
    slug: 'pg-rent-app',
    title: 'PG Rent Register App — Hindi mein, bina coding',
    description: 'PG rent register in Hindi: room, tenant, rent, electricity and what is still due. One building. On NavBharatAI.',
    h1: 'PG rent register',
    storyHi: 'पीजी मालिक के पास कमरे, किराएदार और बिजली का अलग हिसाब होता है। कमरा 3 ने किराया दिया, बिजली बाकी है — यह कागज पर उलझ जाता है। यह ऐप एक इमारत की मासिक चिट्ठी है: कमरा, नाम, किराया, बिजली, और बाकी।',
    stepsHi: ['कमरा नंबर और किराएदार का नाम। खाली कमरा भी दिखे।', 'महीने का किराया और जमा।', 'बिजली का रीडिंग अंतर और रेट से राशि।', 'जमा और बाकी, कमरे के हिसाब से।'],
    forWhomHi: 'एक इमारत के पीजी या हॉस्टल के मालिक। कई शहरों की प्रॉपर्टी कंपनी नहीं।',
    limitHi: 'यह रेंट एग्रीमेंट का वकील या पुलिस वेरिफिकेशन नहीं है। केवल मासिक किराया और बिजली।',
    storyEn: 'One building. Each room has a tenant or is empty. Rent and the electricity reading are separate lines, so rent paid and power still due stays visible.',
    features: ['Room number and tenant, or empty', 'Monthly rent paid or due', 'Meter difference times a rate', 'A per-room balance'],
    faqs: [
      { q: 'दो किराएदार एक कमरे में?', a: 'कमरे पर एक मुख्य नाम और किराया। बाँटने का हिसाब वे आपस में रखें, वरना रसीद उलझती है।' },
      { q: 'सिक्योरिटी डिपॉजिट?', a: 'एक अलग राशि, जो मासिक किराए में न मिल जाए। लौटाने पर निशान लगे।' },
      { q: 'बिजली का रेट?', a: 'मालिक रेट लिखता है। ऐप सरकारी टैरिफ का दावा नहीं करता।' },
      { q: 'नमूना?', a: '“कमरा 3, नीलम, किराया जमा, बिजली ₹420” काल्पनिक है।' },
    ],
    mockTitle: 'शांति पीजी — नवम्बर',
    mockRows: [{ item: 'कमरा 3 · नीलम', detail: 'किराया जमा ₹7,000' }, { item: 'मीटर 120 से 162', detail: 'बिजली ₹420 बाकी' }, { item: 'कमरा 4', detail: 'खाली' }, { item: 'जमा सुरक्षा', detail: '₹5,000 · लौटी नहीं' }],
    mockFoot: 'एक इमारत · काल्पनिक किराएदार',
    prompt: prompt('PG rent register for one building', 'Building Shanti PG. Room, tenant ya empty, rent due/paid, security deposit alag, meter start-end aur rate se bijli. Kamre ka bakaya. Agreement ya police verification nahi.'),
  },
  {
    slug: 'doctor-prescription-app',
    title: 'Doctor Prescription Note — Hindi mein, bina coding',
    description: 'A clinic prescription note in Hindi the doctor prints. Not a diagnosis engine and not a health record system. On NavBharatAI.',
    h1: 'Doctor prescription note',
    storyHi: 'क्लिनिक में डॉक्टर पर्चा कागज पर लिखते हैं: मरीज का नाम, उम्र, शिकायत उनके अपने शब्दों में, और दवा की लाइन। यह ऐप वही पर्चा छपने लायक बनाता है। यह बीमारी का पता नहीं लगाता और न ही यह कहता है कि दवा सही है।',
    stepsHi: ['मरीज का नाम, उम्र और तारीख।', 'शिकायत वैसी लिखी जाए जैसी डॉक्टर लिखें — ऐप सुझाव न दे।', 'दवा, खुराक और कितने दिन, खाली लाइनें जिन्हें डॉक्टर भरें।', 'क्लिनिक का नाम और डॉक्टर का नाम पर्चे पर छपे।'],
    forWhomHi: 'अपनी क्लिनिक में पर्चा छपवाने वाले चिकित्सक। यह मरीज के लिए स्व-इलाज की ऐप नहीं है।',
    limitHi: 'यह निदान नहीं करता, दवा नहीं सुझाता, और सरकारी स्वास्थ्य रिकॉर्ड नहीं है। डॉक्टर जो लिखें वही छपता है।',
    storyEn: 'The note prints what the doctor typed: name, age, the complaint in the doctor\'s words, and medicine lines the doctor fills. The app does not suggest a diagnosis or a drug.',
    features: ['Patient name, age and date', 'Complaint typed by the doctor, with no suggestion', 'Medicine, dose and days as blank lines the doctor fills', 'Clinic and doctor name on the print'],
    faqs: [
      { q: 'क्या ऐप बीमारी बताएगा?', a: 'नहीं। खाली जगह डॉक्टर भरते हैं। कोई संभावित रोग सूची नहीं।' },
      { q: 'क्या यह अपॉइंटमेंट बुक करता है?', a: 'नहीं। समय की बुक के लिए क्लिनिक अपॉइंटमेंट पेज है।' },
      { q: 'पुराने पर्चे कहाँ रहेंगे?', a: 'उसी फोन पर, ताकि डॉक्टर अपना पिछला नोट देख सकें। यह अस्पताल का केंद्रीय रिकॉर्ड नहीं है।' },
      { q: 'नमूने की दवा असली सलाह है?', a: 'नहीं। दवा वाली लाइन काल्पनिक उदाहरण है, सलाह नहीं।' },
    ],
    mockTitle: 'पर्चा — काल्पनिक',
    mockRows: [{ item: 'नाम: गीता · 34 वर्ष', detail: '11 नवम्बर' }, { item: 'शिकायत', detail: 'डॉक्टर लिखेंगे' }, { item: 'दवा की लाइन', detail: 'खाली · खुराक · दिन' }, { item: 'क्लिनिक', detail: 'डॉ. वर्मा' }],
    mockFoot: 'ऐप दवा सुझाता नहीं · नमूना',
    prompt: prompt('printable clinic prescription note', 'Clinic aur doctor ka naam. Mareez, umar, tareekh. Shikayat khali - koi disease suggestion nahi. Dawai, dose, din ki khali lines. Print layout. Appointment book ya diagnosis list nahi. Screen par likho ki yeh salah nahi hai.'),
  },
  {
    slug: 'coaching-test-series',
    title: 'Coaching Test Series App — Hindi mein, bina coding',
    description: 'A coaching test series in Hindi: paper, marks, rank in the batch. One institute\'s own tests, not a public exam. On NavBharatAI.',
    h1: 'Coaching test series',
    storyHi: 'कोचिंग में हर रविवार एक पेपर होता है। अंक रजिस्टर में लिखे जाते हैं और बैच में स्थान निकालना पड़ता है। यह ऐप उसी संस्थान के अपने टेस्ट की कॉपी है। यह किसी बोर्ड या प्रवेश परीक्षा का आधिकारिक परिणाम नहीं है।',
    stepsHi: ['पेपर का नाम, तारीख और कुल अंक।', 'हर छात्र के प्राप्त अंक।', 'बैच में स्थान, अंक के क्रम से।', 'एक छात्र के पिछले पेपर एक साथ।'],
    forWhomHi: 'एक कोचिंग संस्थान जो अपनी साप्ताहिक परीक्षा लेता है। सरकारी रिजल्ट पोर्टल नहीं।',
    limitHi: 'स्थान केवल इस बैच के इस पेपर में है। यह किसी सार्वजनिक परीक्षा की रैंक नहीं है।',
    storyEn: 'A coaching centre records its own paper: marks out of a total, then an order inside that batch. A student can see their earlier papers. It is not an official public exam result.',
    features: ['Paper name, date and total marks', 'Marks for each student', 'Order inside this batch only', 'One student\'s earlier papers together'],
    faqs: [
      { q: 'क्या यह किसी सार्वजनिक परीक्षा की रैंक है?', a: 'नहीं। स्थान सिर्फ इस कोचिंग के इस बैच में है। स्क्रीन पर यही लिखा होना चाहिए।' },
      { q: 'सवाल भी ऐप में हों?', a: 'हो सकते हैं, अगर संस्थान अपने सवाल डाले। इस पेज का नमूना केवल अंक दिखाता है।' },
      { q: 'अनुपस्थित छात्र?', a: 'अंक खाली रखें और स्थान में अनुपस्थित दिखाएँ। शून्य न डालें, वरना रैंक झूठी हो जाती है।' },
      { q: 'नमूना?', a: '“रविवार टेस्ट 6, नेहा 72/100, बैच में 4” काल्पनिक है।' },
    ],
    mockTitle: 'रविवार टेस्ट 6 · बैच ए',
    mockRows: [{ item: 'नेहा', detail: '72 / 100 · स्थान 4' }, { item: 'आरव', detail: '81 / 100 · स्थान 2' }, { item: 'फैज़', detail: 'अनुपस्थित' }, { item: 'बैच', detail: 'केवल यह कक्षा' }],
    mockFoot: 'सार्वजनिक परीक्षा की रैंक नहीं · नमूना',
    prompt: prompt('coaching test score book', 'Institute ka apna paper: naam, tareekh, total marks. Har student ke marks. Batch ke andar order. Absent ko zero mat banana. Likho ki yeh public exam rank nahi hai. Public result portal nahi.'),
  },
  {
    slug: 'tailor-measurement-app',
    title: 'Tailor Order App — Hindi mein, bina coding',
    description: 'Tailor orders in Hindi: customer, measurements, cloth and delivery date. One shop\'s bench, not a factory. On NavBharatAI.',
    h1: 'Tailor order book',
    storyHi: 'दर्जी के पास नाप एक पर्ची पर होता है जो अक्सर खो जाती है। अगली बार ग्राहक आता है तो नाप फिर से लेनी पड़ती है, और डिलीवरी की तारीख याद नहीं रहती। यह ऐप एक दुकान की ऑर्डर बुक है: ग्राहक, नाप, कपड़ा और देने की तारीख।',
    stepsHi: ['ग्राहक का नाम। पुराना नाप फिर खुल जाए।', 'कमीज या सूट की नाप अलग फील्ड में, एक ही लाइन में गुंथकर नहीं।', 'कपड़ा ग्राहक का है या दुकान का।', 'डिलीवरी की तारीख और “सिलाई शुरू” या “तैयार”।'],
    forWhomHi: 'एक दुकान के दर्जी। गारमेंट फैक्ट्री की लाइन नहीं।',
    limitHi: 'यह कपड़े का स्टॉक अकाउंट या ऑनलाइन पेमेंट नहीं है। नाप और ऑर्डर की स्थिति है।',
    storyEn: 'Measurements stay in separate fields so the next visit does not start from a lost slip. Cloth is marked as the customer\'s or the shop\'s, and the delivery date has a plain status.',
    features: ['Customer name and saved measurements', 'Separate fields, not one tangled line', 'Whose cloth it is', 'Delivery date and a simple status'],
    faqs: [
      { q: 'नाप की इकाई?', a: 'इंच, जैसा दर्जी बोलते हैं। ऐप सेंटीमीटर में चुपचाप बदल न दे।' },
      { q: 'फोटो?', a: 'हो सकती है अगर फोन से जोड़ी जाए। इस पेज का नमूना बिना फोटो के नाप दिखाता है।' },
      { q: 'एडवांस?', a: 'एक राशि “एडवांस मिला”, बाकी डिलीवरी पर। नकली पेमेंट गेटवे नहीं।' },
      { q: 'नमूना?', a: '“सुरेश, कमीज, लंबाई 30 इंच, देने की तारीख 18 नवम्बर” काल्पनिक है।' },
    ],
    mockTitle: 'नवाब दर्जी',
    mockRows: [{ item: 'सुरेश · कमीज', detail: 'लंबाई 30 इंच' }, { item: 'कंधा 18 · बाह 24', detail: 'इंच' }, { item: 'कपड़ा', detail: 'ग्राहक का' }, { item: 'देना', detail: '18 नवम्बर · सिलाई शुरू' }],
    mockFoot: 'इंच, बदले नहीं · नमूना',
    prompt: prompt('tailor order book', 'Dukaan Nawab Darzi. Grahak, purana maap khule. Shirt/suit ke fields alag, inch mein. Kapda grahak ka ya dukaan ka. Delivery date, status, advance. Factory stock ya payment gateway nahi.'),
  },
  {
    slug: 'tiffin-service-app',
    title: 'Tiffin Service App — Hindi mein, bina coding',
    description: 'Tiffin service in Hindi: customer, lunch or dinner, delivered or skipped, and the month\'s count. One kitchen. On NavBharatAI.',
    h1: 'Tiffin service app',
    storyHi: 'टिफिन वाले की रसोई सुबह तय करती है कि आज कितने डब्बे बनेंगे। कोई ग्राहक छुट्टी पर है, कोई केवल लंच लेता है। महीने के अंत में डब्बे गिनकर पैसे माँगे जाते हैं। यह ऐप एक रसोई की दैनिक लिस्ट है।',
    stepsHi: ['ग्राहक, पता की एक लाइन, और लंच, डिनर या दोनों।', 'आज डिलीवर हुआ या छुट्टी।', 'आज कितने डब्बे बनेंगे, सुबह की गिनती।', 'महीने में डिलीवर डब्बों की गिनती और दर।'],
    forWhomHi: 'एक रसोई से टिफिन पहुँचाने वाला। कई ब्रांच वाली केटरिंग कंपनी नहीं।',
    limitHi: 'यह मैप पर राइड ट्रैक नहीं करता और न ही ऑनलाइन ऑर्डर लेता है। रसोई की लिस्ट और गिनती है।',
    storyEn: 'The kitchen sees how many boxes to cook today, who skipped, and how many boxes were delivered this month. There is no map and no online checkout.',
    features: ['Lunch, dinner or both', 'Delivered or on leave today', 'A morning count of boxes to cook', 'Monthly delivered boxes times a rate'],
    faqs: [
      { q: 'रूट मैप?', a: 'नहीं। पते की एक लाइन काफी है ताकि डब्बा सही घर जाए। लाइव मैप का बटन नहीं।' },
      { q: 'छुट्टी का डब्बा पैसे में गिने?', a: 'नहीं। छुट्टी की तारीख महीने की गिनती से बाहर रहे।' },
      { q: 'दो समय अलग दर?', a: 'लंच और डिनर की दर अलग लिखी जा सके, ताकि केवल लंच का बिल अधूरा न हो।' },
      { q: 'नमूना?', a: '“मेहता, केवल लंच, आज छुट्टी” काल्पनिक है।' },
    ],
    mockTitle: 'माँ की रसोई — आज',
    mockRows: [{ item: 'मेहता · केवल लंच', detail: 'आज छुट्टी' }, { item: 'काज़ी · दोनों', detail: 'डिलीवर' }, { item: 'आज बनेंगे', detail: '26 डब्बे' }, { item: 'इस महीने मेहता', detail: '18 डब्बे' }],
    mockFoot: 'मैप नहीं · नमूना',
    prompt: prompt('tiffin kitchen list', 'Rasoi Maa ki Rasoi. Grahak, ek line pata, lunch/dinner/both, aaj delivered ya chhutti. Subah kitne dabbe. Mahine ke delivered dabbe aur rate. Chhutti ginna nahi. Map ya online order nahi.'),
  },
  {
    slug: 'medical-store-stock',
    title: 'Medical Store Stock App — Hindi mein, bina coding',
    description: 'Medical store stock in Hindi: item, batch, expiry and quantity. A counter book, not a pharmacy licence. On NavBharatAI.',
    h1: 'Medical store stock',
    storyHi: 'मेडिकल स्टोर पर दवाई का बैच और एक्सपायरी लिखना पड़ता है। जो स्ट्रिप इस महीने खत्म हो रही है, वह काउंटर के पीछे छिप जाती है। यह ऐप काउंटर की स्टॉक कॉपी है: सामान, बैच, एक्सपायरी और मात्रा। यह लाइसेंस या डॉक्टर का पर्चा नहीं है।',
    stepsHi: ['सामान का नाम, बैच और एक्सपायरी।', 'मात्रा। बिक्री पर मात्रा घटे।', 'इस महीने खत्म होने वाली स्ट्रिप्स की सूची।', 'कम स्टॉक की एक सीमा, जिसे दुकानदार खुद तय करे।'],
    forWhomHi: 'एक मेडिकल स्टोर का काउंटर। दवा कंपनी का गोदाम या अस्पताल की फार्मेसी चेन नहीं।',
    limitHi: 'यह पर्चे की जाँच नहीं करता, नशीली दवा का रजिस्टर होने का दावा नहीं करता, और सरकारी रिपोर्ट नहीं भेजता।',
    storyEn: 'The counter tracks a name, a batch, an expiry date and a quantity that falls when a strip is sold. Items expiring this month are listed. It does not check a prescription.',
    features: ['Name, batch and expiry', 'Quantity that falls on a sale', 'A list of stock expiring this month', 'A low-stock line the shop sets'],
    faqs: [
      { q: 'क्या ऐप बताएगा कि दवा किस बीमारी की है?', a: 'नहीं। यह स्टॉक है, सलाह नहीं।' },
      { q: 'एक्सपायरी निकल जाए तो?', a: 'सूची में निकालें लिखा हो और वह स्ट्रिप बेचने की लाइन से हट जाए। ऐप खुद कूड़ेदान नहीं है।' },
      { q: 'बारकोड?', a: 'ज़रूरी नहीं। नाम और बैच टाइप होते हैं।' },
      { q: 'नमूना?', a: 'बैच और एक्सपायरी काल्पनिक स्टॉक है, सलाह नहीं।' },
    ],
    mockTitle: 'जीवन मेडिकल — स्टॉक',
    mockRows: [{ item: 'स्ट्रिप ए', detail: 'बैच A12' }, { item: 'एक्सपायरी', detail: 'जनवरी · इस सूची में' }, { item: 'मात्रा', detail: '14 स्ट्रिप' }, { item: 'कम स्टॉक सीमा', detail: 'दुकान ने 10 रखी' }],
    mockFoot: 'सलाह नहीं · लाइसेंस नहीं · नमूना',
    prompt: prompt('medical store stock book', 'Dukaan Jeevan Medical. Item, batch, expiry, qty jo bikri par ghate. Is mahine expiry ki list. Low stock ki seema dukaan khud likhe. Koi disease advice, prescription check ya government report nahi.'),
  },
  {
    slug: 'taxi-daily-hisaab',
    title: 'Taxi Daily Hisaab App — Hindi mein, bina coding',
    description: 'A local taxi driver\'s daily hisaab in Hindi: trip, cash, diesel and what remains. Not a ride-hailing network. On NavBharatAI.',
    h1: 'Taxi daily hisaab',
    storyHi: 'लोकल टैक्सी चलाने वाला शाम को जेब गिनता है: कितनी सवारियाँ, कितना नकद, डीजल कितना डला, और मालिक को कितना देना है। यह ऐप एक गाड़ी के एक दिन का हिसाब है। यह कोई राइड बुक कराने वाला नेटवर्क नहीं है।',
    stepsHi: ['तारीख और गाड़ी नंबर।', 'हर सवारी: कहाँ से कहाँ, नकद।', 'डीजल लीटर और राशि।', 'दिन के अंत में नकद में से डीजल घटाकर बचा।'],
    forWhomHi: 'एक गाड़ी का चालक या मालिक। शहर भर की कैब कंपनी का डिस्पैच नहीं।',
    limitHi: 'ऐप सवारी नहीं बुलाता, किराया तय नहीं करता, और वॉलेट में पैसे नहीं रखता। केवल दिन की बही।',
    storyEn: 'One vehicle, one day. Each trip is a from-to and a cash amount. Diesel is subtracted at the end. Nobody books a ride through this app.',
    features: ['Date and vehicle number', 'Each trip as from, to and cash', 'Diesel litres and rupees', 'Cash minus diesel at day\'s end'],
    faqs: [
      { q: 'क्या यात्री ऐप से टैक्सी बुलाएगा?', a: 'नहीं। यह चालक की अपनी डायरी है।' },
      { q: 'मालिक और चालक का बँटवारा?', a: 'एक प्रतिशत या तय राशि, जिसे वे खुद लिखें। ऐप कोई नियम थोपता नहीं।' },
      { q: 'किराया मीटर?', a: 'नहीं। जो नकद मिला वह लिखा जाता है।' },
      { q: 'नमूना?', a: '“स्टेशन से कस्बा, ₹220” काल्पनिक यात्रा है।' },
    ],
    mockTitle: 'गाड़ी UP 32 · 11 नवम्बर',
    mockRows: [{ item: 'स्टेशन से कस्बा', detail: '₹220 नकद' }, { item: 'कस्बा से अस्पताल', detail: '₹80 नकद' }, { item: 'डीजल 5 लीटर', detail: '₹480' }, { item: 'बचा', detail: 'नकद में से डीजल' }],
    mockFoot: 'सवारी बुक नहीं होती · नमूना',
    prompt: prompt('one taxi daily cash book', 'Ek gaadi ka number. Tareekh. Har savari: kahan se kahan, cash. Diesel litre aur rupaye. Din ke ant mein cash minus diesel. Owner-driver split agar woh khud likhen. Koi ride booking ya fare meter nahi.'),
  },
  {
    slug: 'jewellery-udhaar-app',
    title: 'Jewellery Udhaar App — Hindi mein, bina coding',
    description: 'Jewellery shop udhaar in Hindi: customer, item, weight, amount due and repair status. One shop. On NavBharatAI.',
    h1: 'Jewellery udhaar book',
    storyHi: 'ज्वेलरी की दुकान पर उधार और मरम्मत दोनों चलते हैं। सोने की अंगूठी दी, रकम बाकी, पॉलिश अभी दुकान पर है — एक ही पर्ची पर उलझ जाता है। यह ऐप एक दुकान की बही है: ग्राहक, सामान, वजन, बाकी रकम, और मरम्मत की स्थिति।',
    stepsHi: ['ग्राहक का नाम और फोन।', 'सामान, धातु और वजन। वजन दुकानदार लिखे।', 'कुल राशि, जमा और बाकी।', 'मरम्मत हो तो स्थिति: दुकान पर, काम में, तैयार।'],
    forWhomHi: 'एक ज्वेलरी दुकान। बैंक का गोल्ड लोन या हॉलमार्किंग केंद्र नहीं।',
    limitHi: 'ऐप सोने का भाव नहीं बताता और न ही धातु की शुद्धता जाँचने का दावा करता है। वजन और रकम दुकानदार के लिखे हुए हैं।',
    storyEn: 'One shop records the customer, the piece, the weight the shop wrote, what is still owed, and whether a repair is still on the bench. It does not quote a gold rate or certify purity.',
    features: ['Customer name and phone', 'Piece, metal and weight as written', 'Total, paid and still due', 'Repair status: in shop, in work, ready'],
    faqs: [
      { q: 'क्या आज का सोने का रेट आएगा?', a: 'नहीं। दुकानदार रेट खुद लिखता है। लाइव रेट का दावा झूठ होगा।' },
      { q: 'हॉलमार्क?', a: 'ऐप प्रमाणपत्र नहीं है। दुकान चाहे तो “हॉलमार्क है या नहीं” एक निशान लगाए, दावे के साथ नहीं।' },
      { q: 'उधार और मरम्मत एक पर्ची?', a: 'दो लाइनें: बकाया रकम अलग, मरम्मत की स्थिति अलग, ताकि पॉलिश तैयार और पैसे बाकी साफ रहे।' },
      { q: 'नमूना?', a: '“ललिता, अंगूठी, 3.2 ग्राम, बाकी ₹8,000” काल्पनिक है।' },
    ],
    mockTitle: 'श्री हीरे — बही',
    mockRows: [{ item: 'ललिता · अंगूठी', detail: '3.2 ग्राम' }, { item: 'बाकी', detail: '₹8,000' }, { item: 'पॉलिश', detail: 'दुकान पर · तैयार नहीं' }, { item: 'भाव', detail: 'दुकान ने लिखा' }],
    mockFoot: 'शुद्धता का दावा नहीं · नमूना',
    prompt: prompt('jewellery shop udhaar and repair book', 'Dukaan Shri Heere. Grahak, phone, item, dhatu, wajan jo dukaan likhe. Total, jama, bakaya. Marammat status: dukaan par, kaam mein, taiyar. Live gold rate ya hallmark certificate nahi.'),
  },
  {
    slug: 'mandir-donation-receipt',
    title: 'Mandir Donation Receipt — Hindi mein, bina coding',
    description: 'A temple donation receipt book in Hindi: devotee, amount, purpose and receipt number. One temple. On NavBharatAI.',
    h1: 'Mandir donation receipt',
    storyHi: 'मंदिर में चढ़ावा नकद आता है। भक्त रसीद माँगता है, और ट्रस्ट को दिन के अंत में जोड़ चाहिए। यह ऐप एक मंदिर की रसीद बुक है: नाम, राशि, काम (दान, पूजा, निर्माण), और रसीद नंबर।',
    stepsHi: ['भक्त का नाम। अनाम चढ़ावा भी एक लाइन हो।', 'राशि और मकसद।', 'रसीद नंबर जो दोबारा न आए।', 'आज का जोड़, मकसद के हिसाब से।'],
    forWhomHi: 'एक मंदिर या छोटे ट्रस्ट का काउंटर। कई मंदिरों की सेंट्रल कमेटी नहीं।',
    limitHi: 'यह कर-छूट का प्रमाणपत्र या सरकारी चैरिटी रिटर्न नहीं है। केवल मंदिर की अपनी रसीद बुक।',
    storyEn: 'One temple counter writes a name or anonymous, an amount, a purpose and a receipt number that does not repeat. The day\'s total splits by purpose. It is not a tax-exemption certificate.',
    features: ['Name, or an anonymous line', 'Amount and purpose', 'Receipt numbers that do not repeat', 'Today\'s total split by purpose'],
    faqs: [
      { q: 'क्या कर-छूट की रसीद छपेगी?', a: 'नहीं, जब तक ट्रस्ट का अपना प्रमाण न हो। ऐप केवल मंदिर की आंतरिक रसीद है और स्क्रीन पर यही कहना चाहिए।' },
      { q: 'अनाम चढ़ावा?', a: 'नाम खाली रह सकता है। रसीद नंबर फिर भी बढ़े, ताकि जोड़ बिगड़े नहीं।' },
      { q: 'भोजन और निर्माण अलग?', a: 'मकसद अलग कॉलम है, ताकि दिन के अंत में दोनों के जोड़ अलग रहें।' },
      { q: 'नमूना?', a: '“रसीद 88, ₹501, निर्माण” काल्पनिक है।' },
    ],
    mockTitle: 'श्री राम मंदिर ट्रस्ट — आज',
    mockRows: [{ item: 'रसीद 88', detail: '₹501 · निर्माण' }, { item: 'रसीद 89 · अनाम', detail: '₹101 · दान' }, { item: 'आज निर्माण', detail: '₹2,400' }, { item: 'आज दान', detail: '₹860' }],
    mockFoot: 'कर-छूट प्रमाणपत्र नहीं · नमूना',
    prompt: prompt('temple donation receipt book', 'Ek mandir Shri Ram Mandir Trust. Bhakt ka naam ya anam, rashi, maqsad, rasid number jo dohraaye nahi. Aaj ka jod maqsad ke hisaab se. Screen par likho ki yeh tax-exemption certificate nahi hai.'),
  },
  {
    slug: 'hardware-dukaan-credit',
    title: 'Hardware Dukaan Credit App — Hindi mein, bina coding',
    description: 'Hardware shop credit in Hindi: customer, item, bill and what is still due. One dukaan. Make it on NavBharatAI.',
    h1: 'Hardware dukaan credit',
    storyHi: 'हार्डवेयर की दुकान पर मिस्त्री और मकान मालिक उधार पर सामान उठाते हैं। सीमेंट, पाइप और पेंट एक ही पर्ची पर होते हैं, और महीने बाद कितना बाकी है लड़ने लगता है। यह ऐप एक दुकान की उधार बही है।',
    stepsHi: ['ग्राहक का नाम। पुराने बिल एक साथ खुलें।', 'सामान, मात्रा और रेट। बिल का कुल।', 'जमा और बाकी, ग्राहक के हिसाब से।', 'आज नकद और आज उधार, अलग।'],
    forWhomHi: 'एक हार्डवेयर, पेंट या इलेक्ट्रिकल की दुकान। बिल्डर कंपनी का प्रोजेक्ट अकाउंट नहीं।',
    limitHi: 'यह GST रिटर्न फाइल नहीं करता। चालान चाहिए तो GST पेज है। यहाँ उधार और बिल है।',
    storyEn: 'One hardware shop keeps each customer\'s bills together, with a running balance. Today\'s cash and today\'s credit stay apart. It does not file a tax return.',
    features: ['Customer, with older bills together', 'Item, quantity, rate and bill total', 'A running balance per customer', 'Today\'s cash and today\'s credit apart'],
    faqs: [
      { q: 'GST चालान?', a: 'इस पेज पर नहीं। टैक्स चालान का अलग पेज है। यहाँ दुकान की उधार बही है।' },
      { q: 'मिस्त्री और मकान मालिक दोनों?', a: 'जिसके नाम बिल है वही ग्राहक है। एक बिल पर एक नाम, ताकि बाकी बँट न जाए।' },
      { q: 'स्टॉक?', a: 'इस ऐप का काम उधार है। मात्रा बिल पर लिखी है, गोदाम की पूरी इन्वेंटरी नहीं।' },
      { q: 'नमूना?', a: '“मिस्त्री जगदीश, सीमेंट 4 बोरी, बाकी ₹1,100” काल्पनिक है।' },
    ],
    mockTitle: 'गुप्ता हार्डवेयर',
    mockRows: [{ item: 'जगदीश · सीमेंट 4 बोरी', detail: '₹1,600' }, { item: 'जमा', detail: '₹500' }, { item: 'बाकी', detail: '₹1,100' }, { item: 'आज उधार', detail: '₹1,100' }],
    mockFoot: 'एक दुकान · GST रिटर्न नहीं · नमूना',
    prompt: prompt('hardware shop credit book', 'Dukaan Gupta Hardware. Grahak, purane bill ek saath. Item, matra, rate, kul. Jama aur bakaya. Aaj cash aur aaj udhaar alag. Ek bill par ek naam. GST return ya warehouse inventory nahi.'),
  },
];

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function useCasePath(slug: string): string {
  return `/app/${slug}`;
}

export function useCaseBySlug(slug: string): UseCasePage | null {
  if (!SLUG.test(slug)) return null;
  return USE_CASES.find((p) => p.slug === slug) ?? null;
}

export function useCasePaths(): string[] {
  return USE_CASES.map((p) => useCasePath(p.slug));
}

export function useCaseBuilderHref(slug: string): string {
  return `/?usecase=${encodeURIComponent(slug)}&source=seo`;
}

export function assertUseCaseCatalog(): string[] {
  const problems: string[] = [];
  const slugs = new Set<string>();
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  for (const p of USE_CASES) {
    if (!SLUG.test(p.slug)) problems.push(`bad slug ${p.slug}`);
    if (slugs.has(p.slug)) problems.push(`duplicate slug ${p.slug}`);
    slugs.add(p.slug);
    if (titles.has(p.title)) problems.push(`duplicate title ${p.slug}`);
    titles.add(p.title);
    if (descriptions.has(p.description)) problems.push(`duplicate description ${p.slug}`);
    descriptions.add(p.description);
    if (p.title.length > 65) problems.push(`title long ${p.slug} ${p.title.length}`);
    if (p.description.length < 70 || p.description.length > 160) problems.push(`description length ${p.slug} ${p.description.length}`);
    if (p.faqs.length < 3 || p.faqs.length > 4) problems.push(`faq count ${p.slug}`);
    if (p.stepsHi.length < 4 || p.features.length < 4 || p.mockRows.length < 4) problems.push(`thin lists ${p.slug}`);
    if (p.storyHi.length < 120 || p.storyEn.length < 80) problems.push(`thin story ${p.slug}`);
  }
  if (USE_CASES.length < 20) problems.push(`need at least 20, have ${USE_CASES.length}`);
  return problems;
}
