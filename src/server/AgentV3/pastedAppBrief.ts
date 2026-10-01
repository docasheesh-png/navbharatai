// THE USER PASTED THEIR OWN APP — IT IS THE SPECIFICATION (autopsy a106df77, 2026-10-01).
//
// 🔴 WHAT HAPPENED. A user pasted a whole HTML file — their own "A1 Decor India" bill maker, version 40 —
// and nothing else. The builder read it as loose inspiration and wrote a different app: it kept the name
// and the idea and dropped the "Items" tab the user already had, and its own palette replaced the user's
// blue and gold. A rebuild that loses a screen the user already uses is a step backwards, however tidy.
//
// 🔑 THE FIX: before the builder starts, the page's own facts — its name, every tab and button, every
// field, its colours — are read out of the paste (pastedSource.ts) and handed to it as a checklist with
// one rule: improve, never remove. Read deterministically, so it costs no model call.
//
// Only a whole HTML DOCUMENT counts. A pasted React component or a code snippet is a piece of a larger
// request ("add this to my app"), not the app itself, and gets no brief.
// Kill switch: AGENTV3_PASTED_APP_BRIEF=off. PURE — the env read is the only side input.
import { isPastedHtmlDocument, pastedAppFacts, readablePrompt } from '../lib/pastedSource';

export function pastedAppBriefEnabled(): boolean {
  return (process.env.AGENTV3_PASTED_APP_BRIEF ?? '').trim().toLowerCase() !== 'off';
}

/** The brief for a prompt that is the user's own pasted HTML app, or '' for any other prompt. PURE. */
export function pastedAppBrief(prompt: string | null | undefined): string {
  if (!isPastedHtmlDocument(prompt)) return '';
  const f = pastedAppFacts(prompt);
  const name = f.title ?? f.heading;
  const words = readablePrompt(prompt);
  const lines: string[] = [
    `THE USER PASTED THEIR OWN APP${name ? ` — "${name}"` : ''}. That file is the specification: build it as a working app that keeps everything it already has, and repair what is broken in it.`,
  ];
  if (words) lines.push(`- What they wrote with it, which comes first: "${words.slice(0, 600)}"`);
  if (name) lines.push(`- Keep its name: "${name}".`);
  if (f.controls.length) lines.push(`- Keep every tab and button it has: ${f.controls.join(', ')}.`);
  if (f.fields.length) lines.push(`- Keep every field it has: ${f.fields.join(', ')}.`);
  if (f.colours.length) lines.push(`- Keep its colours as the app's palette: ${f.colours.map((c) => `${c.name} ${c.value}`).join(', ')}.`);
  lines.push(
    '- Read its <script> too: what each button does there (save, delete, print, share, the stored keys) is behaviour the user already has. Keep it working.',
    '- If the file is broken (an unclosed tag, code after </html>), repair it quietly.',
    'Improve it, never remove from it: a screen, a control or a field it already has must still be there.',
  );
  return lines.join('\n');
}
