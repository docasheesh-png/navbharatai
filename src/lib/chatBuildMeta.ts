// A CHAT REPLY THAT BUILT SOMETHING IS MARKED BY THE PLATFORM, NOT BY THE MODEL (admin 2026-10-11, Q-781).
//
// The chat's "View Live Preview" and deploy buttons branched on markers (`__VIEW_PREVIEW__`,
// `__DEPLOY_ACTIONS__`) that the prompt never asked the model to print, so they could not appear: a build
// that worked offered no way to open its preview. THE CLASS: a button waiting for text a model was never
// told to write. The platform knows when a reply's code really landed in the workspace — it did the sync —
// so it records that fact on the reply, and the buttons read the record.

/** The reply's meta after its code landed: marked built, carrying the files the deploy row hands on. */
export function chatBuildMeta(meta: Record<string, unknown> | undefined, files: Record<string, string>): Record<string, unknown> {
  return { ...(meta ?? {}), built: true, deployFiles: files };
}

/** What a reply bubble needs to know to offer View preview and the deploy row. */
export function chatBuildView(meta: Record<string, unknown> | undefined): { built: boolean; deployFiles: Record<string, string> | null } {
  const built = meta?.built === true;
  const files = meta?.deployFiles;
  const deployFiles = built && files && typeof files === 'object' && Object.keys(files as object).length > 0
    ? files as Record<string, string>
    : null;
  return { built, deployFiles };
}
