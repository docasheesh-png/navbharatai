import crypto from 'crypto';
import type { Express } from 'express';
import { AppContextInjector } from '../AppContext/AppContextInjector';
import { extractDocumentText } from '../lib/attachmentText';
import { claudeVisionAnswerModel, grokVisionModels, geminiVisionModels, vertexVisionModels } from '../lib/visionModels';
import { CREATOR_IDENTITY, INDIA_TERRITORIAL_INTEGRITY } from '../lib/prompts';
import { computeClinicalTool, AVAILABLE_CLINICAL_TOOLS } from '../lib/clinical/calculators';
import { retrieveClinicalKnowledge, formatKnowledgeForPrompt } from '../lib/clinical/knowledgeBase';
import { detectRedFlagsAcross } from '../lib/clinical/redFlags';
import { isAuditReplyClean } from '../lib/clinical/auditGate';
import { AIRouterManager } from '../AI/AIRouterManager';
import { verifyFirebaseIdentity } from '../lib/authMiddleware';
import { gateProfessionalTurn, burnFreeMessage, type ProfessionalTier } from '../professionals/passGate';
import { chargeForAiTurn } from '../lib/aiTurnCharge';
import type { ChatTurnUsage } from '../lib/chatSpend';
import { usdInrRate } from '../lib/UsdInrRate';
import { getServerDb } from '../lib/serverDb';
import { detectImageIntent, imageGenGuidance } from '../lib/imageIntent';
import { SessionReportStore, isVisionReportType, referencesAttachedReport } from '../lib/clinical/reportMemory';
import { buildAuditPrompt, buildAuditContents, type AuditReportFile } from '../lib/clinical/reportAudit';

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
// REPORT MEMORY (admin 2026-08-18): the session's recently-sent report files (ECG/X-ray/USG images and
// PDFs), so a follow-up like "lead V2 dekho" can RE-ATTACH the report to the model instead of honestly
// admitting the pipeline dropped it — which is exactly what a real transcript showed. See reportMemory.ts.
const sdaReportStore = new SessionReportStore();
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, entry] of sdaClinicalStore.entries()) {
    if (entry.updatedAt < cutoff) sdaClinicalStore.delete(id);
  }
  for (const [id] of sdaRecentMessages.entries()) {
    if (!sdaClinicalStore.has(id)) sdaRecentMessages.delete(id);
  }
  sdaReportStore.sweep(Date.now());
}, 60 * 60 * 1000);

/**
 * B — independent safety audit: a SECOND model reviews SDA's reply for dangerous
 * errors (wrong dose, missed contraindication, missed red flag, unsafe statement)
 * before it reaches the doctor. Best-effort + fail-open: any error/timeout/missing
 * key returns null (no note) and never blocks the reply.
 */
async function auditSdaReply(
  caseContext: string,
  reply: string,
  geminiKey: string,
  // TREATMENT-GRADE CROSS-CHECK (admin 2026-08-18): when the turn analysed a report, the auditor gets
  // the SAME image/PDF and re-reads it — a text-only audit was checking a reading it could not see.
  reportFile?: AuditReportFile | null,
): Promise<string | null> {
  if (!geminiKey) return null;
  const auditPrompt = buildAuditPrompt(caseContext, reply, !!(reportFile?.fileData));
  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: geminiKey });
    const r: any = await Promise.race([
      ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: buildAuditContents(auditPrompt, reportFile),
        config: { thinkingConfig: { thinkingBudget: 0 } },
      } as any),
      // A little more headroom than the text audit's 12s — the auditor now reads an image too.
      new Promise((_, rej) => setTimeout(() => rej(new Error('audit timeout')), reportFile?.fileData ? 18000 : 12000)),
    ]);
    const text = String(r?.text || r?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    // Drop ONLY an exact "OK" pass — NEVER a warning that merely starts with "OK" (e.g. an overdose note).
    if (isAuditReplyClean(text)) return null;
    return text;
  } catch {
    return null;
  }
}

