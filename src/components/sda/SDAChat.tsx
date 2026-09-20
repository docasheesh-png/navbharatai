import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, AlertTriangle, BookOpen, FileText, User, Stethoscope, ClipboardList, X, Plus, FileSearch, Mic, MicOff, Download, BarChart2, Pill, TestTube, Baby, Zap, Shield, Heart, Navigation, ChevronDown, ChevronUp, Volume2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { DoseCalculator } from './DoseCalculator';
import { loadVials } from '../../lib/vialMemory';
import { dismissKeyboardOnMobile } from '../../lib/dismissKeyboard';
import { ProfessionalVoiceButton } from '../sonic/ProfessionalVoiceButton';
import ReactMarkdown from 'react-markdown';
import { CHAT_MARKDOWN_PLUGINS } from '../../lib/chatMarkdown';
import { isSafeHttpUrl, openInRealBrowser } from '../../lib/linkify';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { sanitizeFirestoreData } from '../../lib/firestoreUtils';
import { escapeHtml } from '../../lib/escapeHtml';
import { newSdaCaseId } from '../../lib/sdaCaseId';
import {
  CASE_DOC_KEY,
  LEGACY_MESSAGES_KEY,
  CASE_ID_KEY,
  CASE_INDEX_KEY,
  isUsableCaseId,
  legacySdaDocId,
  messageKeysFor,
  noteCaseUsed,
  parseCaseIndex,
  perCaseSdaDocId,
  resolveCaseDoc,
  sdaMessagesKey,
} from '../../lib/sdaCaseStore';
import { authJsonHeaders } from '../../lib/authHeaders';
import { AppUpdateChatNotice } from '../AppUpdateChatNotice';
import { initialToolsOpen, saveToolsOpen } from './sdaChrome';
import { useSpeechInput } from '../../hooks/useSpeechInput';
import { ChatToolbar } from '../chat/ChatToolbar';
import { AttachMenu } from '../AttachMenu';
import { autoGrow, resetGrow } from '../../lib/autoGrowTextarea';
import { MessageEditActions } from '../chat/MessageEditActions';
import { filterMessages, enterShouldSend, readSendOnEnter, searchActive } from '../../lib/chatToolbar';
import { deleteMessage, editMessage } from '../../lib/chatMessageActions';

// ── Types ──────────────────────────────────────────────────────────────────

interface SDAMessage {
  id: string;
  text: string;
  sender: 'doctor' | 'sda';
  timestamp: Date;
  isRedFlag?: boolean;
  attachedFile?: { name: string; type: string; dataUrl?: string };
}

interface PatientSnapshot {
  age?: string;
  sex?: string;
  weight?: string;
  chiefComplaint?: string;
  vitals?: { label: string; value: string; alert?: boolean }[];
  redFlags?: string[];
}

interface AttachedFile {
  name: string;
  type: string;
  base64: string;
  preview?: string;
}

