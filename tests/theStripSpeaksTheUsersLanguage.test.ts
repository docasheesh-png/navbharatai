// "ui clean and indian user ke liye useful banana hai" (admin, 2026-09-20).
//
// The live strip is the only window the person who asked for the app has onto the build, and it was
// reading `writing src/components/InvoiceForm.tsx`. These lock the two halves of the fix that matter:
// the directory noise goes, and NOTHING is invented in its place.

import { describe, it, expect } from 'vitest';
import { plainFileName, plainCommand } from '../src/components/agentv3/toolLabels';

describe('plainFileName', () => {
  it('drops the directories and spaces a screen name out', () => {
    expect(plainFileName('src/components/InvoiceForm.tsx')).toBe('Invoice form');
    expect(plainFileName('src/pages/CustomerList.tsx')).toBe('Customer list');
    expect(plainFileName('PaymentReceipt.jsx')).toBe('Payment receipt');
  });

  it('keeps acronyms readable instead of title-casing them into nonsense', () => {
    expect(plainFileName('src/lib/GstCalculator.ts')).toBe('GST calculator');
    expect(plainFileName('src/api/ApiClient.ts')).toBe('API client');
  });

  it('🔒 leaves a real identifier exactly as written', () => {
    // `useInvoices` is a name the user can meet again in Code Studio. "Use invoices" would be both a
    // worse sentence and a DIFFERENT word from the one in their project.
    expect(plainFileName('src/hooks/useInvoices.ts')).toBe('useInvoices');
    expect(plainFileName('src/lib/formatCurrency.ts')).toBe('formatCurrency');
  });

  it('names an index file by its folder, because "index" names nothing', () => {
    expect(plainFileName('src/pages/invoices/index.tsx')).toBe('invoices');
    expect(plainFileName('src/features/Billing/index.ts')).toBe('Billing');
  });

  it('says what the well-known files ARE', () => {
    expect(plainFileName('package.json')).toBe('project setup');
    expect(plainFileName('src/index.css')).toBe('styles');
    expect(plainFileName('index.html')).toBe('the page');
    expect(plainFileName('src/App.tsx')).toBe('the app');
  });

  it('is total — a path it cannot improve comes back unharmed', () => {
    expect(plainFileName('')).toBe('');
    expect(plainFileName('   ')).toBe('');
    expect(plainFileName('weird')).toBe('weird');
    expect(plainFileName('/')).toBe('/');
    expect(plainFileName('.env.local')).toBe('.env.local');
    expect(plainFileName(undefined as unknown as string)).toBe('');
  });

  it('handles Windows separators and a leading ./ the same way', () => {
    expect(plainFileName('.\\src\\components\\InvoiceForm.tsx')).toBe('Invoice form');
    expect(plainFileName('./src/components/InvoiceForm.tsx')).toBe('Invoice form');
  });
});

describe('plainCommand', () => {
  it('renames only the commands it recognises exactly', () => {
    expect(plainCommand('npm install --no-audit --no-fund')).toBe('installing packages');
    expect(plainCommand('npm run build')).toBe('building the app');
    expect(plainCommand('npm run dev -- --host')).toBe('starting the preview');
    expect(plainCommand('npx tsc --noEmit')).toBe('checking the code');
  });

  it('🔒 shows an unrecognised command as it was typed — never as a guess', () => {
    // "running a command" would hide a real fact; a made-up description would state a false one.
    expect(plainCommand('rm -rf dist')).toBe('rm -rf dist');
  });

  it('caps a very long command so one install line cannot take the whole strip', () => {
    const long = `node ${'x'.repeat(200)}`;
    const out = plainCommand(long);
    expect(out.length).toBeLessThanOrEqual(48);
    expect(out.endsWith('…')).toBe(true);
  });

  it('is total', () => {
    expect(plainCommand('')).toBe('a command');
    expect(plainCommand(undefined as unknown as string)).toBe('a command');
  });
});
