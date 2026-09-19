import { defineStorefront } from '@vendua/kernel';

export default defineStorefront({
  contract: 1,
  ring: 'stable',
  tokens: {
    color: {
      // Flour paper, case-card cream, roast ink, crust ember.
      bg: '#f2e9d5',
      surface: '#fdf8ec',
      text: '#2c2115',
      muted: '#8e7d63',
      accent: '#b2531c',
      onAccent: '#fdf3e4',
      danger: '#9e3524',
      success: '#567a46',
    },
    font: {
      display: "'Fraunces Variable', Georgia, 'Times New Roman', serif",
      body: "'Fraunces Variable', Georgia, 'Times New Roman', serif",
      mono: "'IBM Plex Mono', 'Courier New', monospace",
    },
    radius: { sm: '4px', md: '10px', lg: '18px' },
    space: { scale: ['0', '4px', '8px', '12px', '16px', '24px', '32px', '48px', '64px'] },
    motion: { duration: '180ms', easing: 'cubic-bezier(0.22, 0.68, 0.32, 1)' },
  },
  overrides: {
    // The closed state is this storefront's core surface — restyle it as a
    // lit shop sign instead of the generic token-styled banner.
    'system.StoreClosedNotice': () => import('./overrides/StoreClosedNotice'),
  },
  routes: './routes',
  budgets: 'default',
});
