import type { Express, RequestHandler } from 'express';
import { privateProofPictureStore, readProofPicture, type ProofPictureStore } from '../AgentV3/gameProofPictures';

/**
 * Admin → Apps → "v" (one app's build reports): the GAME_PROOF pictures (Q-3363). One read-only route, behind the admin
 * token, that streams one picture from the private store by the key GAME_PROOF recorded. Never a public or signed URL:
 * the bytes leave only through this route, with `no-store`, so no browser or proxy keeps a copy. Each failure has its
 * own status — an invalid key (400), a picture past its 30 days (410), one that is gone (404), storage that could not
 * answer (503) — never an empty image that looks like a picture.
 */
export function registerGameProofPicturesAdminRoutes(
  app: Express,
  verifyAdminToken: RequestHandler,
  store: () => ProofPictureStore | null = () => privateProofPictureStore(),
): void {
  app.get('/api/admin/game-proof-picture', verifyAdminToken, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const answer = await readProofPicture(store(), req.query?.key);
    if (answer.kind === 'ok') {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'inline');
      res.status(200).send(answer.bytes);
      return;
    }
    const [status, error] = answer.kind === 'invalid' ? [400, 'That is not a game proof picture.']
      : answer.kind === 'expired' ? [410, 'This picture was kept for 30 days and has been deleted.']
        : answer.kind === 'missing' ? [404, 'This picture is not in storage (deleted, or never kept).']
          : [503, 'The private picture store could not be read right now.'];
    res.status(status).json({ error });
  });
}
