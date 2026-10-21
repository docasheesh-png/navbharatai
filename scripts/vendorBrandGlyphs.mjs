#!/usr/bin/env node
// Vendors a SMALL, curated set of Lucide glyphs into src/lib/brandGlyphs.generated.ts (admin 2026-10-21: "pahle lucide,
// fir alfabet"). Run by hand when the list below changes:  node scripts/vendorBrandGlyphs.mjs
//
// WHY VENDORED AND NOT IMPORTED: the app-logo mark is composed on the server, in the browser and on a GitHub runner
// (as a plain SVG string). `lucide-react` is a React component library; importing it would drag React into the
// server and the runner, and would load all ~4,200 icons. ~100 glyphs as SVG strings are ~25 KB.
//
// LICENCE: Lucide is ISC (Copyright (c) 2026 Lucide Icons and Contributors; portions Feather, MIT, Cole Bemis).
// The notice is kept in the generated file's header, as the licence requires. `lucide-react` is already a dependency
// of this app, so no new licence enters the project.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ICONS = path.join(ROOT, 'node_modules', 'lucide-react', 'dist', 'esm', 'icons');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'lucide-react', 'package.json'), 'utf8')).version;

// id → words (English + Hinglish) an app NAME may contain. The FIRST glyph whose word matches wins, so order = priority.
const GLYPHS = {
  coffee: ['chai', 'coffee', 'cafe', 'tea', 'kahwa'],
  utensils: ['food', 'restaurant', 'khana', 'recipe', 'kitchen', 'dhaba', 'menu', 'tiffin', 'thali', 'biryani', 'pizza', 'burger'],
  'shopping-cart': ['shop', 'store', 'dukan', 'mart', 'bazaar', 'cart', 'kirana', 'grocery', 'sale'],
  'book-open': ['book', 'kitab', 'quran', 'gita', 'read', 'story', 'library', 'novel', 'ebook', 'dictionary', 'shabd'],
  'graduation-cap': ['school', 'exam', 'study', 'class', 'college', 'tutor', 'learn', 'quiz', 'course', 'padhai', 'vidya', 'student', 'teacher'],
  music: ['music', 'song', 'gana', 'radio', 'sangeet', 'bhajan', 'playlist', 'karaoke'],
  'gamepad-2': ['game', 'play', 'racing', 'arcade', 'puzzle', 'khel', 'ludo', 'snake', 'chess', 'tetris'],
  calculator: ['calculator', 'calc', 'emi', 'math', 'tax', 'gst'],
  calendar: ['calendar', 'planner', 'schedule', 'panchang', 'event', 'booking', 'appointment', 'diary'],
  'cloud-sun': ['weather', 'mausam', 'forecast', 'rain', 'sun'],
  'heart-pulse': ['health', 'doctor', 'medical', 'clinic', 'swasthya', 'care', 'ayurveda', 'yoga'],
  dumbbell: ['gym', 'fitness', 'workout', 'exercise', 'muscle', 'diet'],
  car: ['car', 'taxi', 'cab', 'ride', 'drive', 'rto', 'parking', 'garage', 'auto'],
  bus: ['bus', 'transport', 'yatra'],
  plane: ['flight', 'airline', 'travel', 'trip', 'tour', 'holiday'],
  camera: ['camera', 'photo', 'photography', 'selfie', 'studio', 'tasveer'],
  'message-circle': ['chat', 'message', 'talk', 'bol', 'sms', 'messenger'],
  wallet: ['wallet', 'pay', 'payment', 'upi', 'bank', 'budget', 'expense', 'khata', 'finance', 'money', 'paisa', 'loan'],
  newspaper: ['news', 'khabar', 'blog', 'magazine', 'akhbar', 'samachar'],
  'map-pin': ['map', 'location', 'nearby', 'gps', 'find', 'locator'],
  timer: ['timer', 'stopwatch', 'clock', 'alarm', 'pomodoro', 'time'],
  'notebook-pen': ['note', 'notes', 'notepad', 'journal', 'memo'],
  'square-check-big': ['todo', 'task', 'tasks', 'checklist', 'reminder', 'habit'],
  sprout: ['farm', 'kheti', 'kisan', 'crop', 'garden', 'plant', 'organic', 'agri'],
  leaf: ['nature', 'eco', 'green', 'herbal'],
  shirt: ['fashion', 'cloth', 'clothes', 'kapde', 'tailor', 'boutique', 'wear'],
  scissors: ['salon', 'barber', 'hair', 'beauty', 'parlour'],
  pill: ['pharmacy', 'medicine', 'dawai', 'chemist', 'tablet'],
  house: ['home', 'house', 'rent', 'property', 'ghar', 'flat', 'realty', 'pg'],
  briefcase: ['job', 'work', 'career', 'office', 'business', 'resume', 'naukri', 'hr'],
  trophy: ['score', 'winner', 'champion', 'cricket', 'sport', 'league', 'tournament', 'ipl'],
  landmark: ['mandir', 'temple', 'masjid', 'mosque', 'church', 'gurudwara', 'dharm', 'puja', 'prayer', 'namaz', 'aarti', 'museum', 'fort'],
  phone: ['phone', 'call', 'dialer', 'contact', 'recharge'],
  mail: ['mail', 'email', 'letter', 'inbox', 'newsletter'],
  gift: ['gift', 'offer', 'coupon', 'reward', 'cashback', 'refer'],
  baby: ['baby', 'kids', 'child', 'bachcha', 'parenting', 'nursery'],
  'paw-print': ['pet', 'dog', 'cat', 'animal', 'vet'],
  palette: ['art', 'paint', 'color', 'colour', 'design', 'draw', 'sketch', 'rangoli', 'mehndi'],
  video: ['video', 'movie', 'film', 'cinema', 'tv', 'show', 'stream', 'reels'],
  mic: ['podcast', 'record', 'voice', 'speech', 'audio'],
  languages: ['translate', 'translator', 'language', 'bhasha', 'dictionary', 'anuvad'],
  lightbulb: ['idea', 'tips', 'tricks', 'learn', 'quote', 'vichar'],
  rocket: ['launch', 'startup', 'rocket', 'boost', 'space'],
  shield: ['secure', 'safety', 'security', 'guard', 'vpn', 'password', 'antivirus'],
  scan: ['scan', 'scanner', 'qr', 'barcode', 'ocr'],
  'qr-code': ['qr'],
  'heart': ['love', 'dating', 'wedding', 'shaadi', 'matrimony', 'friend', 'like'],
  star: ['star', 'rating', 'review', 'favourite', 'favorite', 'top'],
  flame: ['fire', 'streak', 'trending', 'hot', 'spicy'],
  droplets: ['water', 'paani', 'drink', 'milk', 'dairy', 'tanker'],
  'bike': ['bike', 'cycle', 'scooter', 'delivery', 'courier'],
  truck: ['truck', 'cargo', 'logistics', 'shipping', 'tempo', 'parcel'],
  wrench: ['repair', 'service', 'mechanic', 'fix', 'plumber', 'tools'],
  zap: ['electric', 'power', 'bijli', 'bill', 'energy', 'charge', 'ev'],
  'wifi': ['wifi', 'internet', 'broadband', 'network', 'speedtest'],
  'users': ['team', 'group', 'community', 'club', 'society', 'family', 'sangh', 'samaj'],
  'badge-check': ['verify', 'certificate', 'id', 'aadhaar', 'pan', 'kyc'],
  'file-text': ['document', 'pdf', 'invoice', 'bill', 'form', 'report', 'resume'],
  'chart-column': ['stats', 'analytics', 'dashboard', 'report', 'tracker', 'sales', 'stock', 'market', 'share'],
  'tent': ['camp', 'camping', 'trek', 'adventure'],
  'mountain': ['mountain', 'hill', 'trek', 'himalaya'],
  'ticket': ['ticket', 'pass', 'movie', 'event', 'concert'],
  'bed-double': ['hotel', 'stay', 'hostel', 'room', 'resort', 'lodge'],
  'building-2': ['company', 'society', 'apartment', 'builder', 'construction', 'city'],
  'hammer': ['law', 'court', 'legal', 'lawyer', 'vakil', 'kanoon', 'advocate'],
  'church': [],
  'bird': ['bird', 'parrot', 'tweet'],
  'fish': ['fish', 'aquarium', 'machhli'],
  'sun': ['morning', 'subah', 'suryodaya'],
  'moon': ['night', 'sleep', 'raat', 'dream', 'ramzan', 'eid', 'chand'],
  'sparkles': ['magic', 'ai', 'smart', 'genius', 'wow', 'new'],
  'smile': ['happy', 'fun', 'emoji', 'mood', 'joke', 'meme'],
  'dices': ['dice', 'luck', 'lottery', 'random'],
  'puzzle': ['puzzle', 'brain', 'riddle', 'paheli', 'sudoku', 'word'],
  'pizza': [],
  'cake': ['cake', 'birthday', 'bakery', 'sweet', 'mithai', 'halwai'],
  'glasses': ['optical', 'chashma', 'eyewear', 'vision'],
  'baggage-claim': [],
  'umbrella': ['umbrella', 'insurance', 'bima', 'policy'],
  'recycle': ['recycle', 'scrap', 'kabadi', 'waste', 'clean'],
  'sofa': ['furniture', 'interior', 'decor', 'sofa'],
  'printer': ['print', 'xerox', 'photocopy'],
  'microscope': ['lab', 'science', 'research', 'test'],
  'atom': ['physics', 'chemistry', 'atom', 'neet', 'jee'],
  'languages-2': [],
};
// Symbols used when the name has no keyword AND no Latin letter (e.g. a Devanagari-only name): a stable pick by name hash.
const GENERIC = ['sparkles', 'star', 'rocket', 'zap', 'flame', 'smile', 'puzzle', 'lightbulb', 'heart', 'shield', 'sun', 'moon', 'leaf', 'bird'];

