import fs from 'fs';
import path from 'path';
import type { Express, Request, Response } from 'express';
import { BuildJobManager } from '../AppMakerLab/jobs/BuildJobManager';

/**
 * AppMaker execution-telemetry + job-status routes extracted from the server.ts
 * monolith (Phase 1). Behavior unchanged. Build-history is read from the
 * on-disk runtime/build-history directory.
 */
const HISTORY_DIR = path.join(process.cwd(), 'runtime', 'build-history');

export function registerAppmakerRoutes(app: Express): void {
  app.get('/api/appmaker/executions', async (_req: Request, res: Response) => {
    try {
      if (!fs.existsSync(HISTORY_DIR)) {
        return res.json([]);
      }
      const files = fs.readdirSync(HISTORY_DIR);
      const executions = files.map(file => {
        const filePath = path.join(HISTORY_DIR, file);
        fs.statSync(filePath);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
          executionId: content.executionId,
          timestamp: content.timestamp,
          status: content.buildResult.success ? 'SUCCESS' : 'FAILED'
        };
      });
      res.json(executions);
    } catch (err) {
      console.error('Error fetching executions:', err);
      res.status(500).json({ error: 'Failed to fetch executions' });
    }
  });

  app.get('/api/appmaker/executions/:executionId', async (req: Request, res: Response) => {
    try {
      const { executionId } = req.params;
      const filePath = path.join(HISTORY_DIR, `${executionId}.json`);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Execution not found' });
      }
      const content = fs.readFileSync(filePath, 'utf8');
      res.json(JSON.parse(content));
    } catch (err) {
      console.error('Error fetching execution:', err);
      res.status(500).json({ error: 'Failed to fetch execution' });
    }
  });

  app.get('/api/appmaker/jobs/:jobId', async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      const job = await BuildJobManager.getJob(jobId);
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }
      res.json(job);
    } catch (err) {
      console.error('Error fetching job:', err);
      res.status(500).json({ error: 'Failed to fetch job' });
    }
  });
}
