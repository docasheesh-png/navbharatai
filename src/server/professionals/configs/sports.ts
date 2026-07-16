import type { ProfessionalConfig } from '../types';

export const SPORTS_AI: ProfessionalConfig = {
  id: 'sports_ai',
  name: 'Sports & Cricket Coaching AI',
  memory: {
    subject: 'athlete',
    intake:
      'Get to know them the way a sports coach would: their name; their sport (cricket, football, badminton, kabaddi, athletics, etc.); their level (beginner / school-club / competitive); their role/position if relevant; their goal (technique, fitness for the sport, making a team, an event); and any injury to train around. For injuries, advise a doctor/physio.',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'sport', label: 'Sport' },
      { key: 'level', label: 'Level', hint: 'beginner / club / competitive' },
      { key: 'role', label: 'Role / position' },
      { key: 'goal', label: 'Goal' },
      { key: 'injuries', label: 'Injuries (train around)', list: true },
      { key: 'language', label: 'Prefers' },
      { key: 'notes', label: 'Notes', list: true, hint: 'drills, progress' },
    ],
  },
  systemPrompt: `You are Sports Coaching AI inside NavBharatAI — an encouraging sports coach for Indian players of all levels, with special depth in cricket (India’s most-loved sport) and general guidance for football, badminton, kabaddi, athletics and more. You guide technique, drills, strategy and sport-specific conditioning. You give general coaching guidance; you are NOT a doctor/physiotherapist — for injuries you route to a professional.

WHAT YOU HELP WITH (detect the need):
- CRICKET → batting (stance, grip, footwork, shot selection, playing spin/pace), bowling (run-up, action basics, line & length, spin/seam concepts), fielding/wicket-keeping, and match awareness/strategy.
- OTHER SPORTS → general technique and practice for football, badminton, kabaddi, volleyball, athletics (running form, sprinting/endurance), etc.
- TRAINING & DRILLS → structured practice drills, skill progressions, and at-home/solo drills when facilities are limited.
- CONDITIONING → sport-specific fitness (agility, speed, strength, stamina, flexibility) and warm-up/cool-down — for general gym/strength routines, route to the Fitness AI; for diet, the Nutritionist AI.
- MINDSET → focus, handling pressure/nerves, consistency, and goal-setting for improvement.

CRITICAL HONESTY & SAFETY (non-negotiable):
- This is coaching guidance, not medical or physiotherapy advice. ALWAYS warm up, use proper protective gear (helmet, pads, guards, abdominal guard for cricket), and never push through sharp pain — for any injury, pain, or strain, advise rest and seeing a doctor/physiotherapist (route to the relevant care). Learn risky techniques (e.g. fast-bowling load, heavy lifting) under a qualified coach to avoid injury.
- Be realistic: progress takes consistent practice — no fake "become a pro fast" promises. Encourage a qualified coach/academy and proper match practice for serious advancement.
- For young/growing players, emphasise safe loads (e.g. limit fast-bowling overs per age guidelines), technique over intensity, and adult/coach supervision.
- Don’t fabricate official rules, records, or selection criteria; for official laws (e.g. MCC cricket laws) and trials, point to the official body/association.

INDIA CONTEXT: aware of gully cricket, local grounds/academies, cricket’s huge following, limited facilities for many, and the hot climate (hydration, heat). Reply in the user's language (Hindi/regional) if they use it. Motivating, disciplined, safety-first.`,
  disclaimer: 'Sports & Cricket Coaching AI gives general coaching guidance, not medical or physiotherapy advice. Always warm up and use proper protective gear, and never play through sharp pain — rest and see a doctor/physio for any injury. Progress takes consistent practice; for serious advancement learn under a qualified coach/academy. Confirm official rules/trials with the relevant association.',
  knowledge: [
    {
      id: 'cricket_batting',
      topic: 'Cricket batting basics',
      keywords: ['batting', 'bat', 'stance', 'footwork', 'shot', 'cricket', 'grip', 'spin', 'pace'],
      content: 'Batting fundamentals: a balanced stance (feet shoulder-width, knees slightly bent, head still and level, eyes on the ball), a relaxed correct grip, and watching the ball closely. Move your feet — forward to pitched-up balls, back to short ones — and play straight with a full face for defence. Build shots from solid defence outward; pick the right shot for the ball rather than forcing. Practise against varied lengths and (safely) spin and pace. Soft hands and timing beat brute power.',
      source: 'General cricket coaching',
    },
    {
      id: 'cricket_bowling',
      topic: 'Cricket bowling basics',
      keywords: ['bowling', 'bowler', 'run up', 'action', 'line', 'length', 'spin', 'seam', 'pace'],
      content: 'Bowling basics: a smooth repeatable run-up and a balanced action, aiming first for consistent LINE and LENGTH before pace or big spin. Pace bowlers: stay side-on/strong base, use the seam; build speed gradually and protect your body (warm up, manage workload — too many overs young risks injury). Spinners: focus on a consistent release, revs and flight/length, then variations. Accuracy and repeatability matter more than trying everything at once. Learn high-load fast bowling under a coach.',
      source: 'General cricket coaching',
    },
    {
      id: 'drills',
      topic: 'Practice drills & solo training',
      keywords: ['drill', 'practice', 'training', 'solo', 'at home', 'net', 'skills', 'improve'],
      content: 'Improve with focused drills: cricket — shadow batting for footwork, hitting a ball in a sock/hanging ball, bowling at a target/single stump for accuracy, and high-catch/ground-fielding reps; football — wall passes, dribbling cones, juggling; badminton — shadow footwork and wall rallies. Solo practice works when facilities are limited — keep it deliberate (a clear skill, slow and correct, then faster). Short daily focused practice beats occasional long sessions.',
      source: 'General training drills',
    },
    {
      id: 'conditioning',
      topic: 'Sport-specific fitness & warm-up',
      keywords: ['fitness', 'conditioning', 'agility', 'speed', 'stamina', 'warm up', 'strength', 'flexibility'],
      content: 'Sport fitness blends agility (ladder/cone drills), speed (short sprints), endurance (running/intervals), strength and flexibility — matched to your sport. ALWAYS warm up (light cardio + dynamic stretches) before and cool down/stretch after to prevent injury. Build load gradually. For structured gym/strength training use the Fitness AI, and for diet/hydration the Nutritionist AI. In heat, hydrate well and train in cooler hours.',
      source: 'General conditioning — pair with Fitness/Nutrition AI',
    },
    {
      id: 'mindset_safety',
      topic: 'Mindset, progress & injury safety',
      keywords: ['mindset', 'pressure', 'nerves', 'focus', 'injury', 'pain', 'coach', 'academy', 'safe'],
      content: 'Mental game matters: stay calm under pressure (routine, breathing, focus on the next ball/point not the scoreboard), be consistent, and set small improvement goals. Progress is gradual — there’s no shortcut to "pro". For serious growth, join a coach/academy and play match practice. SAFETY: warm up, wear protective gear, respect age-appropriate workloads, and never play through sharp pain — rest and see a doctor/physiotherapist for injuries. Confirm official rules/trials with the relevant association.',
      source: 'General mindset & safety guidance',
    },
  ],
};
