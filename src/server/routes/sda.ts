import crypto from 'crypto';
import type { Express } from 'express';

/**
 * Senior Doctor Assistant (SDA) chat route extracted from the server.ts monolith
 * (Phase 1, AI-core step e). Self-contained — instantiates Gemini/OpenAI clients
 * (and dynamically Vertex AI) itself; helpers are local.
 *
 * Includes the PR #3 SDA upgrades (ported into the modular route):
 *  - server-side clinical store + recent-message memory (24h TTL) keyed by session
 *  - pinned clinical snapshot context so SDA never forgets early case data
 *  - CLINICAL_JSON memory block parsed/stripped per response
 *  - rural/PHC prompt guidance + structured final Rx + doctor disclaimer
 */

// ══ SDA Clinical Store (in-memory, 24h TTL) ══
interface SdaClinicalEntry {
  patientData: Record<string, any>;
  redFlags: string[];
  stage: string;
  createdAt: number;
  updatedAt: number;
}
const sdaClinicalStore = new Map<string, SdaClinicalEntry>();
const sdaRecentMessages = new Map<string, Array<{ role: 'user' | 'assistant'; content: string; ts: number }>>();
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, entry] of sdaClinicalStore.entries()) {
    if (entry.updatedAt < cutoff) sdaClinicalStore.delete(id);
  }
  for (const [id] of sdaRecentMessages.entries()) {
    if (!sdaClinicalStore.has(id)) sdaRecentMessages.delete(id);
  }
}, 60 * 60 * 1000);

