// U-4 (verified recipe modules) — transactional email generator (Resend + SendGrid).
//
// Every real app sends email: signup confirmation, password reset, receipts, notifications. This emits a real
// server-side send helper for the chosen provider, Bring-Your-Own key (pasted into .env; NavBharatAI never
// stores it). PURE builders; the generated code is complete and correct (no TODO stubs — the real-features
// rule). Unit-tested.

export type EmailProvider = 'resend' | 'sendgrid';

export interface EmailConfig {
  provider: EmailProvider;
  files: Record<string, string>;
  envKeys: string[];
  dependency: { name: string; version: string };
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

const RESEND_HELPER = `import { Resend } from 'resend';

// Bring-Your-Own Resend key — from resend.com → API Keys, pasted into .env.
const resend = new Resend(process.env.RESEND_API_KEY as string);

export interface EmailInput {
  to: string | string[];
  subject: string;
  html: string;
  from?: string; // defaults to EMAIL_FROM (a verified sender/domain in your Resend account)
}

// Send a transactional email. Throws on a provider error — callers should surface it, never swallow it.
export async function sendEmail(input: EmailInput): Promise<{ id: string }> {
  const from = input.from ?? process.env.EMAIL_FROM;
  if (!from) throw new Error('EMAIL_FROM is not set — use a sender on a domain verified in Resend');
  const { data, error } = await resend.emails.send({ from, to: input.to, subject: input.subject, html: input.html });
  if (error) throw new Error(error.message);
  return { id: data?.id ?? '' };
}
`;

const SENDGRID_HELPER = `import sgMail from '@sendgrid/mail';

// Bring-Your-Own SendGrid key — from app.sendgrid.com → Settings → API Keys, pasted into .env.
sgMail.setApiKey(process.env.SENDGRID_API_KEY as string);

export interface EmailInput {
  to: string | string[];
  subject: string;
  html: string;
  from?: string; // defaults to EMAIL_FROM (a VERIFIED sender in your SendGrid account)
}

// Send a transactional email. Throws on a provider error — callers should surface it, never swallow it.
export async function sendEmail(input: EmailInput): Promise<void> {
  const from = input.from ?? process.env.EMAIL_FROM;
  if (!from) throw new Error('EMAIL_FROM is not set — use a verified SendGrid sender');
  await sgMail.send({ to: input.to, from, subject: input.subject, html: input.html });
}
`;

function envBlock(pairs: Array<[string, string]>): string {
  return pairs.map(([k, note]) => `# ${note}\n${k}=`).join('\n') + '\n';
}

/** Generate a working BYO email-send helper for a provider. Deterministic; unknown provider → throws. */
export function generateEmailIntegration(provider: EmailProvider): EmailConfig {
  switch (provider) {
    case 'resend':
      return {
        provider, dependency: { name: 'resend', version: '^4' },
        envKeys: ['RESEND_API_KEY', 'EMAIL_FROM'],
        files: {
          'src/lib/email.ts': RESEND_HELPER,
          [ENV_EXAMPLE]: envBlock([['RESEND_API_KEY', 'Resend API key (resend.com → API Keys)'], ['EMAIL_FROM', 'A sender on a domain verified in Resend, e.g. hello@yourdomain.com']]),
        },
        instructions: 'Import { sendEmail } from "./lib/email" and call it from your server routes (signup, password reset, receipts). Verify your sending domain in Resend first. Your key stays in YOUR env; NavBharatAI never stores it.',
      };
    case 'sendgrid':
      return {
        provider, dependency: { name: '@sendgrid/mail', version: '^8' },
        envKeys: ['SENDGRID_API_KEY', 'EMAIL_FROM'],
        files: {
          'src/lib/email.ts': SENDGRID_HELPER,
          [ENV_EXAMPLE]: envBlock([['SENDGRID_API_KEY', 'SendGrid API key (Settings → API Keys)'], ['EMAIL_FROM', 'A verified SendGrid sender, e.g. hello@yourdomain.com']]),
        },
        instructions: 'Import { sendEmail } from "./lib/email" and call it from your server routes. Verify your sender identity in SendGrid first. Your key stays in YOUR env; NavBharatAI never stores it.',
      };
    default:
      throw new Error(`Unknown email provider: ${provider}`);
  }
}

/** Valid-provider guard for the tool layer. */
export function isEmailProvider(v: unknown): v is EmailProvider {
  return v === 'resend' || v === 'sendgrid';
}
