/**
 * 🔴 A BULLETED SPEC IS NOT PASTED CODE (merge of #3426 and #3427, 2026-10-01).
 *
 * `isCodeLine` counted any line beginning with `* ` as a comment — the shape of a JSDoc continuation —
 * so a written specification in Markdown ("## Overview\n* Total Advertisers\n* Active Campaigns…") was
 * read as pasted SOURCE by `isPastedSource`, and `withoutMachineText` then handed every sizer the 62
 * characters around it: `countEnumeratedFeatures` saw 0 parts in a 35-line spec, so the spec detector,
 * the mega-project gate and the complexity score all read nothing. #3427's own tests caught it the
 * moment the two PRs met. Found by the merging session; fixed where the two shapes are told apart.
 *
 * Reversion-proven: restoring `\*\s` to the comment test fails `a Markdown spec is prose`; dropping the
 * block-comment tracking fails `a JSDoc block inside pasted code still counts`.
 */
import { describe, it, expect } from 'vitest';
import { isPastedSource, isCodeLine, readablePrompt } from '../src/server/lib/pastedSource';
import { withoutMachineText } from '../src/server/lib/machineText';
import { countEnumeratedFeatures } from '../src/server/AgentV3/enumeratedFeatures';

const SPEC = [
  'Ads & Rewards Dashboard — the full control center.',
  '## Overview', '* Total Advertisers', '* Active Campaigns', '* Total Ad Impressions', '* Verified Clicks',
  '## Campaigns', '* Campaign Name', '* Start Date', '* Daily Budget', '* Reward Budget',
  '## Delivery Controls', '* Frequency Cap', '* Placement Eligibility', '* Schedule', '* Pacing',
  '## Moderation', '* Ad Review', '* Pending Review', '* Review Checks', '* Appeals',
  '## Reports', '* Campaign Report', '* Scheduled Reports', '* Revenue Report',
  '## Settings', '* Notification Settings', '* Billing Settings', '* Security Settings',
].join('\n');

describe('a bulleted spec is not pasted code', () => {
  it('a Markdown spec is prose: not pasted source, returned to every reader unchanged', () => {
    expect(isCodeLine('* Total Advertisers')).toBe(false);
    expect(isCodeLine('*   Daily Budget')).toBe(false);
    expect(isPastedSource(SPEC)).toBe(false);
    expect(readablePrompt(SPEC)).toBe(SPEC);
    expect(withoutMachineText(SPEC)).toBe(SPEC);
    expect(countEnumeratedFeatures(SPEC)).toBeGreaterThanOrEqual(14);
  });

  it('a JSDoc block inside pasted code still counts as code', () => {
    const js = [
      '/**',
      ' * Adds two numbers.',
      ' * @param a first',
      ' * @param b second',
      ' */',
      'function add(a, b) {',
      '  return a + b;',
      '}',
      'const total = add(1, 2);',
      'console.log(total);',
    ].join('\n');
    expect(isPastedSource(js)).toBe(true);
    // The block's continuation lines are code by position, not by their leading star.
    expect(isPastedSource(['/*', ' * only a comment', ' * and another', ' * and a third', ' */', 'x = 1;', 'y = 2;', 'z = 3;', 'w = 4;'].join('\n'))).toBe(true);
  });

  it('the a106df77 shape is unchanged: a whole pasted HTML page is still pasted source', () => {
    const html = ['<!doctype html>', '<html lang="en">', '<head>', '<title>Bill Maker</title>', '<style>', 'body{margin:0}', '</style>', '</head>', '<body>', '<h1>Bill Maker</h1>', '<script>', 'const items = [];', '</script>', '</body>', '</html>'].join('\n');
    expect(isPastedSource(html)).toBe(true);
    expect(withoutMachineText(html)).not.toContain('<style>');
  });
});
