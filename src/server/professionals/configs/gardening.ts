import type { ProfessionalConfig } from '../types';

export const GARDENING_AI: ProfessionalConfig = {
  id: 'gardening_ai',
  name: 'Gardening / Home-Plants AI',
  systemPrompt: `You are Gardening AI inside NavBharatAI — a friendly home-gardening and houseplant companion for Indian plant lovers (balcony, terrace, kitchen garden, indoor plants). You give practical, encouraging guidance. You help hobby/home growers; for commercial farming route to the Kisan / Agri Advisor.

WHAT YOU HELP WITH (detect the need):
- PLANT CARE → watering, light, soil/potting mix, repotting, and care for common Indian houseplants & balcony plants (money plant, tulsi, snake plant, aloe, pothos, succulents, ferns).
- KITCHEN GARDEN → growing herbs and veggies at home (tomato, chilli, coriander, mint, spinach, curry leaf) in pots/grow-bags by season.
- PROBLEMS → diagnosing common issues from symptoms (yellow leaves, drooping, leaf spots, no flowering, pests like mealybugs/aphids) and gentle, mostly organic fixes (neem oil, correcting water/light).
- SOIL & FEEDING → simple potting mixes, compost/vermicompost, organic feeding, and drainage.
- SEASONAL & SPACE → what to grow in which season, and tips for small balconies, low light, or hot climates.

CRITICAL HONESTY & SAFETY (non-negotiable):
- Give general guidance; plant needs vary by variety, climate and home conditions — suggest observing the plant and adjusting, and confirm tricky cases with a local nursery.
- PESTICIDE/CHEMICAL SAFETY: prefer organic/least-toxic methods (neem, manual removal); if any chemical is used, advise reading the label, keeping it away from children/pets and edibles, and following safety. Never recommend banned or unsafe chemicals.
- EDIBLE & TOXICITY caution: note that some common houseplants are toxic if eaten (e.g. by children/pets) and home-grown edibles should be washed; don’t advise eating unknown/foraged plants.
- Don’t fabricate plant species, chemical doses, or guaranteed results. Be honest that some plants are hard or unsuited to a given climate.

INDIA CONTEXT: aware of Indian climates (hot summers, monsoon), balcony/terrace gardening, tulsi and common kitchen-garden plants, local nurseries, and organic home composting. Reply in the user's language (Hindi/regional) if they use it. Be warm and motivating — make gardening feel easy.`,
  disclaimer: 'Gardening AI gives general home-gardening guidance — plant needs vary by variety, climate and conditions, so observe your plant and confirm tricky cases with a local nursery. Prefer organic methods; if using any chemical, follow the label and keep it away from children, pets and edibles. Some houseplants are toxic if eaten, and home-grown edibles should be washed.',
  knowledge: [
    {
      id: 'watering_light',
      topic: 'Watering & light basics',
      keywords: ['water', 'watering', 'light', 'sunlight', 'overwater', 'yellow leaves', 'indoor', 'drooping'],
      content: 'Most houseplant deaths come from OVER-watering. Check the top 2–3 cm of soil — water only when it feels dry, and ensure the pot has drainage holes (no waterlogging). Match light to the plant: succulents/most herbs want bright light, while pothos/snake plant/ZZ tolerate low light. Yellow, mushy leaves often mean too much water; crispy, drooping leaves often mean too little or too much harsh sun. Observe and adjust gradually.',
      source: 'General houseplant care',
    },
    {
      id: 'kitchen_garden',
      topic: 'Kitchen garden (herbs & veggies at home)',
      keywords: ['kitchen garden', 'vegetable', 'herbs', 'tomato', 'chilli', 'coriander', 'mint', 'grow', 'pot', 'terrace'],
      content: 'Easy home edibles in pots/grow-bags: coriander, mint, methi, spinach, chilli, tomato, and curry leaf. Use a well-draining mix (garden soil + compost + cocopeat/sand), a pot of adequate size, 4–6 hours of sun for most veggies, and regular but not excessive watering. Sow as per season (cool-season greens in winter, many fruiting veg with warmth). Pinch/harvest regularly to encourage growth. Mint and coriander can grow even on a sunny windowsill.',
      source: 'General home-gardening guidance',
    },
    {
      id: 'problems_pests',
      topic: 'Diagnosing problems & pests',
      keywords: ['pest', 'mealybug', 'aphid', 'leaf spot', 'not flowering', 'problem', 'dying', 'neem', 'fungus'],
      content: 'Read the symptoms: yellowing (often over-water or nutrient issue), brown crispy edges (under-water/low humidity/sunburn), white cottony spots (mealybugs), tiny clustered insects (aphids), leaf spots (often fungal from wet leaves/poor airflow). Fixes: correct watering/light first, wipe or spray off pests, use diluted neem oil for soft-bodied pests, improve airflow and avoid wetting leaves at night. Prefer organic methods, especially on edibles.',
      source: 'General plant-problem guidance',
    },
    {
      id: 'soil_feeding',
      topic: 'Soil, potting mix & feeding',
      keywords: ['soil', 'potting mix', 'compost', 'fertiliser', 'feeding', 'repot', 'drainage', 'vermicompost'],
      content: 'A good all-round potting mix is roughly equal parts garden soil, compost/vermicompost and cocopeat (plus a little sand for drainage) — adjust for the plant (succulents need grittier, faster-draining mix). Feed lightly during the growing season with compost or a balanced organic feed; don’t over-fertilise. Repot when roots fill the pot or growth stalls, into a slightly larger pot with fresh mix. Always ensure drainage to avoid root rot.',
      source: 'General potting & feeding guidance',
    },
    {
      id: 'safety_toxicity',
      topic: 'Safety: pets, children & edibles',
      keywords: ['toxic', 'pet', 'child', 'safe', 'poisonous', 'edible', 'wash', 'chemical'],
      content: 'Some popular houseplants (e.g. pothos/money plant, dieffenbachia, aloe in quantity) can be toxic if chewed by children or pets — keep them out of reach and don’t assume a plant is edible. Wash home-grown vegetables and herbs before eating. If you ever use a chemical pesticide/fungicide, read the label, keep it off edibles and away from kids/pets, and prefer organic options. Never eat an unknown or foraged plant.',
      source: 'General safety guidance',
    },
  ],
};
