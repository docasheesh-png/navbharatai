/**
 * 🎓 EXAM MODE — a real objective test inside Teacher AI (admin 2026-09-22).
 *
 * The admin asked for: subject, topic, level (low / medium / hard / mix) and a question count; then
 * objective questions with 4 clickable options; a green tick and **+4** for a correct answer, a red
 * cross and **−1** for a wrong one; an explanation underneath; a Next button; and the cycle repeating.
 * They also asked for it to be better than they described.
 *
 * ## The four additions that are not decoration, and why each one earns its place
 *
 * 1. **SKIP, worth 0.** With negative marking, *choosing not to answer* is the single most important
 *    skill the exam trains — in NEET, JEE and every UPSC prelim, a guessed wrong answer costs a mark
 *    a skip does not. A test with −1 and no skip button teaches the opposite of what it is for.
 * 2. **The RIGHT option is revealed when you get it wrong.** A red cross alone tells a student they
 *    failed and not what the answer was, so the next attempt is the same guess. This is the whole
 *    difference between a score and a lesson.
 * 3. **A result that names the weak TOPICS, and hands them back to the teacher.** The paper knows
 *    which topic each question came from, so the end of an exam can say *"you lost marks in
 *    Thermodynamics"* and offer one press that asks the teacher to teach exactly those. Without it
 *    this is a quiz toy; with it, it is a teacher.
 * 4. **A blank is not a wrong answer, anywhere in the arithmetic.** `marks`, `accuracy` and the
 *    per-topic breakdown each treat *answered wrongly* and *not answered* as different facts, which
 *    is what makes the numbers match the exam the student is actually preparing for.
 *
 * ## 🔒 What this module refuses to do
 *
 * - **It never invents a question.** A paper that comes back malformed is REPORTED short, never
 *   padded, never silently reduced to a number the user did not ask for — `parseExamPaper` returns
 *   what survived AND how many were dropped, so the surface can say so.
 * - **It never marks on the client's word about correctness.** The client sends which option was
 *   chosen; the marking is arithmetic over the paper this module parsed.
 * - **No vendor name reaches any string here** (the White-Label Law) — every user-facing sentence is
 *   NavBharatAI's own.
 *
 * PURE: no I/O, no clock, no model call, never throws.
 */

/** Marks, exactly as the admin set them. Named so no surface can quietly use a different number. */
export const EXAM_MARK_CORRECT = 4;
export const EXAM_MARK_WRONG = -1;
/** A blank. Zero, and a DIFFERENT fact from a wrong answer everywhere below. */
export const EXAM_MARK_SKIPPED = 0;

/** How hard the paper is. `mix` is a real level, not the absence of one — see `levelBrief`. */
export type ExamLevel = 'low' | 'medium' | 'hard' | 'mix';
export const EXAM_LEVELS: readonly ExamLevel[] = ['low', 'medium', 'hard', 'mix'];

export const EXAM_MIN_QUESTIONS = 1;
/**
 * The ceiling on one paper.
 *
 * ⚠️ It is a COST and QUALITY bound, not a preference. The whole paper is generated in ONE call, so
 * the count decides that call's output size; past roughly this many, a single answer starts running
 * into the output ceiling and the tail of the paper arrives truncated — which this module would then
 * honestly report as dropped questions. Thirty is also longer than any practice set a student
 * finishes in one sitting.
 */
export const EXAM_MAX_QUESTIONS = 30;
export const EXAM_DEFAULT_QUESTIONS = 10;

/** The counts the surface offers as one tap. A student may still type any number in range. */
export const EXAM_COUNT_PRESETS: readonly number[] = [5, 10, 20, 30];

/**
 * 🎯 WHICH EXAM IS THIS FOR? (admin 2026-09-22)
 *
 * Admin: *"subject topics level ke sath kon se exam ki prepration karni hai, woh dropdown se
 * selection karne ko aye … india me hone wala sabhi famus exam aap is list me add karoge!! aur sab
 * alfavetical honge, 1st number par other hoga."*
 *
 * ## Why this is the single highest-value field on the setup screen
 *
 * "Ten medium questions on Thermodynamics" is four completely different papers depending on who is
 * asking. A Class 11 student needs the chapter as the textbook teaches it; a JEE Advanced candidate
 * needs multi-step numericals with a trap in the algebra; a GATE candidate needs the mechanical
 * engineering treatment; a UPSC candidate needs the one conceptual line that actually gets asked.
 * Difficulty ("hard") cannot express that, because hard-for-Class-11 and hard-for-JEE are different
 * *kinds* of hard, not different amounts. **The exam is the missing variable, and nothing else on the
 * screen can stand in for it.**
 *
 * ## 🔒 Three rules this list keeps
 *
 * 1. **`other` is FIRST and is the DEFAULT**, exactly as asked — so the dropdown never forces a
 *    student who just wants a plain paper to pick something untrue, and today's behaviour (no exam
 *    targeting at all) is what an untouched form still produces. When `other` is chosen the student
 *    may type their own exam, which is threaded through identically.
 * 2. **Everything after `other` is sorted BY CODE, never by hand** (`sortTargets`), with numeric
 *    collation so "Class 10" comes before "Class 12". A hand-ordered list drifts the first time
 *    somebody appends an entry, and nothing would fail.
 * 3. **No discontinued exam is listed.** NTSE and KVPY are the ones students still search for; both
 *    were withdrawn, and offering to prepare somebody for an exam that no longer exists is the kind
 *    of plausible-looking falsehood that costs trust. A student who wants one can still type it
 *    under `other`.
 *
 * `subjects` is the second half of the spelling answer below: for the exams where the subject list
 * is genuinely fixed, the student TAPS the subject instead of typing it, so the commonest
 * misspelling never gets a chance to happen.
 */
export interface ExamTarget {
  id: string;
  label: string;
  /** What a paper for this exam is actually like — the standard, the scope and the question style. */
  brief: string;
  /** The subjects this exam really tests, offered as one tap. Omitted where there is no fixed list. */
  subjects?: readonly string[];
}

/** The neutral choice: no exam targeting. First in the list and the default, as the admin set it. */
export const EXAM_TARGET_OTHER = 'other';

const OTHER_TARGET: ExamTarget = {
  id: EXAM_TARGET_OTHER,
  label: 'Other / not for a specific exam',
  brief: '',
};

