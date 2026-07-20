import type { Express, Request, Response } from 'express';
import { rateLimiter } from '../lib/authMiddleware';
import { validateBody, vobject, vstring } from '../lib/validate';
import {
  buildImagePrompt, parseImagePartsResponse, imageGenModels, imageGenConfigured, isValidImageGenRequest,
} from '../lib/imageGen';

/**
 * AI Image Gen — the REAL /api/image/generate route (admin autopsy 2026-07-20).
 *
 * POST /api/image/generate
 *   body: { prompt, style?, size? }
 *   → { image: "data:<mime>;base64,<...>", mimeType }
 *
 * The AI Tools → AI Image Gen tile shipped with NO server side — the client hot-linked a
 * third-party free image site. This route generates images on NavBharatAI's own configured
 * image model (the same key chain the vision path uses). HONESTY: when no key is configured,
 * or every model fails, the response is an explicit white-label error — never a placeholder
 * image, never a silent external fallback.
 */
const ROUTE_TIMEOUT_MS = 60_000;

const schema = vobject({
  prompt: vstring({ max: 2_000 }),
  style: vstring({ optional: true, max: 40 }),
  size: vstring({ optional: true, max: 40 }),
});

// Image generation is costlier than text — its own tighter bucket, separate from the workspace one.
const imageGenLimiter = () => rateLimiter({ name: 'imagegen', authed: 40, anon: 10, noun: 'image generations' });

export function registerImageGenRoutes(app: Express): void {
  app.post('/api/image/generate', imageGenLimiter(), validateBody(schema), async (req: Request, res: Response) => {
    if (!isValidImageGenRequest(req.body)) {
      res.status(400).json({ error: 'A non-empty "prompt" is required.' });
      return;
    }
    if (!imageGenConfigured()) {
      // Honest not-available state (rule 2): the capability needs the image key in the environment.
      res.status(503).json({ error: 'Image generation is not configured on this server yet — please try again later.' });
      return;
    }
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      const ai = new GoogleGenAI({ apiKey });
      const prompt = buildImagePrompt(req.body);
      const timeout = <T,>(p: Promise<T>): Promise<T> => Promise.race([
        p,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('image-generation timeout')), ROUTE_TIMEOUT_MS)),
      ]);
      for (const model of imageGenModels()) {
        try {
          const result: any = await timeout(ai.models.generateContent({
            model,
            contents: prompt,
            config: { responseModalities: ['IMAGE', 'TEXT'] },
          }));
          const img = parseImagePartsResponse(result);
          if (img) {
            res.json({ image: `data:${img.mimeType};base64,${img.base64}`, mimeType: img.mimeType });
            return;
          }
          console.warn(`[IMAGE_GEN] ${model} returned no image part — trying the next rung.`);
        } catch (err) {
          console.warn(`[IMAGE_GEN] ${model} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // Every rung failed — honest, white-label error (model ids stay in server logs only).
      res.status(502).json({ error: 'NavBharatAI could not generate the image right now — please try again in a minute.' });
    } catch {
      res.status(503).json({ error: 'NavBharatAI\'s image engine is briefly busy — please try again.' });
    }
  });
}