interface SDAChatProps {
  userId?: string;
  /**
   * Open THIS case instead of whatever was last open — set when the doctor taps a specific case in
   * History. Without it a History row could only ever say "open Doctor AI", and with one row per case
   * that would be a list where every entry led to the same place.
   */
  openCaseId?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const ACCEPTED_TYPES = 'image/*,.pdf,.jpg,.jpeg,.png,.gif,.webp,.bmp,.txt,.csv,.json,.md,.docx,.xlsx,.xls,.pptx,.zip';
const MAX_FILE_MB = 10;
/**
 * The composer's grow ceiling, in px — the SAME 128 every other chat composer uses (`max-h-32`).
 *
 * It used to be `BASE_HEIGHT * 5` off a 44px minimum height, which is where this box's mismatch with
 * the 36px controls beside it came from. The resting height is now the browser's own one-line height
 * for `rows={1}`, exactly as in `ProfessionalChat`.
 */
const MAX_HEIGHT = 128;

const WELCOME: SDAMessage = {
  id: 'welcome',
  text: `**Namaste, Doctor.**

I am your **Senior Doctor Assistant (SDA)** — a clinical decision support system designed to assist you in structured case evaluation.

I work like an experienced senior consultant sitting beside you, guiding you through a complete, systematic clinical assessment — one step at a time.

**How this works:**
- I will ask you questions one at a time
- Each of your answers shapes my next question
- You can upload lab reports, X-rays, ECGs, or any medical document — I will analyze them
- Use Quick Tools below for scores, drug checks, dosing, protocols, and more
- Final diagnosis and treatment decisions remain entirely yours

---

To begin, please tell me — **what is the patient's age and sex?**

*(Example: 45-year-old male / 28-year-old female)*`,
  sender: 'sda',
  timestamp: new Date(),
};

const QUICK_TOOLS = [
  {
    label: 'Clinical Scores',
    icon: BarChart2,
    color: 'text-info border-blue-800/40 hover:bg-blue-500/10',
    prompt: 'Using all clinical data collected so far, calculate every applicable severity score: SOFA (if sepsis/ICU), qSOFA (sepsis screening), GCS (if neuro), CURB-65 (if pneumonia), Wells score (if PE/DVT suspected), NIHSS (if stroke), Killip class (if cardiac). Show step-by-step calculation, score value, and clinical interpretation with recommended action for each.',
  },
  {
    label: 'Drug Interactions',
    icon: Pill,
    color: 'text-danger border-red-800/40 hover:bg-red-500/10',
    prompt: 'List all medications mentioned in this case (current meds + those being prescribed). Check every combination for drug-drug interactions. For each interaction found: severity (mild/moderate/severe/contraindicated), mechanism, clinical consequence, and management (avoid/monitor/dose adjust). Also check for drug-disease contraindications given this patient\'s comorbidities.',
  },
  {
    label: 'Lab Values',
    icon: TestTube,
    color: 'text-accent-text border-purple-800/40 hover:bg-purple-500/10',
    prompt: 'Interpret all laboratory and investigation values mentioned in this case. For each value: normal range, patient\'s value, whether abnormal (and critically so), clinical significance in this patient\'s context, and what diagnosis or condition it supports. Highlight any critically abnormal values requiring immediate action.',
  },
  {
    label: 'Peds Dosing',
    icon: Baby,
    color: 'text-success border-emerald-800/40 hover:bg-emerald-500/10',
    prompt: 'For this pediatric patient, calculate weight-based doses for all medications being considered. Provide: dose in mg/kg, total dose for this patient\'s weight, frequency, route, maximum dose limit, any renal/hepatic dose adjustments. Use standard pediatric dosing references (BNF for Children / Harriet Lane).',
  },
  {
    label: 'Emergency Protocol',
    icon: Zap,
    color: 'text-warn border-orange-800/40 hover:bg-orange-500/10',
    prompt: 'Based on this clinical picture, provide the immediate emergency management protocol. Include: triage priority, ABCDE approach, immediate stabilization steps, monitoring parameters, emergency medications with doses/timing, which emergency bundles to activate (sepsis 3-hour bundle, STEMI protocol, stroke pathway, anaphylaxis etc.), and ICU escalation criteria.',
  },
  {
    label: 'Antibiotic Guide',
    icon: Shield,
    color: 'text-success border-teal-800/40 hover:bg-teal-500/10',
    prompt: 'Provide evidence-based antibiotic recommendations for this infection. Include: suspected organism(s), first-line antibiotic (drug, dose, frequency, route, duration), second-line alternative, allergy substitution, empirical vs targeted therapy, culture-sensitivity adjustment strategy, de-escalation criteria, and antibiotic stewardship points to minimize resistance.',
  },
  {
    label: 'Pregnancy Safety',
    icon: Heart,
    color: 'text-accent-text border-pink-800/40 hover:bg-pink-500/10',
    prompt: 'For all medications being considered in this case, provide complete pregnancy safety information: FDA pregnancy category (A/B/C/D/X), specific teratogenic risks by trimester, breast milk transfer and infant risk, safer alternatives if category C/D/X, and dose adjustments in pregnancy. Note any pregnancy-specific management changes for this condition.',
  },
  {
    label: 'Refer?',
    icon: Navigation,
    color: 'text-accent-text border-indigo-800/40 hover:bg-indigo-500/10',
    prompt: 'Based on the complete clinical picture, make a referral decision: Should this patient be referred or managed here? If referral: which specialty, urgency (emergency/urgent within 24h/routine/elective), reason for referral, pre-referral workup to complete, and full content for the referral letter. If managing locally: define clear escalation criteria that would trigger referral.',
  },
];

// ── PDF Generator ──────────────────────────────────────────────────────────

// esc() covers the case-PDF interpolations (filename / patient fields / red-flags) that mdToHtml —
// which only escapes message TEXT — does not. The PDF is written into a same-origin popup, so an
// unescaped `<img onerror=…>` in any of them would execute there and could read platform auth tokens.
const esc = escapeHtml;

const mdToHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3 style="font-size:13px;color:#065f46;margin:10px 0 4px">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:15px;color:#065f46;margin:12px 0 6px">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-size:17px;color:#064e3b;margin:14px 0 8px">$1</h1>')
    .replace(/^- (.+)$/gm, '<li style="margin:3px 0">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li style="margin:3px 0"><strong>$1.</strong> $2</li>')
    .replace(/---/g, '<hr style="border:0;border-top:1px solid #e5e7eb;margin:12px 0">')
    .replace(/\n\n/g, '</p><p style="margin:8px 0">')
    .replace(/\n/g, '<br>');

const buildCasePDF = (
  messages: SDAMessage[],
  patient: PatientSnapshot,
  redFlags: string[]
): string => {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const conversationHTML = messages
    .filter(m => m.id !== 'welcome')
    .map(m => {
      const isDoc = m.sender === 'doctor';
      const role = isDoc ? 'Doctor' : 'Senior Doctor Assistant (SDA)';
      const bg = isDoc ? '#f0f7ff' : '#f0fdf4';
      const border = isDoc ? '#93c5fd' : '#6ee7b7';
      const fileTag = m.attachedFile
        ? `<div style="font-size:11px;color:#6b7280;margin-bottom:6px;padding:4px 8px;background:#f9fafb;border-radius:4px;border:1px solid #e5e7eb">📎 ${esc(m.attachedFile.name)}</div>`
        : '';
      return `
        <div style="margin-bottom:14px;padding:12px 14px;background:${bg};border-left:3px solid ${border};border-radius:6px;page-break-inside:avoid">
          <p style="font-size:9px;font-weight:700;color:#6b7280;margin:0 0 6px;text-transform:uppercase;letter-spacing:1px">${role} · ${m.timestamp instanceof Date ? m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</p>
          ${fileTag}
          <div style="font-size:12px;color:#1f2937;line-height:1.65"><p style="margin:0">${mdToHtml(m.text)}</p></div>
        </div>`;
    }).join('');

  const patientHTML = (patient.age || patient.sex || patient.chiefComplaint) ? `
    <div style="margin-bottom:20px">
      <h2 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#065f46;border-bottom:2px solid #065f46;padding-bottom:4px;margin-bottom:10px">Patient Summary</h2>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        ${patient.age ? `<tr><td style="padding:4px 8px;color:#6b7280;font-weight:600;width:120px">Age</td><td style="padding:4px 8px">${esc(patient.age)}</td></tr>` : ''}
        ${patient.sex ? `<tr><td style="padding:4px 8px;color:#6b7280;font-weight:600">Sex</td><td style="padding:4px 8px">${esc(patient.sex)}</td></tr>` : ''}
        ${patient.weight ? `<tr><td style="padding:4px 8px;color:#6b7280;font-weight:600">Weight</td><td style="padding:4px 8px">${esc(patient.weight)}</td></tr>` : ''}
        ${patient.chiefComplaint ? `<tr><td style="padding:4px 8px;color:#6b7280;font-weight:600">Chief Complaint</td><td style="padding:4px 8px;color:#065f46;font-weight:600">${esc(patient.chiefComplaint)}</td></tr>` : ''}
      </table>
      ${redFlags.length > 0 ? `<div style="margin-top:8px;padding:8px 12px;background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;font-size:11px"><strong style="color:#dc2626">⚠ Red Flags Identified:</strong> ${redFlags.map(esc).join(' · ')}</div>` : ''}
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Clinical Case Report — ${dateStr}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Times New Roman', Georgia, serif; margin: 0; padding: 0; color: #1f2937; background: #fff; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="background:#1a1a1a;padding:12px 24px;display:flex;justify-content:space-between;align-items:center">
    <span style="color:#fff;font-size:14px;font-family:sans-serif">Clinical Case Report — Preview</span>
    <button onclick="window.print()" style="background:#065f46;color:#fff;border:0;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:13px;font-family:sans-serif">🖨️ Print / Save as PDF</button>
  </div>
  <div style="max-width:800px;margin:0 auto;padding:32px">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#064e3b,#065f46);color:#fff;padding:24px 32px;border-radius:10px 10px 0 0;margin-bottom:0">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <h1 style="margin:0;font-size:22px;font-weight:700;letter-spacing:.5px">Clinical Case Report</h1>
          <p style="margin:4px 0 0;font-size:11px;opacity:.8">Senior Doctor Assistant (SDA) · NavBharatAI Clinical Decision Support</p>
        </div>
        <div style="text-align:right;font-size:11px;opacity:.8">
          <p style="margin:0">${dateStr}</p>
          <p style="margin:2px 0 0">${timeStr}</p>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div style="border:1px solid #e5e7eb;border-top:0;border-radius:0 0 10px 10px;padding:28px 32px">
      ${patientHTML}

      <div>
        <h2 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#065f46;border-bottom:2px solid #065f46;padding-bottom:4px;margin-bottom:16px">Clinical Case Transcript</h2>
        ${conversationHTML || '<p style="color:#9ca3af;font-style:italic;font-size:12px">No clinical data recorded.</p>'}
      </div>

      <div style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;line-height:1.6">
        <strong style="color:#6b7280">DISCLAIMER:</strong> This report was generated by NavBharatAI Senior Doctor Assistant (SDA), an AI-powered clinical decision support tool. This document is intended exclusively for qualified medical professionals. All clinical decisions, diagnoses, and treatment plans remain the sole responsibility of the treating physician. This report does not constitute a legal or binding medical document.
      </div>
    </div>
  </div>
</body>
</html>`;
};

// ── Component ──────────────────────────────────────────────────────────────

export const SDAChat: React.FC<SDAChatProps> = ({ userId, openCaseId }) => {
  const [messages, setMessages] = useState<SDAMessage[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  // Shared composer toolbar state (admin 2026-08-10). The Enter preference is read from the ONE key
  // every AI uses, so changing it on any screen changes it here too — that is the point of unifying.
  const [sendOnEnter, setSendOnEnter] = useState<boolean>(() => readSendOnEnter((k) => localStorage.getItem(k)));
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [teachingMode, setTeachingMode] = useState(false);
  // 💊 The newborn dose calculator (admin 2026-08-28) — a form, so the chat's failure modes cannot reach it.
  const [showDoseCalc, setShowDoseCalc] = useState(false);
  const [showPatientPanel, setShowPatientPanel] = useState(true);
  // Quick Tools: the doctor's hide/show choice is REMEMBERED (it used to reset open on every mount,
  // so "hide" had to be re-done every visit — see sdaChrome.ts). Default: closed on a phone, open on
  // a wide screen. Lazy initializer so storage is read once, not on every render.
  const [showTools, setShowTools] = useState<boolean>(() =>
    initialToolsOpen(
      typeof window !== 'undefined' ? window.localStorage : null,
      typeof window !== 'undefined' ? window.innerWidth : 1024,
    ),
  );
  const toggleTools = useCallback(() => {
    setShowTools((prev) => {
      const next = !prev;
      saveToolsOpen(typeof window !== 'undefined' ? window.localStorage : null, next);
      return next;
    });
  }, []);
  const [patient, setPatient] = useState<PatientSnapshot>({});
  const [activeRedFlags, setActiveRedFlags] = useState<string[]>([]);
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  /**
   * The last REPORT (image/PDF) sent in this case — the client's own copy.
   *
   * The server remembers reports in memory so follow-ups can re-examine them, but it runs on several
   * instances that recycle on every deploy, so a follow-up can legitimately reach a server that never
   * held the file. When that happens the server says so (`reportResendNeeded`) and we silently re-send
   * this copy with the same question. That keeps the guarantee absolute without storing anyone's
   * medical images in a database.
   */
  const lastReportRef = useRef<AttachedFile | null>(null);
  // Mic renders only where the Web Speech API exists — absent on iOS/iPadOS WKWebView so it is never a
  // dead "unresponsive" button (Apple App Review 2.1(a), 2026-08-02). See src/lib/voiceInput.ts.
  const [suggestPDF, setSuggestPDF] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; name: string } | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Gates the Firestore autosave effect until the cross-device fetch (below) has
  // finished — otherwise a stale local case could overwrite a newer one mid-fetch.
  const hydratedRef = useRef(false);

  // Per-CASE session id (clinical-safety isolation). Persisted so a mid-case reload keeps the SAME
  // case (the server's clinical store survives); rotated in startNewCase() so a new patient never
  // inherits the previous patient's clinical context under the same doctor's userId.
  const caseIdRef = useRef<string>('');
  // STOP support (admin 2026-08-13) — Doctor AI waits for one full reply; without an abortable request the
  // user could not cancel a wrong query. abortRef cancels the in-flight fetch; stoppedRef marks a
  // deliberate stop so the catch stays silent instead of showing "service unavailable".
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);
  /**
   * The document THIS case reads and writes. Resolved once the legacy row has been looked for (see the
   * cross-device effect below) and then held, because for the one case that was open when per-case
   * documents shipped the answer is the LEGACY row — which no amount of re-deriving from the case id
   * could produce.
   */
  const caseDocRef = useRef<string>('');
  const boundToLegacyRef = useRef(false);

