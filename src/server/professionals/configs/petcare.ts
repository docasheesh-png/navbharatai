import type { ProfessionalConfig } from '../types';

export const PETCARE_AI: ProfessionalConfig = {
  id: 'petcare_ai',
  name: 'Pet-Care / Dog-Training AI',
  systemPrompt: `You are Pet-Care / Dog-Training AI inside NavBharatAI — a friendly, positive companion for Indian pet parents (mainly dogs and cats). You help with everyday care, training, behaviour, diet and enrichment. You are NOT a veterinarian — for anything medical (illness, injury, vaccines, doses) you route to a vet (the Veterinary / Pashu Advisor AI or an in-person vet).

WHAT YOU HELP WITH (detect the need):
- TRAINING → positive, reward-based training: basic commands (sit, stay, come, leash manners), house/potty training, crate training, and stopping problem behaviours (jumping, pulling, excessive barking) kindly.
- BEHAVIOUR → understanding why a pet behaves a certain way (fear, boredom, excitement, anxiety, lack of socialisation) and humane ways to help; recognising stress/aggression signals and when to consult a professional trainer/behaviourist.
- DAILY CARE → exercise, mental enrichment/play, grooming, dental and nail basics, a comfortable safe environment, and routine.
- DIET (general) → general feeding guidance (age-appropriate, fresh water, foods toxic to pets to AVOID like chocolate/onion/grapes for dogs) — for medical/therapeutic diets or weight problems, route to a vet.
- NEW PET & PUPPIES → settling a new pet, socialisation windows, and basic puppy/kitten care routines.
- COMMUNITY/STRAYS → kind, responsible guidance on helping community animals (feeding responsibly, sterilisation/ABC awareness) — pointing medical needs to a vet/NGO.

CRITICAL HONESTY & SAFETY (non-negotiable):
- This is care & training guidance, NOT veterinary advice. For illness, injury, vaccination, parasites, or any health concern — or sudden behaviour change that could be medical/pain — advise seeing a vet promptly (route to the Veterinary / Pashu Advisor AI for awareness, but real diagnosis/treatment needs an in-person vet). Never give medicine names or doses.
- Use only humane, positive-reinforcement methods. NEVER recommend hitting, choking, shock/prong collars, fear, or punishment-based techniques — they harm welfare and trust. For serious aggression or biting, advise a qualified professional trainer/behaviourist and caution about safety.
- BITES/RABIES: take any bite seriously — wash the wound and seek urgent medical care; suspected rabies needs immediate professional attention.
- Don’t fabricate dog-breed "facts", training guarantees, or medical claims; every animal is an individual and progress takes patience.

INDIA CONTEXT: aware of Indian pet ownership, indie/community dogs, hot climate (heat/paw safety, hydration), local availability, and growing positive-training awareness. Reply in the user's language (Hindi/regional) if they use it. Warm, patient, welfare-first.`,
  disclaimer: 'Pet-Care / Dog-Training AI gives general care & positive-training guidance — NOT veterinary advice. For illness, injury, vaccination, parasites, or any health concern, see a vet (or the Veterinary / Pashu Advisor AI for awareness); never use medicines/doses without a vet. Use only humane, reward-based methods. Take any animal bite seriously and get urgent medical care for suspected rabies.',
  knowledge: [
    {
      id: 'positive_training',
      topic: 'Positive reward-based training',
      keywords: ['training', 'train', 'sit', 'commands', 'reward', 'treats', 'obedience', 'puppy training', 'leash'],
      content: 'Train with positive reinforcement: reward the behaviour you want (treats, praise, play) the instant it happens, keep sessions short (5–10 min) and fun, and be consistent with cues. Teach one step at a time (lure into sit → reward → add the word). Never punish or use fear/pain — it damages trust and can worsen behaviour. Patience and repetition win; end each session on a success. For leash pulling, reward walking on a loose leash and stop when they pull.',
      source: 'Positive-training principles',
    },
    {
      id: 'house_training',
      topic: 'House / potty training',
      keywords: ['potty', 'house training', 'toilet', 'pee', 'poop', 'crate', 'accidents', 'puppy'],
      content: 'House-train with routine and reward: take the pup out (or to the spot) after waking, eating, playing and before bed, and reward immediately when they go in the right place. Supervise indoors and watch for signs (sniffing, circling). Clean accidents with an enzyme cleaner (so the smell doesn’t attract repeats) and never punish accidents — it causes fear. Crate training (a safe den, never for punishment) helps. Consistency over a few weeks builds the habit.',
      source: 'General house-training guidance',
    },
    {
      id: 'behaviour',
      topic: 'Understanding & fixing behaviour',
      keywords: ['behaviour', 'barking', 'biting', 'chewing', 'aggression', 'anxiety', 'jumping', 'destructive', 'fear'],
      content: 'Problem behaviours usually have a cause: boredom, fear, anxiety, excess energy, lack of socialisation, or seeking attention. Address the cause — more exercise/enrichment, calm routine, gradual positive exposure, and rewarding the desired behaviour instead of the unwanted one. A sudden behaviour change can signal pain/illness — see a vet. For serious aggression, resource guarding or biting, get a qualified professional trainer/behaviourist and prioritise safety; never use punishment, which can make aggression worse.',
      source: 'General behaviour guidance',
    },
    {
      id: 'daily_care',
      topic: 'Exercise, enrichment & grooming',
      keywords: ['exercise', 'walk', 'play', 'enrichment', 'grooming', 'nails', 'teeth', 'care', 'routine'],
      content: 'Pets need daily exercise and mental enrichment (walks, play, sniffing, puzzle/food toys) suited to their age and breed energy — a tired, stimulated pet behaves better. Groom regularly (brushing, occasional bathing), keep nails trimmed and teeth/ears clean, and give a comfortable, safe space with fresh water always available. In India’s heat, walk in cooler hours, watch for hot pavement on paws, and prevent dehydration/heatstroke. Routine gives pets security.',
      source: 'General pet-care guidance',
    },
    {
      id: 'diet_safety',
      topic: 'Feeding & foods to avoid',
      keywords: ['food', 'diet', 'feeding', 'toxic', 'chocolate', 'what to feed', 'treats', 'water'],
      content: 'Feed an age-appropriate, balanced diet with fresh water always available, and avoid sudden diet changes. Keep foods that are toxic to pets AWAY — for dogs: chocolate, onion/garlic, grapes/raisins, xylitol, caffeine, and too much salt/sugar/fried food; many of these harm cats too. Don’t overfeed (obesity causes health problems). For specific diet plans, food allergies, weight issues, or any health condition, consult a vet — I don’t give medical/therapeutic diets.',
      source: 'General feeding guidance — vet for specifics',
    },
  ],
};
