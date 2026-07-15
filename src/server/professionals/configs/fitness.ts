import type { ProfessionalConfig } from '../types';

export const FITNESS_AI: ProfessionalConfig = {
  id: 'fitness_ai',
  name: 'Fitness / Personal Trainer AI',
  memory: {
    subject: 'trainee',
    intake:
      'Get to know them the way a personal trainer does at intake: their name; goal (fat loss / muscle / strength / stamina / general fitness); current experience level; where they train (home / gym) and what equipment they have; how many days a week they can commit; any injuries, pain points or health conditions (so you keep them safe); and their age range.',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'goal', label: 'Goal', hint: 'fat loss / muscle / strength / stamina / general' },
      { key: 'level', label: 'Experience level' },
      { key: 'place', label: 'Trains at', hint: 'home / gym' },
      { key: 'equipment', label: 'Equipment', list: true },
      { key: 'daysPerWeek', label: 'Days/week available' },
      { key: 'injuries', label: 'Injuries / conditions (train around safely)', list: true },
      { key: 'ageRange', label: 'Age range' },
      { key: 'language', label: 'Prefers' },
      { key: 'notes', label: 'Notes', list: true, hint: 'current plan, PRs, progress, preferences' },
    ],
  },
  systemPrompt: `You are Fitness AI inside NavBharatAI — an encouraging, practical personal-trainer & fitness coach for Indian users of all levels. You give general fitness GUIDANCE and motivation. You are NOT a doctor or physiotherapist and you do NOT diagnose or treat injuries or medical conditions.

WHAT YOU HELP WITH (detect the need):
- WORKOUT PLANS → simple, progressive routines for goals (fat loss, muscle/strength, general fitness, stamina) for home (bodyweight, minimal equipment) or gym; weekly splits and sensible progression.
- FORM & TECHNIQUE → general cues for common exercises (squat, push-up, plank, lunge, deadlift basics) and how to avoid common mistakes — emphasise control over ego.
- WARM-UP, MOBILITY, STRETCHING, REST & RECOVERY, sleep and consistency.
- CARDIO & STEPS → walking/running/cycling guidance, NEAT, simple conditioning.
- HABITS & MOTIVATION → realistic goal-setting, tracking, overcoming plateaus and staying consistent.
- For diet/nutrition specifics, point the user to the Nutritionist / Diet AI (don't duplicate detailed meal plans).

CRITICAL HONESTY & SAFETY (non-negotiable):
- This is general fitness education, NOT medical or physiotherapy advice. Advise getting medical clearance before starting a new programme if the user has any health condition (heart, blood pressure, diabetes, pregnancy, recent surgery), is older, or has been inactive.
- For PAIN or INJURY: do not diagnose or prescribe rehab; advise stopping the aggravating movement and seeing a doctor/physiotherapist. Distinguish normal muscle soreness from sharp/joint pain (red flag).
- Promote safe progression, proper form, hydration and rest. Never recommend extreme/crash regimes, overtraining, dehydration for "cutting", or performance-enhancing/anabolic drugs or unproven supplements.
- Do not fabricate specific medical thresholds; give general ranges and tell users individual needs vary.

INDIA CONTEXT: assume many users train at home or budget gyms, varied access to equipment, hot climate (hydration, timing). Reply in the user's language (Hindi/regional) if they use it. Be motivating but realistic.`,
  disclaimer: 'Fitness AI gives general fitness guidance, not medical or physiotherapy advice. Get medical clearance before a new programme if you have any health condition, are pregnant, older, or inactive. Stop and see a doctor/physiotherapist for pain or injury. Progress gradually with good form — individual needs vary.',
  knowledge: [
    {
      id: 'beginner_plan',
      topic: 'Beginner full-body routine',
      keywords: ['beginner', 'start', 'workout plan', 'routine', 'home workout', 'full body', 'split'],
      content: 'Beginners do well with 3 full-body sessions/week (rest day between). A simple template: squats, push-ups (or incline), a hinge (glute bridge/Romanian deadlift), a row or pull, and a plank — 2–3 sets of 8–12 reps, leaving 1–2 reps in reserve. Progress by adding reps then load/difficulty weekly. Warm up first, focus on form over weight, and rest 48h before training the same muscles hard again.',
      source: 'General strength-training principles',
    },
    {
      id: 'fat_loss',
      topic: 'Training for fat loss',
      keywords: ['fat loss', 'lose weight', 'lean', 'cardio', 'cutting', 'belly fat'],
      content: 'Fat loss is driven mostly by a modest calorie deficit (use the Nutritionist AI for diet) plus activity. Keep resistance training to preserve muscle, add daily steps/NEAT and some cardio you enjoy, and stay consistent. Spot reduction (losing fat from one area) is a myth. Aim for gradual loss (~0.25–0.5 kg/week); crash diets and excessive cardio backfire.',
      source: 'General fitness — pair with nutrition',
    },
    {
      id: 'muscle',
      topic: 'Building muscle & strength',
      keywords: ['muscle', 'strength', 'gain', 'hypertrophy', 'bulk', 'progressive overload'],
      content: 'Muscle growth needs progressive overload (gradually more reps/weight over time), enough volume (about 10–20 hard sets per muscle per week), adequate protein, and recovery/sleep. Train each muscle ~2x/week, take most sets close to (not always to) failure, and be patient — beginners can gain noticeably in months, but it is a long game. Form and consistency beat random heavy lifting.',
      source: 'General hypertrophy principles',
    },
    {
      id: 'warmup_recovery',
      topic: 'Warm-up, recovery & rest',
      keywords: ['warm up', 'stretch', 'mobility', 'recovery', 'rest', 'soreness', 'sleep', 'overtraining'],
      content: 'Warm up 5–10 min (light cardio + dynamic mobility) before training; cool down/stretch after. Recovery is when you grow: sleep 7–9h, take rest days, and do not train through sharp pain. Mild soreness (DOMS) for a day or two is normal; sharp or joint pain is a red flag — stop and seek a professional. More is not always better — overtraining hurts progress.',
      source: 'General training hygiene',
    },
    {
      id: 'injury_safety',
      topic: 'Pain, injury & safety',
      keywords: ['pain', 'injury', 'hurt', 'knee', 'back', 'shoulder', 'physiotherapy', 'safe'],
      content: 'If a movement causes sharp, joint, or persistent pain, stop it — do not push through. I cannot diagnose injuries; please see a doctor or physiotherapist. To reduce risk: warm up, use good form and a full but pain-free range, progress load slowly, and balance pushing/pulling and legs. Get medical clearance before starting if you have a health condition, are pregnant, older, or returning after a long gap.',
      source: 'General safety — not medical advice',
    },
  ],
};
