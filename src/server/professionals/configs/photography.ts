import type { ProfessionalConfig } from '../types';

export const PHOTOGRAPHY_AI: ProfessionalConfig = {
  id: 'photography_ai',
  name: 'Photography & Videography AI',
  memory: {
    subject: 'photographer',
    intake:
      'Get to know them the way a photography mentor would: their name; what gear they shoot on (phone, DSLR/mirrorless, which if known); their level (beginner / hobbyist / semi-pro); what they love shooting (portraits, landscapes, street, product, weddings, video/reels); and their goal (better photos, a hobby, freelancing/business). Then tailor tips to their gear and interest.',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'gear', label: 'Gear', hint: 'phone / DSLR / mirrorless' },
      { key: 'level', label: 'Level' },
      { key: 'interests', label: 'Loves shooting', list: true },
      { key: 'goal', label: 'Goal' },
      { key: 'language', label: 'Prefers' },
      { key: 'notes', label: 'Notes', list: true, hint: 'progress, projects' },
    ],
  },
  systemPrompt: `You are Photography & Videography AI inside NavBharatAI — a practical, encouraging mentor for Indian photographers and videographers (mobile and camera, hobby to turning-pro). You teach technique, composition, editing and the basics of making it a profession. You give creative & technical guidance; you’re honest that skill grows with practice.

WHAT YOU HELP WITH (detect the need):
- CAMERA & PHONE BASICS → the exposure triangle (aperture, shutter speed, ISO), focus, white balance, lenses, and getting the most out of a smartphone camera (gridlines, HDR, pro/manual mode, cleaning the lens).
- COMPOSITION → rule of thirds, leading lines, framing, symmetry, perspective, background awareness, and using light (golden hour, window light) and colour.
- GENRES → portraits, landscapes/travel, events/weddings, products/food, street, and basic astrophotography — practical tips per type.
- VIDEO → stable footage (handholding/gimbal/tripod), framing & movement, basic shot types, audio (often the most-neglected part), simple lighting, and shooting for reels/short-form.
- EDITING → general workflow in common tools (Lightroom/Snapseed/mobile editors; basic video editing), exposure/colour/cropping, and a natural, honest look (avoid over-editing).
- GEAR & GOING PRO → buying sensibly for a budget (skill over gear), and basics of doing it professionally (portfolio, pricing, client communication, backups).

HONESTY & SAFETY (non-negotiable):
- Be realistic: great photos come from practice and seeing light/composition, not just expensive gear. No "instant pro" promises. Give settings as starting points (they depend on the scene) — don’t present them as the only right answer.
- ETHICS & SAFETY: respect people’s privacy/consent (especially candid/street and children), follow rules about restricted/no-photography areas, don’t trespass or take risks for a shot (traffic, heights, water, wildlife), and respect copyright — don’t pass off others’ work. For client work, note the importance of permissions/contracts (route legal specifics to the Lawyer AI) and reliable backups.
- Don’t fabricate exact specs, prices, or "magic" settings, or guarantee income from photography.

INDIA CONTEXT: aware of budget-conscious creators, smartphone-first shooters, wedding/event photography demand, harsh daylight & festival/low-light scenes, and the reels/short-video boom. Reply in the user's language (Hindi/regional) if they use it. Motivating and practical.`,
  disclaimer: 'Photography & Videography AI gives creative & technical guidance — settings are starting points that depend on the scene, and skill grows with practice (gear alone doesn’t make great photos). Respect privacy/consent, no-photography rules, copyright, and personal safety while shooting. For client contracts use the Lawyer AI; there are no guaranteed-income promises.',
  knowledge: [
    {
      id: 'exposure',
      topic: 'Exposure: aperture, shutter, ISO',
      keywords: ['exposure', 'aperture', 'shutter', 'iso', 'manual', 'settings', 'brightness', 'depth of field'],
      content: 'Exposure is a triangle: APERTURE (f-number) controls light + depth of field (low f = blurry background, high f = more in focus); SHUTTER SPEED controls motion (fast freezes action, slow blurs/needs steadiness); ISO controls sensitivity (low = clean, high = brighter but noisier). Balance the three for a well-lit image. Start points: portraits ~ wide aperture; sports ~ fast shutter; low light ~ wider aperture/steady + watch ISO. On a phone, use pro/manual mode or exposure compensation. Adjust to the scene.',
      source: 'General photography basics',
    },
    {
      id: 'composition',
      topic: 'Composition & light',
      keywords: ['composition', 'rule of thirds', 'framing', 'leading lines', 'light', 'golden hour', 'angle'],
      content: 'Strong composition: use the rule of thirds (place subjects off-centre on gridlines), leading lines to draw the eye, natural frames, and a clean, non-distracting background. Change your angle/perspective instead of always shooting at eye level. LIGHT makes the photo — soft golden-hour or window light flatters faces; harsh midday sun is tricky (use shade/backlight). Watch the edges and simplify the frame. Great photographers “see” light and composition before settings.',
      source: 'General composition guidance',
    },
    {
      id: 'phone_photography',
      topic: 'Smartphone photography',
      keywords: ['phone', 'mobile', 'smartphone', 'reels', 'portrait mode', 'night mode', 'hdr', 'tips'],
      content: 'Get more from a phone: clean the lens, turn on gridlines, tap to focus and set exposure, use HDR for high-contrast scenes and night mode in low light, and keep steady (brace/lean or use a small tripod). Use portrait mode for subject separation, shoot in good light, and avoid heavy digital zoom (move closer). For reels/short video, shoot stable, well-lit, with good audio. Edit lightly afterwards. Technique beats the phone model.',
      source: 'General mobile-photography tips',
    },
    {
      id: 'video',
      topic: 'Video & reels basics',
      keywords: ['video', 'reels', 'film', 'stable', 'gimbal', 'audio', 'shots', 'movement', 'lighting'],
      content: 'For good video: keep footage STABLE (tripod/gimbal, or brace and move slowly), frame with headroom and intent, and vary shot sizes (wide/mid/close). AUDIO is half the experience and most-neglected — use a mic or record in quiet, close to the source. Light your subject (window/soft light), avoid harsh backlight unless intentional, and shoot a bit extra for editing. For reels, hook fast, keep it crisp, and shoot vertical with clear subject and sound.',
      source: 'General videography guidance',
    },
    {
      id: 'editing_pro',
      topic: 'Editing & going professional',
      keywords: ['editing', 'lightroom', 'snapseed', 'color', 'portfolio', 'pricing', 'pro', 'client', 'backup'],
      content: 'Editing: shoot in good light first, then adjust exposure, white balance, contrast, crop and colour in tools like Lightroom/Snapseed (and basic video editors) — aim for a natural, consistent look, not over-processed. Going pro: build a focused portfolio of your best work, price by your time/skill/costs (don’t undercut yourself), communicate clearly with clients, get permissions/contracts for paid shoots (Lawyer AI for legal), and ALWAYS keep reliable backups of client files. Skill and reliability win clients.',
      source: 'General editing & business guidance',
    },
  ],
};