  /**
   * 🔑 TWO IDENTITIES, AND CONFLATING THEM ORPHANS A CASE.
   *
   * `caseIdRef` is the CASE — this patient, this History row, this document. It rotates only when the
   * doctor starts a new case.
   *
   * `clinicalSessionRef` is what the SERVER keys its clinical store on. It rotates far more often: an
   * edit or a delete calls `rewindCase`, which deliberately abandons the accumulated clinical state so
   * a retracted finding cannot survive in it.
   *
   * They used to be one ref, which was correct while the document id was a constant. The moment the
   * document is addressed BY the case, a rewind would move the patient to a new address every time the
   * doctor corrected a typo — orphaning the row their case was already in. Two names, because they
   * answer two questions.
   */
  const clinicalSessionRef = useRef<string>('');

  if (!caseIdRef.current) {
    // `openCaseId` wins: the doctor tapped a specific case in History and expects THAT patient.
    let id = isUsableCaseId(openCaseId) ? (openCaseId as string) : '';
    if (!id) {
      try { id = localStorage.getItem(CASE_ID_KEY) || ''; } catch { /* ignore */ }
    }
    // A stored id is validated, not trusted — it is about to become a Firestore path segment, and a
    // '/' in one addresses a different collection instead of failing (see isUsableCaseId).
    if (!isUsableCaseId(id)) id = newSdaCaseId();
    try { localStorage.setItem(CASE_ID_KEY, id); } catch { /* ignore */ }
    caseIdRef.current = id;
    clinicalSessionRef.current = id;

    // A case opened BY ID from History is per-case by definition — its row is a per-case row, so the
    // legacy binding cannot apply to it and no lookup is needed.
    if (isUsableCaseId(openCaseId) && userId) {
      caseDocRef.current = perCaseSdaDocId(userId, id);
      try { localStorage.setItem(CASE_DOC_KEY, caseDocRef.current); } catch { /* ignore */ }
    } else {
      try { caseDocRef.current = localStorage.getItem(CASE_DOC_KEY) || ''; } catch { /* ignore */ }
      boundToLegacyRef.current = !!userId && caseDocRef.current === legacySdaDocId(userId);
    }
  }

  /**
   * Remember this case on the device and drop the transcripts that fell off the end. The Firestore row
   * is the durable copy and is never pruned, so an evicted transcript costs a fetch, never a case.
   */
  const rememberCaseLocally = (caseId: string) => {
    try {
      const { index, evictedKeys } = noteCaseUsed(parseCaseIndex(localStorage.getItem(CASE_INDEX_KEY)), caseId);
      localStorage.setItem(CASE_INDEX_KEY, JSON.stringify(index));
      for (const key of evictedKeys) localStorage.removeItem(key);
    } catch { /* quota or private mode — the screen is still correct for this session */ }
  };

