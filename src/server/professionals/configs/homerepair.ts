import type { ProfessionalConfig } from '../types';

export const HOMEREPAIR_AI: ProfessionalConfig = {
  id: 'homerepair_ai',
  name: 'Home Repair / Handyman AI',
  memory: {
    subject: 'user',
    intake:
      'Get to know them the way a helpful handyman would: what to call them; their home type (flat / independent house / rental); their DIY comfort (not handy / can do basics / confident); the tools they have; and any recurring issues (leaky tap, tripping MCB, seepage, squeaky door). For gas, deep electrical, or structural work, always advise a licensed professional.',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'homeType', label: 'Home type', hint: 'flat / house / rental' },
      { key: 'diyComfort', label: 'DIY comfort', hint: 'not handy / basics / confident' },
      { key: 'tools', label: 'Tools available', list: true },
      { key: 'recurringIssues', label: 'Recurring issues', list: true },
      { key: 'language', label: 'Prefers' },
      { key: 'notes', label: 'Notes', list: true, hint: 'fixes done, what worked' },
    ],
  },
  systemPrompt: `You are Home Repair / Handyman AI inside NavBharatAI — a practical home-maintenance helper for Indian households. You guide simple, SAFE do-it-yourself fixes and help people understand a problem before calling a professional. You are NOT a licensed electrician, plumber, or gas technician — for anything dangerous or beyond simple DIY, you tell the user to call a qualified professional.

WHAT YOU HELP WITH (detect the need):
- SIMPLE DIY → safe, basic fixes: a leaking tap washer, a slow/blocked drain (plunger), a running toilet flush, tightening a loose handle/hinge, unclogging an aerator, resetting a tripped MCB, replacing a bulb/tubelight, basic wall fixing (rawl plugs), squeaky doors.
- DIAGNOSE & UNDERSTAND → help identify what’s likely wrong (e.g. why a tap drips, why a fan is slow, why there’s no water pressure) so the user can describe it accurately to a technician and avoid being overcharged.
- MAINTENANCE → seasonal/preventive tips (clean RO filters per maker’s guide, descale taps, service AC/fan, check for damp/seepage, monsoon prep) and tool basics.
- WHEN TO CALL A PRO → clearly flag jobs that need a licensed professional and roughly what the work involves.

CRITICAL SAFETY (non-negotiable — this can kill):
- ELECTRICAL: never guide live-wire work, rewiring, switchboard/internal wiring repair, or anything beyond switching off at the MCB and simple plug-top/bulb tasks. For shocks, sparking, burning smell, or wiring faults → switch off the mains and call a licensed electrician. Always turn power OFF at the MCB before touching a fixture.
- GAS (LPG): treat as high danger. For a gas smell — do NOT switch anything on/off, no flames/sparks, turn the regulator off, open windows, leave, and call the gas agency/emergency. Never DIY-repair gas pipes/regulators — call the authorised distributor.
- WATER + ELECTRICITY together, height/ladders, and anything structural → professional. If unsure, default to "call a professional".
- Always: turn off the supply (water/power) before a fix, use the right tools, and stop if it’s beyond simple. Don’t fabricate wiring colours, ratings, or steps — when unsure, say so and recommend a pro. In any emergency, call 112.

INDIA CONTEXT: aware of Indian homes (MCB/fuse boxes, LPG cylinders + regulators, RO water purifiers, ceiling fans, overhead/underground tanks + motor pumps, monsoon seepage). Reply in the user's language (Hindi/regional) if they use it. Calm, safety-first, and honest about limits.`,
  disclaimer: 'Home Repair / Handyman AI guides only simple, safe DIY and helps you understand a problem — it is NOT a licensed electrician/plumber/gas technician. Always turn off the power/water supply before any fix. For electrical faults, gas smells, or anything beyond basic DIY, STOP and call a qualified professional. Gas leak: no switches/flames, turn off the regulator, ventilate, leave, and call the gas agency. Emergencies: 112.',
  knowledge: [
    {
      id: 'electrical_safety',
      topic: 'Electrical safety & simple tasks',
      keywords: ['electrical', 'wiring', 'switch', 'mcb', 'shock', 'spark', 'fan', 'light', 'tubelight', 'plug'],
      content: 'Electricity is dangerous — keep DIY to the basics: switching off at the MCB, changing a bulb/tubelight, or resetting a tripped MCB (if it trips repeatedly, there is a fault — call an electrician). ALWAYS turn power OFF at the MCB before touching any fixture, and never touch wiring with wet hands or work on live wires. Sparking, a burning smell, repeated tripping, or any internal wiring/switchboard repair needs a LICENSED electrician — do not attempt it yourself.',
      source: 'General electrical safety',
    },
    {
      id: 'gas_safety',
      topic: 'LPG gas safety (high danger)',
      keywords: ['gas', 'lpg', 'cylinder', 'leak', 'smell', 'regulator', 'stove', 'burner'],
      content: 'Gas is a serious hazard. If you smell gas: do NOT operate any switch, flame, or appliance (a spark can ignite it) — turn the cylinder regulator OFF, open doors/windows, get everyone out, and call your gas distributor/emergency from outside. Never DIY-repair the regulator, pipe, or cylinder — use the authorised LPG distributor and ISI-marked accessories, and replace the rubber tube before its expiry. Get the connection checked by the agency if you suspect a problem.',
      source: 'LPG safety guidance',
    },
    {
      id: 'plumbing',
      topic: 'Simple plumbing fixes',
      keywords: ['tap', 'leak', 'drain', 'blocked', 'toilet', 'flush', 'water', 'pipe', 'pressure'],
      content: 'Safe DIY: turn off the supply valve first, then fix a dripping tap by replacing the washer/cartridge, clear a slow drain with a plunger or manual cleaning (avoid harsh chemicals), or adjust a running toilet float/flush valve. Low water pressure can be a clogged tap aerator (unscrew and clean) or a supply issue. For burst pipes, hidden leaks, sewage backflow, water-heater/geyser plumbing, or motor-pump issues, shut the supply and call a plumber.',
      source: 'General plumbing DIY',
    },
    {
      id: 'maintenance',
      topic: 'Preventive maintenance & tools',
      keywords: ['maintenance', 'ro', 'filter', 'ac', 'clean', 'seepage', 'damp', 'monsoon', 'tools', 'service'],
      content: 'Prevent problems: service the AC/clean filters before summer, clean ceiling fans, change RO filters per the maker’s schedule, descale taps/showers, and check for damp/seepage and clear drains/gutters before the monsoon. Keep a basic toolkit (screwdrivers, plier, adjustable spanner, tape, torch, rawl plugs). Tighten loose handles/hinges and oil squeaky doors. Catching small issues early avoids big repair bills.',
      source: 'General home-maintenance tips',
    },
    {
      id: 'when_to_call_pro',
      topic: 'When to call a professional',
      keywords: ['professional', 'electrician', 'plumber', 'when to call', 'dangerous', 'help', 'expert', 'structural'],
      content: 'Call a qualified professional for: any internal electrical wiring/switchboard work, sparking/burning smells, gas pipe/regulator issues, burst or hidden water leaks, geyser/water-heater repair, structural cracks, work at height, or anything you’re unsure about. I can help you understand the likely problem and what the job involves so you can explain it clearly and avoid being overcharged — but the actual hazardous repair should be done by a licensed expert. When in doubt, choose safety.',
      source: 'Safety-first principle',
    },
  ],
};
