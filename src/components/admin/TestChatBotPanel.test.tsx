import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TestChatBotPanel } from './TestChatBotPanel';
import { tabOfPage, resolvePage } from '../../lib/adminTabs';

describe('separate Test Chat Bot panel', () => {
  it('has actual text input, starts without inference, and discloses the gateway boundary', () => {
    const html = renderToStaticMarkup(<TestChatBotPanel adminToken="synthetic-admin-secret" />);
    expect(html).toContain('Test Chat Bot'); expect(html).toContain('<textarea'); expect(html).toContain('<select');
    expect(html).toContain('value="mitrify"'); expect(html).toContain('value="qubax"');
    expect(html).not.toContain('independent review of the exact payload');
    expect(html).toContain('Send to Qubax only'); expect(html).toContain('no NavBharatAI provider fallback');
    expect(html).toContain('Model (optional)'); expect(html).toContain('same cheapest-model selection as main chat');
    expect(html).toContain('upstream sellers'); expect(html).toContain('does not save transcripts');
    expect(html).toContain('This checkbox does not create those approvals'); expect(html).toContain('disabled');
    expect(html).not.toContain('synthetic-admin-secret'); expect(html).not.toContain('type="password"');
  });
  it('keeps conversation scrolling inside the visible mobile viewport with a fallback', () => {
    const html = renderToStaticMarkup(<TestChatBotPanel adminToken="synthetic-admin" />);
    expect(html).toContain('max-h-[50vh] supports-[height:100dvh]:max-h-[50dvh] min-h-0 overflow-y-auto');
  });
  it('has a separate admin page and never imports or calls the production chat service', () => {
    expect(tabOfPage('test-chat-bot')).toBe('engines'); expect(resolvePage('test-chat-bot')).toBe('test-chat-bot');
    const panel = readFileSync('src/components/admin/TestChatBotPanel.tsx', 'utf8');
    expect(panel).toContain('/api/v1/admin/test-chat-bot');
    expect(panel).toContain('Copy error details');
    expect(panel).toContain('Provider error details');
    expect(panel).toContain('Check Qubax balance');
    expect(panel).toContain('up to three');
    expect(panel).toContain('priced Qubax rows');
    expect(panel).toContain('Price feed');
    expect(panel).toContain('isAllowedTestChatModel');
    expect(panel).toContain('HTTP 504');
    expect(panel).toContain('provider-side gateway time-out');
    expect(panel).toContain('modelDraft');
    expect(panel).not.toContain('No automatic retry');
    expect(panel).not.toMatch(/localStorage|sessionStorage|authedFetch|AIService|useChatEngine|\/api\/chat/);
    expect(readFileSync('src/components/AdminDashboard.tsx', 'utf8')).toContain('<TestChatBotPanel adminToken={adminToken} />');
    expect(readFileSync('src/server/routes/admin.ts', 'utf8')).toContain('registerTestChatBotRoutes(app, verifyAdminToken)');
  });
});
