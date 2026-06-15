import axios from 'axios';
import type { Express, Request, Response } from 'express';
import { doc, getDoc } from 'firebase/firestore';
import { getDb } from '../lib/db';

/**
 * Anthropic streaming proxy (Pro/VIP-gated) extracted from the server.ts
 * monolith (Phase 1). Behavior unchanged — verifies the caller's tier from
 * Firestore, then proxies a streaming chat completion.
 */
export function registerAnthropicRoutes(app: Express): void {
  app.post('/api/anthropic', async (req: Request, res: Response) => {
    const db = getDb() as any;
    try {
      const { userId, messages, model } = req.body;
      if (!userId || !messages) return res.status(400).json({ error: 'Missing parameters' });

      // Check User Tier
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (!userDoc.exists()) return res.status(404).json({ error: 'User not found' });

      const userData = userDoc.data();
      if (userData.tier !== 'pro' && userData.tier !== 'vip') {
        return res.status(403).json({ error: 'Forbidden: Pro or VIP access required' });
      }

      // Proxy request
      const response = await axios.post(
        `${process.env.ANTHROPIC_BASE_URL}/chat/completions`,
        {
          model: model || 'anthropic/claude-opus-4.7-fast',
          messages,
          stream: true
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.ANTHROPIC_API_KEY}`,
            'Content-Type': 'application/json'
          },
          responseType: 'stream'
        }
      );

      // Pipe response
      res.setHeader('Content-Type', 'text/event-stream');
      response.data.pipe(res);

    } catch (err: any) {
      console.error('[API] Anthropic proxy error:', err.message);
      res.status(500).json({ error: 'Failed to call Anthropic API' });
    }
  });
}
