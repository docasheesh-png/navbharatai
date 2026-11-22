// The server-side net for failedbr #2498: our own status notice must never be run as a build request.
// See src/lib/platformAdmissionNotices.ts for the defect and the class. Called by the build route before any
// lock, lease, sandbox or model call, so a refusal here costs nothing and is a clean HTTP answer.

import { platformNoticeAsBuildRequest } from '../../lib/platformFixRequest';
import { PLATFORM_NOTICE_NOT_A_REQUEST_CODE, PLATFORM_NOTICE_NOT_A_REQUEST_MESSAGE } from '../../lib/platformAdmissionNotices';

interface RefusalResponse { headersSent?: boolean; status(code: number): { json(body: unknown): unknown } }

/** Refuse (400) a prompt that is only a platform notice. Returns true when it answered the request. */
export function refusePlatformNoticeAsBuildRequest(res: RefusalResponse, prompt: string | null | undefined): boolean {
  if (!platformNoticeAsBuildRequest(prompt)) return false;
  if (!res.headersSent) {
    res.status(400).json({ error: PLATFORM_NOTICE_NOT_A_REQUEST_MESSAGE, code: PLATFORM_NOTICE_NOT_A_REQUEST_CODE });
  }
  return true;
}
