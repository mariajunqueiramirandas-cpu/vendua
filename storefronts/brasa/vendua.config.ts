import { defineStorefront } from '@vendua/kernel';

// Brasa Burger — a smash-burger bar in Rio's Zona Portuária. Night service,
// chapa, port-side industrial warmth. Tokens drive the Kernel's system
// surfaces AND the storefront's own styles (--v-* vars on :root).
export default defineStorefront({
  contract: 1,
  ring: 'stable',
  tokens: {
    color: {
      bg: '#151210', // soot — the room at night
      surface: '#221c15', // raised steel / charred wood
      text: '#f2e7d0', // butcher paper
      muted: '#a08f76', // ash
      accent: '#ff5a1f', // ember
      onAccent: '#1a0f07', // char on ember
      danger: '#e0452c',
      success: '#9cbf60', // "chapa acesa" signal green
    },
    font: {
      display: "'Big Shoulders Stencil Display', 'Arial Narrow', sans-serif",
      body: "'Archivo', system-ui, sans-serif",
      mono: "'IBM Plex Mono', ui-monospace, monospace",
    },
    radius: { sm: '2px', md: '4px', lg: '8px' },
    space: { scale: ['4px', '8px', '12px', '16px', '24px', '32px', '48px', '64px'] },
    motion: { duration: '160ms', easing: 'cubic-bezier(.2,.7,.2,1)' },
  },
  budgets: 'default',
});