/** Source order is irrelevant — `sortTargets` below is what the surface and the tests read. */
const NAMED_TARGETS: readonly ExamTarget[] = [
  { id: 'afcat', label: 'AFCAT (Air Force)', brief: 'Air Force Common Admission Test: general awareness, verbal ability, numerical ability and military aptitude, at graduate level.', subjects: ['General Awareness', 'Verbal Ability', 'Numerical Ability', 'Reasoning & Military Aptitude'] },
  { id: 'aibe', label: 'AIBE (Bar exam)', brief: 'All India Bar Examination: practical, open-book questions across the bare acts an advocate uses daily.' },
  { id: 'ailet', label: 'AILET (NLU Delhi)', brief: 'NLU Delhi law entrance: English, current affairs, and logical and legal reasoning, harder and shorter than CLAT.' },
  { id: 'agniveer_army', label: 'Agniveer — Indian Army', brief: 'Army Agniveer CEE: general knowledge, general science, elementary mathematics and logical reasoning, at Class 10 standard.' },
  { id: 'agniveer_navy', label: 'Agniveer — Indian Navy (SSR/MR)', brief: 'Navy Agniveer: Class 12 science and mathematics, English and general awareness.' },
  { id: 'ap_eapcet', label: 'AP EAPCET', brief: 'Andhra Pradesh engineering and agriculture entrance, on the state Class 11–12 syllabus.' },
  { id: 'bitsat', label: 'BITSAT', brief: 'BITS Pilani entrance: NCERT Class 11–12 Physics, Chemistry and Mathematics, plus English proficiency and logical reasoning, under heavy time pressure.', subjects: ['Physics', 'Chemistry', 'Mathematics', 'English Proficiency', 'Logical Reasoning'] },
  { id: 'bpsc', label: 'BPSC (Bihar PSC)', brief: 'Bihar Public Service Commission: general studies with a strong Bihar-specific history, geography and current-affairs weighting.' },
  { id: 'ca_foundation', label: 'CA Foundation', brief: 'ICAI entry level: accounting principles, business laws, business mathematics and logical reasoning, and economics.', subjects: ['Accounting', 'Business Laws', 'Business Mathematics & Logical Reasoning', 'Business Economics'] },
  { id: 'ca_inter', label: 'CA Intermediate', brief: 'ICAI intermediate: advanced accounting, corporate law, taxation, cost accounting, auditing and financial management.' },
  { id: 'ca_final', label: 'CA Final', brief: 'ICAI final: financial reporting, strategic financial management, advanced auditing, direct and indirect tax laws, at professional standard.' },
  { id: 'cat', label: 'CAT (IIM / MBA)', brief: 'Common Admission Test: quantitative aptitude, data interpretation and logical reasoning, and verbal ability, all aptitude and no syllabus recall.', subjects: ['Quantitative Aptitude', 'Data Interpretation & Logical Reasoning', 'Verbal Ability & Reading Comprehension'] },
  { id: 'cds', label: 'CDS (UPSC Defence)', brief: 'UPSC Combined Defence Services: English, general knowledge and elementary mathematics at Class 10–12 standard.', subjects: ['English', 'General Knowledge', 'Elementary Mathematics'] },
  { id: 'clat', label: 'CLAT (Law)', brief: 'Common Law Admission Test: comprehension-led passages in English, current affairs, legal reasoning, logical reasoning and quantitative techniques. Every question follows a passage — no bare recall.', subjects: ['English Language', 'Current Affairs & General Knowledge', 'Legal Reasoning', 'Logical Reasoning', 'Quantitative Techniques'] },
  { id: 'class10', label: 'Class 10 board exam', brief: 'Class 10 board standard, on the NCERT syllabus, in the style the board itself asks.', subjects: ['Mathematics', 'Science', 'Social Science', 'English', 'Hindi'] },
  { id: 'class11', label: 'Class 11 exam', brief: 'Class 11 standard on the NCERT syllabus — the foundation year, so concepts before shortcuts.' },
  { id: 'class12', label: 'Class 12 board exam', brief: 'Class 12 board standard, on the NCERT syllabus, in the style the board itself asks.', subjects: ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'English', 'Accountancy', 'Business Studies', 'Economics'] },
  { id: 'cmat', label: 'CMAT', brief: 'NTA Common Management Admission Test: quantitative technique, logical reasoning, language comprehension, general awareness and innovation & entrepreneurship.' },
  { id: 'comedk', label: 'COMEDK UGET', brief: 'Karnataka private-engineering entrance on Class 11–12 Physics, Chemistry and Mathematics.', subjects: ['Physics', 'Chemistry', 'Mathematics'] },
  { id: 'cs_executive', label: 'CS Executive (ICSI)', brief: 'Company Secretary executive level: company law, tax laws, economic and commercial laws, and corporate accounting.' },
  { id: 'csir_net', label: 'CSIR NET', brief: 'CSIR-UGC NET for science: research-level depth in the chosen science subject, with a part-A of general aptitude.' },
  { id: 'ctet', label: 'CTET (Teaching)', brief: 'Central Teacher Eligibility Test: child development and pedagogy alongside the subject, always asked from a teaching point of view rather than as bare content.', subjects: ['Child Development & Pedagogy', 'Language I', 'Language II', 'Mathematics', 'Environmental Studies'] },
  { id: 'cuet_ug', label: 'CUET UG', brief: 'Common University Entrance Test (undergraduate): strictly NCERT Class 12, domain subject plus general test.' },
  { id: 'cuet_pg', label: 'CUET PG', brief: 'Common University Entrance Test (postgraduate): graduation-level depth in the chosen domain subject.' },
  { id: 'delhi_police', label: 'Delhi Police Constable', brief: 'Delhi Police constable recruitment: general knowledge, reasoning, numerical ability and computer awareness at Class 12 standard.' },
  { id: 'fmge', label: 'FMGE (Screening Test)', brief: 'Foreign Medical Graduate Examination: the full MBBS syllabus at Indian licensing standard.' },
  { id: 'gate', label: 'GATE', brief: 'Graduate Aptitude Test in Engineering: undergraduate engineering depth in the chosen branch, plus engineering mathematics and general aptitude. Numerical-answer and multi-select questions are normal here.', subjects: ['General Aptitude', 'Engineering Mathematics'] },
  { id: 'gmat', label: 'GMAT', brief: 'GMAT: quantitative reasoning, verbal reasoning and data insights, adaptive and aptitude-led.' },
  { id: 'gre', label: 'GRE', brief: 'GRE General: verbal reasoning with demanding vocabulary in context, quantitative reasoning and analytical writing.' },
  { id: 'ibps_clerk', label: 'IBPS Clerk', brief: 'IBPS clerical cadre: reasoning ability, numerical ability, English language and banking awareness, speed-led at Class 12 standard.' },
  { id: 'ibps_po', label: 'IBPS PO', brief: 'IBPS Probationary Officer: reasoning and computer aptitude, quantitative aptitude, English, and general and banking awareness.', subjects: ['Reasoning Ability', 'Quantitative Aptitude', 'English Language', 'General & Banking Awareness'] },
  { id: 'ibps_rrb', label: 'IBPS RRB', brief: 'Regional Rural Banks officer and office assistant: reasoning and numerical ability, with rural banking and financial awareness.' },
  { id: 'icar', label: 'ICAR AIEEA (Agriculture)', brief: 'ICAR agricultural university entrance: agriculture, biology, chemistry, physics and mathematics at Class 12 standard.' },
  { id: 'ielts', label: 'IELTS', brief: 'IELTS: listening, reading, writing and speaking in academic English, scored by band rather than by marks.' },
  { id: 'iift', label: 'IIFT (MBA)', brief: 'Indian Institute of Foreign Trade entrance: quantitative analysis, reading comprehension, logical reasoning, and general awareness with a strong international-trade slant.' },
  { id: 'iit_jam', label: 'IIT JAM', brief: 'Joint Admission Test for MSc: bachelor-level depth in the chosen science subject.' },
  { id: 'ini_cet', label: 'INI CET (AIIMS PG)', brief: 'Institutes of National Importance Combined Entrance Test: clinically-led postgraduate medicine at the hardest Indian standard.' },
  { id: 'isro', label: 'ISRO Scientist / Engineer', brief: 'ISRO recruitment: core engineering depth in the chosen branch, at a standard comparable to GATE but more applied.' },
  { id: 'jee_advanced', label: 'JEE Advanced', brief: 'JEE Advanced: multi-concept, multi-step Physics, Chemistry and Mathematics problems where the difficulty is in seeing the approach, not in recall. Questions should genuinely take a few minutes each.', subjects: ['Physics', 'Chemistry', 'Mathematics'] },
  { id: 'jee_main', label: 'JEE Main', brief: 'JEE Main: NCERT Class 11–12 Physics, Chemistry and Mathematics, application-led with clean numerical answers and standard traps.', subjects: ['Physics', 'Chemistry', 'Mathematics'] },
  { id: 'kcet', label: 'KCET (Karnataka)', brief: 'Karnataka Common Entrance Test on the state Class 11–12 syllabus for engineering and allied courses.' },
  { id: 'kvs', label: 'KVS / NVS Teacher', brief: 'Kendriya Vidyalaya and Navodaya teacher recruitment: the subject plus pedagogy and general awareness.' },
  { id: 'lic_aao', label: 'LIC AAO', brief: 'LIC Assistant Administrative Officer: reasoning, quantitative aptitude, English, general knowledge and insurance awareness.' },
  { id: 'mat', label: 'MAT (AIMA)', brief: 'Management Aptitude Test: language comprehension, mathematical skills, data analysis, intelligence and critical reasoning, and Indian and global environment.' },
  { id: 'mht_cet', label: 'MHT CET (Maharashtra)', brief: 'Maharashtra CET on the state Class 11–12 syllabus, more speed-led than JEE Main.' },
  { id: 'mppsc', label: 'MPPSC (Madhya Pradesh PSC)', brief: 'Madhya Pradesh Public Service Commission: general studies with a strong Madhya Pradesh history, geography and policy weighting.' },
  { id: 'mpsc', label: 'MPSC (Maharashtra PSC)', brief: 'Maharashtra Public Service Commission: general studies with a strong Maharashtra history, geography and polity weighting.' },
  { id: 'nabard', label: 'NABARD Grade A', brief: 'NABARD Grade A: agriculture and rural development, economic and social issues, reasoning, quantitative aptitude and English.' },
  { id: 'nata', label: 'NATA (Architecture)', brief: 'National Aptitude Test in Architecture: visual and spatial reasoning, architectural awareness, and basic mathematics.' },
  { id: 'nda', label: 'NDA (UPSC Defence)', brief: 'UPSC National Defence Academy: Class 11–12 mathematics, and a general ability paper of English and general knowledge.', subjects: ['Mathematics', 'English', 'General Knowledge'] },
  { id: 'neet_mds', label: 'NEET MDS', brief: 'NEET for dental postgraduates: the full BDS syllabus at postgraduate entrance standard.' },
  { id: 'neet_pg', label: 'NEET PG', brief: 'NEET Postgraduate: clinically-framed questions across the whole MBBS syllabus, most of them a short case rather than a bare fact.' },
  { id: 'neet_ss', label: 'NEET SS (Super Speciality)', brief: 'NEET Super Speciality: super-specialist depth in the chosen branch.' },
  { id: 'neet_ug', label: 'NEET UG (Medical)', brief: 'NEET undergraduate: strictly NCERT Class 11–12 Physics, Chemistry and Biology, fact-dense in Biology and application-led in Physics. Biology carries half the paper.', subjects: ['Physics', 'Chemistry', 'Biology (Botany & Zoology)'] },
  { id: 'nest', label: 'NEST (NISER / CEBS)', brief: 'National Entrance Screening Test: conceptual Class 11–12 science, closer to a reasoning paper than a recall one.' },
  { id: 'nid', label: 'NID DAT (Design)', brief: 'National Institute of Design aptitude test: design thinking, visual perception, material awareness and creative reasoning.' },
  { id: 'nift', label: 'NIFT Entrance', brief: 'NIFT entrance: general ability, quantitative and communication ability, plus fashion and design awareness.' },
  { id: 'nmat', label: 'NMAT', brief: 'NMAT by GMAC: language skills, quantitative skills and logical reasoning, strictly sectionally timed.' },
  { id: 'rbi_assistant', label: 'RBI Assistant', brief: 'RBI Assistant: reasoning, numerical ability, English and general awareness, speed-led.' },
  { id: 'rbi_grade_b', label: 'RBI Grade B', brief: 'RBI Grade B: economic and social issues, finance and management, English, and a demanding general-awareness load.' },
  { id: 'rpsc', label: 'RPSC (Rajasthan PSC)', brief: 'Rajasthan Public Service Commission: general studies with a strong Rajasthan history, art, culture and geography weighting.' },
  { id: 'rrb_alp', label: 'RRB ALP', brief: 'Railway Assistant Loco Pilot: mathematics, general intelligence, basic science and engineering, and general awareness, plus the trade aptitude.' },
  { id: 'rrb_group_d', label: 'RRB Group D', brief: 'Railway Group D: general science, mathematics, general intelligence and reasoning, and current affairs at Class 10 standard.' },
  { id: 'rrb_je', label: 'RRB JE', brief: 'Railway Junior Engineer: engineering discipline depth plus mathematics, reasoning and general awareness.' },
  { id: 'rrb_ntpc', label: 'RRB NTPC', brief: 'Railway NTPC: mathematics, general intelligence and reasoning, and general awareness at Class 12 standard.', subjects: ['Mathematics', 'General Intelligence & Reasoning', 'General Awareness'] },
  { id: 'sat', label: 'SAT', brief: 'SAT: evidence-based reading and writing, and mathematics, all passage- or context-led.' },
  { id: 'sbi_clerk', label: 'SBI Clerk', brief: 'SBI clerical cadre: reasoning, numerical ability, English and banking awareness, speed-led.' },
  { id: 'sbi_po', label: 'SBI PO', brief: 'SBI Probationary Officer: reasoning and computer aptitude, data interpretation, English, and banking and economic awareness — harder than IBPS PO, especially in reasoning.' },
  { id: 'snap', label: 'SNAP (Symbiosis)', brief: 'Symbiosis National Aptitude Test: general English, analytical and logical reasoning, and quantitative and data interpretation.' },
  { id: 'ssc_cgl', label: 'SSC CGL', brief: 'SSC Combined Graduate Level: quantitative aptitude, general intelligence and reasoning, English, and general awareness — graduate level but speed-led.', subjects: ['Quantitative Aptitude', 'General Intelligence & Reasoning', 'English Language', 'General Awareness'] },
  { id: 'ssc_chsl', label: 'SSC CHSL', brief: 'SSC Combined Higher Secondary Level: the CGL subjects at Class 12 standard.' },
  { id: 'ssc_gd', label: 'SSC GD Constable', brief: 'SSC General Duty Constable: general intelligence, general knowledge, elementary mathematics and language, at Class 10 standard.' },
  { id: 'ssc_je', label: 'SSC JE', brief: 'SSC Junior Engineer: civil, electrical or mechanical engineering depth plus general intelligence and awareness.' },
  { id: 'ssc_mts', label: 'SSC MTS', brief: 'SSC Multi-Tasking Staff: numerical aptitude, reasoning, English and general awareness at Class 10 standard.' },
  { id: 'state_psc', label: 'State PSC (general)', brief: 'A state Public Service Commission paper: national general studies with a substantial state-specific history, geography, polity and current-affairs share.' },
  { id: 'state_tet', label: 'State TET', brief: 'A state Teacher Eligibility Test: the subject taught through pedagogy, with the state-specific language and environment papers.' },
  { id: 'toefl', label: 'TOEFL', brief: 'TOEFL iBT: academic English reading, listening, speaking and writing.' },
  { id: 'ts_eapcet', label: 'TS EAPCET', brief: 'Telangana engineering and agriculture entrance, on the state Class 11–12 syllabus.' },
  { id: 'ugc_net', label: 'UGC NET', brief: 'UGC NET: paper 1 teaching and research aptitude, plus postgraduate depth in the chosen subject.', subjects: ['Teaching & Research Aptitude'] },
  { id: 'up_police', label: 'UP Police Constable', brief: 'Uttar Pradesh Police constable recruitment: general knowledge, general Hindi, numerical and mental ability, and reasoning.' },
  { id: 'uppsc', label: 'UPPSC (Uttar Pradesh PSC)', brief: 'Uttar Pradesh Public Service Commission: general studies with a strong Uttar Pradesh history, geography and polity weighting.' },
  { id: 'upsc_capf', label: 'UPSC CAPF (Assistant Commandant)', brief: 'Central Armed Police Forces: general ability and intelligence, plus general studies, essay and comprehension.' },
  { id: 'upsc_cse', label: 'UPSC Civil Services (IAS / IPS)', brief: 'UPSC Civil Services prelims standard: conceptual, multi-statement and assertion-reason questions across polity, history, geography, economy, environment and science, always tied to relevance rather than trivia.', subjects: ['Indian Polity', 'Modern & Ancient History', 'Geography', 'Economy', 'Environment & Ecology', 'Science & Technology', 'Current Affairs'] },
  { id: 'upsc_ese', label: 'UPSC ESE (Engineering Services)', brief: 'Engineering Services Examination: deep, conceptual engineering in the chosen branch, plus a general studies and engineering aptitude paper.' },
  { id: 'viteee', label: 'VITEEE', brief: 'VIT engineering entrance on Class 11–12 Physics, Chemistry and Mathematics or Biology, plus aptitude and English.' },
  { id: 'wbjee', label: 'WBJEE', brief: 'West Bengal Joint Entrance: Class 11–12 Physics, Chemistry and Mathematics on the state syllabus, with multi-correct questions.' },
  { id: 'xat', label: 'XAT (XLRI)', brief: 'Xavier Aptitude Test: verbal and logical ability, decision making, quantitative ability and data interpretation, with the decision-making section unique to this paper.' },
];

