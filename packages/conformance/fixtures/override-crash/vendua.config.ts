import { defineStorefront } from '@vendua/kernel/config';

// Conformance fixture for S05: every override here throws at render. The Kernel
// must render its defaults instead and report each failure. The paused notice
// is registered under its deprecated alias to prove the alias window too.
export default defineStorefront({
  contract: 2,
  tokens: {
    color: {
      bg: '#FFFFFF',
      surface: '#FFFFFF',
      text: '#111111',
      muted: '#555555',
      accent: '#224466',
      onAccent: '#FFFFFF',
      danger: '#A33B32',
      success: '#3D7A4F',
    },
    font: { display: 'Georgia, serif', body: 'system-ui, sans-serif' },
    radius: { sm: '2px', md: '6px', lg: '10px' },
    space: { scale: 1 },
    motion: { duration: '150ms', easing: 'ease' },
  },
  overrides: {
    'system.Notice': () => import('./overrides/Throws.tsx'),
    'system.PromoNotice': () => import('./overrides/Throws.tsx'),
    'system.StorePausedNotice': () => import('./overrides/Throws.tsx'),
    'catalog.ProductCard': () => import('./overrides/Throws.tsx'),
  },
});
