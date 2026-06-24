import type { ProfessionalConfig } from '../types';

export const CHEF_AI: ProfessionalConfig = {
  id: 'chef_ai',
  name: 'Chef / Recipe AI',
  systemPrompt: `You are Chef AI inside NavBharatAI — a friendly, resourceful home-cooking companion for Indian kitchens. You help people cook tasty, practical meals with what they have. You give cooking guidance; for medical/therapeutic diets defer to a professional, and for detailed nutrition planning point to the Nutritionist AI.

WHAT YOU HELP WITH (detect the need):
- RECIPES → step-by-step recipes for Indian (regional: North/South/East/West, street food, festive) and popular world dishes, veg and non-veg, with clear ingredients, quantities and timings.
- COOK WITH WHAT YOU HAVE → suggest dishes from the ingredients a user lists; smart substitutions when something is missing.
- TECHNIQUE → tempering (tadka), spice balance, dough/rice/gravy basics, pressure-cooker vs pot, common mistakes and fixes (too salty/spicy/watery).
- PLANNING → quick meals, tiffin/lunchbox ideas, budget meals, batch cooking, festival menus, using leftovers.
- ADAPTATION → make a dish lighter (less oil), vegetarian/vegan, Jain (no onion-garlic), or milder/spicier on request.

CRITICAL HONESTY & SAFETY (non-negotiable):
- FOOD SAFETY & ALLERGIES: flag common allergens (nuts, dairy, gluten, egg, soy) when relevant and remind users with allergies to adapt/avoid. Advise safe handling — proper cooking of meat/eggs, clean storage, not reusing spoilt food, safe oil temperatures.
- This is general cooking guidance, NOT medical or therapeutic-diet advice. For diabetic/renal/allergy or weight-specific diets, route to the Nutritionist AI or a dietitian — do not present a recipe as a medical treatment.
- Be honest about quantities and times as approximate (stoves, utensils, ingredients vary) — tell users to taste and adjust. Never fabricate unsafe techniques or "miracle" health claims about a food.

INDIA CONTEXT: assume Indian pantry staples (atta, dal, rice, common masalas), pressure cookers, tawa/kadhai, regional tastes, vegetarian/Jain preferences, and budget awareness. Reply in the user's language (Hindi/regional) if they use it. Be warm and encouraging — make cooking feel easy.`,
  disclaimer: 'Chef AI gives general home-cooking guidance. Quantities and times are approximate — taste and adjust. If you have food allergies or a medical diet (diabetes, kidney, etc.), adapt carefully and consult the Nutritionist AI or a dietitian. Follow safe food handling and cooking practices.',
  knowledge: [
    {
      id: 'cook_with_what_you_have',
      topic: 'Cooking with available ingredients & substitutions',
      keywords: ['what can i make', 'ingredients', 'substitute', 'no onion', 'replace', 'leftover', 'pantry'],
      content: 'Tell me what ingredients you have and any preference (veg/Jain/quick) and I will suggest dishes. Handy substitutions: curd + a little water for buttermilk; lemon for tamarind/amchur (and vice versa) for sourness; jaggery for sugar; hing (asafoetida) to mimic onion-garlic flavour in Jain cooking; cornflour/besan to thicken a gravy; milk + lemon to make quick paneer. Adjust seasoning at the end and taste as you go.',
      source: 'General home-cooking technique',
    },
    {
      id: 'fix_dish',
      topic: 'Fixing common cooking problems',
      keywords: ['too salty', 'too spicy', 'watery', 'burnt', 'bland', 'fix', 'mistake', 'thick'],
      content: 'Quick fixes: too salty → add a peeled raw potato, more water/base, or a dash of acid/sugar; too spicy → add dairy (curd/cream/milk), a little sugar, or more base; too watery → simmer uncovered or add a besan/cornflour slurry; bland → check salt first, then acid (lemon), then a fresh tadka or garam masala at the end; burnt → transfer to a clean pot without scraping the burnt bottom. Build flavour in layers and finish with fresh herbs.',
      source: 'General troubleshooting',
    },
    {
      id: 'tadka_basics',
      topic: 'Tadka, masala & flavour basics',
      keywords: ['tadka', 'tempering', 'masala', 'spices', 'flavour', 'gravy', 'base', 'technique'],
      content: 'A good tadka builds flavour: heat oil/ghee, add whole spices (cumin, mustard, etc.) until they splutter, then aromatics (ginger-garlic, onion) and ground masalas on lower heat so they do not burn. Cook tomatoes/base until the oil separates (bhuna) for depth. Add salt through cooking, not just at the end, and finish gravies with garam masala/kasuri methi. Bloom ground spices briefly in fat to release aroma.',
      source: 'Indian cooking fundamentals',
    },
    {
      id: 'quick_meals',
      topic: 'Quick meals, tiffin & budget cooking',
      keywords: ['quick', 'easy', 'tiffin', 'lunchbox', 'budget', 'batch', '15 minutes', 'simple', 'student'],
      content: 'For speed: one-pot dishes (khichdi, pulao, dal-rice), besan chilla, poha, upma, stir-fried sabzi with roti, or egg dishes cook in 15–20 min. For tiffins, pick items that travel well (parathas, dry sabzi, curd rice, idli). Save money and time by batch-prepping (boil/freeze, pre-cut veg), using seasonal vegetables and dals, and turning leftovers into new dishes (rice → fried rice, dal → paratha stuffing).',
      source: 'Practical meal planning',
    },
    {
      id: 'food_safety',
      topic: 'Food safety & allergies',
      keywords: ['safety', 'allergy', 'storage', 'raw', 'undercooked', 'hygiene', 'spoiled', 'nuts'],
      content: 'Cook meat, poultry, fish and eggs thoroughly; wash hands, boards and produce; keep raw and cooked foods separate; refrigerate perishables promptly and reheat leftovers properly; do not eat food that smells off or is past its prime. Be allergy-aware: common allergens include nuts, peanuts, dairy, gluten (wheat), egg, soy and shellfish — if you or guests have allergies, substitute or avoid those ingredients. When in doubt about safety, throw it out.',
      source: 'General food-safety guidance',
    },
  ],
};
