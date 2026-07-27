// Where a generated CI file has to live, and whether NavBharatAI can genuinely put it there.
//
// WHY THIS EXISTS (admin 2026-07-27):
//
//  • THE PATH WAS WRITTEN OUT TWICE inside CICDPipeline.tsx — once for the download filename and once
//    for the preview header. Two copies of the same string is exactly how the file the user is shown
//    stops matching the file they receive. One source of truth now.
//
//  • "COMMIT THIS FOR ME" IS ONLY HONEST FOR SOME OF THESE. A GitHub Actions workflow and a Cloud
//    Build config both do real work sitting in a GitHub repository — Cloud Build triggers read from
//    GitHub, which is how NavBharatAI itself deploys. A `.gitlab-ci.yml` in a GitHub repository does
//    nothing at all, and NavBharatAI has no GitLab connection to commit it with. Rather than offer a
//    button that quietly produces a dead file, `commitTarget` says which case a user is in.
//
//  • A NAVBHARATAI WORKSPACE IS NOT A REPOSITORY. Writing a workflow into a Pro v5 app would look
//    like it worked and would never run — nothing watches those files for pushes. So the commit
//    target here is a real Git host, never the workspace.

export type CiPlatform = 'github' | 'cloudbuild' | 'gitlab';

/** The one place each platform's file name is decided. */
export function workflowPath(platform: CiPlatform): string {
  switch (platform) {
    case 'github': return '.github/workflows/cicd.yml';
    case 'cloudbuild': return 'cloudbuild.yaml';
    case 'gitlab': return '.gitlab-ci.yml';
  }
}

export type CommitTarget =
  | { canCommit: true; note: string }
  | { canCommit: false; reason: string };

/** Whether committing this platform's file to the user's GitHub repository is genuinely useful. */
export function commitTarget(platform: CiPlatform): CommitTarget {
  switch (platform) {
    case 'github':
      return { canCommit: true, note: 'GitHub runs this the moment it lands on your default branch.' };
    case 'cloudbuild':
      return {
        canCommit: true,
        note: 'Google Cloud Build reads this from your GitHub repository once you create a trigger for it.',
      };
    case 'gitlab':
      return {
        canCommit: false,
        reason: 'This file belongs in a GitLab project, and NavBharatAI connects to GitHub only. Download it and add it to your GitLab project yourself.',
      };
  }
}

/** The commit message the push carries, so a repository's history says where the file came from. */
export function commitMessage(platform: CiPlatform, appName: string): string {
  const what = platform === 'cloudbuild' ? 'Cloud Build config' : 'CI/CD workflow';
  const name = (appName || '').trim();
  return `Add ${what}${name ? ` for ${name}` : ''} (NavBharatAI)`;
}
