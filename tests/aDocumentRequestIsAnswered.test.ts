// failedbr #1420, #1430 (2026-11-20): "Create a comprehensive game design document (GDD)…" was built as an app, and
// "Design a complete progression loop… Outline the journey… Detail XP/skill trees…" ran as a build whose model wrote the
// document and was then told to "act now". A document is answered in chat; the reply offers the build.
import { describe, expect, it } from 'vitest';
import { buildConfirmation, requestsADocument } from '../src/server/AgentV3/buildConfirmation';

const GDD_1420 = 'Create a comprehensive game design document (GDD) for a mobile 3D cricket game optimized for budget Android devices (4 GB RAM). Include responsive virtual joystick controls for batting.';
const LOOP_1430 = 'Design a complete progression loop for a Player Career Mode in a cricket game. Outline the journey from domestic club cricket to national team captaincy. Detail XP/skill trees (Power Hitting, Timing, Running, Bowling Speed, Spin Variations).';

describe('a document request is answered, not built (failedbr #1420, #1430)', () => {
  it.each([GDD_1420, LOOP_1430, 'Write a business plan for a tiffin service', 'Prepare a PRD for a ride-sharing app', 'Draft a detailed report on our sales'])(
    'not a build: %s', (m) => {
      expect(requestsADocument(m)).toBe(true);
      expect(buildConfirmation(m)).toEqual({ confirmed: false, reason: 'asks-for-a-document' });
    });

  it.each([
    'Design a login page with email and OTP',
    'Build a document management app for my office',
    'Create a report generator tool for my shop',
    'Make a cricket game with a career mode',
    'Create an essay writing app for students',
    'Build a todo app. Describe the tasks in a list.',
  ])('still a build: %s', (m) => {
    expect(requestsADocument(m)).toBe(false);
    expect(buildConfirmation(m).confirmed).toBe(true);
  });
});
