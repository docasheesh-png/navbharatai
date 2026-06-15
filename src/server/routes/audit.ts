import type { Express, Request, Response } from 'express';
import { callGemini } from '../lib/aiCalls';
import { getSecurityContext } from '../lib/prompts';

/**
 * Security-scan + website-audit routes extracted from the server.ts monolith
 * (Phase 1, AI-core step e). Behavior unchanged.
 *
 * - POST /api/security/scan — AI security scan of a target (uses Gemini)
 * - POST /api/audit/full    — full website audit (currently a placeholder in the
 *   original code; preserved as-is, flagged for real implementation in Phase 5)
 */
export function registerAuditRoutes(app: Express): void {
  app.post('/api/security/scan', async (req: Request, res: Response) => {
    const { target, files } = req.body;
    const userKeys = {
      gemini: req.headers['x-gemini-key'] as string,
    };

    if (!target) return res.status(400).json({ error: 'Target is required' });

    try {
      const prompt = `Perform a deep security scan on the following target: ${target}.
Current Project Files (if applicable): ${JSON.stringify(files || {})}
Analyze the target for any vulnerabilities, configuration issues, or exposed secrets.`;

      const reply = await callGemini(prompt, userKeys.gemini, [], getSecurityContext(target));
      res.json({ reply });
    } catch (error: any) {
      console.error('Security scan failure:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // REAL WEBSITE AUDIT ENGINE ENDPOINT
  app.post('/api/audit/full', async (req: Request, res: Response) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    try {
      // const report = await fullWebsiteAudit(url);
      const report = { status: 'audit_not_available' }; // Placeholder
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
