import path from 'path';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import type { Express, Request, Response } from 'express';
import { buildApp as buildAppEngine, editApp as editAppEngine, buildReactApp as buildReactAppEngine } from '../AppMakerLab/AppEngine';
import { aiRouter } from '../lib/aiRouter';

/**
 * Pro engine routes extracted from the server.ts monolith (Phase 1, AI-core step d).
 * Hosts the Pro chat + Pro build pipeline and the proxy-aware callClaudePro helper.
 * Behavior unchanged. Delegates model routing to the shared aiRouter and app
 * generation/editing to AppMakerLab/AppEngine.
 */
export function registerProRoutes(app: Express): void {
  async function callClaudePro(
    apiKey: string,
    systemPrompt: string,
    msgs: { role: 'user' | 'assistant'; content: any }[],
    maxTokens: number,
  ): Promise<string> {
    const rawBaseURL = process.env.ANTHROPIC_BASE_URL;
    const baseURL = rawBaseURL?.replace(/\/v1\/?$/, '');

    if (baseURL) {
      // OpenAI-compatible proxy path — sends Authorization: Bearer
      const proxyMsgs = [{ role: 'system' as const, content: systemPrompt }, ...msgs];
      const client = new OpenAI({ apiKey, baseURL });
      const models = [
        'anthropic/claude-sonnet-4.6', 'claude-sonnet-4-6',
        'anthropic/claude-3.5-sonnet', 'claude-3-5-sonnet-20241022',
      ];
      let lastErr: any;
      for (const model of models) {
        try {
          const r = await client.chat.completions.create({ model, messages: proxyMsgs, max_tokens: maxTokens });
          const text = r.choices[0]?.message?.content;
          if (text) return text;
        } catch (e: any) {
          console.warn(`[PRO-PROXY] model ${model} failed: ${e.message}`);
          lastErr = e;
        }
      }
      throw lastErr || new Error('All proxy models failed');
    }

    // Direct Anthropic SDK path — sends x-api-key
    const A = (await import('@anthropic-ai/sdk')).default;
    const r = await new A({ apiKey }).messages.create({
      model: 'claude-3-5-sonnet-20241022', max_tokens: maxTokens,
      system: systemPrompt, messages: msgs,
    });
    return (r.content.find((c: any) => c.type === 'text') as any)?.text || '';
  }

  app.post('/api/pro-chat', async (req, res) => {
    console.log("=== HIT /api/pro-chat ===");
    try {
      let { message, history, mode, fileData, fileType, fileName, currentApp, memorySummary } = req.body;
      if (!message && !fileData) return res.status(400).json({ error: 'Message required' });
      message = message || '';
      if (memorySummary && typeof memorySummary === 'string' && memorySummary.trim().length > 20) {
        message = `[CONVERSATION MEMORY — summary of earlier discussion:\n${memorySummary.trim().slice(0, 2000)}]\n\nCurrent message: ${message}`;
      }
      const hasFile = !!(fileData && fileType);
      const isImageFile = hasFile && (fileType as string).startsWith('image/');
      const isPDFFile = hasFile && fileType === 'application/pdf';
      const isTextDoc = hasFile && !isImageFile && !isPDFFile;

      // Decode text/code files and prepend to message so all providers can use them
      if (isTextDoc && fileData) {
        try {
          const decoded = Buffer.from(fileData, 'base64').toString('utf-8').slice(0, 8000);
          message = `[Attached document: ${fileName}]\n\`\`\`\n${decoded}\n\`\`\`\n\n${message}`;
        } catch { /* keep original */ }
      }
      // Ensure file-only messages have a prompt
      if (!message.trim() && hasFile) message = isImageFile ? 'Please analyze this image in detail.' : isPDFFile ? 'Please analyze this document.' : 'Please review the attached file.';

      // currentApp context for planning mode
      const canvasContext = currentApp && typeof currentApp === 'string' && currentApp.length > 200
        ? `\n\n### CURRENT APP ON CANVAS (${currentApp.length} chars):\n\`\`\`html\n${currentApp.slice(0, 3000)}\n\`\`\`\nUser is discussing modifications/additions to THIS app.`
        : '';

      // ══ BUILDING MODE — Use AppEngine to generate real app ══
      if (mode === 'building') {
        console.log('[PRO] Building mode — AppEngine starting');
        const result = await buildAppEngine(message);

        if (result.success && Object.keys(result.files).length > 0) {
          console.log('[PRO] Build success:', Object.keys(result.files));
          return res.json({
            reply: result.reply,
            files: result.files,
            previewHtml: result.previewHtml,
            appName: result.appName,
            validationReport: result.validationReport,
            deploymentGuide: result.deploymentGuide,
          });
        } else {
          // AppEngine failed — fallback to direct Claude JSON build
          console.warn('[PRO] AppEngine failed, using direct build fallback');
          const BUILD_PROMPT = `You are the world's best AI app builder. Output ONLY JSON.
{"reply":"what was built","files":{"index.html":"complete html with inline css and js","style.css":"complete css","script.js":"complete js"}}
Write complete working code. Beautiful dark UI. No placeholders. Output ONLY the JSON.`;

          function extractJSON(raw: string): any | null {
            try { const p = JSON.parse(raw.trim()); if (p.files) return p; } catch {}
            const m1 = raw.match(/\`\`\`(?:json)?\s*([\s\S]+?)\s*\`\`\`/);
            if (m1) { try { const p = JSON.parse(m1[1].trim()); if (p.files) return p; } catch {} }
            const m2 = raw.match(/\{[\s\S]+\}/);
            if (m2) { try { const p = JSON.parse(m2[0]); if (p.files) return p; } catch {} }
            return null;
          }

          try {
            const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
            if (key) {
              const raw = await callClaudePro(key, BUILD_PROMPT, [{ role: 'user', content: message }], 8000);
              const parsed = extractJSON(raw);
              if (parsed) return res.json({ reply: parsed.reply || 'App ready!', files: parsed.files });
            }
          } catch (e: any) { console.warn('[PRO] Fallback Claude err:', e.message); }

          return res.status(500).json({ error: result.error || 'Build failed. Check API keys.' });
        }
      }

      // ══ CONVERSATION MODE — Friendly chat in Build Mode (greetings, questions) ══
      if (mode === 'conversation') {
        const CONV_SYS = `You are NavBharatAI Pro's friendly assistant. The user is in Build Mode — they can describe any app and you will build it instantly.

LANGUAGE RULE: Reply in the EXACT same language the user writes in. Hindi → Hindi, English → English, Hinglish → Hinglish.

Your role:
- Respond warmly to greetings, small talk, and casual messages
- If they ask what you can do: explain you can build any web app (games, social apps, tools, dashboards, quizzes, etc.) — just describe it
- If they ask about a feature or concept: explain briefly and helpfully
- Keep responses SHORT (2-4 sentences max)
- End with a gentle nudge: ask them to describe their app idea if they haven't yet
- NEVER write code`;

        try {
          const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
          if (!key) return res.json({ reply: 'Hello! Describe your app idea and I will build it for you! 🚀', files: {} });
          const msgs = [
            ...(history || []).slice(-6).map((m: any) => ({
              role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
              content: String(m.text || m.content || '').slice(0, 400),
            })),
            { role: 'user' as const, content: message },
          ];
          const reply = await callClaudePro(key, CONV_SYS, msgs, 300);
          return res.json({ reply: reply || 'Hello! Tell me what app you want to build! 🚀', files: {} });
        } catch (e: any) {
          return res.json({ reply: 'Hello! Describe your app idea and I will build it! 🚀', files: {} });
        }
      }

      // ══ AUTO MODE — Human-like: chat, clarify, plan, or trigger build ══
      if (mode === 'auto' || mode === 'auto_plan' || mode === 'auto_build') {
        const isAutoPlan  = mode === 'auto_plan';
        const isAutoBuild = mode === 'auto_build';

        const AUTO_SYS = `You are NavBharatAI, a friendly expert who helps people build web apps. Talk like a real human — warm, natural, conversational. No corporate speak, no robotic tone.

LANGUAGE RULE: Always reply in the EXACT language the user writes in. Hindi → Hindi. Hinglish → Hinglish. English → English.

${isAutoPlan ? `MODE: PLAN THEN BUILD
The user wants to build something complex. Write a clear, friendly plan covering:
- What will be built (1-2 lines)
- Key features (bullets)
- UI/screens overview

Keep it concise — not a formal document. Then at the very end of your reply (on its own line), add exactly: __AUTO_PLAN__
This tells the frontend to show a "Build Now" button. Do NOT explain the marker.` : ''}

${isAutoBuild ? `MODE: DIRECT BUILD
The user wants something simple built. Respond in 1-2 friendly lines confirming what you'll make, then at the very end add exactly: __AUTO_BUILD__
This triggers the actual build. Do NOT explain the marker. Keep the human text very short.` : ''}

${mode === 'auto' ? `MODE: CONVERSATION
The user is asking a question, discussing something, or their intent is unclear.
- If they ask a question: answer naturally and helpfully
- If they mention an app vaguely: ask ONE simple clarifying question ("Banau kya? Koi features chahiye?")
- If they say "coding nahi" or similar: just talk, don't mention building
- Keep responses SHORT (2-5 sentences usually enough)
- Be helpful and warm` : ''}

NEVER write any code or HTML in your response.`;

        try {
          const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
          if (!key) return res.json({ reply: isAutoPlan ? 'Plan ready! __AUTO_PLAN__' : 'Theek hai, bana raha hun! __AUTO_BUILD__', files: {} });
          const msgs = [
            ...(history || []).slice(-10).map((m: any) => ({
              role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
              content: String(m.text || m.content || '').slice(0, 800),
            })),
            { role: 'user' as const, content: message },
          ];
          const maxTokens = isAutoBuild ? 200 : isAutoPlan ? 500 : 400;
          const reply = await callClaudePro(key, AUTO_SYS, msgs, maxTokens);
          return res.json({ reply: reply || 'Haan, batao!', files: {} });
        } catch (e: any) {
          const fallback = isAutoBuild ? 'Theek hai, bana raha hun! __AUTO_BUILD__' : isAutoPlan ? 'Plan ready! __AUTO_PLAN__' : 'Haan, batao kya chahiye?';
          return res.json({ reply: fallback, files: {} });
        }
      }

      // ══ PLANNING MODE — No code, architecture discussion only ══

      // Detect build intent to flag frontend (no hard-block — AI still responds with plan)
      const BUILD_INTENT_PATTERN = /\b(bana[odo]*|banado|likhna|likho|likh do|create|make|build|generate|code karo|code kar|code do|implement|develop|app bana)\b/i;
      const suggestBuild = BUILD_INTENT_PATTERN.test(message);

      const PLAN_PROMPT = `You are NavBharatAI Pro's PLANNING EXPERT. Your job is to plan app blueprints — writing code is NOT your job.${canvasContext}

LANGUAGE RULE (MANDATORY):
- Detect the language/tone the user writes in and reply in EXACTLY the same language and tone
- Hindi, English, Hinglish, Tamil, Telugu, Bengali, Marathi, Punjabi — whatever the user uses, you mirror it
- Match their emotion and formality level too

IRON RULES:
1. ABSOLUTELY NO CODE — not a single line of HTML, CSS, JS, Python, or anything. ZERO.
2. No code blocks (\`\`\`...\`\`\`) ever. If you need to mention a function/component, just write its name in plain text.
3. If user asks to "build", "create", "code" — immediately say: "This is Planning Mode. Switch to Build Mode to generate the app! 🔨"
4. Only discuss: feature list, user stories, UI sections, tech stack names (names only), architecture (text boxes/arrows only).

Response Format:
## 📱 App Concept
(1-2 line summary)

## ✨ Key Features
(bullet points — feature names only, no code)

## 🎨 UI/UX Design
(describe screens and layout in words)

## ⚙️ Tech Stack
(technology names only, no code)

## 🗺️ Architecture Overview
(text-based diagram only)

---
🔨 Ready? Switch to **Build Mode** — I'll generate the complete working app!`;

      // Strip any code blocks that slip through AI response
      const sanitizePlanningReply = (text: string): string => {
        return text
          .replace(/```[\s\S]*?```/g, '\n> ⚠️ *[Code removed — switch to Build Mode for actual code]*\n')
          .replace(/^\s{4,}.+$/gm, '') // strip indented code blocks
          .trim();
      };

      try {
        const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
        if (key) {
          // Build user content — with optional vision attachment (images/PDFs only work on direct Anthropic path)
          let userContent: any = message;
          if (isImageFile) {
            userContent = [
              { type: 'image', source: { type: 'base64', media_type: fileType, data: fileData } },
              { type: 'text', text: `[Image attached: ${fileName}]\n${message}` },
            ];
          } else if (isPDFFile) {
            userContent = [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileData } },
              { type: 'text', text: `[PDF attached: ${fileName}]\n${message}` },
            ];
          }
          const msgs = [
            ...(history || []).map((m: any) => ({
              role: (m.sender === 'user' ? 'user' : 'assistant') as 'user'|'assistant',
              content: String(m.text || m.content || '')
            })),
            { role: 'user' as const, content: userContent }
          ];
          const rawReply = await callClaudePro(key, PLAN_PROMPT, msgs, 1500);
          return res.json({ reply: sanitizePlanningReply(rawReply), files: {}, suggestBuild });
        }
      } catch (e: any) { console.warn('[PRO PLAN] Claude err:', e.message); }

      // ── Race 2: Claude + Grok simultaneously for planning ─────────────────
      const grokKeyPlan = process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
      const claudeKeyPlan = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
      type PlanRacerFn = (signal: AbortSignal) => Promise<string>;
      const planRacers: PlanRacerFn[] = [];

      // Build the last user message content — include file for vision providers
      const buildRaceUserContent = (supportsImages: boolean): any => {
        if (!hasFile || !supportsImages) return message;
        if (isImageFile) return [
          { type: 'image_url', image_url: { url: `data:${fileType};base64,${fileData}` } },
          { type: 'text', text: `[Image: ${fileName}]\n${message}` },
        ];
        // PDFs: fallback to text label (OpenAI-format race doesn't support PDF natively)
        return `[PDF attached: ${fileName}]\n${message}`;
      };

      const planHistoryMsgs = (history || []).slice(-8).map((m: any) => ({
        role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: String(m.text || m.content || '').slice(0, 400),
      }));

      const planMsgsText = [
        { role: 'system' as const, content: PLAN_PROMPT },
        ...planHistoryMsgs,
        { role: 'user' as const, content: message },
      ];

      // NOTE: Claude race attempt — separate from the sequential attempt above
      if (claudeKeyPlan) planRacers.push(async (signal) => {
        const rawBase = process.env.ANTHROPIC_BASE_URL;
        const base = rawBase?.replace(/\/v1\/?$/, '');
        if (!base) throw new Error('No proxy for race');
        const c = new OpenAI({ apiKey: claudeKeyPlan, baseURL: base });
        const claudeMsgs = [
          { role: 'system' as const, content: PLAN_PROMPT },
          ...planHistoryMsgs,
          { role: 'user' as const, content: buildRaceUserContent(true) },
        ];
        for (const m of ['anthropic/claude-sonnet-4.6', 'claude-sonnet-4-6']) {
          try {
            const r = await c.chat.completions.create({ model: m, messages: claudeMsgs, max_tokens: 1500 }, { signal });
            const t = r.choices[0]?.message?.content || '';
            if (t.trim()) return t;
          } catch (e: any) { if (signal.aborted) throw e; }
        }
        throw new Error('Claude plan race: empty');
      });

      if (grokKeyPlan) planRacers.push(async (signal) => {
        const c = new OpenAI({ apiKey: grokKeyPlan, baseURL: 'https://api.x.ai/v1' });
        // Use vision model for images, text model for everything else
        const grokModels = (hasFile && isImageFile) ? ['grok-2-vision-1212', 'grok-2-mini-vision-1212'] : ['grok-3', 'grok-3-fast'];
        const grokMsgs = [
          { role: 'system' as const, content: PLAN_PROMPT },
          ...planHistoryMsgs,
          { role: 'user' as const, content: buildRaceUserContent(!isPDFFile) },
        ];
        for (const gm of grokModels) {
          try {
            const r = await c.chat.completions.create({ model: gm, messages: grokMsgs, max_tokens: 1500 }, { signal });
            const t = r.choices[0]?.message?.content || '';
            if (t.trim()) return t;
          } catch (e: any) { if (signal.aborted) throw e; }
        }
        throw new Error('Grok plan race: empty');
      });

      if (planRacers.length > 0) {
        const planAcs = planRacers.map(() => new AbortController());
        try {
          const planWinner = await Promise.any(
            planRacers.map((fn, i) => fn(planAcs[i].signal).then(text => {
              planAcs.forEach((ac, j) => { if (j !== i && !ac.signal.aborted) ac.abort(); });
              console.log(`[PRO PLAN] Race won by ${i === 0 ? 'Claude' : 'Grok'}`);
              return text;
            }))
          );
          if (planWinner?.trim()) return res.json({ reply: sanitizePlanningReply(planWinner), files: {}, suggestBuild });
        } catch { console.warn('[PRO PLAN] Race both failed → Gemini/Vertex'); }
      }

      // ── Sequential fallback: Gemini → Vertex (both support images + PDFs via inlineData) ──
      // Build user parts with optional vision content
      const buildGeminiPlanParts = (): any[] => {
        const parts: any[] = [];
        if (hasFile && (isImageFile || isPDFFile)) {
          parts.push({ inlineData: { mimeType: fileType, data: fileData } });
          parts.push({ text: `[${isPDFFile ? 'PDF' : 'Image'}: ${fileName}]\n${PLAN_PROMPT}\n\nUser: ${message}` });
        } else {
          parts.push({ text: PLAN_PROMPT + '\n\nUser: ' + message });
        }
        return parts;
      };

      const geminiKeyPlan = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
      if (geminiKeyPlan) {
        try {
          const { GoogleGenAI } = await import('@google/genai');
          const rawHistory = (history || []).slice(-10).filter((m: any) => String(m.text || m.content || '').trim().length > 0);
          let historyContents: any[] = rawHistory.map((m: any) => ({
            role: m.sender === 'user' ? 'user' : 'model',
            parts: [{ text: String(m.text || m.content || '').slice(0, 600) }]
          }));
          while (historyContents.length > 0 && historyContents[0].role !== 'user') historyContents.shift();
          for (const gm of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']) {
            try {
              const r = await new GoogleGenAI({ apiKey: geminiKeyPlan }).models.generateContent({
                model: gm,
                contents: [...historyContents, { role: 'user', parts: buildGeminiPlanParts() }],
              });
              if (r.text?.trim()) return res.json({ reply: sanitizePlanningReply(r.text), files: {}, suggestBuild });
            } catch (ge: any) { console.warn(`[PRO PLAN] Gemini ${gm}: ${ge.message}`); }
          }
        } catch (e: any) { console.warn('[PRO PLAN] Gemini err:', e.message); }
      }

      const projectIdPlan = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID || '';
      if (projectIdPlan) {
        try {
          const { GoogleGenAI: VtxAI } = await import('@google/genai');
          const ai = new VtxAI({ vertexai: true, project: projectIdPlan, location: process.env.GOOGLE_CLOUD_REGION || 'us-central1' });
          for (const vm of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']) {
            try {
              const r = await ai.models.generateContent({ model: vm, contents: [{ role: 'user', parts: buildGeminiPlanParts() }] });
              if (r.text?.trim()) return res.json({ reply: sanitizePlanningReply(r.text), files: {}, suggestBuild });
            } catch (ve: any) { console.warn(`[PRO PLAN] Vertex ${vm}: ${ve.message}`); }
          }
        } catch (e: any) { console.warn('[PRO PLAN] Vertex err:', e.message); }
      }

      return res.status(500).json({ error: 'All AI providers unavailable. Please check API keys in Cloud Run console.' });

    } catch (error: any) {
      console.error('Pro Chat Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ══ SSE STREAMING BUILD ENDPOINT — Live progress to frontend ══
  // ── Shared sanitizer for user-supplied HTML ─────────────────────────────────
  const sanitizeUserHtml = (html: string): string => html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\bignore\b.*\bprevious\b/gi, '')
    .replace(/\bsystem\s*prompt\b/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '<script>[removed]</script>')
    .slice(0, 18000);

  app.post('/api/pro-build', async (req: any, res: any) => {
    let { message, currentFiles, isEdit, framework, history, fileAttachments, allFiles } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    // Process file attachments: text files decoded and prepended; images described via vision AI
    if (Array.isArray(fileAttachments) && fileAttachments.length > 0) {
      type FA = { name: string; type: string; base64: string };
      const fas: FA[] = fileAttachments;
      const textParts: string[] = [];
      const visionFas = fas.filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
      const textFas = fas.filter(f => !f.type.startsWith('image/') && f.type !== 'application/pdf');

      // Decode text/code files and prepend
      for (const f of textFas) {
        try {
          const decoded = Buffer.from(f.base64, 'base64').toString('utf8').slice(0, 6000);
          textParts.push(`\n\n[Reference file: ${f.name}]\n\`\`\`\n${decoded}\n\`\`\``);
        } catch { /* skip corrupt */ }
      }

      // For images/PDFs: use Gemini vision to get a description, inject into build prompt
      for (const f of visionFas) {
        try {
          const gemKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
          if (gemKey) {
            const { GoogleGenAI } = await import('@google/genai');
            const visionAI = new GoogleGenAI({ apiKey: gemKey });
            const descResult = await visionAI.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: [{ parts: [
                { inlineData: { mimeType: f.type, data: f.base64 } },
                { text: 'Describe this image/document in detail for a developer building a web app: layout, colors, components, text, UI elements. Be precise and comprehensive.' },
              ]}],
            });
            const desc = descResult.text?.trim();
            if (desc) textParts.push(`\n\n[Reference ${f.type.startsWith('image/') ? 'image' : 'document'}: ${f.name}]\n${desc}`);
          } else {
            textParts.push(`\n\n[Reference ${f.type.startsWith('image/') ? 'image' : 'document'}: ${f.name} — vision AI unavailable, build based on the text description]`);
          }
        } catch (ve: any) {
          console.warn(`[PRO-BUILD] Vision description failed for ${f.name}: ${ve.message}`);
          textParts.push(`\n\n[Reference file: ${f.name} — use this as design inspiration]`);
        }
      }

      if (textParts.length > 0) message = message + textParts.join('');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    // Build conversation context string from history array
    const historyContext = Array.isArray(history) && history.length > 0
      ? history.map((m: any) => `${m.role === 'user' ? 'User' : 'AI'}: ${String(m.content || '').slice(0, 600)}`).join('\n')
      : '';

    // Detect edit mode: explicit flag OR has currentFiles with substantial content
    const hasCurrentFiles = currentFiles &&
      (typeof currentFiles.html === 'string' && currentFiles.html.length > 50) ||
      (allFiles && typeof allFiles === 'object' && Object.keys(allFiles).length > 0);
    const useEdit = isEdit === true || (hasCurrentFiles && isEdit !== false);

    // Build allFiles context string so edit engine knows full workspace
    let allFilesContext = '';
    if (allFiles && typeof allFiles === 'object') {
      const fileNames = Object.keys(allFiles);
      if (fileNames.length > 0) {
        const fileSnippets = fileNames.slice(0, 40).map(name => {
          const content = String(allFiles[name] || '').slice(0, 3000);
          return `\n\n### ${name}\n\`\`\`\n${content}${String(allFiles[name] || '').length > 3000 ? '\n...[truncated]' : ''}\n\`\`\``;
        }).join('');
        allFilesContext = `\n\n[WORKSPACE — ${fileNames.length} files total. Edit ONLY what the user requested; all other files will be preserved automatically]${fileSnippets}`;
      }
    }

    try {
      let result;
      if (useEdit && hasCurrentFiles) {
        // ── ITERATIVE EDIT PATH ──────────────────────────────────────────────
        const safeFiles = {
          html: sanitizeUserHtml((currentFiles?.html || allFiles?.['index.html'] || allFiles?.[Object.keys(allFiles || {}).find((k: string) => k.endsWith('.html')) || ''] || '')),
          js:   ((currentFiles?.js  || allFiles?.['script.js'] || allFiles?.[Object.keys(allFiles || {}).find((k: string) => k.match(/\.(js|ts|jsx|tsx)$/) && !k.endsWith('.d.ts')) || ''] || '')).slice(0, 250000),
          css:  ((currentFiles?.css || allFiles?.['style.css']  || allFiles?.[Object.keys(allFiles || {}).find((k: string) => k.match(/\.(css|scss)$/)) || ''] || '')).slice(0, 100000),
        };

        // ── TypeScript/React source workspace: file-level editing ──────────────
        // When allFiles has .tsx/.ts source files, the workspace is a framework app.
        // editAppEngine expects single-file {html,css,js} — it can't handle TSX.
        // Instead: ask AI which specific file(s) to change, edit them directly.
        const tsxSourceFiles = allFiles
          ? Object.keys(allFiles).filter((k: string) => /\.(tsx|ts|jsx)$/.test(k) && !k.includes('node_modules') && !k.endsWith('.d.ts'))
          : [];
        const isTsxSourceWorkspace = tsxSourceFiles.length > 0;

        if (isTsxSourceWorkspace) {
          send({ type: 'progress', stage: 'Analyzing workspace', step: 1, total: 3, detail: `${tsxSourceFiles.length} TypeScript files found` });

          // Step 1: AI identifies which file(s) to edit
          const fileListStr = tsxSourceFiles.slice(0, 60).join('\n');
          let targets: string[] = [];
          try {
            const planRaw = await aiRouter.route(
              `User request: "${message.slice(0, 500)}"\n\nFiles:\n${fileListStr}\n\nWhich 1-2 files to edit? JSON only: {"targets":["path"]}`,
              [], 'free' as any, undefined,
              'TypeScript architect. Return only valid JSON {"targets":["path/to/file.tsx"]}.'
            );
            const parsed = JSON.parse(planRaw.replace(/```json?|```/g, '').trim());
            targets = ((parsed.targets || []) as string[]).filter((f: string) => allFiles?.[f]);
          } catch {}
          if (targets.length === 0) targets = [tsxSourceFiles[0]]; // fallback to first TS file

          send({ type: 'progress', stage: 'Editing source files', step: 2, total: 3, detail: `Updating ${targets.join(', ')}` });

          // Step 2: Edit each target file
          const updatedFiles: Record<string, string> = {};
          for (const filePath of targets.slice(0, 2)) {
            const original = String(allFiles?.[filePath] || '').slice(0, 20000);
            try {
              const updated = await aiRouter.route(
                `Edit this TypeScript/React file.\n\nUSER REQUEST: "${message.slice(0, 500)}"${historyContext ? `\nHISTORY:\n${historyContext.slice(0, 600)}` : ''}\n\nFILE: ${filePath}\n\n${original}\n\nReturn ONLY the complete updated file. No markdown.`,
                [], 'free' as any, undefined,
                'TypeScript/React expert. Return ONLY the complete updated file content. No markdown fences, no explanation.'
              );
              updatedFiles[filePath] = updated;
              send({ type: 'file', fileName: filePath, content: updated });
            } catch (e: any) {
              console.warn(`[TSX-EDIT] ${filePath}:`, e.message);
            }
          }

          result = {
            success: true,
            reply: Object.keys(updatedFiles).length > 0
              ? `Updated ${Object.keys(updatedFiles).join(', ')}`
              : `Could not identify which files to edit — please be more specific about what to change.`,
            files: updatedFiles,
            fileList: Object.entries(updatedFiles).map(([p, c]) => ({ path: p, content: c, description: p })),
            previewHtml: '',
            appName: 'Updated App',
            validationReport: null,
            followUpSuggestions: [],
          };

        } else {
        // Server-side guard: if the existing HTML is too short/placeholder AND message looks
        // like a full new build, route to buildApp instead of editApp to avoid broken rewrites.
        // Only treat as placeholder if allFiles is also small (Vite HTML is < 400 chars but has many source files).
        const hasSubstantialWorkspace = allFiles ? Object.keys(allFiles).length > 5 : false;
        const isPlaceholderWorkspace = safeFiles.html.length < 400 && !hasSubstantialWorkspace;
        const looksFreshBuild = /\b(build|create|make|generate)\b/i.test(message) &&
          /\b(app|game|website|tool|dashboard|calculator|quiz|generator)\b/i.test(message);
        if (isPlaceholderWorkspace && looksFreshBuild) {
          console.log('[PRO-BUILD] Placeholder workspace + fresh-build request detected → routing to buildApp');
          const buildMsg = historyContext ? `[CONVERSATION HISTORY]\n${historyContext}\n\n[BUILD REQUEST]\n${message}` : message;
          result = await buildAppEngine(
            buildMsg,
            (p) => send({ type: 'progress', stage: p.stage, step: p.step, total: p.total, detail: p.detail }),
            (fileName, content) => send({ type: 'file', fileName, content })
          );
        } else {
        const editMessage = allFilesContext ? message + allFilesContext : message;
        result = await editAppEngine(
          editMessage,
          safeFiles,
          (p) => send({ type: 'progress', stage: p.stage, step: p.step, total: p.total, detail: p.detail, isEdit: true }),
          (fileName, content) => send({ type: 'file', fileName, content }),
          historyContext
        );
        } // end else (non-placeholder edit path)
        } // end else (non-TSX workspace)
      } else if (framework === 'react') {
        // ── REACT BUILD PATH ─────────────────────────────────────────────────
        const reactMessage = historyContext
          ? `[CONVERSATION HISTORY]\n${historyContext}\n\n[BUILD REQUEST]\n${message}`
          : message;
        result = await buildReactAppEngine(
          reactMessage,
          (p) => send({ type: 'progress', stage: p.stage, step: p.step, total: p.total, detail: p.detail }),
          (fileName, content) => send({ type: 'file', fileName, content })
        );
      } else {
        // ── FULL BUILD PATH ──────────────────────────────────────────────────
        const buildMessage = historyContext
          ? `[CONVERSATION HISTORY]\n${historyContext}\n\n[BUILD REQUEST]\n${message}`
          : message;
        result = await buildAppEngine(
          buildMessage,
          (p) => send({ type: 'progress', stage: p.stage, step: p.step, total: p.total, detail: p.detail }),
          (fileName, content) => send({ type: 'file', fileName, content })
        );
      }

      send({
        type: 'complete',
        files: result.files,
        reply: result.reply,
        appName: result.appName,
        previewHtml: result.previewHtml,
        success: result.success,
        error: result.error,
        validationReport: result.validationReport,
        deploymentGuide: result.deploymentGuide,
        followUpSuggestions: result.followUpSuggestions,
      });
    } catch (err: any) {
      const msg: string = err?.message || 'Unknown build error';
      let userFriendly = 'App build failed. Please try again.';
      let suggestion = 'Try simplifying your request or breaking it into smaller steps.';
      if (msg.includes('temporarily unavailable') || msg.includes('overloaded')) {
        userFriendly = 'AI service is temporarily busy.';
        suggestion = 'Wait 30 seconds and try again.';
      } else if (msg.includes('rate limit') || msg.includes('429')) {
        userFriendly = 'Rate limit reached.';
        suggestion = 'Please wait 1 minute before building again.';
      } else if (msg.includes('token') || msg.includes('length') || msg.includes('too long')) {
        userFriendly = 'App request is too complex for one build.';
        suggestion = 'Break it into phases: first build the basic structure, then add features one by one.';
      } else if (msg.includes('API key') || msg.includes('auth') || msg.includes('401')) {
        userFriendly = 'AI provider authentication error.';
        suggestion = 'Contact support — API key may need renewal.';
      }
      send({ type: 'error', message: userFriendly, detail: msg, suggestion });
    }
    res.end();
  });
}