export function registerSdaRoutes(app: Express): void {
  // Deterministic clinical calculators — exact, coded scores/doses (never LLM math).
  app.post('/api/sda/calc', (req: any, res: any) => {
    try {
      const { tool, inputs } = req.body || {};
      res.json(computeClinicalTool(String(tool || ''), inputs || {}));
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Invalid clinical calculation request.' });
    }
  });

  app.post('/api/sda-chat', async (req: any, res: any) => {
    try {
      let { message, history = [], teachingMode = false, userId, sessionId, fileData, fileType, fileName } = req.body;
      if (!message && !fileData) return res.status(400).json({ error: 'Message required' });
      message = message || 'Please analyze this medical document and extract all relevant clinical findings.';

      // Professional Pass gate — Doctor AI is a professional too (admin 2026-07-15: "Doctor AI = same as
      // all professionals"). Same shared gate as every config-driven professional: 50 free msgs/day
      // (across ALL professionals), Pass ⇒ unlimited, anonymous ⇒ sign in. Flag-off ⇒ no-op (today's
      // behaviour). The verified identity keys the gate — never the client-claimed body userId.
      const sdaIdentity = await verifyFirebaseIdentity(req);
      const sdaGate = await gateProfessionalTurn(sdaIdentity?.uid || null, sdaIdentity?.email || null);
      if (!sdaGate.allow) return res.status(sdaGate.status).json(sdaGate.body);
      const sdaTier: ProfessionalTier = sdaGate.tier;
      // What the answering model reported, filled in by whichever branch below actually answers.
      let sdaSpend: ChatTurnUsage | null = null;

      // IMAGE-GENERATION INTENT (admin 2026-08-02): Doctor AI does not generate images — if the doctor asks
      // it to CREATE a picture (e.g. "draw a diagram of the heart"), point them to the dedicated AI Image
      // Gen tool instead of an unhelpful answer. Skipped when a file is attached (that is a document/image
      // ANALYSIS request, which SDA does handle). No free message is burned.
      if (!fileData && typeof message === 'string' && detectImageIntent(message).wants) {
        return res.json({ reply: imageGenGuidance(), sessionId: sessionId || userId || null });
      }

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

      // ── REPORT MEMORY (admin 2026-08-18) ─────────────────────────────────────
      // A report sent this turn is remembered for the session; a follow-up turn WITHOUT a file that
      // plainly asks about the report gets it RE-ATTACHED, so "ecg me lead V2 dekho" puts the actual
      // ECG in front of the vision model again with the doctor's specific question beside it. Without
      // this, the attachment lived exactly one turn and every follow-up honestly failed ("main image
      // dekh nahi sakta" — the real reported transcript). Generous matching on purpose: a false match
      // costs a fraction of a paisa of cheap vision; a miss reproduces the failure.
      if (fileData && fileType && isVisionReportType(fileType)) {
        sdaReportStore.remember(sdaSessionId, { fileData, fileType, fileName: fileName || 'report' }, now);
      } else if (!fileData && typeof message === 'string' && referencesAttachedReport(message)) {
        const prior = sdaReportStore.latest(sdaSessionId, now);
        if (prior) {
          fileData = prior.fileData;
          fileType = prior.fileType;
          fileName = prior.fileName;
          message = `${message}\n\n[The report "${prior.fileName}" the doctor sent earlier in this session is re-attached above. Answer their question by examining it directly — never say you cannot see it.]`;
        }
      }

      const hasFile = !!(fileData && fileType);
      const isImage = hasFile && fileType.startsWith('image/');
      const isPDF = hasFile && fileType === 'application/pdf';
      // Any non-image, non-PDF file → extract real text (plain text/code AND Word,
      // Excel, PowerPoint, ZIP) via the shared extractor and prepend to the message,
      // so the document is readable by every provider at zero API cost. Images/PDFs
      // keep their native multimodal path below (Gemini/Grok/Vertex/Claude).
      const isDoc = hasFile && !isImage && !isPDF;
      if (isDoc && fileData) {
        const docText = await extractDocumentText({ name: fileName || 'document', type: fileType, base64: fileData });
        if (docText && docText.trim()) {
          message = `[Document: ${fileName}]\n\n${docText}\n\n---\nDoctor's question: ${message}`;
        }
      }

      const SDA_SYSTEM = `You are the Senior Doctor Assistant (SDA) — a Clinical Decision Support AI inside NavBharatAI, designed exclusively for qualified doctors (MBBS, residents, consultants, specialists).

CORE IDENTITY:
- You are NOT a patient-facing chatbot, symptom checker, or general AI.
- You behave like an experienced senior consultant conducting a bedside case discussion with a junior doctor.
- You assist, you never replace. Final decisions always belong to the treating physician.
- Always communicate that you are assisting, not replacing, the doctor.

OPTIMISE FOR PATIENT SAFETY AND THE JUNIOR / RURAL DOCTOR:
- Patient safety is the FIRST priority: never miss a danger sign; when unsure, advise the safer action (escalate/refer) rather than risk harm.
- Always give a clear, explicit "MANAGE HERE vs REFER NOW" decision with the criteria — this is what a junior or rural doctor needs most.
- Teach briefly: add one short line of clinical reasoning ("why") so the junior doctor learns, without slowing things down.
- Prefer affordable, essential (NLEM/WHO) options and give a fallback when a test/drug is unavailable.
- When GROUNDED CLINICAL REFERENCES are provided below, base your advice on them and cite the source; if you go beyond them, say so.

SCOPE — YOU ARE A SENIOR DOCTOR MENTOR, NOT ONLY A CASE ASSISTANT:
A junior/rural doctor may ask about much more than a patient case. FIRST detect what kind of help they need, then respond in the right MODE:
- PATIENT CASE (diagnosis/management of a specific patient) → use the focused clinical workflow below (minimal high-yield questions → working impression → plan). Only this mode takes a history.
- GENERAL HELP (everything else) → answer DIRECTLY and practically as a senior mentor. Do NOT take a patient history or run the case workflow. Categories you fully support:
  • PROCEDURES / how-to: step-by-step technique, indications/contraindications, equipment, complications, and "do this under supervision until competent".
  • GUIDELINES / PROTOCOLS: summarise the current standard/national protocol; cite the source; say if it varies or you are unsure.
  • DRUG INFORMATION: indication, dosing (use the verified calculator for weight-based doses), contraindications, interactions, pregnancy category, monitoring.
  • DOCUMENTATION & MEDICO-LEGAL: discharge summary, referral letter, informed consent, death/MLC certificates, prescriptions — give a clear structure/template, and flag that exact legal requirements vary by state/country and institution → verify locally.
  • COMMUNICATION SKILLS: breaking bad news (SPIKES), counselling, consent conversations, handling difficult patients/relatives.
  • EXAM / CAREER: NEET-PG/USMLE/MRCP study approach, specialty choice, skill-building — give practical, balanced guidance and note it is general advice.
  • WELLBEING / BURNOUT: be supportive and practical, normalise seeking help, and signpost professional support; you are not a substitute for a mental-health professional.
Always: be accurate and concrete, prefer India/NLEM/WHO context where relevant, never fake certainty, and for medico-legal/career/exam answers clearly mark them as general guidance to verify locally. If a query is ambiguous, ask ONE short question to clarify which mode is needed.

EFFICIENCY — THE MOST IMPORTANT RULE:
A senior consultant reaches a working diagnosis with the FEWEST questions, not the most. Be fast and high-yield:
- FIRST, extract everything the doctor has ALREADY told you (age, sex, complaint, duration, vitals, history, investigations) and NEVER re-ask anything already known.
- Ask ONE focused question at a time, but ONLY the single highest-yield question that would actually change the differential, the management, or patient safety. Skip routine/low-yield questions.
- Do NOT run a fixed demographics→history→examination checklist. Only ask demographic / past-history / allergy / examination items that are genuinely RELEVANT to this complaint or to drug safety.
- After 2–4 well-chosen questions — or IMMEDIATELY if enough information is already given — provide a WORKING IMPRESSION with ranked differentials and the next best step. Do not keep interrogating once you can reason usefully.
- If the doctor pastes a full case, or says "just give differentials / assessment / plan / what's next", SKIP questioning and answer directly.
- Never present questionnaires or ask multiple questions in one message.

ADAPTIVE FOCUS (ask only what matters for the presented complaint):
- Screen for red flags FIRST. If a danger sign is present, alert immediately and move to action — do not continue routine history.
- Use complaint-specific high-yield questions only (fever: duration/pattern/travel/danger-signs; chest pain: onset/radiation/exertion/cardiac risk; abdomen: site/character/peritoneal signs; neuro: deficit/onset/consciousness). Adapt to whatever complaint is presented.
- Examination/investigations: ask only for the few findings that would change your top differentials or management — not a full panel.

QUESTIONING RULES:
- Offer structured answer options when it speeds the doctor up (e.g., severity 0–10, anatomical regions).
- For SAFETY-CRITICAL values only, insist on an exact figure (e.g., "Please give the exact SpO2 value, e.g. 94%") — do not nitpick non-critical answers.
- Adapt the next question entirely to the previous answer; never repeat a line of questioning that has been answered.

MEDICAL REPORT & IMAGE ANALYSIS (ECG, X-ray, USG, CT/MRI films, lab reports, prescriptions — ANY report the doctor sends):
- You CAN see and analyse attached images and PDF reports. When a report is attached to this turn — including one re-attached from earlier in this session — examine it DIRECTLY and answer from what is actually visible. NEVER say you cannot see an attached file.
- ALWAYS give a STRUCTURED reading:
  1) Report type + patient identifiers exactly as printed on it (name, age, date) — flag any mismatch with the case being discussed.
  2) SYSTEMATIC findings. ECG: rate, rhythm, axis, intervals (PR/QRS/QTc), then morphology lead by lead where relevant (P, QRS pattern, ST, T). X-ray: systematic anatomical review (e.g. CXR: airway → bones → cardiac silhouette → diaphragm → lung fields → soft tissue). USG/CT/MRI: organ-by-organ as shown. Labs: each value vs reference range, graded.
  3) PROVISIONAL DIAGNOSIS: your working diagnosis with ranked differentials, the evidence for and against each, and how confident you are.
  4) RED FLAGS on the report needing urgent action, stated first and prominently if present.
  5) NEXT STEPS: what to correlate clinically, which confirmatory investigation, and the manage-here vs refer decision.
- You are advising a QUALIFIED DOCTOR: commit to a genuine provisional diagnosis with reasoning — never hide behind "consult a doctor" (they ARE the doctor). It remains provisional and theirs to confirm.
- Be honest about image limits: if a region/lead is blurred or cut off, say WHICH one is unreadable ("V5 is not clearly readable in this image") and interpret the rest — never guess the unreadable part and never let one bad region block the whole reading.
- When the doctor asks about a SPECIFIC part (one lead, one lung zone, one value), look at that exact region of the attached report and describe what is actually there before interpreting it.
- TREATMENT-GRADE DILIGENCE — the doctor may START TREATMENT from your reading, so examine EVERY detail, never skim:
  • Read the report EDGE TO EDGE: headers, patient identifiers, date/time, technical/calibration parameters (ECG: gain, sweep, filters; imaging: view, position, exposure), every lead/zone/organ/value — including the NORMAL ones, stated as normal, so the doctor knows each was actually checked and not skipped.
  • Report every abnormality HOWEVER SMALL, and incidental findings too — a "minor" finding you omit may be the one that changes the treatment.
  • RE-VERIFY every number you quote against what is actually printed on the report before you write it; a transcription slip becomes a wrong dose downstream.
  • If the report carries the machine's own printed interpretation, form YOUR OWN reading first, then compare — and state plainly where you agree and where you disagree with the machine.
  • Before finishing, do one deliberate second pass over the report asking "what did I miss?" — only then give the provisional diagnosis.

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

SCORES & DOSES — SHOW-YOUR-WORKING RULE (arithmetic errors are dangerous):
- For any clinical score (CURB-65, CRB-65, qSOFA, GCS, Wells DVT/PE, CHA2DS2-VASc, eGFR/creatinine clearance, anion gap, Killip, Centor/McIsaac) or weight-based dose: ALWAYS state the EXACT inputs you used and the standard criteria/formula, then give the value — show your working so the doctor can verify every step. Do NOT round loosely or guess a missing input; if one needed input is missing, ask for THAT one input only.
- Before dosing any renally-cleared drug (aminoglycosides, many antibiotics, metformin, DOACs), estimate renal function (Cockcroft-Gault) FIRST and dose-adjust to it.
- The app also ships coded, unit-tested calculators (${AVAILABLE_CLINICAL_TOOLS.join(', ')}) the doctor can run for an independent exact check. Only say a value came from the app's calculator if it actually did — otherwise present it honestly as your own careful calculation from the standard criteria.

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
- CLINICAL SCORES: For qSOFA, GCS, CURB-65/CRB-65, Wells PE/DVT, CHA2DS2-VASc, eGFR (Cockcroft-Gault), anion gap, Killip class, Centor/McIsaac — show the inputs used, step-by-step criteria, the score, its risk band, and the recommended action tier. For scores the app does not compute for you (e.g. SOFA, NIHSS), calculate transparently from the published criteria and say they are your own computation.
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

LANGUAGE — MIRROR THE DOCTOR, NEVER DEFAULT: write your reply in the SAME language they wrote in. Hindi in → Hindi out; English in → English out; Hinglish in → Hinglish out; a regional language in → that same language out. Decide ONLY from their own words — do not default to English (or to Hindi) because NavBharatAI is an Indian product. CLINICAL TERMS STAY IN ENGLISH inside that reply — drug names, doses, units, investigations, diagnoses and red-flag names are written in English exactly as they appear on a prescription or a lab report, because a translated drug name is a patient-safety risk and cannot be looked up. So: explain in THEIR language, name the medicine in English.

CLINICAL NOTE UPDATE — MANDATORY ON EVERY RESPONSE:
At the very START of your response (before your reply to the doctor), output a clinical note block:
[CLINICAL_JSON]
{"demographics":{"age":"...","sex":"...","weight":"..."},"chiefComplaint":"...","hpi":"...","vitals":{"temp":"...","pulse":"...","bp":"...","rr":"...","spo2":"..."},"pmh":[],"medications":[],"allergies":[],"examination":"...","investigations":[],"redFlags":[],"differentials":[],"stage":"demographics|cc|hpi|history|examination|investigations|differential|complete"}
[/CLINICAL_JSON]
Rules: Only include fields collected so far. Merge and UPDATE — never remove previously collected data. Keep values brief (machine-readable, not prose). This block is stripped before the doctor sees it — it is purely for memory continuity across the full case.

IMPORTANT: You are assisting a doctor. Responses must be clinically rigorous, evidence-based, and respectful of physician authority.`;

      // Phase 21 — app self-awareness: append NavBharatAI navigation context ONLY when
      // the doctor asks about the app itself (e.g. "where is history?"). For any clinical
      // message this is empty, so the clinical prompt and behavior are unchanged.
      const sdaAppCtx = AppContextInjector.getRelevantContext(message, 'sda_chat');
      // C — ground the answer in curated safety guidance relevant to THIS case
      // (the message + any recorded complaint/red flags). Patient-safety & junior-
      // doctor focused; the model is told to use and cite these.
      const kbQuery = `${message} ${clinicalEntry.patientData?.chiefComplaint || ''} ${clinicalEntry.redFlags.join(' ')}`;
      const kbBlock = formatKnowledgeForPrompt(retrieveClinicalKnowledge(kbQuery));
      const SDA_SYSTEM_FINAL = [SDA_SYSTEM, sdaAppCtx, kbBlock, INDIA_TERRITORIAL_INTEGRITY, CREATOR_IDENTITY].filter(Boolean).join('\n\n');

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

      // Build AI context: pinned clinical snapshot + last 6 raw exchanges. The
      // snapshot encodes ALL collected patient data in ~200 tokens regardless of
      // session length, so SDA never forgets demographics/symptoms from turn 1.
      const hasClinicalData = Object.keys(clinicalEntry.patientData).length > 0 || clinicalEntry.redFlags.length > 0;
      const clinicalSnapshot = hasClinicalData
        ? JSON.stringify({ patientData: clinicalEntry.patientData, redFlags: clinicalEntry.redFlags, stage: clinicalEntry.stage })
        : null;

      // Rolling context: last 20 turns verbatim; older turns compressed into a
      // summary block so nothing is forgotten even in very long sessions.
      const VERBATIM_TAIL = 20;
      const recentMsgs = storedMsgs.slice(-VERBATIM_TAIL);
      const olderMsgs = storedMsgs.length > VERBATIM_TAIL ? storedMsgs.slice(0, -VERBATIM_TAIL) : [];
      const olderContextEntry: Array<{ role: 'user' | 'assistant'; content: string }> = olderMsgs.length > 0
        ? [
            {
              role: 'user' as const,
              content: `[EARLIER SESSION — ${olderMsgs.length} exchanges before the recent history below]\n` +
                olderMsgs.map(m => `${m.role === 'user' ? 'Dr' : 'SDA'}: ${String(m.content).slice(0, 120)}`).join('\n'),
            },
            { role: 'assistant' as const, content: 'Acknowledged. I have the complete session history.' },
          ]
        : [];

      const historyForAI: Array<{ role: 'user' | 'assistant'; content: string }> = [
        ...(clinicalSnapshot ? [
          { role: 'user' as const, content: `[CASE_CONTEXT]\n${clinicalSnapshot}\n[/CASE_CONTEXT]\nContinue the clinical assessment. Do NOT re-ask anything already recorded in the context above.` },
          { role: 'assistant' as const, content: 'Understood. Full clinical context loaded. Continuing without repeating any question already answered.' },
        ] : []),
        ...olderContextEntry,
        ...recentMsgs.map(m => ({ role: m.role, content: m.content })),
      ];

      let reply = '';

      // ── Shared helpers ───────────────────────────────────────────────────────
      // Build OpenAI-format message list (used by Claude proxy and Grok)
      const buildOpenAIMsgs = (userContent: any) => [
        { role: 'system' as const, content: SDA_SYSTEM_FINAL },
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

      // Grok supports images via vision models but NOT PDFs — skip Grok for PDF files.
      // TIER: Grok is a premium provider — PAID tier only. A free-tier turn uses the cheap providers
      // (Gemini/Vertex) just like every other professional's free tier (admin 2026-07-15).
      if (sdaGrokKey && !isPDF && sdaTier === 'paid') sdaRacers.push(async (signal) => {
        const { default: OpenAI } = await import('openai');
        const c = new OpenAI({ apiKey: sdaGrokKey, baseURL: 'https://api.x.ai/v1' });

        // For images: use current Grok vision-capable models (shared list, env-overridable)
        // For text: use standard Grok-3 models
        const models = isImage ? grokVisionModels() : ['grok-3', 'grok-3-fast'];
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

      // TIER: for a FREE text turn, GLM leads (via the professional-free universe below), exactly like
      // every other professional — so the Gemini-direct racer is PAID-only for text. Vision (image/PDF)
      // still needs Gemini/Vertex on any tier (GLM can't read attachments), so keep it there.
      if (sdaGeminiKey && (sdaTier === 'paid' || isImage || isPDF)) sdaRacers.push(async (signal) => {
        const { GoogleGenAI } = await import('@google/genai');
        const contents = buildGeminiContents();
        for (const m of geminiVisionModels()) {
          try {
            const r = await new GoogleGenAI({ apiKey: sdaGeminiKey }).models.generateContent({ model: m, systemInstruction: SDA_SYSTEM_FINAL, contents, config: { thinkingConfig: { thinkingBudget: 0 } } } as any);
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

      // ── Isolated PROFESSIONAL namespace router (text-only) ────────────────
      // SDA is part of the PROFESSIONAL universe — one isolated, provably-separate
      // universe defined once in AIRouterManager (P0.1). routeRaced fires
      // Grok × Gemini × Vertex concurrently and uses Claude Haiku ONLY if all
      // three fail. Multimodal (image/PDF) requests keep the inline Vertex/Claude
      // path below, which handles attachments.
      if (!reply && !isImage && !isPDF) {
        try {
          const histText = historyForAI
            .map((m: any) => `${m.role === 'user' ? 'Dr' : 'SDA'}: ${m.content}`)
            .join('\n');
          const fallbackPrompt = histText ? `${histText}\nDr: ${message}` : message;
          // TIER: free → GLM-flash (the professional-free universe) leads, EXACTLY like every other
          // professional; if GLM is empty the Vertex fallback below finishes the free chain (GLM → Vertex).
          // Paid → the full race (Grok × Gemini × Vertex → Claude). Never Grok/Claude on the free tier.
          const professionalRouter = AIRouterManager.getRouter(sdaTier === 'free' ? 'professional-free' : 'professional');
          const { response, telemetry } = await professionalRouter.routeRaced(fallbackPrompt, SDA_SYSTEM_FINAL);
          if (telemetry.success && response.content?.trim()) {
            reply = response.content;
            // ONE WALLET: keep what this answer cost so the turn can be charged like any other AI.
            // SDA's other branches (the Grok/Gemini race above, the Vertex/Claude multimodal fallback
            // below) do not report usage, so a turn answered by one of those stays UNMEASURED and is
            // therefore not charged — we never invent a number to bill (see chatSpend.ts).
            sdaSpend = {
              provider: response.provider,
              model: response.model,
              inputTokens: response.usage?.inputTokens,
              outputTokens: response.usage?.outputTokens,
            };
            console.log(`[SDA] Isolated 'professional' universe router succeeded via ${telemetry.provider}`);
          }
        } catch (e: any) { console.warn('[SDA] professional-universe router err:', e.message); }
      }

      // ── Sequential fallback: Vertex → Claude (multimodal-capable safety net) ──
      if (!reply) {
        try {
          const sdaProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID || '';
          if (!sdaProjectId) throw new Error('No Vertex project ID');
          const { VertexAI } = await import('@google-cloud/vertexai');
          const vertexAI = new VertexAI({ project: sdaProjectId, location: process.env.GOOGLE_CLOUD_REGION || 'us-central1' });
          const contents = buildGeminiContents();
          for (const modelName of vertexVisionModels()) {
            try {
              const model = vertexAI.getGenerativeModel({ model: modelName, systemInstruction: { role: 'system', parts: [{ text: SDA_SYSTEM_FINAL }] } });
              const result = await model.generateContent({ contents });
              reply = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (reply) { console.log(`[SDA] Vertex ${modelName} succeeded`); break; }
            } catch (ve: any) { console.warn(`[SDA] Vertex ${modelName}:`, ve.message); }
          }
        } catch (e: any) { console.warn('[SDA] Vertex err:', e.message); }
      }

      // FREE-tier reliability (admin 2026-07-30, "Doctor AI respond nahi kar raha"): a free TEXT turn
      // only had GLM-flash → inline Vertex; when BOTH are down (e.g. a GLM-429 storm with no Vertex
      // project configured) it 503'd and looked "dead". Gemini is explicitly in the free ladder
      // (GLM/Kimi → Vertex/Gemini → …), so add DIRECT Gemini as a sequential free fallback. It fires
      // ONLY when the cheap chain produced nothing, so a normal free turn that GLM answers costs nothing
      // extra. Never Grok/Claude on free. (Image/PDF already reach Gemini via the racer above.)
      if (!reply && sdaTier === 'free' && sdaGeminiKey && !isImage && !isPDF) {
        try {
          const { GoogleGenAI } = await import('@google/genai');
          const contents = buildGeminiContents();
          for (const m of geminiVisionModels()) {
            try {
              const r = await new GoogleGenAI({ apiKey: sdaGeminiKey }).models.generateContent({ model: m, systemInstruction: SDA_SYSTEM_FINAL, contents, config: { thinkingConfig: { thinkingBudget: 0 } } } as any);
              const t = r.text || '';
              if (t.trim()) { reply = t; console.log(`[SDA] Free-tier Gemini fallback ${m} succeeded`); break; }
            } catch (e: any) { console.warn(`[SDA] free Gemini ${m}:`, e.message); }
          }
        } catch (e: any) { console.warn('[SDA] free Gemini fallback err:', e.message); }
      }

      // TIER: Claude is the premium last resort — PAID tier only. A free-tier turn that got no reply
      // from the cheap providers (Gemini/Vertex) fails honestly rather than escalating to a paid model.
      if (!reply && sdaTier === 'paid') {
        const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
        if (anthropicKey) {
          try {
            // Native Anthropic SDK only — the aicredits OpenAI-proxy path removed.
            const A = (await import('@anthropic-ai/sdk')).default;
            const userContent = isImage
              ? [{ type: 'image', source: { type: 'base64', media_type: fileType, data: fileData } }, { type: 'text', text: `[Document: ${fileName}]\n${message}` }]
              : isPDF
              ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileData } }, { type: 'text', text: `[PDF Report: ${fileName}]\n${message}` }]
              : message;
            const r = await new A({ apiKey: anthropicKey }).messages.create({
              model: claudeVisionAnswerModel(), max_tokens: 2000, system: SDA_SYSTEM_FINAL,
              messages: [...historyForAI, { role: 'user', content: userContent }],
            });
            reply = (r.content.find((c: any) => c.type === 'text') as any)?.text || '';
            if (reply) console.log('[SDA] Claude direct succeeded');
          } catch (e: any) { console.warn('[SDA] Claude err:', e.message); }
        }
      }

      if (!reply) {
        // Admin-facing detail stays in the log; the doctor gets an honest, on-brand busy message
        // (never internal provider/key detail — the client now shows this text directly).
        console.error('[SDA] All AI providers failed — returning 503');
        return res.status(503).json({ error: 'Doctor AI is busy right now — please try again in a moment.' });
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

      // B — independent safety audit. Run only on actionable ADVICE (not on a plain
      // follow-up question), to keep cost/latency down. Fail-open, never blocks.
      let finalReply = cleanReply;
      if (process.env.SDA_VERIFY !== '0') {
        const isJustQuestion = cleanReply.trim().endsWith('?') && cleanReply.length < 400;
        const adviceRe = /\b(mg|mcg|ml|dose|dosage|tablet|capsule|syrup|inject|\biv\b|\bim\b|prescrib|treatment|manage|diagnos|differential|administer|refer|admit|start\b|give\b)/i;
        // A turn that analysed a report (image/PDF, sent or re-attached) is ALWAYS audited — the doctor
        // may start treatment from that reading (admin 2026-08-18) — and the auditor gets the SAME file
        // so it re-reads the report itself instead of only sanity-checking the prose.
        const isReportTurn = hasFile && (isImage || isPDF);
        if (!isJustQuestion && (adviceRe.test(cleanReply) || isReportTurn)) {
          const caseContext = `Recorded case data: ${JSON.stringify(clinicalEntry.patientData)}\nRecorded red flags: ${clinicalEntry.redFlags.join(', ') || 'none'}\nDoctor's latest message: ${message}`;
          const audit = await auditSdaReply(
            caseContext, cleanReply, sdaGeminiKey,
            isReportTurn ? { fileData, fileType, fileName: fileName || 'report' } : null,
          );
          if (audit) {
            finalReply = `${cleanReply}\n\n---\n**⚠️ Automated safety cross-check (second AI):**\n${audit}\n\n_This is an automated double-check, not a substitute for your clinical judgment._`;
          }
        }
      }

      // Check both the model's reply AND the clinician's message (as the old inline detector did),
      // but per-text so a number in one can't fuse with a delimiter in the other into a fake vital.
      const redFlags = detectRedFlagsAcross(cleanReply, message);
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

      // A genuinely-answered FREE-tier turn burns one of today's free messages (shared across all
      // professionals + Doctor AI). Never on a paywall block or an error. Best-effort.
      if (sdaGate.countsAgainstFree) burnFreeMessage(sdaGate.uid);
      // ONE WALLET: Doctor AI draws on the same balance as every other assistant and every build.
      // After the answer, never awaited into the response, inert while AI_WALLET_SPEND is off.
      void chargeForAiTurn(
        getServerDb() as any,
        { userId: sdaGate.uid, isFreeListed: sdaGate.isFreeListed, hasActivePass: sdaGate.hasActivePass },
        sdaSpend,
        usdInrRate(),
        Date.now(),
      );
      return res.json({ reply: finalReply, redFlagDetected, redFlags, patientUpdate, fileAnalyzed: hasFile ? fileName : null, suggestPDF, sessionId: sdaSessionId });

    } catch (err: any) {
      // Full detail to the server log (admin diagnostics); a safe, on-brand message to the doctor —
      // the client now shows this `error` text directly, so it must never leak internals.
      console.error('[SDA] Error:', err);
      res.status(500).json({ error: 'Doctor AI hit an unexpected error. Please try again in a moment.' });
    }
  });
}
