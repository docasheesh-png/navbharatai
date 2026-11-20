/**
 * Q-2769 (BR2002): JOURNEY_NOT_DERIVED told the admin a business site's form fields had "no name, id, placeholder,
 * label or test id" and to add them, while ACCESSIBILITY scored the same files 100/100. The contact form drew its
 * inputs from a `FormField[]` list (`name={field.name}`) — named and labelled, but by expressions this check cannot
 * read from source. The sentence now says that, and the false remedy is kept for forms that really lack names.
 */
import { describe, it, expect } from 'vitest';
import { noJourneyReason } from '../src/server/AgentV3/journeyDerivation';

const APP = `import ContactSection from './components/ContactSection';
const App = () => {
  const handleContactSubmit = (data: Record<string, string>) => { console.log('Contact form submitted:', data); };
  return <main><ContactSection onSubmit={handleContactSubmit} /></main>;
};
export default App;`;

const CONTACT_FROM_LIST = `import type { FormField } from '../types';
const fields: FormField[] = [
  { name: 'name', label: 'Your name', type: 'text', required: true },
  { name: 'email', label: 'Email', type: 'email', required: true },
];
export default function ContactSection({ onSubmit }: { onSubmit: (d: Record<string, string>) => void }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({}); }}>
      {fields.map((field) => (
        <div key={field.name}>
          <label htmlFor={field.name}>{field.label}</label>
          <input id={field.name} name={field.name} type={field.type} placeholder={field.placeholder} required={field.required} />
        </div>
      ))}
      <button type="submit">Send message</button>
    </form>
  );
}`;

const CONTACT_UNNAMED = CONTACT_FROM_LIST
  .replace('<label htmlFor={field.name}>{field.label}</label>', '')
  .replace('<input id={field.name} name={field.name} type={field.type} placeholder={field.placeholder} required={field.required} />', '<input type="text" />');

const files = (contact: string) => ({ 'src/App.tsx': APP, 'src/components/ContactSection.tsx': contact, 'src/main.tsx': "import App from './App';" });

describe('a form drawn from a list is not called unnamed', () => {
  it('the reported shape: says the names come from a list, and asks for no change', () => {
    const reason = noJourneyReason(files(CONTACT_FROM_LIST));
    expect(reason).toContain('src/components/ContactSection.tsx');
    expect(reason).toContain('limit of this check, not a defect in the app');
    expect(reason).not.toContain('no name, id, placeholder');
    expect(reason).not.toContain('Give each field a `name`');
  });

  it('a form whose fields really carry nothing keeps the remedy', () => {
    const reason = noJourneyReason(files(CONTACT_UNNAMED));
    expect(reason).toContain('no name, id, placeholder, label or test id');
  });
});
