// The NavBharatAI page's half of the preview assistant (see src/lib/previewAiProtocol.ts). The app in the
// preview posts a question; this asks our server WITH THE OWNER'S OWN LOGIN and returns the answer. The page
// in the preview never sees a token, a key, or anything else it could reuse.
import { authJsonHeaders } from '../../lib/authHeaders';
import { PREVIEW_AI_ANSWER, PREVIEW_AI_IMAGE_ANSWER, type PreviewAiAnswer, type PreviewAiImageAnswer } from '../../lib/previewAiProtocol';

export async function answerPreviewAiAsk(
  ask: { id: string; prompt: string; system: string },
  workspaceId: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<PreviewAiAnswer> {
  const fail = (message: string): PreviewAiAnswer => ({ [PREVIEW_AI_ANSWER]: true, id: ask.id, ok: false, message });
  if (!workspaceId) return fail('Open this app in NavBharatAI to try its assistant.');
  try {
    const res = await fetchImpl('/api/app-ai/preview-ask', {
      method: 'POST',
      headers: await authJsonHeaders(),
      body: JSON.stringify({ workspaceId, prompt: ask.prompt, ...(ask.system ? { system: ask.system } : {}) }),
    });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; text?: unknown; message?: unknown } | null;
    if (j?.ok === true && typeof j.text === 'string') return { [PREVIEW_AI_ANSWER]: true, id: ask.id, ok: true, text: j.text };
    return fail(typeof j?.message === 'string' && j.message ? j.message : 'The assistant is not available right now.');
  } catch {
    return fail('The assistant could not be reached. Please try again.');
  }
}

/**
 * The same relay for a PICTURE (admin 2026-10-04): the app in the preview asks, this asks our server with the
 * owner's login, and the page receives a data URL — or the owner's own message saying which image key the
 * app needs and where to put it.
 */
export async function answerPreviewAiImage(
  ask: { id: string; prompt: string; width: number; height: number },
  workspaceId: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<PreviewAiImageAnswer> {
  const fail = (message: string, code = ''): PreviewAiImageAnswer => ({ [PREVIEW_AI_IMAGE_ANSWER]: true, id: ask.id, ok: false, message, ...(code ? { code } : {}) });
  if (!workspaceId) return fail('Open this app in NavBharatAI to make pictures in the preview.');
  try {
    const res = await fetchImpl('/api/app-ai/preview-image', {
      method: 'POST',
      headers: await authJsonHeaders(),
      body: JSON.stringify({ workspaceId, prompt: ask.prompt, width: ask.width, height: ask.height }),
    });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; image?: unknown; message?: unknown; code?: unknown } | null;
    if (j?.ok === true && typeof j.image === 'string' && j.image.startsWith('data:image/')) {
      return { [PREVIEW_AI_IMAGE_ANSWER]: true, id: ask.id, ok: true, image: j.image };
    }
    return fail(typeof j?.message === 'string' && j.message ? j.message : 'The picture maker is not available right now.', typeof j?.code === 'string' ? j.code : '');
  } catch {
    return fail('The picture maker could not be reached. Please try again.');
  }
}
