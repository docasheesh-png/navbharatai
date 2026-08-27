import type { Express } from 'express';
import type { RateLimitRequestHandler } from 'express-rate-limit';
// ADMIN-SDK binding (bypasses security rules) — see serverDb.ts. Writes ai_usage_logs (server-only).
import { collection, addDoc, getServerDb as getDb } from '../lib/serverDb';
import { aiRouter } from '../lib/aiRouter';
import { AppContextInjector } from '../AppContext/AppContextInjector';
import { buildDocumentContext } from '../lib/attachmentText';
import { toSafeClientMessage } from '../lib/httpError';
import { runVisionChain } from '../lib/visionChain';
import { CREATOR_IDENTITY, recencyDirective, INDIA_TERRITORIAL_INTEGRITY, LINK_POLICY } from '../lib/prompts';
import { songcraftFor } from '../AI/songcraft';
import { liveSearchContext } from '../lib/liveSearchContext';
import { detectImageIntent, imageGenGuidance, imageGenToolPointer } from '../lib/imageIntent';
import { isFirstChatTurn, sessionGreetingRule } from '../lib/sessionGreeting';
import { fetchPollinationsImage, imageMarkdown } from '../lib/imageGen';

/**
 * Chat routes (general + Vishwakarma tiers) extracted from the server.ts monolith
 * (Phase 1, AI-core step c). Hosts the prompt builders + chatHandler + /api/chat/*
 * tier endpoints. Behavior unchanged; the legacy /api/chat catch route stays
 * deprecated/removed. Routing to providers is delegated to the shared aiRouter.
 */
