/**
 * NavBharatAI Pro — App Maker Engine v2
 * 
 * Replaces the broken AppMakerOrchestrator flow.
 * 
 * Flow:
 *   user prompt
 *     → analyzeRequirements()   — understand what to build
 *     → planFiles()             — decide which files needed
 *     → generateFiles()         — generate each file via AI (Claude → Vertex → Gemini)
 *     → assemble()              — combine into final output + preview HTML
 *
 * Connected to /api/pro-chat in server.ts via buildApp()
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AppFile {
  path: string;
  content: string;
  description: string;
}

export interface BuildResult {
  success: boolean;
  reply: string;
  files: Record<string, string>;   // path → content (for existing preview system)
  fileList: AppFile[];
  previewHtml: string;
  appName: string;
  error?: string;
}

export interface BuildProgress {
  stage: string;
  step: number;
  total: number;
  detail: string;
}

type ProgressCallback = (p: BuildProgress) => void;
type FileGeneratedCallback = (fileName: string, content: string) => void;

// ─── AI Caller — Claude first, Gemini fallback ───────────────────────────────

async function callAI(prompt: string, systemPrompt: string, maxTokens = 4000): Promise<string> {
  // 1. Try Claude
  const claudeKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (claudeKey) {
    try {
      const client = new Anthropic({ apiKey: claudeKey });
      const r = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = r.content.find(c => c.type === 'text')?.text || '';
      if (text.trim()) return text;
    } catch (e: any) {
      console.warn('[AppEngine] Claude failed:', e.message);
    }
  }

  // 2. Fallback: Gemini
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const r = await ai.models.generateContent({
        model: 'gemini-1.5-pro',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { systemInstruction: systemPrompt, maxOutputTokens: maxTokens },
      });
      if (r.text?.trim()) return r.text;
    } catch (e: any) {
      console.warn('[AppEngine] Gemini failed:', e.message);
    }
  }

  throw new Error('All AI providers failed. Check ANTHROPIC_API_KEY and GEMINI_API_KEY.');
}

// ─── Step 1: Analyze what app to build ───────────────────────────────────────

async function analyzeRequirements(prompt: string): Promise<{
  appName: string;
  appType: string;
  features: string[];
  techStack: string;
  description: string;
}> {
  const sys = `You are a software architect. Analyze the user's app request and return JSON only.
Return this exact JSON structure:
{
  "appName": "short app name",
  "appType": "web-app|game|tool|dashboard|landing-page|calculator|clock|etc",
  "features": ["feature1", "feature2", "feature3"],
  "techStack": "HTML+CSS+JS (vanilla)",
  "description": "one sentence what this app does"
}
Return ONLY the JSON, no markdown, no explanation.`;

  const raw = await callAI(prompt, sys, 500);
  try {
    const clean = raw.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return {
      appName: 'My App',
      appType: 'web-app',
      features: ['main functionality'],
      techStack: 'HTML+CSS+JS',
      description: prompt.slice(0, 80),
    };
  }
}

// ─── Step 2: Generate individual file ────────────────────────────────────────

async function generateFile(
  fileName: string,
  fileRole: string,
  appName: string,
  appDescription: string,
  features: string[],
  existingFiles: Record<string, string> = {}
): Promise<string> {
  const context = Object.keys(existingFiles).length > 0
    ? `\n\nAlready generated files for reference:\n${Object.entries(existingFiles).map(([f, c]) => `--- ${f} ---\n${c.slice(0, 800)}`).join('\n\n')}`
    : '';

  const sys = `You are a world-class frontend developer. Generate ONLY the raw file content requested.
No markdown fences, no explanations, just the pure code content.
Make it beautiful, modern, and fully functional.`;

  const prompt = `Generate the ${fileName} file for this app:

App Name: ${appName}
Description: ${appDescription}
Features: ${features.join(', ')}
This file's role: ${fileRole}
${context}

Rules:
- Write COMPLETE, WORKING code — no placeholders, no TODOs
- For HTML: full document structure, link style.css and script.js
- For CSS: beautiful dark theme, smooth animations, responsive design, professional look
- For JS: complete working logic, real-time if needed (clocks use setInterval), all features implemented
- For analog clock: use HTML5 Canvas API, draw hour/minute/second hands with proper math
- Quality must be world-class — something you'd be proud to show

Output ONLY the raw code for ${fileName}:`;

  return callAI(prompt, sys, 4000);
}

// ─── Step 3: Build preview HTML (self-contained) ─────────────────────────────

function buildPreviewHtml(files: Record<string, string>, appName: string): string {
  let html = files['index.html'] || '';
  const css = files['style.css'] || '';
  const js = files['script.js'] || '';

  if (!html) {
    html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${appName}</title></head><body></body></html>`;
  }

  // Inject CSS inline
  if (css) {
    const styleTag = `<style>\n${css}\n</style>`;
    if (html.includes('</head>')) {
      html = html.replace('</head>', `${styleTag}\n</head>`);
    } else {
      html = styleTag + html;
    }
  }

  // Remove external CSS link (since we inlined it)
  html = html.replace(/<link[^>]+style\.css[^>]*>/gi, '');

  // Inject JS inline
  if (js) {
    const scriptTag = `<script>\n${js}\n</script>`;
    if (html.includes('</body>')) {
      html = html.replace('</body>', `${scriptTag}\n</body>`);
    } else {
      html = html + scriptTag;
    }
  }

  // Remove external JS script tag (since we inlined it)
  html = html.replace(/<script[^>]+src=["']script\.js["'][^>]*><\/script>/gi, '');

  return html;
}

// ─── Main: buildApp() — called from server.ts ─────────────────────────────────

export async function buildApp(
  userPrompt: string,
  onProgress?: ProgressCallback,
  onFileGenerated?: FileGeneratedCallback
): Promise<BuildResult> {
  const report = (stage: string, step: number, total: number, detail: string) => {
    console.log(`[AppEngine] [${step}/${total}] ${stage}: ${detail}`);
    onProgress?.({ stage, step, total, detail });
  };

  try {
    report('Analyzing', 1, 6, 'Understanding your requirements...');
    const analysis = await analyzeRequirements(userPrompt);
    console.log('[AppEngine] Analysis:', analysis);

    report('Planning', 2, 6, `Building ${analysis.appName} — ${analysis.appType}`);

    const generatedFiles: Record<string, string> = {};

    // Generate CSS first (no dependencies)
    report('Generating', 3, 6, 'Writing style.css — design & animations...');
    generatedFiles['style.css'] = await generateFile(
      'style.css',
      'All visual styling: layout, colors, animations, responsive design. Dark theme. Professional look.',
      analysis.appName,
      analysis.description,
      analysis.features
    );
    onFileGenerated?.('style.css', generatedFiles['style.css']);

    // Generate JS (no HTML dependency needed)
    report('Generating', 4, 6, 'Writing script.js — application logic...');
    generatedFiles['script.js'] = await generateFile(
      'script.js',
      'Complete application logic. All functionality implemented and working.',
      analysis.appName,
      analysis.description,
      analysis.features,
      { 'style.css': generatedFiles['style.css'] }
    );
    onFileGenerated?.('script.js', generatedFiles['script.js']);

    // Generate HTML last (references CSS and JS)
    report('Generating', 5, 6, 'Writing index.html — structure & markup...');
    generatedFiles['index.html'] = await generateFile(
      'index.html',
      'Complete HTML5 document. Links to style.css and script.js. All DOM elements needed by JS.',
      analysis.appName,
      analysis.description,
      analysis.features,
      { 'style.css': generatedFiles['style.css'], 'script.js': generatedFiles['script.js'] }
    );
    onFileGenerated?.('index.html', generatedFiles['index.html']);

    report('Assembling', 6, 6, 'Building live preview...');
    const previewHtml = buildPreviewHtml(generatedFiles, analysis.appName);

    report('Complete', 6, 6, `${analysis.appName} is ready!`);

    const fileList: AppFile[] = Object.entries(generatedFiles).map(([path, content]) => ({
      path,
      content,
      description: path === 'index.html' ? 'HTML structure'
        : path === 'style.css' ? 'Styles & animations'
        : 'Application logic',
    }));

    return {
      success: true,
      reply: `✅ ${analysis.appName} ban gayi! ${analysis.description}`,
      files: generatedFiles,
      fileList,
      previewHtml,
      appName: analysis.appName,
    };

  } catch (err: any) {
    console.error('[AppEngine] Build failed:', err);
    return {
      success: false,
      reply: `Build failed: ${err.message}`,
      files: {},
      fileList: [],
      previewHtml: '',
      appName: 'App',
      error: err.message,
    };
  }
}
