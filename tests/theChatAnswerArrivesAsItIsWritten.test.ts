/**
 * 🔴 THE SPEED FIX, LOCKED AT THE CLASS (admin 2026-11-25, verbatim: "navbharatai (ai chat) me response
 * bahut [slow] hai … response jitna ho sake fast aye").
 *
 * The free chat's own send path was a single blocking `axios.post` to `/api/chat/navbharatai` that never
 * set `stream`, so the route took its non-streaming branch and the user saw nothing at all until the model
 * had finished writing. The server's token stream and this app's SSE consumer both already existed; the
 * streaming call was reachable only as an ERROR fallback.
 *
 * The CLASS is not "one slow call". It is that `stream` is an OPTIONAL field whose absence silently buys
 * the slowest possible behaviour — so a new chat caller gets a blocking reply by forgetting a line. These
 * tests fail when that happens again: the chat engine must stream, and any client that talks to a chat
 * route must say which it wants, out loud.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Comments are stripped before every shape check: this file's own explanation of the bug names the
 *  deleted helpers, and a guard that reads its own prose would pass or fail for the wrong reason. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n');
}

const engine = code('src/hooks/useChatEngine.ts');
const route = code('src/server/routes/chat.ts');

function clientSources(dir = 'src', found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (path.startsWith('src/server')) continue;
    if (statSync(path).isDirectory()) { clientSources(path, found); continue; }
    if (/\.(ts|tsx)$/.test(path) && !/\.test\.tsx?$/.test(path)) found.push(path);
  }
  return found;
}

describe('a chat answer arrives as it is written', () => {
  it('the chat engine asks the route to stream, and keeps no blocking send path of its own', () => {
    expect(engine).toContain('stream: true');
    // The blocking path is gone, not merely unused: an unreachable copy is what a later change re-routes to.
    expect(engine).not.toMatch(/axios/);
    expect(engine).not.toMatch(/callGeminiFrontend|runFrontendPipeline|isGeminiSovereign/);
    // The one send path consumes the stream rather than waiting for a whole JSON body.
    expect(engine).toContain('consumeChatResponseStream');
  });

  it('the engine renders the first words it receives instead of waiting for the last', () => {
    // A streamed bubble is created and then updated from each frame. Without this the stream would be
    // collected in a variable and shown once, which is the blocking behaviour wearing a stream's clothes.
    const consume = engine.slice(engine.indexOf('consumeChatResponseStream'));
    expect(consume).toMatch(/snapshot/);
    expect(consume).toMatch(/setMessagesForTab/);
  });

  it('every client caller of a chat route states whether it wants a stream', () => {
    const offenders: string[] = [];
    for (const path of clientSources()) {
      const source = code(path);
      if (!/['"`]\/api\/chat\/navbharat(?:ai)?['"`]/.test(source)) continue;
      // A caller that never names `stream` is taking the blocking branch by omission — the exact class.
      if (!/stream:\s*(true|false)/.test(source)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  it('the route still answers a streaming request with SSE, and says so before the slow part', () => {
    expect(route).toContain("res.setHeader('Content-Type', 'text/event-stream')");
    // The grounded path opens the stream and sends a status frame BEFORE the live lookup it waits on,
    // so a question that needs the web is narrated instead of silent. Only a stream can carry that.
    const grounding = route.indexOf('const groundingStatus = groundingStatusFor(message);');
    const lookup = route.indexOf('await liveSearchContext(message');
    expect(grounding).toBeGreaterThan(0);
    expect(lookup).toBeGreaterThan(grounding);
    expect(route.slice(grounding, lookup)).toContain('text/event-stream');
  });
});
