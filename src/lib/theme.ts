export type ThemeMode = 'light' | 'dark' | 'dim' | 'comfort' | 'contrast';

export const THEME_MODES: { label: string; value: ThemeMode }[] = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
  { label: 'Dim Light', value: 'dim' },
  { label: 'Comfort', value: 'comfort' },
  { label: 'Contrast', value: 'contrast' },
];

export const getThemeClasses = (mode: ThemeMode): { bg: string; text: string; border: string; accent: string; card: string; raw: { bg: string; text: string; border: string; card: string } } => {
  switch (mode) {
    case 'light': 
      return { 
        bg: 'bg-[#f8fafc]', 
        text: 'text-[#0f172a]', 
        border: 'border-[#e2e8f0]', 
        accent: 'text-indigo-600',
        card: 'bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]',
        raw: { bg: '#f8fafc', text: '#0f172a', border: '#e2e8f0', card: '#ffffff' }
      };
    case 'dark': 
      return { 
        bg: 'bg-[#0d1117]', 
        text: 'text-[#c9d1d9]', 
        border: 'border-white/10', 
        accent: 'text-indigo-400',
        card: 'bg-[#161b22] border-white/5',
        raw: { bg: '#0d1117', text: '#c9d1d9', border: 'rgba(255,255,255,0.1)', card: '#161b22' }
      };
    case 'dim': 
      return { 
        bg: 'bg-[#15202b]', 
        text: 'text-[#f7f9f9]', 
        border: 'border-[#38444d]', 
        accent: 'text-[#1d9bf0]',
        card: 'bg-[#1c2732] border-[#38444d]',
        raw: { bg: '#15202b', text: '#f7f9f9', border: '#38444d', card: '#1c2732' }
      };
    case 'comfort': 
      return { 
        bg: 'bg-[#fdf6e3]', 
        text: 'text-[#657b83]', 
        border: 'border-[#eee8d5]', 
        accent: 'text-[#268bd2]',
        card: 'bg-[#eee8d5] border-[#dfd9c6]',
        raw: { bg: '#fdf6e3', text: '#657b83', border: '#eee8d5', card: '#eee8d5' }
      };
    case 'contrast': 
      return { 
        bg: 'bg-black', 
        text: 'text-[#ffff00]', 
        border: 'border-[#ffff00]', 
        accent: 'text-white',
        card: 'bg-black border-2 border-[#ffff00]',
        raw: { bg: '#000000', text: '#ffff00', border: '#ffff00', card: '#000000' }
      };
    default: 
      return { 
        bg: 'bg-[#0d1117]', 
        text: 'text-white', 
        border: 'border-white/5', 
        accent: 'text-indigo-400',
        card: 'bg-[#161b22]',
        raw: { bg: '#0d1117', text: '#ffffff', border: 'rgba(255,255,255,0.05)', card: '#161b22' }
      };
  }
};
