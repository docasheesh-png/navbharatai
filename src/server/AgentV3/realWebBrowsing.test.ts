// "Can NavBharatAI Pro open a real-world website and show it, like a live browser?" (admin 2026-08-04)
//
// The answer was yes, and the surprising part was WHY it did not already happen: the sandbox has always
// run a real Chromium via Playwright, and `screenshot` / `browser_action` always accepted any URL — but
// every description framed them as "test YOUR OWN app". So the model never considered visiting a real
// site and answered questions about real websites from memory instead. Nothing was broken; the
// capability was simply invisible to the one thing that could use it.
//
// These tests lock the unlock: the tools SAY they reach the real web, the prompt tells v5 to go and look
// rather than guess, and the honesty rules that make that trustworthy are present.

import { describe, it, expect } from 'vitest';
import { architectSystemPrompt } from './systemPrompt';
import { defaultToolCatalog } from './ToolCatalog';

function toolDescription(name: string): string {
  const tools = defaultToolCatalog() as Array<{ name: string; description?: string }>;
  const tool = tools.find((t) => t.name === name);
  expect(tool, `${name} is missing from the tool catalog`).toBeTruthy();
  return tool!.description || '';
}

describe('the tools advertise the real web, not just the sandbox', () => {
  it('browser_action says it drives a real browser on any public site', () => {
    const d = toolDescription('browser_action');
    expect(d).toMatch(/real Chrome browser/i);
    expect(d).toMatch(/any public https address|real website/i);
    // The steering that actually changes behaviour: look, do not recall.
    expect(d).toMatch(/GO AND LOOK AT IT rather than guessing/i);
  });

  it('screenshot says it can capture any real website too', () => {
    const d = toolDescription('screenshot');
    expect(d).toMatch(/ANY REAL WEBSITE/i);
    // …without losing its original, still-primary job.
    expect(d).toMatch(/localhost|preview URL/i);
  });

  it('and both still say a real sandbox is required — no fake capability', () => {
    for (const name of ['browser_action', 'screenshot']) {
      expect(toolDescription(name)).toMatch(/Requires a real sandbox/i);
    }
  });
});

describe('v5 knows it may browse, and how to be honest about it', () => {
  const prompt = architectSystemPrompt();

  it('states the capability plainly — this is the whole unlock', () => {
    expect(prompt).toMatch(/BROWSE THE REAL INTERNET/i);
  });

  it('tells it to go and look instead of answering from memory', () => {
    expect(prompt).toMatch(/GO AND LOOK/);
    expect(prompt).toMatch(/Do not answer from memory/i);
  });

  it('forbids claiming to have seen a page it never opened', () => {
    expect(prompt).toMatch(/never claim to have seen a page you did not open/i);
  });

  it('requires honesty when a page fails to load, instead of inventing it', () => {
    expect(prompt).toMatch(/fails to load or is blocked, say so/i);
    expect(prompt).toMatch(/rather than inventing/i);
  });

  it('says internal addresses are refused, so it does not waste turns retrying them', () => {
    expect(prompt).toMatch(/Internal\/private addresses are refused/i);
  });

  it('draws the copyright line: ideas and structure, never a site’s content', () => {
    expect(prompt).toMatch(/Copy IDEAS and STRUCTURE/i);
    expect(prompt).toMatch(/never a site.{0,3}s copyrighted text, images or logos/i);
  });
});
