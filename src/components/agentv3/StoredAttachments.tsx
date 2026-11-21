import { useEffect, useState } from 'react';
import { resolveApiHref } from '../../lib/apiBase';
import { isNativeApp } from '../../lib/mobileNative';
import { attachmentResponse, attachmentStateLabel, visiblePrivateAttachments, attachmentChatLabel, safeAttachmentDownloadPath, validStoredAttachment, type StoredProAttachment } from '../../lib/proAttachmentClient';

export function StoredAttachments({ sessionId, userId, refresh, headers }: {
  sessionId: string; userId?: string; refresh: number; headers: () => Promise<Record<string, string>>;
}) {
  const [files, setFiles] = useState<StoredProAttachment[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [reload, setReload] = useState(0);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [onlyThisChat, setOnlyThisChat] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setFiles([]); setError(''); setBusy(''); setAvailable(null); setConfirmDelete(null);
    if (userId) void (async () => {
      const response = await fetch('/api/agentv3/attachments', {
        headers: await headers(), signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.status === 404) { setAvailable(false); return; }
      setAvailable(true);
      const body = await attachmentResponse(response);
      if (!Array.isArray(body.attachments) || !body.attachments.every(validStoredAttachment)) throw new Error('Could not verify the saved file list.');
      if (!controller.signal.aborted) {
        setFiles(body.attachments);
        setAvailable(body.enabled !== false || body.attachments.length > 0);
      }
    })().catch((e) => { if (!controller.signal.aborted) { setAvailable(true); setError(e instanceof Error ? e.message : 'Could not load saved files.'); } });
    return () => controller.abort();
  }, [sessionId, userId, refresh, reload, headers]);

  const act = async (file: StoredProAttachment, remove: boolean) => {
    if (busy || (!remove && file.state !== 'ready')) return;
    setBusy(file.id); setError('');
    try {
      const body = await attachmentResponse(await fetch(`/api/agentv3/attachments/${encodeURIComponent(file.id)}${remove ? '' : '/ticket'}`, {
        method: remove ? 'DELETE' : 'POST', headers: await headers(),
      }));
      if (remove) { setConfirmDelete(null); setReload((n) => n + 1); }
      else {
        const href = resolveApiHref(safeAttachmentDownloadPath(body.path), window);
        if (isNativeApp()) window.open(href, '_blank', 'noopener');
        else window.location.href = href;
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'The file action failed.'); }
    finally { setBusy(''); }
  };
  const visibleFiles = visiblePrivateAttachments(files, sessionId, onlyThisChat);
  // Nothing saved and nothing wrong: the panel has nothing to offer, so it does not take a row of the chat (admin
  // screenshot 2026-11-21: "Private attached files · all my chats (0)" under every chat). It appears with the first
  // saved file, or when the list could not be read — an error is never hidden.
  if (!userId || available !== true || (files.length === 0 && !error)) return null;
  return <details className="mx-3 mt-2 rounded border border-line bg-card text-xs">
    <summary className="cursor-pointer px-3 py-2">Private attached files · all my chats ({files.length})</summary>
    <div className="px-3 pb-3 space-y-2">
      <p className="text-muted">Original files saved privately across all your chats, including files from a chat that is no longer open. Delete files here when no longer needed. Not read by the AI or included in your app. Downloading does not scan a file for malware; open only files you trust.</p>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <button type="button" onClick={() => setReload((n) => n + 1)} disabled={!!busy}>Refresh files</button>
      <div className="flex gap-2" role="group" aria-label="Private file scope">
        <button type="button" aria-pressed={!onlyThisChat} onClick={() => setOnlyThisChat(false)} className="px-2 py-2 border border-line rounded">All my private files</button>
        <button type="button" aria-pressed={onlyThisChat} onClick={() => setOnlyThisChat(true)} className="px-2 py-2 border border-line rounded">This chat only</button>
      </div>
      {onlyThisChat && visibleFiles.length === 0 && <p>No originals in this chat. Choose All my private files to find earlier uploads.</p>}
      {visibleFiles.map((file) => <div key={file.id} className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
        <span className="min-w-0 break-all flex-1">{file.name} · {(file.size / 1024).toFixed(1)} KB<span className="block text-muted">{attachmentStateLabel(file)} · {attachmentChatLabel(file, sessionId)}</span></span>
        <button type="button" disabled={!!busy || file.state !== 'ready'} onClick={() => void act(file, false)} className="px-2 py-2 border border-line rounded">Download</button>
        {confirmDelete === file.id ? <div role="group" aria-label={`Confirm deletion of ${file.name}`} className="w-full border border-line rounded p-2 space-y-2">
          <p>Delete this original file permanently? This cannot be undone. Any unfinished upload will be cancelled.</p>
          <button type="button" disabled={!!busy} onClick={() => void act(file, true)} className="px-2 py-2 border border-line rounded text-danger">Delete permanently</button>
          <button type="button" disabled={!!busy} onClick={() => setConfirmDelete(null)} className="px-2 py-2">Keep file</button>
        </div> : <button type="button" disabled={!!busy} onClick={() => setConfirmDelete(file.id)} className="px-2 py-2 border border-line rounded text-danger">{file.state === 'ready' ? 'Delete file' : 'Remove unfinished file'}</button>}
      </div>)}
    </div>
  </details>;
}
