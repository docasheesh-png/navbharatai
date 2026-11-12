import type { Express, Request, Response, RequestHandler } from 'express';
import { envFlag } from '../lib/envFlag';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { routeParam } from '../lib/expressCompat';
import { signDownloadTicket, verifyDownloadTicket, downloadTicketQuery, ticketSecret } from '../lib/downloadTicket';
import { proAttachmentStore, AttachmentError, attachmentIdValid, type ProAttachmentStore, type ProAttachment } from '../lib/proAttachmentStore';

const view = ({ leaseUntil: _leaseUntil, ...file }: ProAttachment) => ({ ...file, readable: false });
export function registerProAttachmentRoutes(app: Express, limiter: RequestHandler, store: ProAttachmentStore = proAttachmentStore): void {
  const handle = (fn: (req: Request, res: Response, uid: string) => Promise<unknown>) => async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const uid = await verifyFirebaseToken(req);
      if (!uid) return res.status(401).json({ error: 'Please sign in to save or download attachments.' });
      return await fn(req, res, uid);
    } catch (e) {
      return res.status(e instanceof AttachmentError ? e.status : 503).json({
        error: e instanceof AttachmentError ? e.message : 'Attachment storage is unavailable. Please try again.',
      });
    }
  };
  app.post('/api/agentv3/attachments', limiter, handle(async (req, res, uid) => {
    if (!envFlag('PRO_ATTACHMENTS_ENABLED')) throw new AttachmentError(503, 'Saving new binary attachments is not enabled. Existing saved files can still be downloaded or deleted.');
    const record = await store.upload(uid, req.body);
    return res.json({ ok: true, attachment: view(record) });
  }));
  app.get('/api/agentv3/attachments', handle(async (req, res, uid) => {
    const session = req.query.sessionId;
    if (session !== undefined && (typeof session !== 'string' || !/^[\w-]{1,160}$/.test(session))) {
      throw new AttachmentError(400, 'Invalid chat.');
    }
    return res.json({ ok: true, enabled: envFlag('PRO_ATTACHMENTS_ENABLED'), attachments: (await store.list(uid, session as string | undefined)).map(view) });
  }));
  app.delete('/api/agentv3/attachments', handle(async (req, res, uid) => {
    const { sessionId, messageId } = req.query;
    if (typeof sessionId !== 'string' || !/^[\w-]{1,160}$/.test(sessionId)
      || (messageId !== undefined && (typeof messageId !== 'string' || !/^[\w-]{1,160}$/.test(messageId)))) {
      throw new AttachmentError(400, 'A valid chat and message are required.');
    }
    await store.erase(uid, { sessionId, ...(messageId ? { messageId: messageId as string } : {}) });
    return res.json({ ok: true });
  }));
  app.delete('/api/agentv3/attachments/:id', handle(async (req, res, uid) => {
    const id = String(routeParam(req.params.id));
    if (!attachmentIdValid(id)) throw new AttachmentError(404, 'That file is not available.');
    await store.inspect(uid, id); await store.remove(uid, id);
    return res.json({ ok: true });
  }));
  app.post('/api/agentv3/attachments/:id/ticket', limiter, handle(async (req, res, uid) => {
    const id = String(routeParam(req.params.id));
    if (!attachmentIdValid(id)) throw new AttachmentError(404, 'That file is not available.');
    await store.get(uid, id);
    const expiresAt = Date.now() + 60_000;
    const sig = signDownloadTicket(`pro-attachment:${id}`, uid, expiresAt, ticketSecret());
    return res.json({ ok: true, expiresAt, path: `/api/agentv3/attachments/${id}/download?${downloadTicketQuery(uid, expiresAt, sig)}` });
  }));
  app.get('/api/agentv3/attachments/:id/download', limiter, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const id = String(routeParam(req.params.id));
      if (!attachmentIdValid(id)) throw new AttachmentError(404, 'That file is not available.');
      if (verifyDownloadTicket(`pro-attachment:${id}`, req.query, ticketSecret(), Date.now()) !== 'ok') {
        throw new AttachmentError(403, 'This download link is invalid or expired. Request a new link.');
      }
      const { record, bytes } = await store.read(String(req.query.u), id);
      // Never serve the supplied MIME, HTML, SVG, executable or an inline preview.
      res.setHeader('Content-Type', 'application/octet-stream');
      const fallback = record.name.replace(/[^a-zA-Z0-9._ -]/g, '_');
      const encoded = encodeURIComponent(record.name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`);
      res.setHeader('Content-Disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`);
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
      return res.send(bytes);
    } catch (e) {
      return res.status(e instanceof AttachmentError ? e.status : 503).json({ error: e instanceof AttachmentError ? e.message : 'Could not download this file.' });
    }
  });
}
