import { defineStorefront } from '@vendua/kernel/config';

// the baseline every store without its own bundle wears, and every `vendua scaffold` copies:
// Venduá's own paper-and-forest palette, so a brand-new store already feels like a finished app
export default defineStorefront({
  contract: 2,
  tokens: {
    color: {
      bg: '#F7F4EA',
      surface: '#FFFDF8',
      text: '#123C32',
      muted: '#4F6A5E',
      accent: '#123C32',
      onAccent: '#FFFDF8',
      danger: '#B3261E',
      success: '#1F7A4D',
    },
    font: {
      display: '"Space Grotesk Variable", system-ui, sans-serif',
      body: '"Figtree Variable", system-ui, -apple-system, "Segoe UI", sans-serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    },
    radius: { sm: '10px', md: '16px', lg: '24px' },
    space: { scale: ['4px', '8px', '12px', '16px', '24px', '32px', '48px'] },
    motion: { duration: '180ms', easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  },
  paths: { catalog: '/cardapio' },
  budgets: 'default',
});
