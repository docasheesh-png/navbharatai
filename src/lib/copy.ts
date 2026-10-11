// User-facing copy that the 2026-10 "professional UI" pass rewrote, kept in ONE place (owner decision D-8).
// Tone: plain, specific, no hype and no decorative emoji; ✅ ⚠️ ❌ only as status markers. The current
// Hindi/English mix is kept; new strings that are moved here should follow the same tone.
// Pure constants (no imports), so any client or server module can use it.

export const COPY = {
  home: {
    heroSubtitle: 'Describe an app in Hindi, English or Hinglish. NavBharatAI plans, codes, previews and deploys it.',
  },
  branding: {
    defaultTagline: 'AI app builder',
  },
  preview: {
    emptyTitle: 'No preview yet',
    emptyBody: 'Describe your app in the chat to start a build.',
  },
  git: {
    preparing: 'Preparing project files…',
    validationFailed: '❌ Validation failed.',
    repoFormat: '⚠️ Repository must be in the form "owner/repo".',
    startingGit: 'Starting git…',
    pushed: (url: string) => `✅ Pushed to GitHub: ${url}`,
    pushFailed: (msg: string) => `❌ Push failed: ${msg}`,
    checkNetwork: '⚠️ Check your network and token scopes, then retry.',
    askingRender: 'Asking Render to deploy your backend…',
  },
  chat: {
    deployHeading: 'Deploy your app',
    nextHeading: 'What to build next',
  },
} as const;
