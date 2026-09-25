import { defineStorefront } from '@vendua/kernel';

// the always-green baseline every `vendua scaffold` copies — deliberately neutral tokens, not a brand
export default defineStorefront({
  contract: 1,
  ring: 'stable',
  tokens: {
    color: {
      bg: '#F7F6F4',
      surface: '#FFFFFF',
      text: '#1C1B1A',
      muted: '#6E6A64',
      accent: '#3F5E4E',
      onAccent: '#FFFFFF',
      danger: '#A33B32',
      success: '#3D7A4F',
    },
    font: {
      display: 'Georgia, "Times New Roman", serif',
      body: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    },
    radius: { sm: '4px', md: '8px', lg: '14px' },
    space: { scale: ['4px', '8px', '12px', '16px', '24px', '32px', '48px'] },
    motion: { duration: '180ms', easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  },
  budgets: 'default',
});