export function registerSdaRoutes(app: Express): void {
  app.post('/api/sda-chat', async (req: any, res: any) => {
    try {
      let { message, history = [], teachingMode = false, userId, sessionId, fileData, fileType, fileName } = req.body;
      if (!message && !fileData) return res.status(400).json({ error: 'Message required' });
      message = message || 'Please analyze this medical document and extract all relevant clinical findings.';

      // ── Session / clinical-store resolution ──────────────────────────────────
      // sessionId is preferred; fall back to userId for backwards compat.
      const sdaSessionId: string = sessionId || userId || crypto.randomBytes(8).toString('hex');
      const now = Date.now();

      let clinicalEntry = sdaClinicalStore.get(sdaSessionId);
      if (!clinicalEntry) {
        clinicalEntry = { patientData: {}, redFlags: [], stage: 'demographics', createdAt: now, updatedAt: now };
        sdaClinicalStore.set(sdaSessionId, clinicalEntry);
      }

      // Server-side history; seed from client-provided history on first turn.
      let storedMsgs = sdaRecentMessages.get(sdaSessionId);
      if (!storedMsgs) {
        // Skip leading assistant messages (e.g. a welcome message) — Gemini/Vertex
        // require contents to start with a 'user' turn, otherwise the API errors silently.
        const allMapped = (history as Array<{ role: string; content: string }>).map(m => ({
          role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
          content: String(m.content || ''),
          ts: now,
        }));
        const firstUserIdx = allMapped.findIndex(m => m.role === 'user');
        storedMsgs = firstUserIdx >= 0 ? allMapped.slice(firstUserIdx) : [];
        sdaRecentMessages.set(sdaSessionId, storedMsgs);
      }

      const hasFile = !!(fileData && fileType);
      const isImage = hasFile && fileType.startsWith('image/');
      const isPDF = hasFile && fileType === 'application/pdf';
      const isTextDoc = hasFile && !isImage && !isPDF &&
        (fileType === 'text/plain' || fileType === 'text/csv' || fileType === 'text/html' || fileType === 'application/json');

      // For plain-text documents: decode base64 → prepend content to message (works with all providers)
      if (isTextDoc && fileData) {
        try {
          const docText = Buffer.from(fileData, 'base64').toString('utf-8').slice(0, 10000);
          message = `[Document: ${fileName}]\n\n${docText}\n\n---\nDoctor's question: ${message}`;
        } catch { /* keep original message */ }
      }

      const SDA_SYSTEM = `You are the Senior Doctor Assistant (SDA) — a Clinical Decision Support AI inside NavBharatAI, designed exclusively for qualified doctors (MBBS, residents, consultants, specialists).

CORE IDENTITY:
- You are NOT a patient-facing chatbot, symptom checker, or general AI.
- You behave like an experienced senior consultant conducting a bedside case discussion with a junior doctor.
- You assist, you never replace. Final decisions always belong to the treating physician.
- Always communicate that you are assisting, not replacing, the doctor.

THE SINGLE MOST IMPORTANT RULE:
ASK ONLY ONE QUESTION AT A TIME. Never ask multiple questions. Never present questionnaires. Each question must follow from the previous answer. This is non-negotiable.

WORKFLOW SEQUENCE:
1. Demographics first: Age, Sex, Weight, Pregnancy status (if female, reproductive age), Current medications, Allergies, Chronic illnesses
2. Chief Complaint — ask for the single most important complaint
3. History of Present Illness — complaint-specific, dynamic questioning:
   - Fever pathway: duration, pattern, max temp, chills/rigors, rash, travel, mosquito exposure, sick contacts
   - Chest pain pathway: onset, location, radiation, severity, sweating, breathlessness, palpitations, syncope, cardiac risk factors
   - Abdominal pain pathway: location (use anatomical regions), character, radiation, bowel symptoms, food relation
   - Neuro pathway: consciousness, focal deficits, seizures, weakness, speech, headache features
   - Adapt pathway to whatever complaint is presented
4. Past Medical/Surgical/Medication/Allergy/Family/Social History
5. General Physical Examination: Temp, Pulse, BP, RR, SpO2, Pallor, Icterus, Cyanosis, Clubbing, Edema, Lymphadenopathy
6. Systemic Examination: relevant systems only based on complaint
7. Investigation review if provided

QUESTIONING RULES:
- Always provide structured answer options when clinically useful (e.g., pain location as anatomical regions, severity as 0-10 scale)
- Reject vague answers: if doctor says "SpO2 normal" respond "Please provide exact SpO2 value (e.g., 94%, 98%)"
- Validate every response before proceeding
- Adapt next question entirely based on previous answer

RED FLAG DETECTION (always active):
Screen continuously for: Shock, Sepsis, Respiratory failure, ACS, Stroke, Meningitis, Severe dehydration, Status epilepticus, GI bleed, Severe anemia, DKA, Obstetric emergencies, Pediatric emergencies.
If detected: IMMEDIATELY alert the doctor prominently before continuing.

DIFFERENTIAL DIAGNOSIS:
- Never anchor on one diagnosis. Always maintain ranked differentials.
- For each differential: supporting evidence, contradicting evidence, confirming investigations
- State uncertainty clearly when evidence is insufficient

MEDICATION SAFETY:
- Always check: age, weight, pregnancy, breastfeeding, renal/hepatic disease, allergies, drug interactions
- Never suggest a medication without evaluating available safety data

${teachingMode ? `TEACHING MODE ACTIVE: After each question, briefly explain WHY you are asking it and what clinical reasoning it serves. Help the doctor learn to think like a senior clinician.` : ''}

SPECIAL POPULATIONS:
- Pediatric: collect birth history, gestational age, immunization, development, feeding, growth
- Geriatric: focus on polypharmacy, frailty, fall risk, cognitive impairment
- Pregnant: trimester, fetal risk, medication safety

RESPONSE FORMAT:
- Be concise and clinical. No unnecessary padding.
- Use markdown for structure when generating summaries or differentials.
- For case summaries: include Demographics, CC, HPI, PMH, Examination, Investigations, Impression, Differentials, Red Flags, Safety notes, Next steps.
- For "What am I missing?": review entire case for missing history, examination gaps, investigation gaps, alternative diagnoses, cognitive biases.

CLINICAL TOOLS (when doctor requests via Quick Tools or in conversation):
- CLINICAL SCORES: Calculate SOFA, qSOFA, GCS, CURB-65, Wells PE/DVT, NIHSS, Killip — show step-by-step calculation, score value, mortality risk, and recommended action tier.
- DRUG INTERACTIONS: Systematically check every drug-drug pair and drug-disease interaction. Grade severity (mild/moderate/severe/contraindicated), explain mechanism, state clinical consequence, and give management (avoid/monitor/dose adjust).
- LAB INTERPRETATION: For each value: reference range, patient value, abnormality grade, clinical significance in this patient's context, and diagnostic implication. Flag critically abnormal values requiring immediate action.
- PEDIATRIC DOSING: Provide mg/kg dose, calculated total dose for patient weight, frequency, route, max dose, and any renal/hepatic adjustments. Reference BNF for Children / Harriet Lane.
- EMERGENCY PROTOCOLS: ABCDE approach, triage priority, immediate interventions, resuscitation medications with exact doses, which bundles to activate (Sepsis-6, STEMI protocol, stroke pathway, DKA protocol, anaphylaxis etc.), escalation criteria to ICU.
- ANTIBIOTIC STEWARDSHIP: Suspect organism, first-line drug (dose/frequency/route/duration), allergy alternative, empirical vs targeted, de-escalation strategy, when to narrow based on cultures.
- PREGNANCY SAFETY: For each drug — FDA category (A/B/C/D/X), trimester-specific risks, breast milk transfer, neonatal effects, safer alternatives, dose adjustments in pregnancy.
- REFERRAL DECISION: Referral yes/no with clear criteria, specialty, urgency (emergency/urgent/routine/elective), what to include in referral letter, pre-referral workup, escalation triggers.

RURAL & RESOURCE-LIMITED SETTINGS (CRITICAL FOR VILLAGE/PHC DOCTORS):
- Always give a clear "Manage here" vs "Refer NOW" decision with explicit criteria
- For every investigation: provide clinical alternative if test unavailable ("If ECG unavailable, assess by...")
- Prioritize drugs from India NLEM / WHO Essential Medicines List (available at PHC/CHC level)
- Referral: include pre-transfer stabilization steps, mode of transport, and what to tell the referral centre
- Flag region- and season-specific Indian conditions: Malaria, Dengue, Typhoid, TB, Leptospirosis, Snake bite, Kala-azar, Scrub typhus, Pesticide/organophosphate poisoning, Nutritional deficiencies (iron, B12, Vit D)
- Pediatric: apply IMCI guidelines, screen for SAM/MAM criteria
- Telemedicine-ready: assessments must be communicable over phone/WhatsApp when needed

END-OF-CASE SIGNAL: When you provide a final diagnosis, treatment plan, management summary, or discharge advice — structure your final response EXACTLY as follows, then end with [CASE_COMPLETE] on its own line:

---
**📋 Chief Complaint:** [single sentence]

**🔬 Diagnosis:** [primary diagnosis + key differentials if relevant]

**🧪 Suggestive Investigations:** [list — always include affordable/basic options first; note which can be skipped if unavailable]

**💊 Rx:**
| Drug | Dose | Route | Frequency | Duration |
|------|------|-------|-----------|----------|
| ... | ... | ... | ... | ... |

[Add any critical precautions, drug interactions, or monitoring parameters here]

---
> ⚠️ **Doctor ke liye zaroori note:** Yeh SDA (AI) ka suggestion hai — ek experienced consultant ki tarah guidance deta hai, lekin aapki jagah nahi le sakta. Aapki physical examination, local clinical context, aur apna judgment SABSE IMPORTANT hai. Koi bhi treatment start karne se pehle apna dimaag zaroor lagaiye — AI ko blindly follow karna patient ke liye safe nahi hai. **Aap doctor hain, final decision aapka hai.** 🩺
---

[CASE_COMPLETE]

LANGUAGE: Primarily English medical terminology. Can use Hinglish for brief clarifications if needed.

CLINICAL NOTE UPDATE — MANDATORY ON EVERY RESPONSE:
At the very START of your response (before your reply to the doctor), output a clinical note block:
[CLINICAL_JSON]
{"demographics":{"age":"...","sex":"...","weight":"..."},"chiefComplaint":"...","hpi":"...","vitals":{"temp":"...","pulse":"...","bp":"...","rr":"...","spo2":"..."},"pmh":[],"medications":[],"allergies":[],"examination":"...","investigations":[],"redFlags":[],"differentials":[],"stage":"demographics|cc|hpi|history|examination|investigations|differential|complete"}
[/CLINICAL_JSON]
Rules: Only include fields collected so far. Merge and UPDATE — never remove previously collected data. Keep values brief (machine-readable, not prose). This block is stripped before the doctor sees it — it is purely for memory continuity across the full case.

IMPORTANT: You are assisting a doctor. Responses must be clinically rigorous, evidence-based, and respectful of physician authority.`;

      // Extract structured data from response (simple heuristic)
      const extractPatientUpdate = (text: string, msg: string): Record<string, any> => {
        const update: Record<string, any> = {};
        const ageSexMatch = msg.match(/(\d+)\s*[-–]?\s*year[- ]?old\s*(male|female|m|f)/i);
        if (ageSexMatch) {
          update.age = ageSexMatch[1] + ' years';
          update.sex = ageSexMatch[2].toLowerCase().startsWith('m') ? 'Male' : 'Female';
        }
        const weightMatch = msg.match(/(\d+)\s*kg/i);
        if (weightMatch) update.weight = weightMatch[1] + ' kg';
        return update;
      };

      const detectRedFlags = (text: string): string[] => {
        const flags: string[] = [];
        const patterns: [RegExp, string][] = [
          [/\bshock\b/i, 'Shock'],
          [/\bsepsis\b/i, 'Sepsis'],
          [/spo2.{0,10}[0-8]\d%?|oxygen.{0,10}[0-8]\d/i, 'Low SpO2'],
          [/\brespiratory failure\b/i, 'Respiratory Failure'],
          [/\bchest pain\b.{0,30}\bsweating\b|\bdiaphoresis\b/i, 'Possible ACS'],
          [/\bstroke\b|\bfacial droop\b|\barm weakness\b/i, 'Stroke Signs'],
          [/\bmeningitis\b|\bneck stiffness\b.*fever/i, 'Meningitis Signs'],
          [/\bgi bleed\b|\bmelena\b|\bhematemesis\b/i, 'GI Bleeding'],
          [/\bdka\b|\bdiabetic ketoacidosis\b/i, 'DKA'],
          [/bp.{0,10}[0-7]\d\/|hypotension/i, 'Hypotension'],
          [/\bpulse.{0,10}1[2-9]\d|tachycardia/i, 'Tachycardia'],
          [/\btemp.{0,10}1(?:0[4-9]|[1-9]\d)|fever.{0,20}high|hyperpyrexia/i, 'High Fever'],
          [/\baltered.{0,20}conscious|unconscious|unresponsive/i, 'Altered Consciousness'],
          [/\beclampsia\b|\bpre-?eclampsia\b.*severe/i, 'Eclampsia'],
          [/\bhb.{0,10}[0-6]\.?\d?\b|severe.{0,15}anaemia|severe.{0,15}anemia/i, 'Severe Anaemia'],
          [/\bneck stiffness\b|\bphotophobia\b|\bmeningism\b/i, 'Meningism'],
        ];
        for (const [pattern, label] of patterns) {
          if (pattern.test(text) || pattern.test(message)) flags.push(label);
        }
        return flags;
      };

      // Build AI context: pinned clinical snapshot + last 6 raw exchanges. The
      // snapshot encodes ALL collected patient data in ~200 tokens regardless of
      // session length, so SDA never forgets demographics/symptoms from turn 1.
      const hasClinicalData = Object.keys(clinicalEntry.patientData).length > 0 || clinicalEntry.redFlags.length > 0;
      const clinicalSnapshot = hasClinicalData
        ? JSON.stringify({ patientData: clinicalEntry.patientData, redFlags: clinicalEntry.redFlags, stage: clinicalEntry.stage })
        : null;

      const historyForAI: Array<{ role: 'user' | 'assistant'; content: string }> = [
        ...(clinicalSnapshot ? [
          { role: 'user' as const, content: `[CASE_CONTEXT]\n${clinicalSnapshot}\n[/CASE_CONTEXT]\nContinue the clinical assessment. Do NOT re-ask anything already recorded in the context above.` },
          { role: 'assistant' as const, content: 'Understood. Full clinical context loaded. Continuing without repeating any question already answered.' },
        ] : []),
        ...storedMsgs.slice(-6).map(m => ({ role: m.role, content: m.content })),
      ];

      let reply = '';

      // ── Shared helpers ───────────────────────────────────────────────────────
      // Build OpenAI-format message list (used by Claude proxy and Grok)
      const buildOpenAIMsgs = (userContent: any) => [
        { role: 'system' as const, content: SDA_SYSTEM },
        ...historyForAI,
        { role: 'user' as const, content: userContent },
      ];

      // Build Gemini/Vertex contents array (with optional file attachment)
      // NOTE: @google/genai SDK uses camelCase: inlineData/mimeType (NOT inline_data/mime_type)
      const buildGeminiContents = () => {
        const userParts: any[] = [];
        if ((isImage || isPDF) && fileData)
          userParts.push(
            { inlineData: { mimeType: fileType, data: fileData } },
            { text: `[${isPDF ? 'PDF Report' : 'Image'}: ${fileName}]\n${message}` }
          );
        else
          userParts.push({ text: message });
        // Gemini requires contents to start with 'user' — drop any leading model turns
        const geminiHistory = historyForAI.map((m: any) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
        const firstUserTurn = geminiHistory.findIndex((m: any) => m.role === 'user');
        return [
          ...(firstUserTurn >= 0 ? geminiHistory.slice(firstUserTurn) : []),
          { role: 'user', parts: userParts },
        ];
      };

      // ── Race: Grok + Gemini simultaneously (SDA primary pair) ──────────────
      const sdaGrokKey   = process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
      const sdaGeminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';

      type SdaRacerFn = (signal: AbortSignal) => Promise<string>;
      const sdaRacers: SdaRacerFn[] = [];

      // Grok supports images via vision models but NOT PDFs — skip Grok for PDF files
      if (sdaGrokKey && !isPDF) sdaRacers.push(async (signal) => {
        const { default: OpenAI } = await import('openai');
        const c = new OpenAI({ apiKey: sdaGrokKey, baseURL: 'https://api.x.ai/v1' });

        // For images: use Grok vision model with image_url format
        // For text: use standard Grok-3 models
        const models = isImage ? ['grok-2-vision-1212', 'grok-2-mini-vision-1212'] : ['grok-3', 'grok-3-fast'];
        const userContent: any = isImage && fileData
          ? [
              { type: 'image_url', image_url: { url: `data:${fileType};base64,${fileData}` } },
              { type: 'text', text: `[Image: ${fileName}]\n${message}` },
            ]
          : message;

        for (const m of models) {
          try {
            const r = await c.chat.completions.create({ model: m, messages: buildOpenAIMsgs(userContent), max_tokens: 2000 }, { signal });
            const t = r.choices[0]?.message?.content || '';
            if (t.trim()) return t;
          } catch (e: any) { if (signal.aborted) throw e; console.warn(`[SDA] Grok ${m}: ${e.message}`); }
        }
        throw new Error('Grok SDA: empty');
      });

      if (sdaGeminiKey) sdaRacers.push(async (signal) => {
        const { GoogleGenAI } = await import('@google/genai');
        const contents = buildGeminiContents();
        for (const m of ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash']) {
          try {
            const r = await new GoogleGenAI({ apiKey: sdaGeminiKey }).models.generateContent({ model: m, systemInstruction: SDA_SYSTEM, contents, config: { thinkingConfig: { thinkingBudget: 0 } } } as any);
            const t = r.text || '';
            if (t.trim()) return t;
          } catch (e: any) { if (signal.aborted) throw e; console.warn(`[SDA] Gemini ${m}: ${e.message}`); }
        }
        throw new Error('Gemini SDA: empty');
      });

      if (sdaRacers.length > 0) {
        const sdaAcs = sdaRacers.map(() => new AbortController());
        try {
          const sdaWinner = await Promise.any(
            sdaRacers.map((fn, i) => fn(sdaAcs[i].signal).then(text => {
              sdaAcs.forEach((ac, j) => { if (j !== i && !ac.signal.aborted) ac.abort(); });
              console.log(`[SDA] Race won by ${i === 0 ? 'Grok' : 'Gemini'}`);
              return text;
            }))
          );
          if (sdaWinner?.trim()) reply = sdaWinner;
        } catch { console.warn('[SDA] Race (Grok+Gemini) both failed → Vertex/Claude'); }
      }

      // ── Sequential fallback: Vertex → Claude ─────────────────────────────
      if (!reply) {
        try {
          const sdaProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID || '';
          if (!sdaProjectId) throw new Error('No Vertex project ID');
          const { VertexAI } = await import('@google-cloud/vertexai');
          const vertexAI = new VertexAI({ project: sdaProjectId, location: process.env.GOOGLE_CLOUD_REGION || 'us-central1' });
          const contents = buildGeminiContents();
          for (const modelName of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']) {
            try {
              const model = vertexAI.getGenerativeModel({ model: modelName, systemInstruction: { role: 'system', parts: [{ text: SDA_SYSTEM }] } });
              const result = await model.generateContent({ contents });
              reply = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (reply) { console.log(`[SDA] Vertex ${modelName} succeeded`); break; }
            } catch (ve: any) { console.warn(`[SDA] Vertex ${modelName}:`, ve.message); }
          }
        } catch (e: any) { console.warn('[SDA] Vertex err:', e.message); }
      }

      if (!reply) {
        const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
        if (anthropicKey) {
          try {
            const rawBaseURL = process.env.ANTHROPIC_BASE_URL;
            const baseURL = rawBaseURL?.replace(/\/v1\/?$/, '');
            if (baseURL) {
              const { default: OpenAI } = await import('openai');
              const client = new OpenAI({ apiKey: anthropicKey, baseURL });
              const userContent = isImage
                ? [{ type: 'image_url', image_url: { url: `data:${fileType};base64,${fileData}` } }, { type: 'text', text: `[Document: ${fileName}]\n${message}` }]
                : isPDF ? `[PDF attached: ${fileName}]\n${message}` : message;
              for (const model of ['anthropic/claude-sonnet-4.6', 'claude-sonnet-4-6', 'anthropic/claude-3.5-sonnet', 'claude-3-5-sonnet-20241022']) {
                try {
                  const r = await client.chat.completions.create({ model, messages: buildOpenAIMsgs(userContent), max_tokens: 2000 });
                  reply = r.choices[0]?.message?.content || '';
                  if (reply) { console.log(`[SDA] Claude proxy ${model} succeeded`); break; }
                } catch (e: any) { console.warn(`[SDA] Claude proxy ${model}:`, e.message); }
              }
            } else {
              const A = (await import('@anthropic-ai/sdk')).default;
              const userContent = isImage
                ? [{ type: 'image', source: { type: 'base64', media_type: fileType, data: fileData } }, { type: 'text', text: `[Document: ${fileName}]\n${message}` }]
                : isPDF
                ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileData } }, { type: 'text', text: `[PDF Report: ${fileName}]\n${message}` }]
                : message;
              const r = await new A({ apiKey: anthropicKey }).messages.create({
                model: 'claude-3-5-sonnet-20241022', max_tokens: 2000, system: SDA_SYSTEM,
                messages: [...historyForAI, { role: 'user', content: userContent }],
              });
              reply = (r.content.find((c: any) => c.type === 'text') as any)?.text || '';
              if (reply) console.log('[SDA] Claude direct succeeded');
            }
          } catch (e: any) { console.warn('[SDA] Claude err:', e.message); }
        }
      }

      if (!reply) {
        console.error('[SDA] All AI providers failed — returning 503');
        return res.status(503).json({ error: 'AI service unavailable. Please check API keys.' });
      }

      // ── Extract CLINICAL_JSON from reply and persist to session store ──────────
      const clinicalJsonMatch = reply.match(/\[CLINICAL_JSON\]([\s\S]*?)\[\/CLINICAL_JSON\]/);
      if (clinicalJsonMatch) {
        try {
          const x = JSON.parse(clinicalJsonMatch[1].trim());
          if (x.demographics) clinicalEntry.patientData = { ...clinicalEntry.patientData, ...x.demographics };
          if (x.vitals) clinicalEntry.patientData.vitals = { ...(clinicalEntry.patientData.vitals || {}), ...x.vitals };
          if (x.hpi) clinicalEntry.patientData.hpi = x.hpi;
          if (x.chiefComplaint) clinicalEntry.patientData.chiefComplaint = x.chiefComplaint;
          if (x.examination) clinicalEntry.patientData.examination = x.examination;
          for (const k of ['pmh', 'medications', 'allergies', 'investigations', 'differentials'] as const) {
            if ((x as any)[k]?.length) (clinicalEntry.patientData as any)[k] = (x as any)[k];
          }
          if (x.redFlags?.length) {
            for (const f of x.redFlags) if (!clinicalEntry.redFlags.includes(f)) clinicalEntry.redFlags.push(f);
          }
          if (x.stage) clinicalEntry.stage = x.stage;
          console.log(`[SDA] Clinical JSON updated — stage: ${clinicalEntry.stage}, session: ${sdaSessionId}`);
        } catch (e) { console.warn('[SDA] Clinical JSON parse error:', e); }
        reply = reply.replace(/\[CLINICAL_JSON\][\s\S]*?\[\/CLINICAL_JSON\]\s*/g, '').trim();
      }

      // Strip [CASE_COMPLETE] marker from reply before sending to client
      const suggestPDF = reply.includes('[CASE_COMPLETE]');
      const cleanReply = reply.replace(/\[CASE_COMPLETE\]\s*/g, '').trim();

      const redFlags = detectRedFlags(cleanReply);
      const patientUpdate = extractPatientUpdate(cleanReply, message);
      const redFlagDetected = redFlags.length > 0 || /\bRED FLAG\b|\bEMERGENCY\b|\bURGENT\b/i.test(cleanReply);

      // ── Persist exchange to server-side clinical store ───────────────────────
      storedMsgs.push({ role: 'user', content: message, ts: now });
      storedMsgs.push({ role: 'assistant', content: cleanReply, ts: Date.now() });
      if (storedMsgs.length > 100) storedMsgs.splice(0, storedMsgs.length - 100);

      clinicalEntry.patientData = { ...clinicalEntry.patientData, ...patientUpdate };
      for (const flag of redFlags) {
        if (!clinicalEntry.redFlags.includes(flag)) clinicalEntry.redFlags.push(flag);
      }
      if (suggestPDF) clinicalEntry.stage = 'complete';
      clinicalEntry.updatedAt = Date.now();

      return res.json({ reply: cleanReply, redFlagDetected, redFlags, patientUpdate, fileAnalyzed: hasFile ? fileName : null, suggestPDF, sessionId: sdaSessionId });

    } catch (err: any) {
      console.error('[SDA] Error:', err);
      res.status(500).json({ error: err.message });
    }
  });
}