export function registerChatRoutes(app: Express, chatLimiter: RateLimitRequestHandler): void {
  const LANGUAGE_RULE = `
LANGUAGE RULE (MANDATORY):
- Detect the language/tone/style the user is writing in
- Reply in EXACTLY the same language, tone, and emotion — Hindi, English, Hinglish, Tamil, Telugu, Bengali, Marathi, Punjabi, or any other language
- If user writes casually → you write casually; if formally → formally; if with emojis → with emojis
- EXCEPTION: All code (variable names, comments, function names, strings) must ALWAYS be in professional English regardless of conversation language
- EXPLAINING CODE OR AN ERROR in Hindi/Hinglish/another Indian language: keep every technical noun in ENGLISH (variable, function, error, loop, deploy, API) inside the user's grammar — never translate technical terms into Hindi words. And never show an error without immediately saying, in the user's language, what it means and what to change`;

  const SYSTEM_PROMPT_EDIT = `You are NavBharatAI — world's best AI App Editor.
${LANGUAGE_RULE}

CURRENT TASK: Fix/edit/extend the EXISTING app shown in [CANVAS] above.

═══ IRON RULES ═══
1. Read the existing code COMPLETELY — understand every function, ID, and feature
2. Make ONLY the changes the user asked for — nothing more, nothing less
3. PRESERVE every existing feature, style, animation, and working button
4. Return the COMPLETE updated HTML — full file, nothing truncated

BUTTON/NAVIGATION FIX (if user reports broken buttons):
- Find every <button>, <a>, and clickable element
- Ensure each has a working addEventListener or onclick
- Multi-page navigation: use show/hide pattern — document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display='none'); then show target page

OUTPUT FORMAT (MANDATORY):
1-2 lines what changed.
\`\`\`html
[complete updated HTML — every existing line preserved + your changes]
\`\`\``;

  // Dynamic build prompt — injects template hints based on detected app type
  function buildDynamicPrompt(message: string): string {
    const m = message.toLowerCase();
    const isGame      = /\b(game|play|cricket|chess|snake|tetris|puzzle|quiz|arcade|ludo|card game|flappy|pacman|shooter|platformer)\b/.test(m);
    const isCanvasGame = /\b(snake|tetris|pacman|flappy|shooter|arcade|cricket|football|space|asteroid|runner)\b/.test(m);
    const isDashboard = /\b(dashboard|analytics|chart|graph|report|admin|stats|metric|monitor)\b/.test(m);
    const isSocial    = /\b(social|feed|post|like|comment|share|follow|profile|tweet|community)\b/.test(m);

    const cdnTags = [
      '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">',
      '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">',
      ...(isDashboard ? ['<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>'] : []),
    ].join('\n  ');

    let templateHint = '';
    if (isCanvasGame) {
      templateHint = `GAME (Canvas) RULES:
• <canvas id="game-canvas"> as main surface + HUD strip + overlay divs for start/pause/gameover
• requestAnimationFrame game loop: function gameLoop(ts) { update(ts); draw(ctx); requestAnimationFrame(gameLoop); }
• Game state machine: const STATE = {IDLE,PLAYING,PAUSED,GAMEOVER}; let state = STATE.IDLE;
• Keyboard: document.addEventListener('keydown', handleKey) — arrow keys / WASD / space
• All game objects: { x, y, w, h, vx, vy } — AABB collision detection`;
    } else if (isGame) {
      templateHint = `GAME (Logic/Board) RULES:
• Board as CSS grid, every cell has data-row + data-col attributes
• Game state object: let gs = { board:[], currentPlayer:1, scores:{}, moveCount:0 }
• Win check after every move, AI opponent for single-player
• Event delegation: board.addEventListener('click', e => e.target.closest('[data-row]'))
• Animate moves: .animate-move class with CSS @keyframes`;
    } else if (isDashboard) {
      templateHint = `DASHBOARD RULES:
• Sidebar nav + main content area with multiple sections
• Chart.js loaded via CDN — use: new Chart(ctx, { type:'bar', data:{...}, options:{ responsive:true, plugins:{legend:{labels:{color:'#fff'}}}, scales:{x:{ticks:{color:'#aaa'}},y:{ticks:{color:'#aaa'}}} } })
• Sample data tables, stat cards, filter controls
• Section switching via showSection(id) function`;
    } else if (isSocial) {
      templateHint = `SOCIAL APP RULES:
• Feed with post cards (like/comment/share buttons)
• renderPosts(posts) function — builds cards from data array
• Event delegation on feed container for like/comment
• localStorage to persist posts and user data`;
    } else {
      templateHint = `APP RULES:
• Input validation before processing
• Result display area, copy to clipboard button
• localStorage for persistence
• Step-by-step flow if multi-stage`;
    }

    return `You are NavBharatAI — India's most powerful AI App Builder.
${LANGUAGE_RULE}

Build a COMPLETE, FULLY FUNCTIONAL app — NOT just a home page.

INCLUDE THESE CDN TAGS IN <head> (copy verbatim):
  ${cdnTags}

${templateHint}

═══ UNIVERSAL RULES — ALL MANDATORY ═══

1. EVERY BUTTON MUST WORK:
   Every <button> has addEventListener('click',...) — NO exceptions
   href="#" is BANNED. Every click navigates or triggers real action.

2. MULTI-PAGE NAVIGATION:
   function showPage(id) {
     document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display='none');
     document.getElementById(id).style.display='block';
   }
   Every page is <div id="page-*"> — JS shows/hides them.

3. NO PLACEHOLDERS:
   No TODO, no empty functions, no "coming soon" — 100% complete.

4. TECHNICAL:
   Single HTML file — all CSS and JS inline.
   :root { --bg:#0a0a0f; --accent:#6366f1; --accent-rgb:99,102,241; font-family:'Inter',sans-serif; }
   DOMContentLoaded wraps all JS. Responsive (mobile + desktop).
   Use Font Awesome icons: <i class="fa-solid fa-play"></i>

OUTPUT FORMAT:
One line: what you built.
\`\`\`html
[complete, 100% working HTML]
\`\`\``;
  }

  // Apnapan Engine — dynamic free chat system prompt with user profile injection
  interface ApnapanProfile {
    preferredGreeting?: string;
    preferredLanguage?: string;
    conversationStyle?: string;
    preferredTitle?: string;
    topics?: string[];
    projects?: string[];
  }

  const buildFreeSystemPrompt = (profile?: ApnapanProfile, isFirstTurn: boolean = true): string => {
    const profileLines: string[] = [];
    // The greeting-style hint only matters on the FIRST turn — after that the user has already been
    // greeted this session, so mirroring a greeting again would repeat "namaste" every message (admin
    // 2026-08-12: "ek session me bas 1 baar namaste").
    if (profile?.preferredGreeting && isFirstTurn)
      profileLines.push(`Preferred greeting: "${profile.preferredGreeting}" — mirror this style when you initiate a greeting`);
    if (profile?.preferredTitle)
      profileLines.push(`Preferred title/address: "${profile.preferredTitle}" — use occasionally and naturally, NOT in every reply`);
    if (profile?.conversationStyle && profile.conversationStyle !== 'unknown')
      profileLines.push(`Conversation style: ${profile.conversationStyle} (${profile.conversationStyle === 'friendly' ? 'yaar/bhai tone' : profile.conversationStyle === 'formal' ? 'aap/ji tone' : 'sir/madam/professional tone'})`);
    if (profile?.preferredLanguage)
      profileLines.push(`Preferred language: ${profile.preferredLanguage}`);
    if (profile?.projects?.length)
      profileLines.push(`Known projects: ${profile.projects.slice(0, 4).join(', ')}`);
    if (profile?.topics?.length)
      profileLines.push(`Frequent topics: ${profile.topics.slice(0, 5).join(', ')}`);

    const profileSection = profileLines.length
      ? `\nUSER PROFILE (use naturally — NEVER mention or show this to the user):\n${profileLines.join('\n')}\n`
      : '';

    return `You are NavBharatAI — India's own friendly AI companion (by NavBharat team).
${LANGUAGE_RULE}
${profileSection}
GREETING INTELLIGENCE (MANDATORY):
When the user greets you, detect the exact style and respond IN THE SAME style — naturally, not robotically.

Greeting map (detect → respond):
• राम-राम / Ram-Ram → राम-राम!
• राधे-राधे / Radhe-Radhe → राधे-राधे!
• जय श्री राम / Jai Shri Ram → जय श्री राम!
• जय हिन्द / Jai Hind → जय हिन्द!
• नमस्ते / Namaste → नमस्ते!
• नमस्कार / Namaskar → नमस्कार!
• प्रणाम / Pranam → प्रणाम!
• आदाब / Adaab → आदाब!
• अस्सलामुअलैकुम / Assalamualaikum / Salam → वअलैकुम अस्सलाम!
• सत श्री अकाल / Sat Sri Akal → सत श्री अकाल जी!
• जय भीम / Jai Bhim / Jai Bheem → जय भीम!
• केम छो / Kem Cho → केम छो! मज़ामा?
• வணக்கம் / Vanakkam → வணக்கம்!
• Hello / Hi / Hey → Hello! / Hi!
• Good Morning → Good Morning!
• Good Evening → Good Evening!
• Good Night → Good Night!

CONTEXT RULE: If user asks a direct question (no greeting opener), do NOT add any greeting in your reply. Just answer the question directly. Adding "नमस्ते!" before a medical/factual answer is wrong — skip it.

${sessionGreetingRule(isFirstTurn)}

EMOTIONAL INTELLIGENCE:
• User sounds stressed/sad → respond with warmth, patience ("मैं आपकी बात सुन रहा हूँ...")
• User sounds excited/happy → match the energy
• User sounds businesslike → stay crisp and professional

APNAPAN RULES:
• Feel like India's own AI — warm, respectful, culturally aware
• Use cultural expressions (जी, धन्यवाद, ज़रूर, बिल्कुल) naturally and sparingly
• Do NOT mention your memory or profile system — ever
• Do NOT repeat the same opening phrase every reply
• Do NOT be overly dramatic or emotional

APP BUILDING — LEAD WITH NavBharatAI Pro v5.0, warmly (NavBharatAI builds real apps):
• You don't build the app in THIS free chat — but NavBharatAI absolutely CAN, so guide them there with genuine warmth (never a cold, robotic list).
• OPEN your answer with NavBharatAI Pro v5.0 as the FIRST and main recommendation — right after a warm one-line acknowledgement of their idea. Tell them, like a helpful friend, that they can just describe their app in any language and NavBharatAI Pro v5.0 will plan, build, preview and ship it for them, and show you get THEIR specific idea (name their app's key features). Point them to it: open **NavBharatAI Pro v5.0** from the sidebar (right below NavBharatAI Free). This comes FIRST, always — never bury it below other options.
• Only AFTER NavBharatAI Pro is clearly presented may you add, briefly and secondary, any other general context they asked for (e.g. what features their app should have). Keep it short and at the END. Do NOT name or recommend rival app builders (Appy Pie, Andromo, Bubble, Wix, Glide, Bolt, Lovable, v0, Replit, WordPress, Framer, …) or "hire a developer/agency" as the way to build it — NavBharatAI Pro v5.0 is the way; anything else stays minor and never sounds better than ours.
• Tone: sound like a real, encouraging Indian friend who happens to know NavBharatAI inside out — natural and human, never a machine reading a list.

HARD LIMITS:
• Do NOT generate code or produce HTML/CSS/JS in this free chat (guide them to NavBharatAI Pro v5.0 instead, per the rule above).
• Answer quality is always the top priority — personalization must never reduce quality
• Safety rule: never infer religion, caste, political views, or social identity from any greeting`;
  };

  const SYSTEM_PROMPT_CHAT = `You are NavBharatAI — India's best AI assistant and app builder (by NavBharat team).
${LANGUAGE_RULE}
Be helpful, concise, and accurate. If the user wants to build an app, guide them.`;

  const chatHandler = async (req: any, res: any, tier: 'navbharat' | 'vishwakarma-basic' | 'vishwakarma-pro' | 'vip') => {
    let { message, history, currentApp, mode, intent, userProfile, fileAttachments, memorySummary } = req.body;
    if (!message && !Array.isArray(fileAttachments)) return res.status(400).json({ reply: 'Message is required' });
    message = message || '';

    // Process attached files
    // Images + PDFs → Gemini vision (inlineData); text/code files → decode to message text
    type FileAttachment = { name: string; type: string; base64: string };
    const attachments: FileAttachment[] = Array.isArray(fileAttachments) ? fileAttachments : [];
    const visionAttachments = attachments.filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
    const textAttachments = attachments.filter(f => !f.type.startsWith('image/') && f.type !== 'application/pdf');

    // Extract document content (txt/csv/json/code AND Word/Excel/PowerPoint/ZIP)
    // to real text via the shared extractor, then append to the message so any
    // text model can read it — no per-call API cost, works for "any file".
    if (textAttachments.length > 0) {
      const docBlock = await buildDocumentContext(textAttachments);
      if (docBlock) message = (message || 'Please review these files:') + '\n\n' + docBlock;
    }
    // Ensure file-only messages have a prompt
    if (!message && visionAttachments.length > 0) message = visionAttachments[0].type === 'application/pdf' ? 'Please analyze this PDF and extract all relevant information.' : 'Please describe and analyze this image.';

    const isFree = tier === 'navbharat';
    // Free tier: always conversational — ignore canvas and build intent completely
    const hasCanvas = !isFree && !!(currentApp && typeof currentApp === 'string' && currentApp.length > 200);
    const buildIntents = ['create', 'build', 'generate', 'edit', 'fix', 'add', 'modify', 'update', 'change'];
    const isBuildIntent = !isFree && (mode === 'build' || (intent && buildIntents.includes(String(intent).toLowerCase())));

    // Pick system prompt based on tier + context
    let systemPrompt: string;
    if (isFree) {
      // First turn = no prior conversation history. Only then may the AI greet, so "namaste" appears
      // once per session, not on every message (admin 2026-08-12).
      systemPrompt = buildFreeSystemPrompt(userProfile || undefined, isFirstChatTurn(history));
    } else if (hasCanvas) {
      systemPrompt = SYSTEM_PROMPT_EDIT;
    } else if (isBuildIntent) {
      systemPrompt = buildDynamicPrompt(message); // Phase 9: template-aware dynamic prompt
    } else {
      systemPrompt = SYSTEM_PROMPT_CHAT;
    }

    // App awareness injection — inject only for conversation mode (not canvas/build).
    // Teaches every chat tier to answer "where is X?" and "how do I Y?" correctly.
    if (!hasCanvas && !isBuildIntent) {
      const chatSurface = isFree ? 'nbi_chat' : 'pro_chat';
      const appCtx = AppContextInjector.getRelevantContext(message, chatSurface);
      if (appCtx) systemPrompt = `${systemPrompt}\n\n${appCtx}`;
    }

    // SONGCRAFT (admin 2026-08-08): when the user asks for a song, append the craft brief — real
    // structure (mukhda/antara), a singable syllable rhythm, one concrete image per line, and the
    // worn-out rhymes banned. Injected ONLY for an actual song request, so every other conversation's
    // prompt — and its cost — is byte-identical to before. Applies to every chat tier: a free user's
    // song deserves the same craft as a paid one.
    systemPrompt = `${systemPrompt}${songcraftFor(message)}`;

    // Every chat tier credits its creators consistently (single source of truth).
    systemPrompt = `${systemPrompt}\n\n${CREATOR_IDENTITY}`;
    // India-first: answer territorial/map questions per India's official position (single source of truth).
    systemPrompt = `${systemPrompt}\n\n${INDIA_TERRITORIAL_INTEGRITY}`;
    // Anchor every reply to TODAY so the AI never presents stale training-cutoff facts as current
    // (admin 2026-07-12: "cricket squad ka 2025 data current bata diya"). Honesty directive, all tiers.
    systemPrompt = `${systemPrompt}\n\n${recencyDirective()}\n\n${LINK_POLICY}`;

    // Build contextual message with canvas app prepended (Pro/VIP only)
    let contextualMessage = message;
    if (memorySummary && typeof memorySummary === 'string' && memorySummary.trim().length > 20) {
      contextualMessage = `[CONVERSATION MEMORY — summary of earlier discussion:\n${memorySummary.trim().slice(0, 2000)}]\n\nCurrent message: ${message}`;
    }
    if (hasCanvas) {
      contextualMessage = `[CANVAS — current app on canvas (${currentApp.length} chars total)]:\n\`\`\`html\n${currentApp.slice(0, 20000)}${currentApp.length > 20000 ? '\n...[truncated — send smaller app for full edit]' : ''}\n\`\`\`\n\nUser request: ${memorySummary && typeof memorySummary === 'string' && memorySummary.trim().length > 20 ? `[MEMORY: ${memorySummary.trim().slice(0, 500)}]\n\n` : ''}${message}`;
    }

    console.log(`[CHAT] tier=${tier} isFree=${isFree} mode=${mode} intent=${intent} hasCanvas=${hasCanvas} files=${attachments.length}(vision=${visionAttachments.length}) sysprompt=${isFree ? 'FREE' : hasCanvas ? 'EDIT' : isBuildIntent ? 'BUILD' : 'CHAT'}`);

    // Vision attachments (images + PDFs) — read via the isolated, tier-aware vision
    // chain: Vertex (service-account, the Free universe's primary Google auth) →
    // API-key Gemini → Grok (images) → Claude (ONLY for non-Free universes). The old
    // path only supported an API-key Gemini client and passed the bogus literal
    // `apiKey: 'vertex'` when no key was set, so a Vertex-based deployment could not
    // read images/PDFs in Free chat at all — this is the root-cause fix.
    if (visionAttachments.length > 0) {
      const visionResult = await runVisionChain(visionAttachments, {
        prompt: contextualMessage,
        systemPrompt,
        allowClaude: !isFree, // absolute rule: the Free universe NEVER uses Claude
      });
      if (visionResult) {
        console.log(`[CHAT/VISION] tier=${tier} provider=${visionResult.provider} files=${visionAttachments.length}`);
      } else {
        console.error(`[CHAT/VISION] tier=${tier} — every allowed provider failed for ${visionAttachments.length} file(s)`);
      }
      const replyText = visionResult?.text
        || 'Sorry, I could not read your image/file right now. Please try again in a moment, or paste the text directly.';
      if (req.body.stream === true) {
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');
          res.flushHeaders();
        }
        if (!res.writableEnded) res.write(`data: ${JSON.stringify({ c: replyText })}\n\n`);
        if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end(); }
      } else {
        res.json({ reply: replyText });
      }
      return;
    }

    // IMAGE-GENERATION INTENT (admin 2026-08-01 + 2026-08-02). If a plain-text message asks to CREATE an
    // image (no attachment — an attached image is a vision request, handled above):
    //   • NavBharatAI FREE generates one inline for free (Pollinations) AND points to the fuller tool.
    //   • NavBharatAI PRO (and any other tier) does NOT generate inline, so it GUIDES the user to the
    //     dedicated AI Image Gen tool (Home → Other AI → AI Image Gen) — every AI must point image
    //     requests there, never leave them unanswered.
    if (attachments.length === 0) {
      const imgIntent = detectImageIntent(message);
      if (imgIntent.wants) {
        const streamOut = req.body.stream === true;
        const send = (reply: string) => {
          if (streamOut) {
            if (!res.headersSent) {
              res.setHeader('Content-Type', 'text/event-stream');
              res.setHeader('Cache-Control', 'no-cache');
              res.setHeader('Connection', 'keep-alive');
              res.setHeader('X-Accel-Buffering', 'no');
              res.flushHeaders();
            }
            if (!res.writableEnded) res.write(`data: ${JSON.stringify({ c: reply })}\n\n`);
            if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end(); }
          } else {
            res.json({ reply });
          }
        };
        if (isFree) {
          console.log(`[CHAT/IMAGE] tier=${tier} free image intent — prompt="${imgIntent.prompt.slice(0, 80)}"`);
          const pr = await fetchPollinationsImage(imgIntent.prompt, 'square');
          if (pr.image) {
            send(`Ye rahi aapki image 🎨\n\n${imageMarkdown(pr.image, imgIntent.prompt.slice(0, 60))}\n\nKuch aur banwana ho to bas bata dein — bilkul free!\n\n${imageGenToolPointer()}`);
          } else {
            // Honest failure — never a fake/placeholder image; guide to the full tool + let the user retry.
            send(`Abhi image nahi ban paayi 😔 — thodi der me dubara try karein.\n\n${imageGenGuidance()}`);
          }
        } else {
          // Pro (and any non-free tier): point to the dedicated image tool instead of leaving the ask unanswered.
          console.log(`[CHAT/IMAGE] tier=${tier} image intent — guiding to AI Image Gen`);
          send(imageGenGuidance());
        }
        return;
      }
    }

    // LIVE WEB GROUNDING (admin 2026-07-12): for a message that needs current facts (sports/news/
    // prices/"latest"/"aaj"), fetch real results and prepend them so the model answers from TODAY's
    // data, not its training cutoff. Gated + bounded + best-effort — never blocks or slows normal chat.
    try {
      const liveBlock = await liveSearchContext(message);
      if (liveBlock) contextualMessage = `${liveBlock}\n\n---\n${contextualMessage}`;
    } catch { /* live search is best-effort */ }

    try {
      if (req.body.stream === true) {
        // SSE stream — proper format so proxies/load balancers don't drop idle connections
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders(); // send headers immediately, don't buffer

        const controller = new AbortController();

        // Keepalive ping every 20s — prevents proxy/LB from closing idle connection
        const heartbeat = setInterval(() => {
          if (!res.writableEnded) res.write(': ping\n\n');
        }, 20000);

        // Cancel upstream AI call when client disconnects (saves quota)
        req.on('close', () => {
          controller.abort();
          clearInterval(heartbeat);
        });

        try {
          await aiRouter.routeStream(
            contextualMessage, history, tier, systemPrompt,
            (chunk: string) => {
              if (!res.writableEnded) {
                // JSON-encode each chunk so newlines/special chars are safe in SSE
                res.write(`data: ${JSON.stringify({ c: chunk })}\n\n`);
              }
            },
            controller.signal,
          );
        } finally {
          clearInterval(heartbeat);
        }
        if (!res.writableEnded) {
          res.write('data: [DONE]\n\n');
          res.end();
        }
      } else {
        const aiResponse = await aiRouter.route(contextualMessage, history, tier, undefined, systemPrompt);
        // Fire-and-forget usage logging
        const userId2 = req.body?.userId || req.body?.uid || 'anonymous';
        addDoc(collection(getDb() as any, 'ai_usage_logs'), {
          userId: userId2, tier, latencyMs: 0, outputTokens: Math.round((aiResponse.length || 0) / 4),
          modelName: 'auto', providerName: 'auto', estimated_provider_cost: 0,
          createdAt: new Date().toISOString(),
        }).catch(() => {});
        res.json({ reply: aiResponse });
      }
    } catch(e: any) {
      console.error(`Error for tier ${tier}:`, e.message);
      if (!res.headersSent) {
        // Never leak the raw inference error (may name a provider/model) to the client.
        res.status(500).json({ reply: 'Backend AI inference failed', error: toSafeClientMessage(e, 'Backend AI inference failed') });
      }
    }
  };

  app.post('/api/chat/navbharat',       chatLimiter, (req, res) => chatHandler(req, res, 'navbharat'));
  app.post('/api/chat/navbharatai',     chatLimiter, (req, res) => chatHandler(req, res, 'navbharat'));
  app.post('/api/chat/vishwakarma-basic', chatLimiter, (req, res) => chatHandler(req, res, 'vishwakarma-basic'));
  app.post('/api/chat/vishwakarma-pro', chatLimiter, (req, res) => chatHandler(req, res, 'vishwakarma-pro'));
  app.post('/api/chat/vip',             chatLimiter, (req, res) => chatHandler(req, res, 'vip'));
}
