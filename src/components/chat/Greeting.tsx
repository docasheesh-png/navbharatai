// The headline an empty chat opens with (admin 2026-10-13, "font, headline etc bilkul claude jaisa"):
// a serif "Good evening, Asheesh" with a small accent mark, and one quiet line under it. Rendered by
// every AI surface's empty state, so the first thing a user sees is the same on all of them.
//
// The words come from the pure `greetingText.ts`; this file is only the picture.
import { Sparkles } from 'lucide-react';
import { greetingFor } from './greetingText';
import { GREETING_CLASS, GREETING_SUBLINE_CLASS } from './conversation';

export interface GreetingProps {
  /** What the account calls itself (`user.displayName`); the first word is used. Absent ⇒ no name. */
  name?: string | null;
  /** The line under the headline — "Ask me anything." / "Describe an app to build." */
  subline?: React.ReactNode;
  /** A headline of the surface's own, in place of the time-of-day greeting. */
  headline?: string;
  className?: string;
  /** The hour to greet for — injected only by tests; the real one is the device clock. */
  hour?: number;
}

export function Greeting({ name, subline, headline, className, hour }: GreetingProps) {
  const text = headline ?? greetingFor(hour ?? new Date().getHours(), name);
  return (
    <div className={`flex flex-col items-center text-center gap-2 px-4 ${className ?? ''}`} data-chat-greeting="">
      {/* The mark is INLINE with the first word, so on a phone a wrapped headline keeps it beside
          "Good" rather than floating at the edge of the whole block. */}
      <h1 className={GREETING_CLASS}>
        <Sparkles className="inline-block w-[0.8em] h-[0.8em] align-[-0.1em] mr-2 text-accent-text" aria-hidden />
        {text}
      </h1>
      {subline && <p className={GREETING_SUBLINE_CLASS}>{subline}</p>}
    </div>
  );
}
