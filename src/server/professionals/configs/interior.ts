import type { ProfessionalConfig } from '../types';

export const INTERIOR_AI: ProfessionalConfig = {
  id: 'interior_ai',
  name: 'Interior Design & Home-Decor AI',
  systemPrompt: `You are Interior Design & Home-Decor AI inside NavBharatAI — a practical, creative guide to decorating and organising Indian homes on any budget (rented or owned, small flats to houses). You help with layout, colour, decor, storage and DIY styling. You give design IDEAS and guidance; for anything structural, electrical, plumbing or safety-related you route to a professional (architect/civil engineer/electrician), and to the Home Repair AI for fixes.

WHAT YOU HELP WITH (detect the need):
- SPACE PLANNING → arranging furniture for flow and function, making small/rented spaces feel bigger, multi-use rooms, and zoning.
- COLOUR & MOOD → choosing colour palettes, wall colours/accent walls, and how light and colour affect mood and the feel of a room.
- DECOR & STYLING → affordable decor (cushions, curtains, rugs, plants → Gardening AI, art, lighting layers), styling shelves, and personal/cultural touches.
- STORAGE & DECLUTTER → smart storage, decluttering/organising, and keeping homes tidy in small spaces.
- ROOM-BY-ROOM → living room, bedroom, kitchen, study/work-from-home, kids’ room, balcony, and pooja/prayer space ideas — respectfully.
- BUDGET & DIY → high-impact low-cost changes, DIY projects (repaint, rearrange, upcycle), and what’s worth spending on.

HONESTY & SAFETY (non-negotiable):
- This is decor/design guidance, NOT structural, electrical or architectural engineering. For removing/altering walls, load-bearing changes, electrical/plumbing work, false ceilings, or anything affecting safety/structure, consult a qualified architect/civil/structural engineer or licensed tradesperson (Home Repair AI for safe DIY fixes; never DIY electrical/gas/structural).
- For RENTED homes, suggest landlord-friendly, reversible changes (no permanent damage) and check the agreement before drilling/painting.
- Respect budget and practicality first; don’t push expensive purchases. Be honest that taste is personal — offer options, not rigid rules. (For Vastu-based placement, the Vastu AI covers that.)
- Don’t fabricate exact product prices, brand claims, or guarantee outcomes; safety and legality come before aesthetics.

INDIA CONTEXT: aware of compact urban flats, rented homes, joint families, hot/humid climate (ventilation, easy-clean materials), festive decor, pooja spaces, and budget constraints. Reply in the user's language (Hindi/regional) if they use it. Warm, creative, practical.`,
  disclaimer: 'Interior Design & Home-Decor AI gives decor & design ideas — NOT structural, electrical or architectural advice. For walls/load-bearing changes, electrical/plumbing, false ceilings or anything affecting safety/structure, consult a qualified architect/engineer or licensed tradesperson (Home Repair AI for safe DIY). In rented homes, prefer reversible changes and check your agreement. Taste is personal and prices vary — these are options, not rules.',
  knowledge: [
    {
      id: 'space_planning',
      topic: 'Space planning & small spaces',
      keywords: ['layout', 'space', 'small room', 'furniture', 'arrange', 'flat', 'flow', 'tiny'],
      content: 'Plan for flow and function: leave clear walkways, place larger furniture against walls in small rooms, and choose multi-use/space-saving pieces (sofa-cum-bed, storage beds, foldables). Make small or rented spaces feel bigger with light colours, mirrors to reflect light, vertical storage, legs-on furniture (visual space underneath), and not over-cluttering. Define zones in multi-use rooms with rugs/lighting. Measure before buying so pieces fit and the room breathes.',
      source: 'General space-planning guidance',
    },
    {
      id: 'colour_light',
      topic: 'Colour, light & mood',
      keywords: ['colour', 'color', 'paint', 'wall', 'palette', 'accent', 'light', 'mood'],
      content: 'Colour sets the mood: light, neutral bases make rooms feel bigger and calmer; an accent wall or colourful decor adds personality without overwhelming. Cooler tones feel calm/restful (good for bedrooms), warmer tones feel cosy/social (living/dining). Maximise natural light (light curtains, mirrors) and layer artificial light — ambient (general) + task (reading/kitchen) + accent (highlights) — instead of one harsh ceiling light. Test paint samples on the wall and view in day and night light before committing.',
      source: 'General colour & lighting guidance',
    },
    {
      id: 'decor_budget',
      topic: 'Affordable decor & DIY',
      keywords: ['decor', 'budget', 'cheap', 'diy', 'cushions', 'curtains', 'upcycle', 'style'],
      content: 'High-impact, low-cost changes: fresh cushions/throws, nice curtains (hung high and wide to enlarge windows), a rug to anchor a space, indoor plants (Gardening AI), framed art/photos, and good lighting. DIY ideas: repaint or rearrange, upcycle old furniture, and style shelves with a mix of books, objects and greenery (in odd-numbered groupings). Spend on what you use daily (a good mattress, seating) and save on trend items. Add personal and cultural touches that make it feel like home.',
      source: 'General budget-decor guidance',
    },
    {
      id: 'storage_declutter',
      topic: 'Storage & decluttering',
      keywords: ['storage', 'declutter', 'organise', 'tidy', 'clutter', 'space saving', 'minimal'],
      content: 'Tidy homes feel bigger and calmer. Declutter first (keep what’s useful or loved, donate the rest), then give everything a home. Use vertical space (tall shelves, wall hooks, over-door organisers), under-bed and under-stair storage, baskets/boxes to corral small items, and multi-function furniture with hidden storage. Keep surfaces mostly clear. In small Indian kitchens, use racks, stackables and inside-cabinet organisers. A quick daily reset keeps clutter from building up.',
      source: 'General organising guidance',
    },
    {
      id: 'rooms_safety',
      topic: 'Room ideas & when to call a professional',
      keywords: ['bedroom', 'kitchen', 'living room', 'study', 'pooja', 'wall', 'structural', 'architect', 'professional'],
      content: 'Room tips: living — comfortable seating + good light + a focal point; bedroom — calm colours, blackout/soft curtains, bedside storage; study/WFH — good chair, task light, clutter-free desk near natural light; kitchen — work triangle and easy-clean surfaces; pooja space — a clean, serene, well-lit spot (Vastu AI for placement preferences). IMPORTANT: for removing/altering walls, false ceilings, electrical or plumbing changes, hire a qualified architect/engineer or licensed tradesperson — never DIY structural/electrical work (Home Repair AI covers safe fixes). For rented homes, keep changes reversible and check your agreement.',
      source: 'General room & safety guidance',
    },
  ],
};
