// BR1962 (report be761ff8, 2026-11-08) — user-stopped edit, 12.5 s, nothing written.
// The prompt asked to replace demo replies in src/lib/aiService.ts with a real AI connection
// and listed nine numbered implementation/QA steps (inspect the file, never show fake replies,
// keep the existing design, …). APP_SCOPE said LARGE because of "~10 distinct features":
// featureCount's legacy numbered-line tally counted every Requirements: line, while the shared
// enumerator (MAX_ITEM_WORDS, isItem) saw only three short named parts. Software Project Mode
// did not create a plan (not a fresh build), but the same count on a new app would spend a
// planner call. Numbered lines now drop only when the WHOLE line is a tight, anchored
// quality/acceptance constraint — long numbered product features still count, including
// ones that start with quality words ("Responsive POS…", "Keep existing order history…").
import { describe, it, expect } from 'vitest';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';
import { countEnumeratedFeatures, enumeratedFeatureItems, isQualityAcceptanceLine } from '../src/server/AgentV3/enumeratedFeatures';
import { planningRequest } from '../src/server/AgentV3/planningRequest';

const BR1962 = `Now I want to make NOVA AI a real AI assistant.

Your review identified that src/lib/aiService.ts currently returns demo results instead of real AI responses.

Please fix this.

Requirements:

1. Inspect src/lib/aiService.ts.
2. Identify the existing connected AI service or available platform integration.
3. Replace all hardcoded and randomly generated demo responses with genuine AI-generated responses.
4. Connect the chat interface to the real AI service.
5. Support Hindi and English conversations.
6. Maintain chat history and conversation context.
7. Handle loading, timeout and API errors properly.
8. Never display fake AI responses.
9. Keep the existing NOVA AI design and all working features unchanged.

IMPORTANT:
Do not invent an API key or pretend an AI service is connected.

If an external API key or paid service is required, explain exactly what is needed before proceeding.

Test the chatbot with:
"Who is the President of India?"
and
"भारत की राजधानी क्या है?"

Confirm whether the responses come from a real AI model.`;

const SHOP_ERP_LONG = `Build a shop ERP:
1. Login with an email and password
2. Dashboard showing the sales this week
3. Inventory alerts when stock is low
4. Invoice PDFs for each completed order
5. Full customer purchase history for each account
6. Online payments for every completed order
7. Staff roles with separate access permissions
8. Daily email report of store sales`;

const HINDI_SHOP_ERP = `Ek shop ERP banao:
1. Email aur password se user login
2. Is hafte ki sales dikhane wala dashboard
3. Stock kam hone par inventory alerts
4. Har order ke liye invoice PDF
5. Har customer ki poori purchase history
6. Online payments har order par lena
7. Staff ke liye alag alag roles
8. Rozana email report store ko bhejna`;

const HINGLISH_HOSPITAL = `Ek hospital management system banao:
1. Patient registration with a phone number
2. Doctor ke appointment slots aaj dikhana
3. Pharmacy stock aur counter billing
4. Lab test reports ko upload karna
5. Ward bed availability for tonight
6. Insurance claim status for each patient
7. Emergency queue for arriving ambulances
8. Daily duty roster for night nurses`;

const SHOP_ERP_RESPONSIVE_POS = `Build a shop ERP:
1. Login with an email and password
2. Responsive POS screen for tablets
3. Inventory alerts when stock is low
4. Invoice PDFs for each completed order
5. Full customer purchase history for each account
6. Online payments for every completed order
7. Staff roles with separate access permissions
8. Daily email report of store sales`;

const SHOP_ERP_HINGLISH_POS = `Build a shop ERP:
1. Login with an email and password
2. Responsive POS screen tablets ke liye
3. Inventory alerts when stock is low
4. Invoice PDFs for each completed order
5. Full customer purchase history for each account
6. Online payments for every completed order
7. Staff roles with separate access permissions
8. Daily email report of store sales`;

const SHOP_ERP_KEEP_HISTORY = `Build a shop ERP:
1. Login with an email and password
2. Keep existing order history after migration
3. Inventory alerts when stock is low
4. Invoice PDFs for each completed order
5. Full customer purchase history for each account
6. Online payments for every completed order
7. Staff roles with separate access permissions
8. Daily email report of store sales`;

const PHOTO = `[Image: 1000243024.jpg]
The uploaded file is a portrait-style photograph of a woman. It is not a UI design, screenshot, mockup, or wireframe.

**Visual elements:**
- Long dark hair, parted in the middle
- Gold earrings, a nose ring and a necklace
- A red saree with a golden border
- Soft daylight from the left, a blurred green background
- Slight smile, looking at the camera
- Bangles on both wrists, a bindi, mehndi on the hands
- Framed from the shoulders up`;

