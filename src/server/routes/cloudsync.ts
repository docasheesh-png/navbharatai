import path from 'path';
import axios from 'axios';
import type { Express, Request, Response } from 'express';

/**
 * Cloud-sync provider routes (GitHub repo import, Firebase/Vercel project lists)
 * extracted from the server.ts monolith (Phase 1). Self-contained — token comes
 * from the request. Behavior unchanged.
 *
 * NOTE: the Firebase/Vercel responses are static mock lists in the original
 * code; preserved as-is here (flagged for Phase 5 real-integration work).
 */
export function registerCloudsyncRoutes(app: Express): void {
  app.post('/api/cloudsync/github', async (req: Request, res: Response) => {
    const token = req.headers.authorization?.split(' ')[1] || req.body.token;
    const { owner, repo, branch = 'main' } = req.body;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
      const branchRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/branches/${branch}`, { headers });
      const treeSha = branchRes.data.commit.commit.tree.sha;
      const treeRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`, { headers });
      const tree = treeRes.data.tree;
      const files: Record<string, string> = {};
      const textExtensions = new Set(['.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt', '.py', '.yml', '.yaml']);

      let fetchedCount = 0;
      for (const item of tree) {
        if (item.type === 'blob' && fetchedCount < 100) {
          const ext = path.extname(item.path).toLowerCase();
          if (textExtensions.has(ext) || path.basename(item.path) === 'Dockerfile' || path.basename(item.path).startsWith('.')) {
            try {
              const blobRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/git/blobs/${item.sha}`, { headers });
              files[item.path] = Buffer.from(blobRes.data.content, 'base64').toString('utf-8');
              fetchedCount++;
            } catch (blobErr) {
              console.warn(`Failed to fetch blob for ${item.path}:`, blobErr);
            }
          }
        }
      }
      res.json({ status: 'success', files, tree });
    } catch (err: any) {
      res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
    }
  });

  // Firebase + Vercel real integration requires OAuth tokens and platform API keys —
  // not yet implemented. Return not_available so the UI falls back to presetTemplates.
  app.post('/api/cloudsync/firebase', (req: Request, res: Response) => {
    res.json({ status: 'not_available', message: 'Firebase project listing coming soon. Use Firebase CLI: firebase deploy --only hosting' });
  });

  app.post('/api/cloudsync/vercel', (req: Request, res: Response) => {
    res.json({ status: 'not_available', message: 'Vercel project listing coming soon. Use Vercel CLI: npx vercel --prod' });
  });
}