const toAttrs = (a) => Object.entries(a).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${String(v)}"`).join(' ');
const out = {}, missing = [];
/** The icon data of an id; some ids are aliases that re-export another icon's file (`export { default } from './x.mjs'`). */
async function dataOf(id, depth = 0) {
  const f = path.join(ICONS, `${id}.mjs`);
  if (!fs.existsSync(f)) return null;
  const mod = await import(pathToFileURL(f).href);
  if (mod.__iconData) return mod.__iconData;
  const m = /from ['"]\.\/([a-z0-9-]+)\.mjs['"]/.exec(fs.readFileSync(f, 'utf8'));
  return m && depth < 3 ? dataOf(m[1], depth + 1) : null;
}
for (const id of Object.keys(GLYPHS)) {
  if (GLYPHS[id].length === 0) { delete GLYPHS[id]; continue; } // a glyph no word can select is dead weight
  const d = await dataOf(id);
  if (!d) { missing.push(id); delete GLYPHS[id]; continue; }
  out[id] = d.node.map(([tag, attrs]) => `<${tag} ${toAttrs(attrs)}/>`).join('');
}
for (const g of GENERIC) if (!out[g]) { const d = await dataOf(g); if (!d) throw new Error(`generic glyph ${g} not found in lucide-react ${VERSION}`); out[g] = d.node.map(([tag, attrs]) => `<${tag} ${toAttrs(attrs)}/>`).join(''); }
const keywords = Object.fromEntries(Object.entries(GLYPHS).filter(([, w]) => w.length > 0));

const header = `// GENERATED by scripts/vendorBrandGlyphs.mjs — do not edit by hand. Glyph data from lucide-react ${VERSION}.
//
// Lucide is licensed under the ISC licence:
//   Copyright (c) 2026 Lucide Icons and Contributors. Portions are from Feather, Copyright (c) 2013-2023 Cole Bemis (MIT).
//   Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted,
//   provided that the above copyright notice and this permission notice appear in all copies.
//   THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE.
//
// Each value is the inside of a 24x24, stroke-width 2, round-cap SVG (what <svg viewBox="0 0 24 24"> wraps).
`;
fs.writeFileSync(path.join(ROOT, 'src', 'lib', 'brandGlyphs.generated.ts'),
  `${header}export const LUCIDE_VERSION = ${JSON.stringify(VERSION)};\n` +
  `export const BRAND_GLYPHS: Readonly<Record<string, string>> = ${JSON.stringify(out, null, 1)};\n` +
  `/** Words an app name may contain → the glyph. Order of keys = priority. */\n` +
  `export const BRAND_GLYPH_KEYWORDS: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(keywords, null, 1)};\n` +
  `/** Stable picks for a name with no keyword and no Latin letter. */\n` +
  `export const BRAND_GENERIC_GLYPHS: readonly string[] = ${JSON.stringify(GENERIC)};\n`);
console.log(`wrote ${Object.keys(out).length} glyphs (lucide-react ${VERSION}); not found in this version: ${missing.join(', ') || 'none'}`);
