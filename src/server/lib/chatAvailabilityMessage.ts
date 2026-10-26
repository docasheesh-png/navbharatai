import { resolveChatReplyLanguage, type ChatReplyLanguage } from '../../lib/chatReplyLanguage';
import { detectReplyLanguage } from './freeChatReplies';

export interface ChatAvailabilityInput { message?: unknown; history?: unknown; replyLanguage?: unknown; }
export type ChatAvailabilityKind = 'capacity' | 'temporary';

// Chat notices, not application controls. The user's explicit reply language takes precedence over
// the language they typed in. Never interpolate provider errors, configuration or account details.
const NOTICES: Record<ChatReplyLanguage, Record<ChatAvailabilityKind, string>> = {
  en: { capacity: 'NavBharatAI is busy due to high traffic. Please try again shortly.', temporary: 'NavBharatAI is temporarily unable to respond. Please try again shortly.' },
  hi: { capacity: 'अधिक ट्रैफ़िक के कारण NavBharatAI अभी व्यस्त है। कृपया थोड़ी देर बाद फिर कोशिश करें।', temporary: 'NavBharatAI अभी जवाब नहीं दे पा रहा है। कृपया थोड़ी देर बाद फिर कोशिश करें।' },
  'hi-latn': { capacity: 'Adhik traffic ke karan NavBharatAI abhi vyast hai. Kripya thodi der baad phir prayas karein.', temporary: 'NavBharatAI abhi uttar nahi de pa raha hai. Kripya thodi der baad phir prayas karein.' },
  hinglish: { capacity: 'Zyada traffic ki wajah se NavBharatAI abhi busy hai. Kripya thodi der baad phir try karein.', temporary: 'NavBharatAI abhi jawab nahi de pa raha hai. Kripya thodi der baad phir try karein.' },
  ta: { capacity: 'அதிகப் பயன்பாடு காரணமாக NavBharatAI இப்போது பிஸியாக உள்ளது. சிறிது நேரம் கழித்து மீண்டும் முயற்சிக்கவும்.', temporary: 'NavBharatAI இப்போது பதிலளிக்க இயலவில்லை. சிறிது நேரம் கழித்து மீண்டும் முயற்சிக்கவும்.' },
  te: { capacity: 'అధిక ట్రాఫిక్ కారణంగా NavBharatAI ప్రస్తుతం బిజీగా ఉంది. దయచేసి కొద్దిసేపటి తర్వాత మళ్లీ ప్రయత్నించండి.', temporary: 'NavBharatAI ప్రస్తుతం స్పందించలేకపోతోంది. దయచేసి కొద్దిసేపటి తర్వాత మళ్లీ ప్రయత్నించండి.' },
  bn: { capacity: 'বেশি ট্রাফিকের কারণে NavBharatAI এখন ব্যস্ত। অনুগ্রহ করে কিছুক্ষণ পরে আবার চেষ্টা করুন।', temporary: 'NavBharatAI এখন উত্তর দিতে পারছে না। অনুগ্রহ করে কিছুক্ষণ পরে আবার চেষ্টা করুন।' },
  mr: { capacity: 'जास्त ट्रॅफिकमुळे NavBharatAI सध्या व्यस्त आहे. कृपया थोड्या वेळाने पुन्हा प्रयत्न करा.', temporary: 'NavBharatAI सध्या उत्तर देऊ शकत नाही. कृपया थोड्या वेळाने पुन्हा प्रयत्न करा.' },
  pa: { capacity: 'ਵੱਧ ਟ੍ਰੈਫਿਕ ਕਾਰਨ NavBharatAI ਇਸ ਵੇਲੇ ਰੁੱਝਿਆ ਹੋਇਆ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਥੋੜ੍ਹੀ ਦੇਰ ਬਾਅਦ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।', temporary: 'NavBharatAI ਇਸ ਵੇਲੇ ਜਵਾਬ ਨਹੀਂ ਦੇ ਸਕਦਾ। ਕਿਰਪਾ ਕਰਕੇ ਥੋੜ੍ਹੀ ਦੇਰ ਬਾਅਦ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।' },
  gu: { capacity: 'વધુ ટ્રાફિકને કારણે NavBharatAI અત્યારે વ્યસ્ત છે. કૃપા કરીને થોડી વાર પછી ફરી પ્રયત્ન કરો.', temporary: 'NavBharatAI અત્યારે જવાબ આપી શકતું નથી. કૃપા કરીને થોડી વાર પછી ફરી પ્રયત્ન કરો.' },
  kn: { capacity: 'ಹೆಚ್ಚಿನ ದಟ್ಟಣೆಯಿಂದಾಗಿ NavBharatAI ಈಗ ಕಾರ್ಯನಿರತವಾಗಿದೆ. ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.', temporary: 'NavBharatAI ಈಗ ಪ್ರತಿಕ್ರಿಯಿಸಲು ಸಾಧ್ಯವಾಗುತ್ತಿಲ್ಲ. ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.' },
  ml: { capacity: 'കൂടുതൽ തിരക്ക് കാരണം NavBharatAI ഇപ്പോൾ തിരക്കിലാണ്. ദയവായി അൽപ്പസമയത്തിന് ശേഷം വീണ്ടും ശ്രമിക്കുക.', temporary: 'NavBharatAI-ക്ക് ഇപ്പോൾ മറുപടി നൽകാനാകുന്നില്ല. ദയവായി അൽപ്പസമയത്തിന് ശേഷം വീണ്ടും ശ്രമിക്കുക.' },
  ur: { capacity: 'زیادہ ٹریفک کی وجہ سے NavBharatAI اس وقت مصروف ہے۔ براہ کرم تھوڑی دیر بعد دوبارہ کوشش کریں۔', temporary: 'NavBharatAI اس وقت جواب نہیں دے پا رہا۔ براہ کرم تھوڑی دیر بعد دوبارہ کوشش کریں۔' },
  ne: { capacity: 'धेरै ट्राफिकका कारण NavBharatAI अहिले व्यस्त छ। कृपया केही समयपछि फेरि प्रयास गर्नुहोस्।', temporary: 'NavBharatAI अहिले जवाफ दिन असमर्थ छ। कृपया केही समयपछि फेरि प्रयास गर्नुहोस्।' },
  or: { capacity: 'ଅଧିକ ଟ୍ରାଫିକ୍ ଯୋଗୁଁ NavBharatAI ବର୍ତ୍ତମାନ ବ୍ୟସ୍ତ ଅଛି। ଦୟାକରି କିଛି ସମୟ ପରେ ପୁଣି ଚେଷ୍ଟା କରନ୍ତୁ।', temporary: 'NavBharatAI ବର୍ତ୍ତମାନ ଉତ୍ତର ଦେଇପାରୁନାହିଁ। ଦୟାକରି କିଛି ସମୟ ପରେ ପୁଣି ଚେଷ୍ଟା କରନ୍ତୁ।' },
  sa: { capacity: 'अत्यधिकानुरोधानां कारणात् NavBharatAI इदानीं व्यस्तम् अस्ति। कृपया किञ्चित्कालानन्तरं पुनः प्रयत्नं कुर्वन्तु।', temporary: 'NavBharatAI इदानीम् उत्तरं दातुं न शक्नोति। कृपया किञ्चित्कालानन्तरं पुनः प्रयत्नं कुर्वन्तु।' },
  fr: { capacity: 'NavBharatAI est occupé en raison d’un trafic important. Veuillez réessayer dans un instant.', temporary: 'NavBharatAI ne peut pas répondre pour le moment. Veuillez réessayer dans un instant.' },
  es: { capacity: 'NavBharatAI está ocupado debido al alto tráfico. Inténtalo de nuevo en unos momentos.', temporary: 'NavBharatAI no puede responder temporalmente. Inténtalo de nuevo en unos momentos.' },
  de: { capacity: 'NavBharatAI ist wegen vieler Anfragen ausgelastet. Bitte versuche es in Kürze erneut.', temporary: 'NavBharatAI kann vorübergehend nicht antworten. Bitte versuche es in Kürze erneut.' },
  ar: { capacity: 'NavBharatAI مشغول الآن بسبب كثرة الطلبات. يرجى المحاولة مرة أخرى بعد قليل.', temporary: 'يتعذر على NavBharatAI الرد مؤقتًا. يرجى المحاولة مرة أخرى بعد قليل.' },
  zh: { capacity: '由于访问量较大，NavBharatAI 目前繁忙。请稍后重试。', temporary: 'NavBharatAI 暂时无法回复。请稍后重试。' },
  ja: { capacity: 'アクセスが集中しているため、NavBharatAI は現在混み合っています。しばらくしてからもう一度お試しください。', temporary: 'NavBharatAI は一時的に応答できません。しばらくしてからもう一度お試しください。' },
  ko: { capacity: '요청이 많아 NavBharatAI가 현재 혼잡합니다. 잠시 후 다시 시도해 주세요.', temporary: 'NavBharatAI가 일시적으로 응답할 수 없습니다. 잠시 후 다시 시도해 주세요.' },
  pt: { capacity: 'O NavBharatAI está ocupado devido ao tráfego intenso. Tente novamente em instantes.', temporary: 'O NavBharatAI não pode responder temporariamente. Tente novamente em instantes.' },
  ru: { capacity: 'NavBharatAI сейчас занят из-за большого числа запросов. Попробуйте ещё раз немного позже.', temporary: 'NavBharatAI временно не может ответить. Попробуйте ещё раз немного позже.' },
};

/** Use capacity ONLY for confirmed admission overload, never quota, policy or unknown failures. */
export function chatAvailabilityMessage(kind: ChatAvailabilityKind, input: ChatAvailabilityInput = {}): string {
  const explicit = resolveChatReplyLanguage(input.message, input.history, input.replyLanguage);
  const detected = detectReplyLanguage(typeof input.message === 'string' ? input.message : '');
  const language = explicit ?? (detected === 'other' ? 'en' : detected);
  return NOTICES[language][kind];
}