function expectLarge(prompt: string, label: string): void {
  const s = analyzeAppScope(prompt);
  expect(s.decision, label).toBe('analyze');
  expect(s.size, label).toBe('large');
  expect(s.signals.join(' '), label).toMatch(/distinct features requested|named parts|part spec/);
}

describe('a quality checklist is not ten product features (BR1962)', () => {
  it('the BR1962 edit is not scoped LARGE for ~10 features', () => {
    const s = analyzeAppScope(BR1962);
    expect(s.signals.join(' ')).not.toMatch(/distinct features requested/);
    expect(s.size).toBe('small');
    expect(s.decision).toBe('direct');
    expect(s.famousApp).toBeNull();
    expect(countEnumeratedFeatures(BR1962)).toBeLessThan(8);
    expect(enumeratedFeatureItems(BR1962).length).toBeLessThan(8);
  });
});

describe('🔒 neighbours: long numbered product lists still escalate', () => {
  it('eight sentence-length shop-ERP features stay LARGE', () => {
    // The shared enumerator (MAX_ITEM_WORDS=5) sees none of these sentence-length
    // lines; megaProjectSignals.features therefore cannot rescue the count.
    // featureCount's legacy numbered tally must still see all eight.
    expect(countEnumeratedFeatures(SHOP_ERP_LONG)).toBe(0);
    expectLarge(SHOP_ERP_LONG, 'shop-ERP');
  });

  it('an 8-item shop ERP that includes "Responsive POS screen for tablets" stays LARGE', () => {
    expect(isQualityAcceptanceLine('2. Responsive POS screen for tablets')).toBe(false);
    expectLarge(SHOP_ERP_RESPONSIVE_POS, 'responsive POS');
  });

  it('an 8-item shop ERP that includes Hinglish "Responsive POS screen tablets ke liye" stays LARGE', () => {
    expect(isQualityAcceptanceLine('2. Responsive POS screen tablets ke liye')).toBe(false);
    expectLarge(SHOP_ERP_HINGLISH_POS, 'hinglish responsive POS');
  });

  it('an 8-item shop ERP that includes "Keep existing order history after migration" stays LARGE', () => {
    expect(isQualityAcceptanceLine('2. Keep existing order history after migration')).toBe(false);
    expectLarge(SHOP_ERP_KEEP_HISTORY, 'keep existing order history');
  });

  it('a Hindi shop-ERP of eight long numbered features stays LARGE', () => {
    expectLarge(HINDI_SHOP_ERP, 'hindi shop-ERP');
  });

  it('a Hinglish hospital system of eight long numbered features stays LARGE', () => {
    expectLarge(HINGLISH_HOSPITAL, 'hinglish hospital');
  });

  it('other long numbered product lists stay LARGE', () => {
    const restaurant = `Build a restaurant manager:
1. Table reservations for walk-ins and parties
2. Digital menu with daily specials
3. Kitchen order tickets by table
4. Split bills between guests
5. Staff shift scheduling
6. Ingredient inventory with low-stock alerts
7. Customer loyalty points
8. End-of-day sales summary`;
    const factory = `Build a factory operations app:
1. Machine uptime tracking per shift
2. Raw material inventory by warehouse
3. Work order assignment to operators
4. Quality inspection notes per batch
5. Shipping dispatch schedule
6. Maintenance ticket logging
7. Supplier purchase orders
8. Overnight production email digest`;
    const clinicParen = `Build a clinic management system:
1) Patient check-in with a token number
2) Doctor schedule for each room
3) Pharmacy billing at reception
4) Lab report uploads for each patient
5) Ward bed availability tonight
6) Insurance claim tracking
7) Emergency ambulance queue
8) Night duty roster for nurses`;
    expectLarge(restaurant, 'restaurant');
    expectLarge(factory, 'factory');
    expectLarge(clinicParen, 'clinic 1)');
  });

  it('eight short numbered features are still LARGE', () => {
    const p = `Build a school ERP:
1. Students
2. Teachers
3. Attendance
4. Fees
5. Exams
6. Timetable
7. Library
8. Transport`;
    expectLarge(p, 'short school ERP');
  });

  it('a one-line comma list of eight modules is still LARGE', () => {
    const p = 'school ERP with students, teachers, attendance, fees, exams, timetable, library, transport';
    const s = analyzeAppScope(p);
    expect(s.decision).toBe('analyze');
    expect(s.size).toBe('large');
  });

  it('"youtube ki tarah ek app" still clones', () => {
    const s = analyzeAppScope('youtube ki tarah ek app');
    expect(s.famousApp).toBe('YouTube');
    expect(s.decision).toBe('analyze');
  });
});

describe('🔒 neighbours: a picture visual-element list still sizes LARGE (19641ab5)', () => {
  it('aPictureIsNotAnApp photo description still makes the request analyze/large', () => {
    const before = planningRequest({ prompt: 'Create full image', attachmentText: PHOTO, userAppExists: false });
    expect(analyzeAppScope(before.text).decision).toBe('analyze');
    expect(analyzeAppScope(before.text).size).toBe('large');
  });
});

