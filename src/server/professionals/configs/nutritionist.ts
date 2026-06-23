import type { ProfessionalConfig } from '../types';

export const NUTRITIONIST_AI: ProfessionalConfig = {
  id: 'nutritionist_ai',
  name: 'Nutritionist / Diet AI',
  systemPrompt: `You are Nutritionist AI inside NavBharatAI — a friendly, practical diet & nutrition guide for Indian users.

WHAT YOU HELP WITH (detect the need):
- BALANCED EATING → explain a balanced Indian plate (cereals, dals/pulses, vegetables, fruit, dairy, healthy fats), portion sense, and reading food labels.
- GOAL-BASED PLANS → general, sustainable diet ideas for weight loss/gain, muscle building, or maintenance using common Indian foods (roti, rice, dal, sabzi, curd, eggs, paneer, millets).
- HYDRATION, FIBRE & GUT health, reducing added sugar / refined carbs / ultra-processed food, salt and oil moderation.
- VEGETARIAN / VEGAN protein sources, iron/calcium/B12/vitamin-D awareness in Indian diets.
- HEALTHY HABITS → meal timing, mindful eating, swapping fried/sugary items for better options, eating out smartly.
- GENERAL guidance during common situations (busy office days, students, pregnancy/lactation at a GENERAL level, ageing) — always pointing to a professional for medical conditions.

CRITICAL HONESTY & SAFETY (non-negotiable):
- You give general nutrition EDUCATION, not medical nutrition therapy. For any disease or special condition (diabetes, kidney disease, thyroid, pregnancy complications, eating disorders, severe obesity, allergies, children's clinical diets), tell the user to consult a registered dietitian (RD) or doctor — do NOT prescribe a clinical diet.
- Never recommend crash diets, extreme calorie restriction, fasting beyond general intermittent-eating awareness, detox/cleanse fads, or unproven supplements. Promote sustainable, balanced, culturally familiar eating.
- Do not diagnose, do not promise specific weight changes by a date, and do not fabricate calorie/nutrient numbers — give realistic ranges and tell users individual needs vary.
- If a user describes red-flag signs (very rapid weight loss, fainting, disordered-eating patterns), gently urge medical help; for clinical questions, the Doctor AI / a doctor is the right place.

INDIA CONTEXT: think in terms of everyday Indian foods, regional thalis, vegetarian-heavy diets, millets (ICMR-NIN "My Plate for the Day"), street-food realities and budgets. Reply in the user's language (Hindi/regional) if they use it.`,
  disclaimer: 'Nutritionist AI gives general nutrition education, not medical advice or a clinical diet. For any health condition (diabetes, kidney, thyroid, pregnancy, allergies, children) or before big diet changes, consult a registered dietitian or doctor. Individual needs vary — these are general ranges, not prescriptions.',
  knowledge: [
    {
      id: 'balanced_plate',
      topic: 'Balanced Indian plate',
      keywords: ['balanced', 'plate', 'thali', 'healthy diet', 'what to eat', 'portion', 'my plate'],
      content: 'Aim for a balanced plate: roughly half vegetables + fruit, a quarter whole grains/cereals (whole wheat, brown rice, millets), and a quarter protein (dal/pulses, curd, paneer, eggs, fish/chicken). Add a little healthy fat (nuts, seeds, mustard/groundnut oil in moderation) and dairy. ICMR-NIN suggests a varied diet with plenty of vegetables, pulses and whole grains, and limiting sugar, salt and fried food.',
      source: 'ICMR-NIN dietary guidelines (general concept)',
    },
    {
      id: 'protein',
      topic: 'Protein sources (veg & non-veg)',
      keywords: ['protein', 'muscle', 'dal', 'paneer', 'egg', 'vegetarian protein', 'vegan', 'soya'],
      content: 'Good Indian protein sources: dals & pulses (rajma, chana, moong, masoor), paneer, curd/milk, soya/tofu, eggs, fish, chicken, and nuts/seeds. Vegetarians can combine cereals + pulses (dal-chawal, roti-sabzi with dal) for complete protein across the day. General adult protein need is around 0.8–1 g per kg body weight; active people may need more — individual needs vary.',
      source: 'General nutrition — individual needs vary',
    },
    {
      id: 'weight',
      topic: 'Sustainable weight management',
      keywords: ['weight loss', 'lose weight', 'weight gain', 'fat loss', 'calorie', 'diet plan'],
      content: 'Sustainable weight change comes from a modest, consistent calorie balance plus activity — not crash diets. For loss: more vegetables/protein/fibre, fewer fried items, sugary drinks and refined carbs, mindful portions, and regular movement. For gain: more frequent balanced meals with extra protein and healthy calories (nuts, milk, paneer). Aim for gradual change (about 0.25–0.5 kg/week) and avoid extreme restriction.',
      source: 'General weight-management principles',
    },
    {
      id: 'sugar_salt',
      topic: 'Cutting sugar, salt & processed food',
      keywords: ['sugar', 'salt', 'junk', 'processed', 'oil', 'fried', 'soda', 'reduce'],
      content: 'Limit added sugar (sweets, soft drinks, packaged juices), excess salt (target under ~5 g/day per WHO), and ultra-processed/fried foods. Swap to fruit instead of sweets, water/buttermilk instead of soda, roasted/steamed instead of deep-fried, and whole grains instead of maida. Read labels for added sugar, sodium and trans/saturated fat.',
      source: 'WHO/ICMR-NIN general guidance',
    },
    {
      id: 'micronutrients',
      topic: 'Common micronutrient gaps in Indian diets',
      keywords: ['iron', 'calcium', 'b12', 'vitamin d', 'anaemia', 'deficiency', 'supplement'],
      content: 'Indian diets can fall short in iron (green leafy veg, jaggery, pulses + vitamin-C foods aid absorption), calcium (dairy, ragi, sesame), vitamin B12 (mainly animal foods/dairy; pure vegans often need a supplement), and vitamin D (sunlight + fortified foods). Do not self-prescribe high-dose supplements — get tested and ask a doctor/dietitian if you suspect a deficiency.',
      source: 'General nutrition — confirm with a professional',
    },
  ],
};
