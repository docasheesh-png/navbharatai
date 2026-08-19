// Tests for the treatment-grade report cross-check (admin 2026-08-18: "doctor isi report se patient
// ko treatment start kar sakta hai") — the audit contract that puts the actual report in front of the
// second AI.

import { describe, it, expect } from 'vitest';
import { buildAuditPrompt, buildAuditContents } from './reportAudit';

describe('buildAuditPrompt', () => {
  it('with a report attached, the auditor is told to RE-READ the report itself', () => {
    const p = buildAuditPrompt('case', 'reply', true);
    expect(p).toContain('REPORT CROSS-CHECK');
    expect(p).toContain('re-read the attached report YOURSELF');
    // The stake is stated: treatment may start from this reading.
    expect(p).toContain('start treatment');
  });

  it('without a report, the prompt is the plain safety audit (no phantom-report instruction)', () => {
    const p = buildAuditPrompt('case', 'reply', false);
    expect(p).not.toContain('REPORT CROSS-CHECK');
    expect(p).toContain('SAFETY AUDIT');
  });

  it('carries the case context and the reply verbatim, and keeps the exact OK pass contract', () => {
    const p = buildAuditPrompt('CASE-XYZ', 'REPLY-ABC', true);
    expect(p).toContain('CASE-XYZ');
    expect(p).toContain('REPLY-ABC');
    expect(p).toContain('output EXACTLY: OK');
  });
});

describe('buildAuditContents', () => {
  it('puts the report file BEFORE the instruction so the auditor sees what it must verify', () => {
    const contents = buildAuditContents('check it', { fileData: 'b64', fileType: 'image/jpeg', fileName: 'ecg.jpg' });
    expect(contents).toHaveLength(1);
    expect(contents[0].parts).toHaveLength(2);
    expect(contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'b64' } });
    expect(contents[0].parts[1]).toEqual({ text: 'check it' });
  });

  it('without a file it is the plain text shape the audit always used', () => {
    const contents = buildAuditContents('check it');
    expect(contents[0].parts).toEqual([{ text: 'check it' }]);
    expect(buildAuditContents('x', null)[0].parts).toEqual([{ text: 'x' }]);
  });

  it('an empty payload never produces a broken inlineData part', () => {
    const contents = buildAuditContents('x', { fileData: '', fileType: 'image/png', fileName: 'r.png' });
    expect(contents[0].parts).toEqual([{ text: 'x' }]);
  });
});