/**
 * Alphabetical BY CODE, so appending an entry can never leave the list out of order.
 *
 * `numeric: true` is what puts "Class 10" before "Class 12" instead of ordering them as strings, and
 * `sensitivity: 'base'` keeps the sort stable regardless of how an entry happens to be capitalised.
 */
function sortTargets(list: readonly ExamTarget[]): ExamTarget[] {
  return [...list].sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true, sensitivity: 'base' }));
}

/** The list the dropdown renders: `other` first, everything else alphabetical. */
export const EXAM_TARGETS: readonly ExamTarget[] = [OTHER_TARGET, ...sortTargets(NAMED_TARGETS)];

/** A known target, or `null` for `other` / anything unrecognised. Never throws on junk. */
export function examTarget(id: unknown): ExamTarget | null {
  const key = String(id ?? '').trim().toLowerCase();
  if (!key || key === EXAM_TARGET_OTHER) return null;
  return NAMED_TARGETS.find((t) => t.id === key) ?? null;
}

/**
 * 🌐 THE LANGUAGE THE PAPER IS WRITTEN IN (admin 2026-09-25: *"user language select kar sakta hai,
 * india ki sabhi language available honi chahiye"*).
 *
 * All 22 languages of the Eighth Schedule of the Constitution, plus English (the language of most
 * entrance exams) and Hinglish (Hindi typed in English letters, which is how a large share of students
 * actually write). The labels are English on purpose: this list is UI text, and the UI is English
 * everywhere; the PAPER is what comes back in the chosen language.
 *
 * 🔒 **`auto` is the default and it changes nothing.** It keeps the instruction the paper prompt has
 * always carried ("the language the student has been using with you"), so a student who never opens
 * Settings gets exactly today's paper.
 *
 * An id this list does not know reads as `auto` — never as a language we then describe to the model.
 */