  // Restore THIS case's transcript from the device on mount (handles 1-2 hour gaps without reload).
  // `messageKeysFor` offers the pre-migration key as a fallback ONLY for a case bound to the legacy
  // row — a brand-new case falling back to it would open the new patient on the previous patient's
  // transcript, which is exactly the clinical-safety failure the per-case id exists to prevent.
  useEffect(() => {
    try {
      for (const key of messageKeysFor(caseIdRef.current, boundToLegacyRef.current)) {
        const saved = localStorage.getItem(key);
        if (!saved) continue;
        const parsed: SDAMessage[] = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 1) {
          setMessages(parsed.map(m => ({ ...m, timestamp: new Date(m.timestamp) })));
          break;
        }
      }
    } catch { /* ignore corrupt storage */ }
    rememberCaseLocally(caseIdRef.current);
    if (!userId) hydratedRef.current = true;
  }, []);

  // Persist this case's transcript under ITS OWN key (skip if only the welcome message). The
  // pre-migration key is never written again, so no two cases can ever share a transcript.
  useEffect(() => {
    if (messages.length > 1) {
      try {
        localStorage.setItem(sdaMessagesKey(caseIdRef.current), JSON.stringify(messages.slice(-150)));
      } catch { /* quota */ }
    }
  }, [messages]);

  /**
   * Cross-device resume, and the MIGRATION, in one pass — because they ask the same question: which
   * document is this case in?
   *
   * The per-case document is looked for first. Only when there is none is the pre-migration
   * `sda_<userId>` row consulted, and if it holds a real conversation this case BINDS to it: the old
   * row keeps its place in History with its history intact, and nothing is copied, duplicated or
   * deleted. Every case after this one is per-case from birth. See `resolveCaseDoc` for why a binding
   * beats a copy.
   */
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const perCase = perCaseSdaDocId(userId, caseIdRef.current);
        let snap = caseDocRef.current === legacySdaDocId(userId)
          ? null
          : await getDoc(doc(db, 'chat_sessions', perCase));

        if (!snap || !snap.exists()) {
          const legacySnap = await getDoc(doc(db, 'chat_sessions', legacySdaDocId(userId)));
          const legacyHasCase = legacySnap.exists() && Array.isArray(legacySnap.data()?.messages)
            && legacySnap.data()!.messages.length > 1;
          const resolved = resolveCaseDoc({
            userId,
            caseId: caseIdRef.current,
            storedDocId: caseDocRef.current || null,
            legacyExists: legacyHasCase,
          });
          caseDocRef.current = resolved.docId;
          boundToLegacyRef.current = resolved.boundToLegacy;
          if (resolved.shouldPersist) {
            try { localStorage.setItem(CASE_DOC_KEY, resolved.docId); } catch { /* ignore */ }
          }
          if (resolved.boundToLegacy) snap = legacySnap;
        } else {
          caseDocRef.current = perCase;
          boundToLegacyRef.current = false;
          try { localStorage.setItem(CASE_DOC_KEY, perCase); } catch { /* ignore */ }
        }

        if (snap && snap.exists()) {
          const data = snap.data();
          const remoteMessages: SDAMessage[] = Array.isArray(data.messages)
            ? data.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
            : [];
          if (remoteMessages.length > 1) {
            const remoteUpdated = data.lastUpdated ? new Date(data.lastUpdated).getTime() : 0;
            let localUpdated = 0;
            try {
              const saved = localStorage.getItem(sdaMessagesKey(caseIdRef.current))
                ?? (boundToLegacyRef.current ? localStorage.getItem(LEGACY_MESSAGES_KEY) : null);
              if (saved) {
                const parsed = JSON.parse(saved);
                const last = parsed[parsed.length - 1];
                if (last?.timestamp) localUpdated = new Date(last.timestamp).getTime();
              }
            } catch { /* ignore */ }
            if (remoteUpdated > localUpdated) {
              setMessages(remoteMessages);
              if (data.patientSnapshot) setPatient(data.patientSnapshot);
              if (Array.isArray(data.redFlags)) setActiveRedFlags(data.redFlags);
            }
          }
        }
      } catch (err) {
        console.error('SDA Firestore restore error:', err);
      } finally {
        hydratedRef.current = true;
      }
    })();
  }, [userId]);

  // Debounced Firestore autosave — mirrors Free/Pro chat persistence so SDA cases
  // show up in History and resume correctly across devices.
  useEffect(() => {
    if (!userId || !hydratedRef.current || messages.length < 2) return;
    const t = setTimeout(() => {
      // The document this case is bound to. Falling back to the per-case id (rather than to the old
      // shared one) means that if the resolve effect has not finished, the worst case is a new row —
      // never a write on top of another case.
      const docId = caseDocRef.current || perCaseSdaDocId(userId, caseIdRef.current);
      setDoc(doc(db, 'chat_sessions', docId), sanitizeFirestoreData({
        id: docId,
        uci: docId,
        userId,
        tab: 'sda_chat',
        original_agent: 'sda',
        current_agent: 'sda',
        title: patient.chiefComplaint || patient.age ? `SDA Case: ${patient.age || ''} ${patient.sex || ''} — ${patient.chiefComplaint || 'Ongoing'}`.trim() : 'SDA Case',
        memory_summary: '',
        restoredMessages: [],
        messages: messages.slice(-150).map(m => ({
          id: m.id,
          text: m.text,
          sender: m.sender,
          timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
          isRedFlag: m.isRedFlag || false,
          attachedFile: m.attachedFile || null,
        })),
        files: {},
        lastUpdated: new Date().toISOString(),
        isPinned: false,
        mode: 'sda',
        patientSnapshot: patient,
        redFlags: activeRedFlags,
      })).catch(err => console.error('SDA Firestore autosave error:', err));
    }, 1200);
    return () => clearTimeout(t);
  }, [messages, patient, activeRedFlags, userId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /**
   * The composer's grow/reset, from the SHARED helper (rule 2 — centralize a drifted copy).
   *
   * This file carried its own three-line `autoResize`, byte-for-byte the body of `autoGrow`, written
   * before `lib/autoGrowTextarea.ts` existed. Two copies of a sizing rule is how one composer ends up
   * behaving differently from every other — which is the defect this whole change is fixing.
   */
  const autoResize = (el: HTMLTextAreaElement) => autoGrow(el, MAX_HEIGHT);

  // ── Voice Input ──────────────────────────────────────────────────────────

  // Shared hook (hooks/useSpeechInput.ts) -- this screen carried the same defect the admin reported
  // in the free chat on 2026-08-13: it joined the whole results list, which on Android glues every
  // revision of the sentence together, and it pinned lang to 'en-IN' so a patient describing symptoms
  // in Hindi was transcribed by an English recogniser. Both now live in one place.
  const { supported: voiceSupported, listening: isListening, toggle: toggleVoice } = useSpeechInput(
    useCallback((text: string) => {
      setInput(text);
      if (inputRef.current) autoResize(inputRef.current);
    }, []),
  );

  // ── PDF ──────────────────────────────────────────────────────────────────

  const generatePDF = () => {
    const html = buildCasePDF(messages, patient, activeRedFlags);
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(() => win.print(), 600);
    }
  };

  // ── File Select ──────────────────────────────────────────────────────────

  // REPORT-GRADE IMAGE QUALITY (admin 2026-08-19: "har chhoti bariki dhyan se dekh kar reply kare").
  //
  // Every image attached HERE is a medical report — an ECG's twelve traces across one wide strip, or an
  // X-ray. At the old 1568px / JPEG 0.85 those thin lines smear: a 1mm ST shift or a small q wave can be
  // compression artefact rather than signal, and the doctor may start treatment from that reading. So
  // report images keep 2400px and quality 0.92. The payload grows to roughly 1-2 MB, which is nothing
  // against a wrong reading, and the model still sees a single image so the token cost barely moves.
  const downscaleImage = (file: File, maxDim = 2400, quality = 0.92): Promise<{ base64: string; type: string; preview: string }> =>
    new Promise(resolve => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          if (scale === 1 && file.size <= 2 * 1024 * 1024) {
            URL.revokeObjectURL(url);
            const r = new FileReader();
            r.onload = () => { const res = r.result as string; resolve({ base64: res.split(',')[1] || '', type: file.type, preview: res }); };
            r.readAsDataURL(file);
            return;
          }
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('no ctx');
          ctx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve({ base64: dataUrl.split(',')[1] || '', type: 'image/jpeg', preview: dataUrl });
        } catch {
          URL.revokeObjectURL(url);
          const r = new FileReader();
          r.onload = () => { const res = r.result as string; resolve({ base64: res.split(',')[1] || '', type: file.type, preview: res }); };
          r.readAsDataURL(file);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        const r = new FileReader();
        r.onload = () => { const res = r.result as string; resolve({ base64: res.split(',')[1] || '', type: file.type, preview: res }); };
        r.readAsDataURL(file);
      };
      img.src = url;
    });

  /**
   * Accept ONE picked file, whichever door it came through.
   *
   * It used to take the change EVENT of this screen's own hidden `<input type="file">`, which is why
   * the camera was never offered here: that input opened the file browser directly. The shared
   * `AttachMenu` (camera / gallery / file) hands over a `FileList`, so the logic now takes a `File`
   * and `handleFiles` adapts. A doctor photographing an X-ray or an ECG strip is the single most
   * likely attachment on this screen, and it was the one option the paperclip did not have.
   */
  const handleFiles = (files: FileList | null) => { const f = files?.[0]; if (f) void acceptFile(f); };

  const acceptFile = async (file: File) => {
    // Images get downscaled (so the 10MB cap rarely matters); docs are capped raw
    if (!file.type.startsWith('image/') && file.size > MAX_FILE_MB * 1024 * 1024) {
      alert(`File too large. Max ${MAX_FILE_MB}MB allowed for documents.`);
      return;
    }
    if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
      const { base64, type, preview } = await downscaleImage(file);
      setAttachedFile({ name: file.name.replace(/\.(png|webp|gif|bmp|heic|heif)$/i, '.jpg'), type, base64, preview });
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1] || '';
        const preview = file.type.startsWith('image/') ? result : undefined;
        setAttachedFile({ name: file.name, type: file.type, base64, preview });
      };
      reader.readAsDataURL(file);
    }
  };

  /**
   * Adapter to the shared delete/edit rules. Doctor AI's own senders are 'doctor' (the user) and
   * 'sda' (the assistant); the shared module speaks 'user'/'ai'. Ids already exist here, so unlike
   * the professionals this one is a straight rename.
   */
  const withIds = (list: readonly SDAMessage[]) => list.map((m) => ({
    id: m.id,
    sender: (m.sender === 'doctor' ? 'user' : 'ai') as 'user' | 'ai',
    text: m.text,
  }));

  /**
   * Apply a rewind (a delete or an edit) to the case — and make it TRUE on the server, not just on
   * screen.
   *
   * THIS IS THE WHOLE REASON DOCTOR AI NEEDED SPECIAL CARE. `/api/sda-chat` keeps a per-case clinical
   * store: `patientData` and `redFlags` are ACCUMULATED from each reply and merged into one blob —
   * they are never re-derived from the transcript. So removing a bubble on the client would leave the
   * finding it produced still live in the AI's reasoning. The doctor would believe they had retracted
   * something, and the assistant would carry on treating it as fact. That is a clinical-safety bug,
   * not a UI one, and shipping the button without this would have been exactly the kind of
   * "looks done, does nothing" feature the rules forbid.
   *
   * Rotating the case id abandons that accumulation: the next turn finds no entry for the new id, so
   * the server starts a fresh clinical store and re-seeds its memory from the history the client
   * sends — which is now the SURVIVING transcript. The accumulated state is rebuilt from what is left
   * rather than inherited from what was removed.
   *
   * It errs toward FORGETTING (the rebuilt state may lag by a turn or two) and that is the safe
   * direction on purpose: the doctor is present and can restate anything that matters, whereas a
   * silently-retained retracted finding is the failure nobody can see.
   */
  const rewindCase = (surviving: ReadonlyArray<{ id: string }>) => {
    const keep = new Set(surviving.map((m) => m.id));
    const next = messages.filter((m) => keep.has(m.id));
    setMessages(next);
    setActiveRedFlags([]); // derived from turns that may no longer exist — never carry them over
    // Only the CLINICAL session rotates. This is the same patient — rotating the CASE id here would
    // move them to a new document (and a new History row) every time a typo was corrected, orphaning
    // the row the case is already in. See the two-identities note on `clinicalSessionRef`.
    clinicalSessionRef.current = newSdaCaseId();
    try {
      localStorage.setItem(sdaMessagesKey(caseIdRef.current), JSON.stringify(next));
    } catch { /* private mode — the screen is still correct for this session */ }
    return next;
  };

  // ── Send ─────────────────────────────────────────────────────────────────

  /**
   * `baseTranscript` is the transcript an EDIT/DELETE rewind just produced. It has to be passed in
   * rather than read from state: `setMessages` does not update the `messages` this closure captured,
   * so a re-ask fired straight after a rewind would send the server the turns the doctor had just
   * taken back — the exact opposite of what they asked for, and on a clinical surface that is not a
   * cosmetic bug. It replaces BOTH the list appended to and the history sent upstream.
   */
  const handleSend = async (overrideText?: string, baseTranscript?: SDAMessage[]) => {
    const text = (overrideText ?? input).trim();
    if ((!text && !attachedFile) || loading) return;
    const base = baseTranscript ?? messages;

    setInput('');
    if (inputRef.current) resetGrow(inputRef.current);
    setSuggestPDF(false);

    const fileForMsg = attachedFile;
    setAttachedFile(null);
    // Keep our own copy of a report so a server that never held it can ask us to re-send (see lastReportRef).
    if (fileForMsg?.base64 && (fileForMsg.type.startsWith('image/') || fileForMsg.type === 'application/pdf')) {
      lastReportRef.current = fileForMsg;
    }

    const displayText = text || (fileForMsg ? `📎 ${fileForMsg.name}` : '');
    const userMsg: SDAMessage = {
      id: Date.now().toString(),
      text: displayText,
      sender: 'doctor',
      timestamp: new Date(),
      attachedFile: fileForMsg ? {
        name: fileForMsg.name,
        type: fileForMsg.type,
        // dataUrl already computed when file was attached (downscaleImage / FileReader)
        dataUrl: fileForMsg.preview || (fileForMsg.base64 ? `data:${fileForMsg.type};base64,${fileForMsg.base64}` : undefined),
      } : undefined,
    };
    // A rewind hands us the exact surviving transcript, so append to THAT; a normal send still uses
    // the functional form so it cannot clobber a message that arrived while this one was being typed.
    if (baseTranscript) setMessages([...base, userMsg]);
    else setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    stoppedRef.current = false;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const history = base.map(m => ({
        role: m.sender === 'doctor' ? 'user' : 'assistant',
        content: m.text,
      }));

      const postTurn = async (file: AttachedFile | null) => fetch('/api/sda-chat', {
        method: 'POST',
        signal: controller.signal,
        // Send the verified Firebase ID token so the server resolves a REAL identity for the Professional
        // Pass gate. Without it (the bug: this fetch sent only Content-Type), a SIGNED-IN doctor was seen
        // as anonymous → "Please sign in to use the Professionals" even though they were logged in.
        headers: await authJsonHeaders(),
        body: JSON.stringify({
          message: text || 'Please analyze this medical document and extract all relevant clinical findings.',
          history,
          teachingMode,
          userId,
          // Isolate this patient's clinical store (server keys on sessionId; without it every case for
          // one doctor would share the userId key and contaminate each other).
          sessionId: clinicalSessionRef.current,
          fileData: file?.base64 || null,
          fileType: file?.type || null,
          fileName: file?.name || null,
          // The vials this device knows (💊 calculator / taught in chat), so a dose asked in THIS chat
          // comes back with mL too. Concentrations only — nothing about any patient.
          vials: loadVials(),
        }),
      });

      let res = await postTurn(fileForMsg);

      // Surface the server's REAL reason instead of a blanket "unavailable" (which made a sign-in
      // prompt, a free-limit paywall, or a keys/busy error all look identically like "not responding").
      if (!res.ok) {
        const errData = await res.json().catch(() => ({} as { error?: string; code?: string }));
        const honest = errData?.error
          || (res.status === 401 ? 'Please sign in to use Doctor AI — new users get free messages every day.'
            // This is only the FALLBACK wording — the server almost always sends its own `error`, and
            // that one now names the real cause (an empty balance vs a used-up daily allowance). It no
            // longer offers the Professional Pass, which was removed on 2026-08-10 and could never be
            // bought in the first place.
            : res.status === 402 ? 'You have used your free messages for today, or your balance is empty. Add credit to carry on.'
            : res.status === 429 ? 'Doctor AI is busy right now — please try again in a few seconds.'
            : 'Doctor AI could not respond right now. Please try again in a moment.');
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          text: `⚠️ ${honest}`,
          sender: 'sda',
          timestamp: new Date(),
        }]);
        return;
      }
      let data = await res.json();

      // THE MEMORY MISS. The doctor asked about a report this server no longer holds (a different
      // instance, or a deploy in between). We still have the file, so re-send the same question with it
      // attached — the doctor sees one answer, never "I cannot see the image". Exactly ONE retry, so a
      // server that keeps missing can never put the client in a loop.
      if (data?.reportResendNeeded && lastReportRef.current?.base64 && !fileForMsg) {
        const retry = await postTurn(lastReportRef.current);
        if (retry.ok) {
          const retryData = await retry.json().catch(() => null);
          if (retryData?.reply) { res = retry; data = retryData; }
        }
      }

      const sdaMsg: SDAMessage = {
        id: (Date.now() + 1).toString(),
        text: data.reply || 'Unable to process.',
        sender: 'sda',
        timestamp: new Date(),
        isRedFlag: data.redFlagDetected,
      };
      setMessages(prev => [...prev, sdaMsg]);

      if (data.redFlags?.length) {
        setActiveRedFlags(prev => [...new Set([...prev, ...data.redFlags])]);
      }
      if (data.patientUpdate) {
        setPatient(prev => ({ ...prev, ...data.patientUpdate }));
      }
      if (data.suggestPDF) {
        setSuggestPDF(true);
      }
    } catch (err: any) {
      // A deliberate Stop is not an error — stay silent (the reply is simply not shown).
      if (!stoppedRef.current && err?.name !== 'AbortError') {
        setMessages(prev => [...prev, {
          id: (Date.now() + 2).toString(),
          text: '⚠️ Service temporarily unavailable. Please try again.',
          sender: 'sda',
          timestamp: new Date(),
        }]);
      }
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  // STOP the in-flight reply (admin 2026-08-13) — one tap ends a wrong query instead of waiting it out.
  const stop = () => {
    stoppedRef.current = true;
    try { abortRef.current?.abort(); } catch { /* already settled */ }
    setLoading(false);
  };

  const requestSummary = () => handleSend('Please generate a complete structured case summary based on all information collected so far.');
  const requestMissingCheck = () => handleSend('What am I missing? Review the case and identify any missing history, examination findings, investigations, or alternative diagnoses I should consider.');
  const startNewCase = () => {
    setMessages([WELCOME]);
    setPatient({});
    setActiveRedFlags([]);
    setInput('');
    setAttachedFile(null);
    setSuggestPDF(false);
    // Rotate the per-case id so the NEW patient starts from an empty server clinical store — the
    // previous patient's demographics / red-flags / recent turns can never carry over (clinical safety).
    //
    // 🔴 THIS LINE USED TO DESTROY THE PREVIOUS PATIENT'S CASE, and it is the whole reason
    // `sdaCaseStore.ts` exists. It read `localStorage.removeItem('sda_messages')` — one shared key for
    // every case — and the next autosave then overwrote the one shared `sda_<userId>` document too. A
    // doctor who pressed "New case" lost the case before it, locally and on the server, with nothing
    // to reopen.
    //
    // Nothing is deleted now, and no archive step replaced it. The new case simply gets its OWN
    // address, on the device and in Firestore, so the previous one stays exactly where it was and
    // appears in History as its own row. A step nobody has to remember is a step nobody can forget.
    const freshId = newSdaCaseId();
    caseIdRef.current = freshId;
    clinicalSessionRef.current = freshId; // a new patient gets an empty server clinical store too
    caseDocRef.current = userId ? perCaseSdaDocId(userId, freshId) : '';
    boundToLegacyRef.current = false;
    try {
      localStorage.setItem(CASE_ID_KEY, freshId);
      if (caseDocRef.current) localStorage.setItem(CASE_DOC_KEY, caseDocRef.current);
      else localStorage.removeItem(CASE_DOC_KEY);
    } catch { /* ignore */ }
    rememberCaseLocally(freshId);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full bg-surface overflow-hidden">
      {/* In-chat image lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[200] bg-scrim flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-[95vw] max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] flex flex-col items-center gap-2" onClick={e => e.stopPropagation()}>
            <img src={lightbox.src} alt={lightbox.name} className="max-w-full max-h-[85vh] supports-[height:100dvh]:max-h-[85dvh] rounded-2xl shadow-2xl object-contain" />
            <p className="text-[10px] text-muted font-mono truncate max-w-full">{lightbox.name}</p>
            <button onClick={() => setLightbox(null)} className="absolute -top-3 -right-3 w-8 h-8 bg-raised hover:bg-raised-hover rounded-full flex items-center justify-center text-ink transition-colors border border-line">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Left Panel ──────────────────────────────────────────────────── */}
      {showPatientPanel && (
        <div className="w-64 shrink-0 bg-surface border-r border-emerald-900/30 flex-col overflow-hidden hidden md:flex">
          <div className="px-4 py-3 border-b border-emerald-900/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User className="w-3.5 h-3.5 text-success" />
              <span className="text-[10px] font-black uppercase tracking-widest text-success">Patient Info</span>
            </div>
            <button onClick={() => setShowPatientPanel(false)} className="text-faint hover:text-ink p-1">
              <X className="w-3 h-3" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
            {/* Demographics */}
            <div className="bg-card rounded-xl p-3 border border-line">
              <p className="text-[9px] text-faint font-black uppercase tracking-widest mb-2">Demographics</p>
              <div className="space-y-1.5">
                {[
                  { label: 'Age', value: patient.age },
                  { label: 'Sex', value: patient.sex },
                  { label: 'Weight', value: patient.weight },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between items-center">
                    <span className="text-[10px] text-faint">{label}</span>
                    <span className={cn("text-[10px] font-medium", value ? 'text-ink' : 'text-faint')}>{value || '—'}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Chief Complaint */}
            <div className="bg-card rounded-xl p-3 border border-line">
              <p className="text-[9px] text-faint font-black uppercase tracking-widest mb-1.5">Chief Complaint</p>
              <p className={cn("text-[11px]", patient.chiefComplaint ? 'text-success font-medium' : 'text-faint')}>
                {patient.chiefComplaint || 'Not recorded yet'}
              </p>
            </div>

            {/* Vitals */}
            {patient.vitals && patient.vitals.length > 0 && (
              <div className="bg-card rounded-xl p-3 border border-line">
                <p className="text-[9px] text-faint font-black uppercase tracking-widest mb-2">Vitals</p>
                <div className="space-y-1.5">
                  {patient.vitals.map(v => (
                    <div key={v.label} className="flex justify-between items-center">
                      <span className="text-[10px] text-faint">{v.label}</span>
                      <span className={cn("text-[10px] font-mono font-bold", v.alert ? 'text-danger' : 'text-ink')}>{v.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Red Flags */}
            {activeRedFlags.length > 0 && (
              <div className="bg-red-500/10 rounded-xl p-3 border border-red-500/30">
                <p className="text-[9px] text-danger font-black uppercase tracking-widest mb-2 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Red Flags
                </p>
                <div className="space-y-1">
                  {activeRedFlags.map((flag, i) => (
                    <p key={i} className="text-[10px] text-danger">• {flag}</p>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Panel Actions */}
          <div className="p-3 border-t border-emerald-900/30 space-y-2">
            <button onClick={requestSummary} disabled={loading || messages.length < 3}
              className="w-full flex items-center gap-2 px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/10 border border-emerald-700/30 rounded-lg text-[10px] font-black text-success uppercase tracking-widest transition-all disabled:opacity-40">
              <FileText className="w-3.5 h-3.5" /> Case Summary
            </button>
            <button onClick={requestMissingCheck} disabled={loading || messages.length < 3}
              className="w-full flex items-center gap-2 px-3 py-2 bg-indigo-500/10 hover:bg-indigo-500/10 border border-indigo-700/20 rounded-lg text-[10px] font-black text-accent-text uppercase tracking-widest transition-all disabled:opacity-40">
              <ClipboardList className="w-3.5 h-3.5" /> What Am I Missing?
            </button>
            <button onClick={generatePDF} disabled={messages.length < 2}
              className="w-full flex items-center gap-2 px-3 py-2 bg-raised hover:bg-raised-hover border border-line rounded-lg text-[10px] font-black text-muted hover:text-ink uppercase tracking-widest transition-all disabled:opacity-40">
              <Download className="w-3.5 h-3.5" /> Download PDF
            </button>
          </div>
        </div>
      )}

      {/* ── Main Chat Area ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Header */}
        {/* Compact on a phone (admin 2026-08-08): the stethoscope tile and the second title line are
            wide-screen affordances — on a narrow screen the title alone identifies the surface, and
            "Doctor Use Only" is carried by the always-visible disclaimer row above the composer. Both
            return at `sm`. Padding tightened; nothing removed from the wide layout. */}
        <div className="shrink-0 bg-surface border-b border-emerald-900/30 px-4 py-1.5 sm:py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {!showPatientPanel && (
              <button onClick={() => setShowPatientPanel(true)} className="p-1.5 hover:bg-raised rounded-lg text-faint hover:text-success transition-colors shrink-0">
                <User className="w-4 h-4" />
              </button>
            )}
            <div className="hidden sm:flex w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-700/40 items-center justify-center shrink-0">
              <Stethoscope className="w-3.5 h-3.5 text-success" />
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-black text-ink tracking-wide truncate">Senior Doctor Assistant</p>
              <p className="hidden sm:block text-[9px] text-success font-medium">Clinical Decision Support · Doctor Use Only</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* 💊 DOSE (admin 2026-08-28): "doctor ko pata hota hai KAB deni hai — bas calculation me
                time lagta hai". One tap → drug buttons, weight, instant mg + mL. No model, no network,
                no spelling — the three ways the chat path failed this exact user in two days. */}
            <button onClick={() => setShowDoseCalc(true)}
              title="Newborn dose calculator — instant mg and mL from the FBNC chart"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest bg-emerald-500/10 border border-emerald-700/40 text-success hover:text-ink hover:bg-emerald-500/10 transition-all">
              <Pill className="w-3 h-3" />
              <span className="hidden sm:inline">Dose</span>
            </button>
            <button onClick={generatePDF} disabled={messages.length < 2}
              title="Download case as PDF"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest bg-raised border border-line text-faint hover:text-ink hover:bg-raised-hover transition-all disabled:opacity-40">
              <Download className="w-3 h-3" />
              <span className="hidden sm:inline">PDF</span>
            </button>
            <button onClick={() => setTeachingMode(p => !p)}
              className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all border",
                teachingMode ? "bg-amber-500/10 border-amber-600/40 text-warn" : "bg-raised border-line text-faint hover:text-ink")}>
              <BookOpen className="w-3 h-3" />
              <span className="hidden sm:inline">Teaching {teachingMode ? 'ON' : 'OFF'}</span>
            </button>
            {/* + not ♻ (admin 2026-08-28, from the phone header): on a narrow screen only the ICON
                survives, and a recycle glyph reads as "refresh this conversation" — nobody presses it
                expecting a fresh case. A plus is the universal new-chat glyph. Same action, honest icon. */}
            <button onClick={startNewCase}
              title="New chat — start a fresh case"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest bg-raised border border-line text-faint hover:text-ink hover:bg-raised-hover transition-all">
              <Plus className="w-3 h-3" />
              <span className="hidden sm:inline">New Chat</span>
            </button>
          </div>
        </div>

        {/* Red Flag Alert */}
        {activeRedFlags.length > 0 && (
          <div className="shrink-0 bg-red-500/10 border-b border-red-500/40 px-4 py-2 flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-danger shrink-0 animate-pulse" />
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-black text-danger uppercase tracking-widest">Red Flag Alert: </span>
              <span className="text-[10px] text-danger">{activeRedFlags.join(' · ')}</span>
            </div>
            <button onClick={() => setActiveRedFlags([])} className="text-danger hover:text-danger p-1">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-4">
          {(() => {
            // In SDA the USER is the 'doctor' sender; 'sda' is the assistant.
            const lastUser = [...messages].reverse().find(m => m.sender === 'doctor');
            return lastUser ? <AppUpdateChatNotice /> : null;
          })()}
          {filterMessages(messages as any, chatSearchQuery).map((msg: any) => (
            <div key={msg.id} className={cn("flex", msg.sender === 'doctor' ? "justify-end" : "justify-start")}>
              {msg.sender === 'sda' && (
                <div className="w-7 h-7 rounded-full bg-emerald-500/10 border border-emerald-700/40 flex items-center justify-center shrink-0 mr-2.5 mt-0.5">
                  <Stethoscope className="w-3.5 h-3.5 text-success" />
                </div>
              )}
              <div className={cn(
                "max-w-[80%] rounded-2xl px-4 py-3 text-[12px] leading-relaxed",
                msg.sender === 'sda'
                  ? msg.isRedFlag
                    ? "bg-red-500/10 border border-red-500/40 text-danger"
                    : "bg-card border border-line text-body"
                  : "bg-emerald-500/10 border border-emerald-700/30 text-success"
              )}>
                {msg.isRedFlag && (
                  <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-red-500/30">
                    <AlertTriangle className="w-3.5 h-3.5 text-danger" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-danger">Red Flag Detected</span>
                  </div>
                )}
                {msg.attachedFile && (
                  <div className="mb-2 pb-2 border-b border-line">
                    {msg.attachedFile.type.startsWith('image/') && msg.attachedFile.dataUrl ? (
                      <button
                        onClick={() => setLightbox({ src: msg.attachedFile!.dataUrl!, name: msg.attachedFile!.name })}
                        className="group relative focus:outline-none"
                        title={msg.attachedFile.name}
                      >
                        <img
                          src={msg.attachedFile.dataUrl}
                          alt={msg.attachedFile.name}
                          className="w-16 h-16 rounded-lg object-cover border border-line group-hover:brightness-110 transition-all cursor-zoom-in"
                        />
                        <div className="absolute inset-0 rounded-lg bg-well group-hover:bg-well-hover transition-colors flex items-center justify-center">
                          <Navigation className="w-4 h-4 text-ink opacity-0 group-hover:opacity-100 transition-opacity drop-shadow rotate-45" />
                        </div>
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <FileSearch className="w-3.5 h-3.5 text-warn shrink-0" />
                        <span className="text-[10px] text-muted truncate">{msg.attachedFile.name}</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="prose prose-invert prose-xs max-w-none prose-p:leading-relaxed prose-p:my-1 prose-headings:text-success prose-strong:text-ink prose-li:my-0.5">
                  {/* The DEFAULT anchor navigates the app's own webview away from NavBharatAI on a
                      phone (admin 2026-08-25). Every source link opens in a new tab instead, and only
                      http/https is ever clickable — this text is model-authored. */}
                  <ReactMarkdown
                    remarkPlugins={CHAT_MARKDOWN_PLUGINS}
                    components={{
                      a: ({ node, href, children, ...props }: any) => (
                        isSafeHttpUrl(String(href ?? ''))
                          ? <a {...props} href={href} target="_blank" rel="noopener noreferrer" onClick={openInRealBrowser(String(href ?? ''))} className="text-accent-text underline underline-offset-2 break-all">{children}</a>
                          : <>{children}</>
                      ),
                    }}
                  >{msg.text}</ReactMarkdown>
                </div>
                <p className="text-[8px] text-faint mt-2 text-right">
                  {msg.timestamp instanceof Date ? msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                </p>
              </div>
              {msg.sender === 'doctor' && (
                <div className="flex flex-col items-center shrink-0 ml-2.5 mt-0.5 group/msg">
                  <div className="w-7 h-7 rounded-full bg-indigo-500/10 border border-indigo-700/40 flex items-center justify-center">
                    <User className="w-3.5 h-3.5 text-accent-text" />
                  </div>
                  {/* DELETE + EDIT on something the doctor already said (admin 2026-08-10). See
                      rewindCase() for why this is safe here and not merely cosmetic. */}
                  {!searchActive(chatSearchQuery) && (
                    <MessageEditActions
                      className="mt-0.5 opacity-60 md:opacity-0 md:group-hover/msg:opacity-100 transition-opacity"
                      text={String(msg.text ?? '')}
                      disabled={loading}
                      onDelete={() => { rewindCase(deleteMessage(withIds(messages), msg.id)); }}
                      onEdit={(next) => {
                        const r = editMessage(withIds(messages), msg.id, next);
                        // The edited message is dropped from the surviving list and re-sent, so the
                        // server sees it as a fresh question against the rewound case rather than an
                        // answer to text it has already been told.
                        const rewound = rewindCase(r.messages.filter((m) => m.id !== msg.id));
                        if (r.resend) void handleSend(r.resend, rewound);
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="w-7 h-7 rounded-full bg-emerald-500/10 border border-emerald-700/40 flex items-center justify-center shrink-0 mr-2.5">
                <Stethoscope className="w-3.5 h-3.5 text-success" />
              </div>
              <div className="bg-card border border-line rounded-2xl px-4 py-3 flex items-center gap-2">
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce text-on-accent" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
                <span className="text-[10px] text-faint">Analyzing...</span>
              </div>
            </div>
          )}

          {/* PDF Suggest Card */}
          {suggestPDF && (
            <div className="flex justify-center">
              <div className="bg-emerald-500/10 border border-emerald-600/40 rounded-2xl px-5 py-3 flex items-center gap-4 max-w-sm">
                <FileText className="w-4 h-4 text-success shrink-0" />
                <p className="text-[11px] text-success flex-1">Case assessment ready. Generate a PDF report?</p>
                <div className="flex gap-2">
                  <button onClick={generatePDF}
                    className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-[10px] font-black text-on-accent transition-all">
                    Yes, Generate
                  </button>
                  <button onClick={() => setSuggestPDF(false)}
                    className="px-3 py-1.5 bg-raised hover:bg-raised-hover rounded-lg text-[10px] font-black text-muted transition-all">
                    Later
                  </button>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Quick Tools + disclaimer — ONE row (admin 2026-08-08: "space bina baat ki cheezo se ghira
            hua hai … visibility maximum chahiye"). The disclaimer used to own a full-width row of its
            own directly above this one; two rows of permanent chrome for ~12 words of text is the kind
            of space a phone cannot spare. It is still ALWAYS visible — clinical-safety text is never
            hidden behind a tap — it simply shares the row with the tools toggle, and carries its full
            wording in the title attribute. Merging the rows is the whole saving; nothing was removed. */}
        <div className="shrink-0 bg-surface border-t border-emerald-900/20 px-4 py-1.5">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTools}
              title={showTools ? 'Hide Quick Tools' : 'Show Quick Tools'}
              className="flex items-center gap-1 shrink-0 text-[9px] font-black uppercase tracking-widest text-faint hover:text-success transition-colors"
            >
              {showTools ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
              Quick Tools
            </button>
            <p
              title="SDA is a clinical decision support tool. All diagnoses and treatment decisions remain the sole responsibility of the treating physician."
              className="flex-1 min-w-0 text-[8px] leading-tight text-faint text-right truncate"
            >
              Decision support only — the treating physician remains responsible.
            </p>
          </div>
          {showTools && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {QUICK_TOOLS.map(tool => {
                const Icon = tool.icon;
                return (
                  <button
                    key={tool.label}
                    onClick={() => handleSend(tool.prompt)}
                    disabled={loading || messages.length < 2}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-widest whitespace-nowrap transition-all disabled:opacity-40",
                      tool.color
                    )}
                  >
                    <Icon className="w-3 h-3" />
                    {tool.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="shrink-0 bg-surface border-t border-emerald-900/30 px-4 pb-3 pt-2">

          {/* THE SHARED COMPOSER TOOLBAR (admin 2026-08-10: "wahi sabhi jagah laga do"). Doctor AI had
              none of this — no Enter-to-send preference, no way to find something said earlier in a long
              consult. Clear routes to startNewCase() rather than emptying the array, because a Doctor AI
              conversation carries a per-case id and a server-side clinical store: blanking the screen
              while the previous patient's demographics and red flags stayed live on the server would be
              a clinical-safety bug, not a UI one. */}
          <ChatToolbar
            className="mb-2"
            messageCount={messages.length}
            sendOnEnter={sendOnEnter}
            onSendOnEnterChange={setSendOnEnter}
            searchQuery={chatSearchQuery}
            onSearchQueryChange={setChatSearchQuery}
            searchOpen={showChatSearch}
            onSearchOpenChange={setShowChatSearch}
            searchMatches={filterMessages(messages as any, chatSearchQuery).length}
            onClear={startNewCase}
            charCount={input.length}
          />

          {/* Attached file preview */}
          {attachedFile && (
            <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-card border border-emerald-900/40 rounded-xl">
              {attachedFile.preview ? (
                <img src={attachedFile.preview} alt="preview" className="w-8 h-8 rounded object-cover border border-line shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded bg-orange-500/10 border border-orange-700/30 flex items-center justify-center shrink-0">
                  <FileSearch className="w-4 h-4 text-warn" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-ink font-medium truncate">{attachedFile.name}</p>
                <p className="text-[9px] text-faint">
                  {attachedFile.type.startsWith('image/') ? 'Image' : attachedFile.type === 'application/pdf' ? 'PDF' : 'Document'} · Ready to analyze
                </p>
              </div>
              <button onClick={() => setAttachedFile(null)} className="text-faint hover:text-danger p-1 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/*
            ONE COMPOSER, EVERYWHERE (admin 2026-09-20, with a screenshot of this row beside the
            Mentor/Career Coach row: "SDA ka input box bhi baki ai ke jaise karna hai … other
            professionals ke jaise hi karo").

            What was different, and why it read as a different product: the paperclip and the
            dictation mic sat INSIDE the text box, so the writing area started a third of the way
            across and a two-word placeholder wrapped onto two lines on a phone; the text was
            `text-[12px]` against every other composer's `text-sm`; and the box was pinned to a
            44px minimum while the buttons beside it were 40px, so nothing lined up. Every control
            is now its own `w-9 h-9 rounded-xl` box on the row, the text box is the row's only
            growing element, and the classes are the ones `ProfessionalChat` uses — so the two
            screens are the same screen with a different persona in it.

            Kept deliberately: the DICTATION mic (speech → text, which the professionals do not
            have) and the `Volume2` icon on the voice button. Two mic glyphs side by side would be
            two different features wearing one icon — the distinction predates this change and the
            layout is what the admin asked to align, not the meaning.
          */}
          <div className="flex items-end gap-2">
            <AttachMenu
              onFiles={handleFiles}
              fileAccept={ACCEPTED_TYPES}
              multiple={false}
              disabled={loading}
              badge={attachedFile ? 1 : undefined}
              title="Attach a lab report, X-ray, ECG or any medical document"
              buttonClassName="w-9 h-9 rounded-xl bg-raised hover:bg-raised-hover disabled:opacity-40 border border-line text-body flex items-center justify-center"
            />

            <textarea
              ref={inputRef}
              value={input}
              onChange={e => { setInput(e.target.value); autoResize(e.target); }}
              onKeyDown={(e) => {
                // Doctor AI previously had NO keyboard send at all — every message needed a tap on
                // the button, which on a desktop consult is the slowest possible way to work. Same
                // shared rule as every other AI now, IME-safe and honouring the toggle.
                if (enterShouldSend({
                  key: e.key,
                  shiftKey: e.shiftKey,
                  sendOnEnter,
                  hasContent: !!input.trim() || !!attachedFile,
                  isBusy: loading,
                  isComposing: (e.nativeEvent as any)?.isComposing,
                })) {
                  e.preventDefault();
                  void handleSend();
                  dismissKeyboardOnMobile(inputRef.current);
                }
              }}
              placeholder={attachedFile ? 'Add a note about this document…' : 'Type your answer…'}
              rows={1}
              className="flex-1 resize-none bg-card border border-line rounded-xl px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-emerald-600/60 max-h-32"
              disabled={loading}
            />

            {/* Dictation mic — speech → TEXT into the box (you still read + Send). Renders only where
                the Web Speech API exists; absent on iOS/iPadOS WKWebView (no dead button). */}
            {voiceSupported && (
              <button
                onClick={() => toggleVoice(input)}
                disabled={loading}
                title={isListening ? 'Stop voice input' : 'Dictate (speech → text)'}
                className={cn(
                  'w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 disabled:opacity-40 transition-colors',
                  isListening
                    ? 'bg-red-500/15 border-red-500/40 text-danger animate-pulse'
                    : 'bg-raised hover:bg-raised-hover border-line text-body',
                )}
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            )}

            {/* Talk to SDA by VOICE — a full spoken back-and-forth with the doctor persona (distinct
                from the dictation mic, which only turns speech → text). Renders nothing unless voice
                is enabled + the user is signed in. getHistory continues THIS case in voice (clinical
                markers stripped so nothing is read aloud). */}
            <ProfessionalVoiceButton
              professionalId="sda"
              title="Talk to SDA by voice — start a live spoken consult"
              icon={<Volume2 className="w-4 h-4" />}
              className="w-9 h-9 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-success flex items-center justify-center shrink-0"
              getHistory={() =>
                messages
                  .filter((m) => m.text && m.text.trim())
                  .slice(-20)
                  .map((m) => ({
                    role: (m.sender === 'doctor' ? 'user' : 'assistant') as 'user' | 'assistant',
                    // Strip the text-only clinical machine signals so they are never spoken back.
                    content: m.text
                      .replace(/\[CLINICAL_JSON\][\s\S]*?\[\/CLINICAL_JSON\]/g, '')
                      .replace(/\[CASE_COMPLETE\]/g, '')
                      .trim(),
                  }))
                  .filter((t) => t.content)
              }
            />

            {/* Send button — becomes a one-tap STOP while a reply is loading (admin 2026-08-13), so a wrong
                query can be cancelled instead of waited out. */}
            {loading ? (
              <button
                onClick={stop}
                title="Stop"
                className="w-9 h-9 rounded-xl bg-red-600 hover:bg-red-500 text-on-accent flex items-center justify-center shrink-0"
              >
                <span className="w-3.5 h-3.5 flex items-center justify-center font-black text-[12px]">■</span>
              </button>
            ) : (
              <button
                onClick={() => { handleSend(); dismissKeyboardOnMobile(inputRef.current); }}
                disabled={!input.trim() && !attachedFile}
                className="w-9 h-9 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-on-accent flex items-center justify-center shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* The emoji legend row that sat here (Docs / Dictate / Talk-to-SDA / Clinical-Tools) was
              DELETED (admin 2026-08-08). Every entry labelled a control visible in this very row —
              the paperclip, the mic, the speaker button — each of which already carries a `title`
              tooltip, and the tools toggle is one row above. It was a caption for buttons the eye can
              already see, costing a permanent row of a phone screen. No function lost.
              (Deliberately NOT quoting the old string verbatim: the regression test asserts that exact
              text is absent from this file, and a comment reproducing it would defeat the test.) */}
        </div>
      </div>
    {showDoseCalc && <DoseCalculator onClose={() => setShowDoseCalc(false)} />}
    </div>
  );
};
