import { defineStorefront } from '@vendua/kernel';

export default defineStorefront({
  contract: 1,
  ring: 'stable',
  tokens: {
    color: {
      bg: '#FCFBF8',
      surface: '#FFFFFF',
      text: '#1A1714',
      muted: '#77705F',
      accent: '#B06010',
      onAccent: '#FCFBF8',
      danger: '#B3372F',
      success: '#3D7A4F',
    },
    font: {
      display: '"Newsreader", Georgia, serif',
      body: '"Inter Tight", system-ui, -apple-system, sans-serif',
      mono: '"Geist Mono", ui-monospace, SFMono-Regular, monospace',
    },
    radius: { sm: '2px', md: '8px', lg: '12px' },
    space: { scale: ['4px', '8px', '12px', '16px', '24px', '32px', '48px'] },
    motion: { duration: '200ms', easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  },
  overrides: {
    'system.Notice': () => import('./overrides/Notice.tsx'),
  },
  budgets: 'default',
});