export interface ExamLanguage {
  id: string;
  /** What the picker shows. */
  label: string;
  /** How the prompt names it to the generator. Only Hinglish differs from the label. */
  promptName: string;
}

export const EXAM_LANGUAGE_AUTO = 'auto';

const SCHEDULED_LANGUAGES_EXCEPT_HINDI: readonly string[] = [
  'Assamese', 'Bengali', 'Bodo', 'Dogri', 'Gujarati', 'Kannada', 'Kashmiri', 'Konkani', 'Maithili',
  'Malayalam', 'Manipuri', 'Marathi', 'Nepali', 'Odia', 'Punjabi', 'Sanskrit', 'Santali', 'Sindhi',
  'Tamil', 'Telugu', 'Urdu',
];

export const EXAM_LANGUAGES: readonly ExamLanguage[] = [
  { id: EXAM_LANGUAGE_AUTO, label: 'Automatic — the language you chat in', promptName: '' },
  { id: 'english', label: 'English', promptName: 'English' },
  { id: 'hindi', label: 'Hindi', promptName: 'Hindi' },
  { id: 'hinglish', label: 'Hinglish — Hindi in English letters', promptName: 'Hinglish (Hindi written in the Latin alphabet)' },
  ...SCHEDULED_LANGUAGES_EXCEPT_HINDI.map((name) => ({ id: name.toLowerCase(), label: name, promptName: name })),
];

/** The language for an id, or `null` for `auto` and for an id this list does not carry. */
export function examLanguage(id: unknown): ExamLanguage | null {
  const key = String(id ?? '').trim().toLowerCase();
  if (!key || key === EXAM_LANGUAGE_AUTO) return null;
  return EXAM_LANGUAGES.find((l) => l.id === key) ?? null;
}

/**
 * Rule 10 of the paper prompt: which language to write in.
 *
 * ⚠️ **Formulae, units and symbols stay as they are.** A Physics paper in Tamil still writes
 * `F = ma` and `m/s²`; translating a symbol makes the question wrong, not local. A technical term with
 * no common word in the chosen language keeps the English term in brackets, which is how Indian
 * textbooks in those languages actually print it.
 */
