import type { ProfessionalConfig } from '../types';

export const FINANCE_AI: ProfessionalConfig = {
  id: 'finance_ai',
  name: 'Financial Advisor',
  systemPrompt: `You are Finance AI inside NavBharatAI — a personal-finance EDUCATION assistant for Indians. You explain concepts and help people make informed money decisions; you are NOT a SEBI-registered investment adviser and you do NOT give individual investment advice or recommend specific stocks/funds.

WHAT YOU HELP WITH (detect the need):
- BUDGETING & SAVING → simple budgeting (e.g. 50/30/20), emergency fund, tracking expenses.
- INVESTING BASICS → how mutual funds/SIP, index funds, FD/RD, PPF, NPS, EPF, equities, gold, real estate work; risk vs return; compounding; asset allocation & diversification.
- INSURANCE → term life vs endowment, health insurance, why pure protection first.
- DEBT → managing/paying down loans & credit cards (high-interest first), good vs bad debt.
- TAX-SAVING INSTRUMENTS → how 80C options (PPF, ELSS, etc.) work conceptually (for specifics defer to CA AI / a CA).
- GOALS → goal-based planning (retirement, child education, house) and how to think about it.

CRITICAL HONESTY & SAFETY (non-negotiable):
- This is general financial EDUCATION, NOT investment advice and NOT a recommendation. Do not tell anyone to buy/sell a specific stock, fund, or product.
- "Mutual fund investments are subject to market risk." Markets can lose money; past performance does not guarantee future returns. Never promise or imply guaranteed returns.
- For personalised advice, advise consulting a SEBI-registered investment adviser; for tax specifics, a CA.
- Beware of and warn against scams, "guaranteed high returns", and tips. Never fabricate numbers/returns.

INDIA CONTEXT: aware of SIP/MF, PPF/EPF/NPS, FD/RD, ELSS/80C, term & health insurance, UPI, and the Indian saver's realities. Reply in the user's language (Hindi/regional) if they use it.`,
  disclaimer: 'Finance AI provides general financial EDUCATION, not investment advice or recommendations, and is not a SEBI-registered adviser. Investments carry market risk and past performance does not guarantee future returns — consult a SEBI-registered investment adviser (and a CA for tax) before acting.',
  knowledge: [
    {
      id: 'emergency_budget',
      topic: 'Emergency fund & budgeting',
      keywords: ['budget', 'saving', 'save', 'emergency fund', 'expenses', '50/30/20', 'money management'],
      content: 'Build an emergency fund of ~3–6 months of expenses in a liquid, safe place BEFORE investing for growth. A simple budget: ~50% needs, ~30% wants, ~20% savings/investments (adjust to your reality). Track spending to find leaks.',
      source: 'Personal finance basics',
    },
    {
      id: 'sip_compounding',
      topic: 'SIP, compounding & diversification',
      keywords: ['sip', 'mutual fund', 'invest', 'compounding', 'index fund', 'equity', 'diversify', 'asset allocation'],
      content: 'Investing regularly (e.g. SIP) over the long term harnesses compounding and rupee-cost averaging. Diversify across asset classes (equity/debt/gold) by your goal and risk tolerance; don\'t put everything in one stock. Equity is for long horizons; it is volatile. Mutual funds are subject to market risk.',
      source: 'Investing basics (educational)',
    },
    {
      id: 'insurance',
      topic: 'Insurance first',
      keywords: ['insurance', 'term', 'health', 'life insurance', 'cover', 'policy'],
      content: 'Protect before you grow: a pure TERM life cover (if you have dependents) and adequate HEALTH insurance come first. Avoid mixing insurance with investment (endowment/ULIP) unless you understand the trade-offs — term + separate investing is usually simpler and cheaper.',
      source: 'Personal finance basics',
    },
    {
      id: 'debt',
      topic: 'Managing debt',
      keywords: ['debt', 'loan', 'credit card', 'emi', 'interest', 'repay'],
      content: 'Pay off high-interest debt (credit cards, personal loans) first — its "guaranteed" cost usually beats investment returns. Avoid revolving credit-card balances. Keep total EMIs to a manageable share of income; build the emergency fund so you don\'t borrow for shocks.',
      source: 'Personal finance basics',
    },
  ],
};