describe('isQualityAcceptanceLine is conservative', () => {
  it('discounts the reviewer\'s quality/acceptance examples', () => {
    for (const line of [
      '1. Do not invent an API key',
      '2. Keep existing UI',
      '3. Handle errors gracefully',
      '14. Handling errors',
      '15. Handling errors.',
      '16. Handling errors properly',
      '17. Handling errors gracefully',
      '18. Handling errors correctly',
      '4. no demo results',
      '5. Responsive',
      '11. Mobile responsive',
      '12. The UI must be responsive',
      '6. Tests pass',
      '13. All tests must pass',
      '8. Never display fake AI responses.',
      '9. Keep the existing NOVA AI design and all working features unchanged.',
      '10. Handle loading, timeout and API errors properly.',
    ]) {
      expect(isQualityAcceptanceLine(line), line).toBe(true);
    }
  });

  it('does not discount long numbered product features', () => {
    for (const line of [
      '1. Login with an email and password',
      '2. Dashboard showing the sales this week',
      '3. Inventory alerts when stock is low',
      '4. Invoice PDFs for each completed order',
      '5. Full customer purchase history for each account',
      '6. Online payments for every completed order',
      '7. Staff roles with separate access permissions',
      '8. Daily email report of store sales',
      '1. Handle user payments properly',
      '2. Identify nearby restaurants on a map',
      '3. Never miss a payment reminder',
      '4. Email aur password se login',
      '5. Is hafte ki sales dikhane wala dashboard',
      '2. Responsive POS screen for tablets',
      '2. Responsive POS screen tablets ke liye',
      '2. Keep existing order history after migration',
      '1. Handle COD payments at delivery',
      '1. Do not allow guests to check out without payment',
      '1. No-show tracking for appointments',
      '1. Inspect src/lib/aiService.ts.',
      '1. Identify nearby restaurants on a map',
      '1. Error log viewer for failed payments',
      '1. Test reports upload for each patient',
      '1. Handling customer refunds for COD orders',
      '1. Handling errors from the payment gateway webhook',
      '1. Handling errors and retries for UPI payouts',
      '1. Handling error codes for GST invoices',
      '1. Handling student copies board exam ke liye',
      '1. Handling रिफंड requests for failed UPI payments',
      '1. Handling errors!',
    ]) {
      expect(isQualityAcceptanceLine(line), line).toBe(false);
    }
  });
});

describe('BR1964 / Q-2626: Handling errors is quality; Handling <product> still counts', () => {
  const shop = (line2: string) => `Build a shop ERP:
1. Login with an email and password
2. ${line2}
3. Inventory alerts when stock is low
4. Invoice PDFs for each completed order
5. Full customer purchase history for each account
6. Online payments for every completed order
7. Staff roles with separate access permissions
8. Daily email report of store sales`;

  it('an 8-item shop ERP that includes "Handling customer refunds for COD orders" stays LARGE', () => {
    expect(isQualityAcceptanceLine('2. Handling customer refunds for COD orders')).toBe(false);
    expectLarge(shop('Handling customer refunds for COD orders'), 'handling refunds');
  });

  it('an 8-item shop ERP that includes "Handling errors from the payment gateway webhook" stays LARGE', () => {
    expect(isQualityAcceptanceLine('2. Handling errors from the payment gateway webhook')).toBe(false);
    expectLarge(shop('Handling errors from the payment gateway webhook'), 'handling errors from webhook');
  });

  it('a Hinglish 8-item shop ERP that includes "Handling student copies board exam ke liye" stays LARGE', () => {
    const p = `Ek shop ERP banao:
1. Email aur password se user login
2. Handling student copies board exam ke liye
3. Stock kam hone par inventory alerts
4. Har order ke liye invoice PDF
5. Har customer ki poori purchase history
6. Online payments har order par lena
7. Staff ke liye alag alag roles
8. Rozana email report store ko bhejna`;
    expect(isQualityAcceptanceLine('2. Handling student copies board exam ke liye')).toBe(false);
    expectLarge(p, 'hinglish handling copies');
  });

  it('whole-line "Handling errors" is a quality line (the English gerund now matches)', () => {
    expect(isQualityAcceptanceLine('2. Handling errors')).toBe(true);
    expect(isQualityAcceptanceLine('Handling errors properly')).toBe(true);
    expect(isQualityAcceptanceLine('Handling errors!')).toBe(false); // Q-2627 residual
    // A shop ERP that replaces one product line with "Handling errors" can still
    // reach featureCount 8 via floor(verbs/2). This test locks the line, not a
    // whole-prompt LARGE drop.
  });
});