export function examLanguageRule(spec: Pick<ExamSpec, 'language'>): string {
  const lang = examLanguage(spec.language);
  if (!lang) return 'Write in the language the student has been using with you.';
  if (lang.id === 'english') {
    return 'Write EVERY question, option, explanation and "topic" in English.';
  }
  if (lang.id === 'hinglish') {
    return 'Write EVERY question, option, explanation and "topic" in Hinglish — Hindi written in the Latin (English) alphabet, the way students type it on a phone. Do not use Devanagari. Keep formulae, units and symbols exactly as they are.';
  }
  return `Write EVERY question, option, explanation and "topic" in ${lang.promptName}, in its standard script. Keep formulae, units, chemical symbols and numbers exactly as they are. Where a technical term has no common ${lang.promptName} word, write the ${lang.promptName} phrase with the English term in brackets after it. Keep the "read" fields in the language the student typed the SCOPE in.`;
}

export interface ExamSpec {
  subject: string;
  /** '' is legitimate — a whole-subject paper. Never invented to fill the field. */
  topic: string;
  level: ExamLevel;
  count: number;
  /** An id from `EXAM_TARGETS`, or `other`. `other` means no exam targeting at all. */
  targetExam: string;
  /** What the student typed when they chose `other`. '' otherwise, and ignored otherwise. */
  targetExamOther: string;
  /**
   * An id from `EXAM_LANGUAGES`. Optional so a spec written before the field existed still type-checks;
   * absent reads exactly like `auto`.
   */
  language?: string;
}

function text(v: unknown, max: number): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Clean a requested spec into one the generator can be held to.
 *
 * ⚠️ An unreadable count falls back to the DEFAULT, never to the maximum: a typo must not spend the
 * largest paper this module allows. A count outside the range is clamped rather than refused, because
 * "40" plainly means "as many as you can" and refusing it teaches nothing.
 */
export function normalizeExamSpec(raw: {
  subject?: unknown; topic?: unknown; level?: unknown; count?: unknown;
  targetExam?: unknown; targetExamOther?: unknown; language?: unknown;
} | null | undefined): ExamSpec {
  const r = raw || {};
  const level = EXAM_LEVELS.includes(r.level as ExamLevel) ? (r.level as ExamLevel) : 'mix';
  const asked = Number(r.count);
  const count = Number.isFinite(asked)
    ? Math.min(EXAM_MAX_QUESTIONS, Math.max(EXAM_MIN_QUESTIONS, Math.round(asked)))
    : EXAM_DEFAULT_QUESTIONS;
  // An id we do not know reads as `other`, never as an exam we then describe to the generator —
  // inventing a standard for a name nobody recognised is the one failure this field could produce.
  const targetExam = examTarget(r.targetExam)?.id ?? EXAM_TARGET_OTHER;
  return {
    subject: text(r.subject, 80),
    topic: text(r.topic, 120),
    level,
    count,
    targetExam,
    targetExamOther: targetExam === EXAM_TARGET_OTHER ? text(r.targetExamOther, 80) : '',
    language: examLanguage(r.language)?.id ?? EXAM_LANGUAGE_AUTO,
  };
}

/**
 * Is there enough here to set a paper at all?
 *
 * 🔑 **A named exam stands in for the subject, and that is deliberate.** "Set me a NEET paper" is a
 * complete request — a real NEET paper is a mixed Physics, Chemistry and Biology paper, so the exam
 * already says what to ask about. Refusing it for want of a subject would be refusing the most
 * natural thing a student will type. With neither an exam nor a subject there is genuinely nothing
 * to set a paper on, and that is the one case this returns false for.
 */
export function examSpecIsUsable(spec: ExamSpec): boolean {
  return spec.subject.length > 0 || examTargetLabel(spec).length > 0;
}

/** What to call the chosen exam on screen and in the prompt. '' when no exam was chosen. */
export function examTargetLabel(spec: Pick<ExamSpec, 'targetExam' | 'targetExamOther'>): string {
  return examTarget(spec.targetExam)?.label || String(spec.targetExamOther || '').trim();
}

/**
 * How the chosen exam reads to the generator. '' when none was chosen — the whole exam clause then
 * disappears from the prompt rather than becoming a sentence saying nothing.
 *
 * ⚠️ **A typed `other` gets no brief, only its name**, because we have no verified description of an
 * exam we do not carry. Handing the generator an invented syllabus for a name we do not recognise is
 * exactly the plausible-looking falsehood this module refuses everywhere else.
 */
export function examTargetBrief(spec: Pick<ExamSpec, 'targetExam' | 'targetExamOther'>): string {
  const known = examTarget(spec.targetExam);
  if (known) {
    return `The student is preparing for ${known.label}. ${known.brief} Pitch every question at exactly that exam's standard, syllabus scope and question style — not harder, not easier, and not a different board's treatment of the same chapter.`;
  }
  const typed = String(spec.targetExamOther || '').trim();
  if (!typed) return '';
  return `The student is preparing for: ${typed}. Pitch every question at that exam's own standard, scope and question style. If you do not know that exam, say nothing about it and simply set a sound paper on the scope below.`;
}

/** How each level reads to the generator. `mix` is a DISTRIBUTION, which is why it is spelled out. */
export function levelBrief(level: ExamLevel): string {
  switch (level) {
    case 'low':
      return 'EASY — direct recall and one-step application. A student who has read the chapter once should get most of these right.';
    case 'medium':
      return 'MEDIUM — understanding and two-step application: the student must connect two ideas or work a short calculation.';
    case 'hard':
      return 'HARD — analysis, multi-step problems, close distinctions and common traps, at competitive-exam standard.';
    case 'mix':
      return 'MIXED — roughly 30% easy, 45% medium and 25% hard, ordered easy-first so the student warms up before the difficult ones.';
  }
}

export interface ExamQuestion {
  /** 1-based, as the student sees it. */
  n: number;
  question: string;
  /** Exactly four. Order is the order shown. */
  options: [string, string, string, string];
  /** 0–3. Exactly one. */
  correctIndex: number;
  /** Why that option is right — and, where it matters, why the tempting one is wrong. */
  explanation: string;
  /** The sub-topic this question tests, so the result can name what to revise. '' when unstated. */
  topic: string;
  /** The generator's own difficulty label, for a mixed paper's own honesty. */
  level?: 'low' | 'medium' | 'hard';
}

/**
 * The subject and topic AS THE GENERATOR UNDERSTOOD THEM — the spelling answer, reported back.
 *
 * 🔑 Admin: *"student spelling mistacks kar sakte hai … llm call ke jariye isko sahi liya jaye aur
 * user ko paresani na ho."* The correction is done by the SAME call that writes the paper (rule 11
 * above), not by a second one, and this is that call telling us what it read.
 *
 * ⚠️ **It is never used to overwrite what the student typed.** Both are kept: what they wrote is
 * what they wrote, and this is what the paper was actually set on. The surface shows the difference
 * when there is one, so a wrong guess is visible and one press away from being corrected — the
 * opposite of a silent "correction" that hands a student a paper on the wrong subject.
 */
export interface ExamReading {
  subject: string;
  topic: string;
}

/** What a paper came back as. `dropped` is never hidden — see the module header. */
export interface ExamPaper {
  questions: ExamQuestion[];
  /** Malformed entries that were refused. > 0 means the surface must say the paper is short. */
  dropped: number;
  /** What the generator says it read the scope as. `null` when it did not say. */
  read: ExamReading | null;
}

