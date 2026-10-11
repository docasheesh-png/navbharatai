// A DEPLOY STEP THE CODE SETS IS A STEP THE USER SEES (Q-600 batch two, 2026-10-09).
//
// `GitPanel.tsx` maintained two pieces of real deploy state that nothing rendered:
//   • `activeStep` — set to 1 on validate/prepare, 2 on build/package and 3 on done, by every real
//     deploy path (the GitHub push, the static ZIP export, the managed Render deploy, and the
//     config-injection path);
//   • `currentBuildTime` — a 100 ms ticker measuring how long the running deploy has taken.
// A user watching a deploy therefore saw one pulsing word ("Building...") while the component knew
// exactly which step it was on and how many seconds had passed, and the ticker's state updates were
// re-rendering the panel ten times a second to display nothing.
//
// Same batch, opposite verdict: `BotBuilder.tsx` carried a webhook modal whose snippet was
// `POST https://your-server.com/webhook` with a `<exported_json>` placeholder — an endpoint that
// does not exist — superseded by the real Go Live flow (a Telegram token that connects the bot for
// real; WhatsApp's actual callback URL and verify token). Wiring that one up would have shipped a
// fake feature, so it was deleted. This test holds both halves: the real state stays rendered, and
// the placeholder copy does not come back.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const gitPanel = readFileSync(join(root, 'src/components/ide/GitPanel.tsx'), 'utf8');
const botBuilder = readFileSync(join(root, 'src/components/ide/BotBuilder.tsx'), 'utf8');

const labelsLine = gitPanel.split('\n').find((l) => l.includes('DEPLOY_STEP_LABELS = [')) ?? '';
const stepLabels = [...labelsLine.matchAll(/'([^']+)'/g)].map((m) => m[1]);

describe('the deploy panel shows the step and the time it already tracks', () => {
  it('declares a label for every step', () => {
    expect(stepLabels.length, 'DEPLOY_STEP_LABELS could not be parsed').toBeGreaterThan(1);
  });

  it('no setActiveStep call names a step with no label', () => {
    const steps = [...gitPanel.matchAll(/setActiveStep\((\d+)\)/g)].map((m) => Number(m[1]));
    expect(steps.length, 'no setActiveStep calls found — the deploy paths changed shape').toBeGreaterThan(0);
    for (const step of steps) {
      expect(step, 'a deploy path sets a step below 1').toBeGreaterThanOrEqual(1);
      expect(
        step,
        `a deploy path sets step ${step}, but only ${stepLabels.length} labels exist, so that step would render as nothing`,
      ).toBeLessThanOrEqual(stepLabels.length);
    }
  });

  it('renders the step strip and the elapsed time, not just the status word', () => {
    expect(gitPanel).toContain('DEPLOY_STEP_LABELS.map');
    expect(gitPanel).toMatch(/currentBuildTime\.toFixed/);
    // `activeStep` must be read somewhere other than its own declaration and its setter.
    const reads = [...gitPanel.matchAll(/\bactiveStep\b/g)].length;
    expect(reads, 'activeStep is declared and set but never read — the step strip is gone again').toBeGreaterThan(1);
  });

  it('names a screen reader target for the step, since the strip is dots and tiny text', () => {
    expect(gitPanel).toMatch(/aria-label=\{`Deploy step \$\{activeStep\} of 3`\}/);
  });
});

describe('the bot builder offers no copy button for an endpoint that does not exist', () => {
  it('the superseded webhook modal is gone, all of it', () => {
    for (const dead of ['copyWebhook', 'webhookSnippet', 'showWebhookModal']) {
      expect(botBuilder, `${dead} is back — the placeholder-endpoint modal was revived`).not.toContain(dead);
    }
  });

  it('no placeholder host is offered as something to copy', () => {
    // The only remaining mention of the old snippet's host is the comment recording its removal,
    // so a bare occurrence outside a comment line means a copyable placeholder came back.
    const offending = botBuilder
      .split('\n')
      .filter((l) => l.includes('your-server.com'))
      .filter((l) => !l.trim().startsWith('//'));
    expect(offending, 'a placeholder endpoint is in live code, not a comment').toEqual([]);
  });

  it('the real copy button is still the one wired to actual values', () => {
    // copyField copies the callback URL and verify token Meta really needs.
    expect(botBuilder).toContain('function copyField(');
    expect(botBuilder).toMatch(/copyField\(label, value\)/);
  });
});
