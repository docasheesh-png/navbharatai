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

  app.post('/api/cloudsync/firebase', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    try {
      res.json({
        status: 'success',
        projects: [
          { id: 'navbharat-sandbox-7729', name: 'navBharat Sandbox (Default)', hosting: 'navbharat-sandbox-7729.web.app', functions: ['api-gateway', 'telemetry-worker'] },
          { id: 'navbharat-saas-enterprise', name: 'navBharat SaaS Enterprise (Production)', hosting: 'navbharat-saas-enterprise.web.app', functions: ['billing-service', 'user-provisioner'] },
          { id: 'navbharat-ecom-99a3', name: 'navBharat E-Commerce Portal', hosting: 'navbharat-ecom-99a3.web.app', functions: ['cart-handler', 'checkout-listener'] },
          { id: 'firebase-custom-build', name: 'Custom Firebase Target', hosting: 'firebase-custom-build.web.app', functions: ['webhook-receiver'] }
        ]
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/cloudsync/vercel', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    try {
      res.json({
        status: 'success',
        deployments: [
          { id: 'dep-44a1', name: 'my-ecommerce-app', url: 'https://my-ecommerce-app.vercel.app', repo: 'workspace/my-ecommerce-app', env: 'production' },
          { id: 'dep-09b2', name: 'mitrify', url: 'https://mitrify-stream.vercel.app', repo: 'workspace/mitrify', env: 'production' },
          { id: 'dep-77c8', name: 'navbharat-dashboard', url: 'https://navbharat-dash.vercel.app', repo: 'workspace/navbharat-dashboard', env: 'staging' },
          { id: 'dep-88d9', name: 'portfolio-site', url: 'https://ashish-portfolio.vercel.app', repo: 'workspace/portfolio-site', env: 'production' }
        ]
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