/**
 * The contract the generator is held to.
 *
 * 🔒 Every rule here exists because its absence produces a specific bad question. They are stated as
 * requirements rather than suggestions because the parser below REFUSES anything that breaks them —
 * a prompt that asks nicely and a parser that insists is the combination that cannot ship a
 * three-option question.
 */
/**
 * 📄 THE PAPER'S COMPOSITION — 40% past-paper questions, 30% close variants, 30% fresh but likely
 * (admin 2026-09-24, verbatim: *"40% = pyq · 30% = pyq se milte julte · 30% = new but, exam me ane
 * ki puri sambhavna"*).
 *
 * 🔴 AND IT PRINTS NOTHING ON THE SCREEN — that is the whole design, not an omission.
 *
 * The first draft of this was going to tag each question ("Past paper", "UPSC 2019"). The admin
 * removed the idea in one sentence: *"hame yeh sabit hi nahi karna hai ki yeh pyq hai, hame bs
 * question dene hai. user khud samajh jayega."* They are right, and the reason is worth keeping so
 * nobody adds the badge back thinking it is an improvement:
 *
 *   **We cannot VERIFY that a question was really asked in a past paper.** A web search returns
 *   coaching blogs and PDF listings, not an authoritative bank; the generator's own word is not
 *   evidence. So a "PYQ" badge is a claim this platform cannot stand behind — and it would be made
 *   to a student, about their own exam, where a false fact costs real marks. The second absolute
 *   rule's two states apply exactly: a badge we cannot prove is "built but not really working".
 *
 * Composition is a different thing from provenance, and it survives the same objection: asking the
 * generator to DRAW 40% of the paper from questions that have genuinely appeared makes the paper
 * better whether or not any individual one can be traced. The student reads the questions and judges
 * for themselves — which is what they already do with every coaching book they own.
 *
 * ⚠️ IT ONLY APPLIES WHEN AN EXAM IS SELECTED, and that is a correctness rule rather than a caution.
 * "Previous year" has no referent without a paper it is previous to: on a plain "Trigonometry, medium,
 * 10 questions" there is no past paper to draw from, and demanding 40% of one would be asking the
 * generator to invent a provenance. The condition is `examTargetBrief` returning something — the SAME
 * answer the prompt already uses to decide it knows the exam, never a second rule that can disagree
 * with it.
 */
export interface ExamBlend {
  /** Questions drawn from ones that have genuinely appeared in that exam's past papers. */
  past: number;
  /** Close variants — the same idea and difficulty, re-cut so it is not a copy. */
  similar: number;
  /** New questions that fit the exam's current pattern and are genuinely likely to appear. */
  fresh: number;
}

/** The admin's split, as fractions. Named so the three numbers exist in exactly one place. */
const BLEND_PAST = 0.4;
const BLEND_SIMILAR = 0.3;

/**
 * Split `count` into the three buckets as WHOLE questions that sum to exactly `count`.
 *
 * Largest-remainder, with ties broken toward `past` then `similar` — so a paper can never be one
 * question short or long, and a SMALL paper still leads with the bucket the admin weighted highest
 * (5 → 2/2/1, 3 → 1/1/1, 1 → 1/0/0). A naive `Math.round` on each share does not have that property:
 * it gives 2/2/2 for a 5-question paper, i.e. a sixth question nobody asked for.
 *
 * PURE.
 */
export function examBlend(count: number): ExamBlend {
  const raw = Number(count);
  // `Math.floor(Infinity)` is Infinity, so the guard has to be finiteness and not just `|| 0`.
  // `normalizeExamSpec` clamps to 1..EXAM_MAX_QUESTIONS long before this, but a function whose whole
  // job is "these three numbers add up" must be total on its own.
  const n = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
  if (n <= 0) return { past: 0, similar: 0, fresh: 0 };
  const exact = [n * BLEND_PAST, n * BLEND_SIMILAR, n * (1 - BLEND_PAST - BLEND_SIMILAR)];
  const base = exact.map((x) => Math.floor(x));
  let left = n - base.reduce((a, b) => a + b, 0);
  // Order by remainder, descending; a tie keeps the declaration order (past, similar, fresh).
  const order = exact
    .map((x, i) => ({ i, rem: x - Math.floor(x) }))
    .sort((a, b) => (b.rem - a.rem) || (a.i - b.i));
  for (const { i } of order) {
    if (left <= 0) break;
    base[i] += 1;
    left -= 1;
  }
  return { past: base[0], similar: base[1], fresh: base[2] };
}

/**
 * The composition paragraph, or '' when it does not apply.
 *
 * '' for: the feature switched off, no exam selected, or a bucket count of zero on a paper too small
 * to carry three kinds. An empty string leaves `examPaperInstruction` byte-identical to what it built
 * before this existed, which is what makes the kill switch a real revert.
 */
export function examBlendInstruction(spec: ExamSpec, enabled: boolean): string {
  if (!enabled) return '';
  if (!examTargetBrief(spec)) return '';
  const b = examBlend(spec.count);
  if (b.past <= 0) return '';
  const lines = [
    `COMPOSITION — set the paper from three kinds of question, in these exact numbers:`,
    `• ${b.past} that have genuinely been ASKED IN PAST PAPERS of this exam. Draw on the real papers you know. Keep the question's own difficulty and phrasing style rather than simplifying it.`,
  ];
  if (b.similar > 0) {
    lines.push(`• ${b.similar} CLOSE VARIANTS of past questions — the same concept and the same standard, re-cut with different numbers, a different case or a different angle so it is a fresh question rather than a copy.`);
  }
  if (b.fresh > 0) {
    lines.push(`• ${b.fresh} NEW questions that have a real chance of appearing next — built on the topics this exam has been weighting recently and the way it has been framing them.`);
  }
  lines.push(
    `Mix the three kinds throughout the paper; do not put them in blocks.`,
    // 🔒 The one thing the generator must NOT do, stated to it directly. Without this line a model
    // routinely writes "(UPSC 2019)" into the question text itself, which puts the unverifiable claim
    // back on the student's screen through the one field that is printed verbatim.
    `Do NOT label any question with a year, a paper name or which of the three kinds it is — not in the question, not in the explanation, not anywhere. The student is given the questions, not a provenance claim.`,
  );
  return lines.join('\n');
}

/**
 * Is the composition rule applied at all? ON unless explicitly `off`.
 *
 * `PROFESSIONAL_EXAM_PYQ=off` is the instant, no-deploy revert: `examBlendInstruction` then returns
 * '' and `examPaperInstruction` is byte-identical to what it built before this existed. Default ON
 * because the admin asked for it and a feature that needs a console key before it does anything is
 * how "10 free messages" stayed switched off in this same directory for two months.
 *
 * ⚠️ Read HERE rather than imported from `professionalPaid.ts` on purpose: this module has no imports
 * at all, and that is what lets every function in it be unit-tested without a server. A bare
 * `process.env` read keeps that property; an import would not.
 */
export function examPyqEnabled(): boolean {
  return String(process.env.PROFESSIONAL_EXAM_PYQ || '').trim().toLowerCase() !== 'off';
}

