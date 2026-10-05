// Forensic audit 2026-10-04 (P1) — a Professional turn spends nothing until its gate has allowed it.
//
// POST /api/professional/:id/chat read the attachments FIRST — up to four images through the paid vision
// chain (Gemini → Grok → Claude) — and only then asked the Pass gate, which refused anonymous and
// out-of-quota callers. The refused caller had already been served the paid vision calls, and a
// free-tier turn could reach Claude. The gate now runs before any attachment is read.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/server/routes/professionals.ts', 'utf8');
const chat = src.slice(src.indexOf("app.post('/api/professional/:id/chat'"), src.indexOf("app.post('/api/professional/:id/exam'"));

describe('the chat turn is gated before it spends', () => {
  it('the Pass gate runs before documents are read and before vision is called', () => {
    const gate = chat.indexOf('await gateProfessionalTurn(');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(chat.indexOf('buildDocumentContext(rawAttachments)'));
    expect(gate).toBeLessThan(chat.indexOf('describeVisionAttachments(rawAttachments'));
  });

  it('a free-tier turn never lists the Claude vision rung', () => {
    expect(chat).toMatch(/gate\.tier === 'free' \? \{ noClaude: true \} : \{\}/);
  });
});
