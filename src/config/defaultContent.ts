/**
 * Default editable content for the Home, About, and Donation panels.
 * Extracted from App.tsx. These are the seed values used when nothing is
 * persisted in localStorage yet (admins can edit them at runtime).
 */

export interface HomeFeature {
  title: string;
  subtitle: string;
  description: string;
  icon: string;
  color: string;
  status?: string;
}

export interface HomeData {
  heroTitle: string;
  heroSubtitle: string;
  welcomeText: string;
  ctaText: string;
  features: HomeFeature[];
}

export interface AboutData {
  logoUrl?: string;
  headline: string;
  description: string;
  team: string;
  vision: string;
}

export interface DonationData {
  headline: string;
  subHeadline: string;
  upiId: string;
  name: string;
  missionStatement: string;
  dreamStatement: string;
  qrUrl: string;
  logoUrl: string;
}

export const DEFAULT_HOME_DATA: HomeData = {
  heroTitle: 'navBharatAI Architect',
  heroSubtitle: 'Enterprise-grade ecosystem for building complex, scalable, and production-ready applications with Bharat-first precision.',
  welcomeText: 'Enterprise Architect Mode Active',
  ctaText: 'Assemble System Architecture',
  features: [
    {
      title: 'Senior Architect Protocol',
      subtitle: '15+ Years of Industry Expertise',
      description: 'Not just a chatbot. navBharatAI follows a strict 8-phase senior architect workflow from Discovery to DevOps.',
      icon: 'ShieldCheck',
      color: 'from-indigo-600 to-blue-700',
    },
    {
      title: 'Scale-First Architecture',
      subtitle: 'Designed for Millions of Users',
      description: 'High-level guidance on Monorepos, Microservices, and TB-level data complexity management.',
      icon: 'Zap',
      color: 'from-amber-500 to-orange-600',
    },
    {
      title: 'Modular Code Standards',
      subtitle: 'Production-Ready TypeScript',
      description: 'Clean, well-commented, and modular implementation plans that follow enterprise coding standards.',
      icon: 'Code',
      color: 'from-emerald-500 to-teal-600',
    },
    {
      title: 'End-to-End Governance',
      subtitle: 'Security, Compliance & DevOps',
      description: 'Integrated RBAC, OWASP audits, and professional CI/CD strategy recommendations.',
      icon: 'Shield',
      color: 'from-purple-500 to-pink-500',
      status: 'Enterprise',
    },
  ],
};

export const DEFAULT_ABOUT_DATA: AboutData = {
  logoUrl: '',
  headline: 'Bharat ka Apna AI - navBharat',
  description: 'Navbharat AI is a mission to empower every Indian with the power of Artificial Intelligence.',
  team: 'Built with ❤️ by a passionate developer.',
  vision: 'To make Bharat a global leader in AI.',
};

export const DEFAULT_DONATION_DATA: DonationData = {
  headline: '🇮🇳 नवभारत AI के लिए आपका सहयोग',
  subHeadline: 'Empowering Bharat with Intelligence',
  upiId: 'doc.asheesh@oksbi',
  name: 'Dr. Asheesh',
  missionStatement: 'मैंने अकेले मेहनत करके नवbharat AI बनाने की शुरुआत की है।',
  dreamStatement: 'मेरा सपना है कि एक दिन "नवभारत AI" भारत का ही नहीं, बल्कि दुनिया का सबसे शक्तिशाली, सबसे बुद्धिमान और सबसे उपयोगी AI बने।',
  qrUrl: '',
  logoUrl: '',
};

/**
 * Read JSON from localStorage and fall back to a default when missing or
 * unparseable. Used to seed editable-content state in App.tsx.
 */
export function loadPersistedContent<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    if (saved) return JSON.parse(saved) as T;
  } catch { /* corrupt JSON — use fallback */ }
  return fallback;
}
