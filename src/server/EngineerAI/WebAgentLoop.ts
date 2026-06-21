import { AIRouter } from '../AI/Router/AIRouter';
import { E2BActuator } from './actuators/E2BActuator';

/**
 * WebAgentLoop — an ISOLATED "computer-use" web agent.
 *
 * Given a natural-language goal (e.g. "play <song> on YouTube"), it drives the
 * sandbox's REAL Chromium by repeatedly: screenshot → ask a vision model for the
 * single next action → execute it via coordinate clicks / typing → screenshot →
 * repeat, until the goal is reached or the step budget runs out.
 *
 * Deliberately SEPARATE from EngineerAgentLoop (the app-building engine that is
 * being unified in v2.0): this module never touches that core. It only reuses
 * the shared AIRouter (vision-capable via `route(prompt, system, images)`) and
 * the E2BActuator browser actions (`navigate` / `click_xy` / `type_text` /
 * `press` / `scroll`). Requires a real sandbox (E2B) — there is no browser
 * without one.
 */

export type WebAgentEvent =
  | { type: 'status'; message: string }
  | {
      type: 'frame';
      step: number;
      screenshot: string;
      cursorX?: number;
      cursorY?: number;
      thought: string;
      action: string;
      detail: string;
    }
  | { type: 'done'; summary: string }
  | { type: 'error'; message: string }
  | { type: 'aborted' };

const VIEWPORT_W = 1280;
const VIEWPORT_H = 720;
const MAX_STEPS = 16;

const SYSTEM_PROMPT = `You are a precise web-browsing agent operating a REAL Chromium browser at ${VIEWPORT_W}x${VIEWPORT_H} pixels.
You receive the user's GOAL and a SCREENSHOT of the current page (or "no page yet" on the first step).
Decide the SINGLE best next action to make progress toward the goal.

Respond with ONLY a JSON object — no prose, no markdown fences:
{"thought":"<one short sentence>","action":"navigate|click|type|press|scroll|done","args":{...}}

Action args:
- navigate: {"url":"https://..."}                      open a website (start here when no page is loaded)
- click:    {"x":<0-${VIEWPORT_W}>,"y":<0-${VIEWPORT_H}>}   click at the pixel position you read from the screenshot
- type:     {"text":"..."}                             type into the field you just clicked
- press:    {"key":"Enter"}                            press a keyboard key
- scroll:   {"direction":"down"|"up"}
- done:     {"summary":"what was accomplished"}

Rules:
- Look carefully at the screenshot and target real, visible elements by pixel position.
- To search: click the search box, type the query, then press Enter.
- Dismiss any cookie/consent dialog by clicking its accept button first.
- Take exactly ONE action per step. When the goal is clearly achieved on screen, return "done".`;

function parseAction(raw: string): { thought: string; action: string; args: Record<string, unknown> } | null {
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as { thought?: unknown; action?: unknown; args?: unknown };
    if (typeof o.action === 'string') {
      return {
        thought: typeof o.thought === 'string' ? o.thought : '',
        action: o.action,
        args: (o.args && typeof o.args === 'object' ? o.args : {}) as Record<string, unknown>,
      };
    }
  } catch {
    /* malformed — fall through */
  }
  return null;
}

export class WebAgentLoop {
  constructor(private router: AIRouter, private actuator: E2BActuator) {}

  async *run(workspaceId: string, goal: string, signal?: AbortSignal): AsyncGenerator<WebAgentEvent> {
    let lastShot = '';
    let lastUrl = '';

    for (let step = 1; step <= MAX_STEPS; step++) {
      if (signal?.aborted) {
        yield { type: 'aborted' };
        return;
      }

      const prompt =
        `GOAL: ${goal}\n\n` +
        (lastShot
          ? `Current page URL: ${lastUrl || '(unknown)'}\nA screenshot of the current page is attached. `
          : `No page is loaded yet. `) +
        `Decide the next action (step ${step}/${MAX_STEPS}).`;

      let decision: { thought: string; action: string; args: Record<string, unknown> } | null;
      try {
        const { response, telemetry } = await this.router.route(
          prompt,
          SYSTEM_PROMPT,
          lastShot ? [lastShot] : undefined,
        );
        if (!telemetry.success) {
          yield { type: 'error', message: 'AI model call failed (check provider keys / rate limit).' };
          return;
        }
        decision = parseAction(response.content);
      } catch (err) {
        yield { type: 'error', message: err instanceof Error ? err.message : 'AI call failed.' };
        return;
      }

      if (!decision) {
        yield { type: 'error', message: 'Could not understand the next step. Stopping.' };
        return;
      }

      if (decision.action === 'done') {
        yield { type: 'done', summary: String((decision.args.summary as string) || 'Task complete.') };
        return;
      }

      let res: { screenshot: string; result: string; cursorX?: number; cursorY?: number };
      try {
        switch (decision.action) {
          case 'navigate': {
            const url = String(decision.args.url || '').trim();
            if (!url) {
              yield { type: 'error', message: 'The agent tried to navigate without a URL.' };
              return;
            }
            res = await this.actuator.browserAction(workspaceId, 'navigate', {
              url: /^https?:\/\//i.test(url) ? url : `https://${url}`,
            });
            break;
          }
          case 'click':
            res = await this.actuator.browserAction(workspaceId, 'click_xy', {
              x: Math.round(Number(decision.args.x) || 0),
              y: Math.round(Number(decision.args.y) || 0),
            });
            break;
          case 'type':
            res = await this.actuator.browserAction(workspaceId, 'type_text', {
              text: String(decision.args.text ?? ''),
            });
            break;
          case 'press':
            res = await this.actuator.browserAction(workspaceId, 'press', {
              text: String(decision.args.key || decision.args.text || 'Enter'),
            });
            break;
          case 'scroll':
            res = await this.actuator.browserAction(workspaceId, 'scroll', {
              direction: decision.args.direction === 'up' ? 'up' : 'down',
            });
            break;
          default:
            yield { type: 'error', message: `Unknown action: ${decision.action}` };
            return;
        }
      } catch (err) {
        yield { type: 'error', message: `Browser action failed: ${err instanceof Error ? err.message : 'unknown'}` };
        return;
      }

      lastShot = res.screenshot || lastShot;
      if (res.result && res.result.includes('now at ')) lastUrl = res.result.replace(/.*now at /, '');

      yield {
        type: 'frame',
        step,
        screenshot: res.screenshot,
        cursorX: res.cursorX,
        cursorY: res.cursorY,
        thought: decision.thought,
        action: decision.action,
        detail: res.result,
      };
    }

    yield {
      type: 'status',
      message: `Reached the ${MAX_STEPS}-step limit. Refine the instruction and try again if it isn't done.`,
    };
  }
}
