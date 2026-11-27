// Download the user's OWN saved upload key (Q-3703, 2026-11-27) — the one place a saved key leaves NavBharatAI.
//
// Account deletion erases every saved signing key (the admin's decision (a)), and without its key an app already on
// Google Play can never be updated under the same listing. So before the user confirms, the Danger zone offers each
// key's download; the Native Cloud Build panel offers the same before "Delete saved key". Both call this one helper:
// the server answer is shape-checked, the file goes through the one cross-platform delivery helper, and the outcome is
// reported as it really was — a share sheet that was closed is "not saved", never a download.

import { authedHeaders } from './authHeaders';
import { readAnswer } from './serverAnswer';
import { deliverFile, deliveryMessage, type FileDeliveryResult } from './downloadFile';
import { isExportedKeyAnswer, keystoreFileName, type ExportedKey } from './mobileBuildClient';

export type SigningKeyDownload =
  | { ok: true; saved: boolean; message: string; key: ExportedKey; sentence?: undefined }
  | { ok: false; sentence: string; saved?: undefined; message?: undefined; key?: undefined };

/** Whether a delivery outcome means the file is really on the device (or handed to the share sheet). PURE. */
export function keyDelivered(result: FileDeliveryResult): boolean {
  return result === 'shared' || result === 'downloaded' || result === 'saved';
}

export async function downloadSigningKey(appId: string): Promise<SigningKeyDownload> {
  try {
    const res = await fetch('/api/mobile-builds/signing-key/export', {
      method: 'POST',
      headers: await authedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ appId }),
    });
    const a = await readAnswer(res, isExportedKeyAnswer);
    if (!a.ok) return { ok: false, sentence: a.sentence };
    const name = keystoreFileName(appId);
    const bytes = Uint8Array.from(atob(a.value.keystore.base64), (c) => c.charCodeAt(0));
    const result = await deliverFile(name, new Blob([bytes], { type: 'application/x-pkcs12' }), 'application/x-pkcs12');
    return { ok: true, saved: keyDelivered(result), message: deliveryMessage(result, name), key: a.value.keystore };
  } catch {
    return { ok: false, sentence: 'Your signing key could not be downloaded. It is still saved — please try again.' };
  }
}