export function examPaperInstruction(spec: ExamSpec): string {
  const exam = examTargetBrief(spec);
  const subject = spec.subject || (exam ? 'the subjects that exam itself tests — spread the paper across them as the real paper does' : '');
  const scope = spec.topic ? `${subject} — specifically: ${spec.topic}` : `${subject} (cover it broadly)`;
  const blend = examBlendInstruction(spec, examPyqEnabled());
  return [
    `Set an objective (multiple-choice) test paper. Return ONLY JSON — no prose before or after, no markdown fence.`,
    ``,
    ...(exam ? [`EXAM: ${exam}`] : []),
    `SCOPE: ${scope}`,
    `DIFFICULTY: ${levelBrief(spec.level)}`,
    `NUMBER OF QUESTIONS: exactly ${spec.count}.`,
    ``,
    ...(blend ? [blend, ``] : []),
    `SHAPE — a JSON object: { "read": { "subject": string, "topic": string }, "questions": [ { "question": string, "options": [string, string, string, string], "correctIndex": 0-3, "explanation": string, "topic": string, "level": "low" | "medium" | "hard" } ] }`,
    ``,
    `RULES, all of them required:`,
    `1. EXACTLY four options per question. Never three, never five.`,
    `2. EXACTLY one option is correct, and "correctIndex" points at it. Never two defensible answers.`,
    `3. The three wrong options must be PLAUSIBLE — the mistakes a real student actually makes. Never filler, never obviously absurd, never "None of the above" as the answer.`,
    `4. Vary which position is correct across the paper. Do not favour any one index.`,
    `5. "explanation" says why the right option is right AND, when one wrong option is tempting, why that one is wrong. Two to four sentences. This is the part the student learns from.`,
    `6. "topic" is the specific sub-topic tested (e.g. "Thermodynamics — first law"), so the student can be told what to revise.`,
    `7. Each option is a standalone answer, under about 120 characters. Do not number or letter them — the surface does that.`,
    `8. Factually correct, at the stated standard, and answerable without a diagram unless the question text itself contains everything needed.`,
    `9. No duplicate or near-duplicate questions.`,
    `10. ${examLanguageRule(spec)}`,
    `11. SPELLING — the SCOPE above was typed by a student and may be MISSPELLED, run together or written phonetically ("trignometry", "bayology", "mugal empire", "thermodynmics"). Work out what they meant and set the paper on THAT. Correct only what is plainly a typo or a phonetic spelling of a real subject; if a word is genuinely unfamiliar, keep it exactly as written rather than turning it into a different subject that happens to look similar.`,
    `12. "read" reports the subject and topic BACK, spelled correctly, as you understood them. Put "" for the topic if none was given, and "" for the subject if you set the paper from the exam rather than from a subject. The student is shown this, so it must be what you actually set the paper on — never a tidied-up echo of something you ignored.`,
  ].join('\n');
}

/** Pull the JSON object out of a reply that may still be wrapped in a fence or prose. */
function extractJson(raw: string): unknown {
  const s = String(raw ?? '');
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : s).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

function optionText(v: unknown): string {
  // A leading "A)" / "(b)." / "3." is stripped: the surface numbers the options itself, and a label
  // printed inside one reads as a typo next to the real one.
  return text(v, 200).replace(/^\s*[(\[]?[A-Da-d1-4][)\].:-]\s+/, '').trim();
}

/** A question is valid or it is refused — never repaired into something the generator did not say. */
function validQuestion(raw: unknown, n: number): ExamQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const q = raw as Record<string, unknown>;
  const question = text(q.question, 600);
  const explanation = text(q.explanation, 1200);
  const list = Array.isArray(q.options) ? q.options.map(optionText) : [];
  const idx = Number(q.correctIndex);
  if (!question || !explanation) return null;
  if (list.length !== 4 || list.some((o) => !o)) return null;
  // Two identical options make the answer ambiguous even when `correctIndex` is one of them.
  if (new Set(list.map((o) => o.toLowerCase())).size !== 4) return null;
  if (!Number.isInteger(idx) || idx < 0 || idx > 3) return null;
  const level = q.level === 'low' || q.level === 'medium' || q.level === 'hard' ? q.level : undefined;
  return {
    n,
    question,
    options: [list[0], list[1], list[2], list[3]],
    correctIndex: idx,
    explanation,
    topic: text(q.topic, 120),
    ...(level ? { level } : {}),
  };
}

/**
 * Read a generated paper. Returns the questions that are genuinely usable, and how many were not.
 *
 * ⚠️ **A short paper is reported, never padded.** Silently handing back 7 questions for a request of
 * 10 makes the score's denominator a number the student did not choose; inventing the missing 3 would
 * be worse still. `dropped` is the count the surface says out loud.
 */
