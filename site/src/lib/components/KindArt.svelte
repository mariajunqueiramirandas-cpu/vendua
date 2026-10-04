<script lang="ts" module>
  export type Kind = 'bolo' | 'marmita' | 'burger' | 'pao';
</script>

<script lang="ts">
  // One drawing per kind of shop, inked in the admin's illustration style
  // (apps/admin/src/ui/illustrations.tsx): currentColor strokes so Noite recolours them, one lime
  // accent per drawing. Decorative: the text beside it says what it is.
  let { kind, class: cls = '' }: { kind: Kind; class?: string } = $props();
</script>

<svg
  class={cls}
  viewBox="0 0 160 120"
  fill="none"
  stroke="currentColor"
  stroke-width="2.4"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if kind === 'bolo'}
    <path d="M28 96c16 6 88 6 104 0" />
    <path d="M68 101l-3 11h30l-3-11" />
    <path d="M44 57v35c14 6 58 6 72 0V57" />
    <path
      d="M44 56c0 4 1 9 4 9s4-5 7-5 3 11 7 11 4-8 7-8 4 5 8 5 3-6 7-6 4 9 8 9 3-7 6-7 4 4 7 4 3-6 6-6c3 0 5-2 5-6 0-7-72-7-72 0z"
      fill="var(--spark)"
    />
    <path d="M48 80c14 4 50 4 64 0" stroke-width="2" stroke-dasharray="1 6" />
    <circle cx="80" cy="44" r="5" />
    <path d="M81 39c1-5 4-8 9-9" />
    <path d="M124 38l5-5M128 48h7M32 38l-5-5M28 48h-6" stroke-width="2" />
  {:else if kind === 'marmita'}
    <path d="M64 34c-4-5 4-9 0-14M80 30c-4-5 4-9 0-14M96 34c-4-5 4-9 0-14" stroke-width="2" />
    <path d="M40 58c1-9 9-13 16-11 4-6 14-6 18 1" />
    <path d="M50 52l3-1M59 49h3M62 55l3-1" stroke-width="2" />
    <path d="M86 58c2-7 10-10 16-8 5-4 14-2 18 8" />
    <circle cx="96" cy="54" r="1.8" fill="currentColor" stroke="none" />
    <circle cx="104" cy="52" r="1.8" fill="currentColor" stroke="none" />
    <circle cx="110" cy="56" r="1.8" fill="currentColor" stroke="none" />
    <path d="M68 57c3-10 15-14 23-10-2 9-13 13-23 10z" fill="var(--spark)" />
    <path d="M72 55c6-2 11-4 16-7" stroke-width="2" />
    <path d="M30 63c0-3 2-5 5-5h90c3 0 5 2 5 5" />
    <path d="M34 64l7 34c1 4 3 6 7 6h64c4 0 6-2 7-6l7-34" />
    <path d="M40 76c20 3 60 3 80 0" stroke-width="2" />
  {:else if kind === 'burger'}
    <path d="M40 64c0-20 18-32 40-32s40 12 40 32c0 3-2 4-5 4H45c-3 0-5-1-5-4z" />
    <path d="M62 46l4-2M78 41l4 1M94 46l4 2M70 55l4-1M88 55l4 1" stroke-width="2" />
    <path
      d="M36 70h88c0 5-3 7-5 5-3 4-7 4-10 0-3 4-7 4-10 0-3 4-7 4-10 0-3 4-7 4-10 0-3 4-7 4-10 0-3 4-7 4-10 0-3 4-7 4-10 0-3 4-7 4-10 0-2 2-5 0-3-5z"
      fill="var(--spark)"
    />
    <path d="M40 82c0-3 2-4 5-4h70c3 0 5 1 5 4v5c0 3-2 4-5 4H45c-3 0-5-1-5-4z" />
    <path d="M54 85h4M68 84h4M86 85h4M100 84h4" stroke-width="2" />
    <path d="M42 96h76c0 7-6 11-14 11H56c-8 0-14-4-14-11z" />
  {:else}
    <ellipse cx="80" cy="104" rx="50" ry="5" fill="var(--spark)" stroke="none" opacity=".7" />
    <path d="M90 53l33-33c3-3 8-2 9 2 1 2 0 4-2 6l-30 30" />
    <path d="M104 43l5 4M113 34l5 4M121 26l4 3" stroke-width="2" />
    <path d="M32 88c0-22 22-36 50-36s48 14 48 34c0 10-10 14-22 14H52c-12 0-20-4-20-12z" />
    <path d="M56 70c3 4 5 9 5 14M76 64c4 5 6 11 6 18M98 66c3 5 5 10 5 16" stroke-width="2" />
    <path d="M44 42c-3-4 3-7 0-11M56 36c-3-4 3-7 0-11" stroke-width="2" />
  {/if}
</svg>
