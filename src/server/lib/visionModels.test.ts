import { describe, it, expect, afterEach } from 'vitest';
import {
  claudeVisionModel,
  claudeVisionAnswerModel,
  glmVisionModels,
  grokVisionModels,
  geminiVisionModels,
  vertexVisionModels,
} from './visionModels';

const ENV_KEYS = [
  'VISION_CLAUDE_MODEL',
  'VISION_CLAUDE_ANSWER_MODEL',
  'VISION_GLM_MODELS',
  'VISION_GROK_MODELS',
  'VISION_GEMINI_MODELS',
  'VISION_VERTEX_MODELS',
];

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe('visionModels — current, env-overridable vision model ids', () => {
  it('defaults are CURRENT model ids (never the retired 2024-era ones)', () => {
    const all = [
      claudeVisionModel(),
      claudeVisionAnswerModel(),
      ...grokVisionModels(),
      ...geminiVisionModels(),
      ...vertexVisionModels(),
    ];
    for (const id of all) {
      // The exact retired ids that broke file reading on every surface must never return.
      expect(id).not.toMatch(/claude-3-5-sonnet|grok-2-vision|grok-2-mini-vision|gemini-2\.0-flash|gemini-1\.5/);
      expect(id.length).toBeGreaterThan(4);
    }
  });

  it('Gemini/Vertex default lists read BOTH images and PDFs (multimodal 2.5 family)', () => {
    expect(geminiVisionModels()[0]).toBe('gemini-2.5-flash');
    expect(vertexVisionModels()[0]).toBe('gemini-2.5-flash');
    expect(geminiVisionModels().length).toBeGreaterThan(1); // has a fallback
  });

  // Slice C — the FREE vision leader ($0 in/out on Z.AI, verified 2026-07-11).
  it('GLM vision defaults to the free glm-4.6v-flash and honors VISION_GLM_MODELS', () => {
    expect(glmVisionModels()).toEqual(['glm-4.6v-flash']);
    process.env.VISION_GLM_MODELS = 'glm-5v-turbo, glm-4.6v-flash';
    expect(glmVisionModels()).toEqual(['glm-5v-turbo', 'glm-4.6v-flash']);
  });

  it('env overrides win and are parsed as comma-separated lists', () => {
    process.env.VISION_GROK_MODELS = ' grok-5 , grok-4 ';
    process.env.VISION_GEMINI_MODELS = 'gemini-3.0-pro';
    process.env.VISION_CLAUDE_MODEL = 'claude-test-x';
    expect(grokVisionModels()).toEqual(['grok-5', 'grok-4']);
    expect(geminiVisionModels()).toEqual(['gemini-3.0-pro']);
    expect(claudeVisionModel()).toBe('claude-test-x');
  });

  it('an empty/whitespace env override falls back to the defaults (never an empty chain)', () => {
    process.env.VISION_GROK_MODELS = '  ,  ';
    process.env.VISION_VERTEX_MODELS = '';
    expect(grokVisionModels().length).toBeGreaterThan(0);
    expect(vertexVisionModels().length).toBeGreaterThan(0);
  });
});