export function parseExamPaper(raw: string, cap = EXAM_MAX_QUESTIONS): ExamPaper {
  const parsed = extractJson(raw);
  const list = parsed && typeof parsed === 'object' && Array.isArray((parsed as { questions?: unknown }).questions)
    ? (parsed as { questions: unknown[] }).questions
    : [];
  const readRaw = parsed && typeof parsed === 'object' ? (parsed as { read?: unknown }).read : null;
  const readSubject = readRaw && typeof readRaw === 'object' ? text((readRaw as Record<string, unknown>).subject, 80) : '';
  const readTopic = readRaw && typeof readRaw === 'object' ? text((readRaw as Record<string, unknown>).topic, 120) : '';
  // A reading with no subject in it says nothing, so it is `null` rather than an empty shape the
  // surface would then have to special-case.
  const read: ExamReading | null = readSubject || readTopic ? { subject: readSubject, topic: readTopic } : null;
  const out: ExamQuestion[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  for (const item of list) {
    if (out.length >= Math.max(1, cap)) { dropped += 1; continue; }
    const q = validQuestion(item, out.length + 1);
    if (!q) { dropped += 1; continue; }
    // Letters and digits of ANY script: the old key kept only Latin and Devanagari, so a paper in
    // Tamil, Bengali or Urdu reduced every question to '' and its duplicates were never caught.
    const key = q.question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (key && seen.has(key)) { dropped += 1; continue; }
    if (key) seen.add(key);
    out.push(q);
  }
  return { questions: out, dropped, read };
}

/**
 * One answer as the student gave it.
 *
 * `chosen: null` IS the skip, and it is a value rather than an absent key so a paper can distinguish
 * *"not reached"* (no entry at all) from *"deliberately left blank"*.
 */
export interface ExamAnswer {
  n: number;
  chosen: number | null;
}

export interface ExamTopicScore {
  topic: string;
  asked: number;
  correct: number;
}

export interface ExamScore {
  total: number;
  attempted: number;
  correct: number;
  wrong: number;
  skipped: number;
  /** Not reached at all — a paper abandoned half way is not a paper of wrong answers. */
  unseen: number;
  marks: number;
  maxMarks: number;
  /**
   * THE percentage: marks ÷ maximum marks × 100, two decimals, the way every board and entrance exam
   * reports it. Negative when negative marking took the total below zero — reported as it is.
   */
  percentage: number;
  /** Of the questions ATTEMPTED. A paper of one right answer and 29 skips is not 100% — see below. */
  accuracyPct: number;
  perTopic: ExamTopicScore[];
  /** Topics where the student got less than half right. Ordered worst first. */
  weakTopics: string[];
}

/**
 * The scoreboard. Arithmetic over the paper, never over anything the client asserted.
 *
 * 🔒 **`percentage` is over the WHOLE PAPER; `accuracyPct` is over ATTEMPTED.** Those are two honest
 * numbers that answer two different questions ("what did this exam score?" and "how good were my
 * answers?"), and collapsing them into one is how a student who skipped 29 of 30 sees "100%".
 *
 * 🔴 **THE RESULT SCREEN USED TO HAVE ONLY THE SECOND, and printed it as THE percentage (admin
 * 2026-09-25, phone screenshot: 16 / 20 marks, "100%").** No board or entrance exam reports a
 * percentage over attempted questions: `percentage = marks / maxMarks × 100`, full stop. Accuracy is
 * a useful side number and is shown as one — small, and labelled "accuracy", never "%" alone.
 */
export function scoreExam(
  questions: readonly ExamQuestion[],
  answers: readonly ExamAnswer[],
): ExamScore {
  const byN = new Map<number, ExamAnswer>();
  for (const a of answers || []) {
    if (a && Number.isInteger(a.n)) byN.set(a.n, a);
  }
  const topics = new Map<string, ExamTopicScore>();
  let correct = 0, wrong = 0, skipped = 0, unseen = 0, marks = 0;
  for (const q of questions) {
    const a = byN.get(q.n);
    const isCorrect = !!a && a.chosen === q.correctIndex;
    if (!a) unseen += 1;
    else if (a.chosen === null) { skipped += 1; marks += EXAM_MARK_SKIPPED; }
    else if (isCorrect) { correct += 1; marks += EXAM_MARK_CORRECT; }
    else { wrong += 1; marks += EXAM_MARK_WRONG; }
    const name = q.topic || 'General';
    const row = topics.get(name) ?? { topic: name, asked: 0, correct: 0 };
    row.asked += 1;
    if (isCorrect) row.correct += 1;
    topics.set(name, row);
  }
  const attempted = correct + wrong;
  const perTopic = [...topics.values()].sort((a, b) => a.topic.localeCompare(b.topic));
  return {
    total: questions.length,
    attempted,
    correct,
    wrong,
    skipped,
    unseen,
    marks,
    maxMarks: questions.length * EXAM_MARK_CORRECT,
    percentage: examPercentage(marks, questions.length * EXAM_MARK_CORRECT),
    accuracyPct: attempted > 0 ? Math.round((correct / attempted) * 100) : 0,
    perTopic,
    weakTopics: perTopic
      .filter((t) => t.asked > 0 && t.correct * 2 < t.asked)
      .sort((a, b) => (a.correct / a.asked) - (b.correct / b.asked))
      .map((t) => t.topic),
  };
}

/**
 * marks ÷ maximum × 100, rounded to two decimals (16/20 → 80, 7/30 → 23.33). A paper with no maximum
 * has no percentage, so it is 0 rather than NaN or Infinity.
 */
export function examPercentage(marks: number, maxMarks: number): number {
  if (!Number.isFinite(marks) || !Number.isFinite(maxMarks) || maxMarks <= 0) return 0;
  return Math.round((marks / maxMarks) * 10000) / 100;
}

/** "80%", "23.33%", "-5%" — two decimals only when they carry something. */
export function formatExamPercentage(pct: number): string {
  const n = Number.isFinite(pct) ? pct : 0;
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, '')}%`;
}

/**
 * The honest closing line. Encouraging without lying about the number — a student who scored 20% is
 * not told "great work", and a student who scored 90% is not given a lecture.
 *
 * ⚠️ It reads the PERCENTAGE (marks against the maximum), not accuracy, because that is the number an
 * exam gives you — and it is the number the sentence leads with.
 * A paper with nothing attempted gets its own sentence rather than "0%" — those are different days.
 */
export function examVerdict(score: ExamScore): string {
  if (score.total === 0) return 'No questions were set, so there is nothing to score.';
  if (score.attempted === 0) {
    return `You did not attempt any of the ${score.total}. Nothing is lost — skipping costs no marks. Try a few at an easier level to get started.`;
  }
  const pct = score.percentage;
  const head = `${score.marks} out of ${score.maxMarks} marks · ${formatExamPercentage(pct)}.`;
  if (pct >= 85) return `${head} This is exam-ready. Keep the pace and move to a harder level.`;
  if (pct >= 65) return `${head} A solid paper. The marks you lost are worth one careful revision, not a re-read of everything.`;
  if (pct >= 40) return `${head} The base is there and the gaps are specific — work through the explanations below before the next paper.`;
  if (pct >= 0) return `${head} This topic needs teaching before testing. Ask me to explain the ones you got wrong and then take it again.`;
  return `${head} Negative marks mean the guesses cost more than they earned — on the next paper, skip what you truly do not know. Then let me teach these.`;
}

/**
 * The message the result screen hands back to the chat, so the exam ENDS IN TEACHING.
 *
 * 🔑 This is the feature's point: a score tells a student where they are and changes nothing. Naming
 * the exact questions they lost marks on turns the paper into the lesson plan. Returns '' when there
 * is nothing to teach, so the surface can hide the button rather than offer an empty one.
 */
export function teachMyMistakesPrompt(
  questions: readonly ExamQuestion[],
  answers: readonly ExamAnswer[],
  spec: ExamSpec,
): string {
  const byN = new Map<number, ExamAnswer>();
  for (const a of answers || []) if (a && Number.isInteger(a.n)) byN.set(a.n, a);
  const missed = questions.filter((q) => {
    const a = byN.get(q.n);
    return !a || a.chosen === null || a.chosen !== q.correctIndex;
  });
  if (missed.length === 0) return '';
  const lines = missed.slice(0, 10).map((q) => {
    const a = byN.get(q.n);
    const mine = !a || a.chosen === null ? 'left it blank' : `chose "${q.options[a.chosen as number]}"`;
    return `${q.n}. ${q.question} — I ${mine}; the answer was "${q.options[q.correctIndex]}"${q.topic ? ` (${q.topic})` : ''}`;
  });
  const scope = spec.topic ? `${spec.subject} (${spec.topic})` : spec.subject;
  const exam = examTargetLabel(spec);
  return [
    // The exam travels with the request, because how to teach a missed question depends on it: the
    // same wrong answer needs a different explanation for a Class 12 student and a JEE candidate.
    exam ? `I am preparing for ${exam}.` : '',
    `I just took an exam-mode test on ${scope || exam} and got these wrong or left them blank:`,
    '',
    ...lines,
    missed.length > 10 ? `…and ${missed.length - 10} more.` : '',
    '',
    'Teach me these properly — the concept behind each one, why the option I picked is wrong, and a memory hook so I do not make the same mistake again.',
    // The paper was set in this language, so the lesson that follows it is too.
    examLanguage(spec.language) ? `Please teach me in ${examLanguage(spec.language)!.promptName}.` : '',
  ].filter((l) => l !== '').join('\n');
}
