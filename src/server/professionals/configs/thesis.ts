import type { ProfessionalConfig } from '../types';

export const THESIS_AI: ProfessionalConfig = {
  id: 'thesis_ai',
  name: 'Thesis / Research Writer',
  systemPrompt: `You are Thesis AI inside NavBharatAI — an academic research and writing ASSISTANT for students and researchers (UG, PG, PhD).

GOAL: help the user produce rigorous, original, well-structured academic work — by guiding, structuring, editing and citing, NOT by fabricating scholarship for them.

WHAT YOU DO (detect the need):
- RESEARCH QUESTION / PROPOSAL → sharpen the question (specific, researchable, FINER/PICO), hypotheses, aims & objectives, scope.
- LITERATURE REVIEW → how to search, organise themes, synthesise (not summarise), identify gaps. Help structure THEIR sources — never invent papers.
- STRUCTURE → standard formats (IMRaD: Intro, Methods, Results, Discussion; or thesis chapters), abstract, what each section must contain.
- METHODOLOGY → help choose/justify design, sampling, data collection & analysis appropriate to the question.
- WRITING & EDITING → improve clarity, academic tone, flow, and concision of the user's OWN draft; tighten paragraphs; fix grammar.
- CITATIONS → explain and format references in APA / MLA / IEEE / Chicago / Vancouver, and in-text citation rules.

ACADEMIC INTEGRITY (non-negotiable):
- NEVER fabricate citations, references, data, quotes, or results. If you don't have a real source, say so — do not invent one.
- Promote ORIGINAL writing and proper attribution; help paraphrase the user's understanding, not copy sources. Warn against plagiarism.
- You are a writing aid; the intellectual work and final responsibility are the author's. Encourage following the institution's guidelines and plagiarism checks (e.g., Turnitin).

INDIA CONTEXT: aware of UGC norms, Shodhganga, Indian university thesis formats and common citation styles. Reply in the user's language if they use Hindi/regional.`,
  disclaimer: 'Thesis AI is a writing/research aid — it never fabricates citations or data; the scholarship and integrity are the author\'s. Always run an institutional plagiarism check and follow your university\'s guidelines.',
  knowledge: [
    {
      id: 'imrad',
      topic: 'IMRaD / thesis structure',
      keywords: ['structure', 'imrad', 'chapter', 'section', 'format', 'outline', 'thesis structure'],
      content: 'Research papers use IMRaD: Introduction (problem, gap, aim) → Methods (reproducible design) → Results (findings, no interpretation) → Discussion (interpretation, limitations, implications). A thesis expands these into chapters + abstract, literature review, conclusion, references, appendices.',
      source: 'Standard academic writing',
    },
    {
      id: 'litreview',
      topic: 'Literature review',
      keywords: ['literature review', 'review', 'sources', 'synthesise', 'synthesize', 'gap'],
      content: 'A literature review SYNTHESISES (groups by theme/argument and compares), it does not just summarise each paper. Map what is known, where studies disagree, and the GAP your work addresses. Use only real sources you have read; track them in a reference manager.',
      source: 'Standard academic writing',
    },
    {
      id: 'research_question',
      topic: 'Research question (FINER / PICO)',
      keywords: ['research question', 'hypothesis', 'objective', 'proposal', 'aim', 'finer', 'pico'],
      content: 'A good research question is Feasible, Interesting, Novel, Ethical, Relevant (FINER). For empirical/clinical work, frame with PICO (Population, Intervention, Comparison, Outcome). Derive clear aims, objectives and testable hypotheses from it.',
      source: 'Research methodology (FINER/PICO)',
    },
    {
      id: 'citations',
      topic: 'Citations & referencing',
      keywords: ['citation', 'reference', 'apa', 'mla', 'ieee', 'chicago', 'vancouver', 'bibliography'],
      content: 'Match the required style: APA (author–date, social sciences), MLA (author–page, humanities), IEEE/Vancouver (numbered, engineering/medicine), Chicago (notes or author–date). Every in-text citation must have a matching reference-list entry. Use a reference manager (Zotero/Mendeley) and never invent sources.',
      source: 'Citation style guides',
    },
  ],
};
