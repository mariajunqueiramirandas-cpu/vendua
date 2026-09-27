import { defineStorefront } from '@vendua/kernel/config';

// Tokens mirror the brand and feed the Kernel's --v-* emission. They are the
// repo default; once seeded, the store's tokens live in Core (a staff/merchant
// edit there triggers the rebuild).
export default defineStorefront({
  contract: 2,
  ring: 'stable',
  tokens: {
    color: {
      bg: '#FCFBF8',
      surface: '#FFFFFF',
      text: '#1A1714',
      muted: '#77705F',
      // #B06010 read 4.48:1 against onAccent — just under AA; the build gate blocks that
      accent: '#AC5E10',
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
    // the brand notice also takes the paused slot
    'system.StorePausedNotice': () => import('./overrides/Notice.tsx'),
  },
  paths: { catalog: '/catalog' },
  // URLs printed on menus and shared before Contract 2
  redirects: { '/cart': '/sacola', '/meus-pedidos': '/pedidos' },
  budgets: 'default',
});
