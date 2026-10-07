<script lang="ts" generics="T extends string">
  // A row of choices on the control panel: native radios (arrow keys, works before hydration),
  // drawn as one switch with a lit position.
  let {
    legend,
    name,
    options,
    value = $bindable(),
    hint = '',
    min = 72,
  }: {
    legend: string;
    name: string;
    options: { value: T; label: string }[];
    value: T;
    hint?: string;
    /** narrowest a choice gets before the row wraps into a grid */
    min?: number;
  } = $props();
</script>

<fieldset class="seg">
  <legend>{legend}</legend>
  {#if hint}<p class="hint">{hint}</p>{/if}
  <div class="row" style="--min: {min}px">
    {#each options as o (o.value)}
      <label class:on={value === o.value}>
        <input type="radio" {name} value={o.value} bind:group={value} />
        <span>{o.label}</span>
      </label>
    {/each}
  </div>
</fieldset>

<style>
  .seg {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
    display: grid;
    gap: 8px;
  }
  legend {
    padding: 0;
    margin-bottom: 8px;
    font: 600 0.9375rem/1.3 var(--font-display);
    color: var(--ink);
  }
  .seg p.hint {
    margin: -4px 0 0;
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--ink-muted);
  }
  .row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(var(--min), 100%), 1fr));
    gap: 4px;
    padding: 4px;
    border-radius: 14px;
    background: var(--surface-sunken);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  label {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 44px;
    padding: 4px 8px;
    border-radius: 10px;
    font-size: 0.9375rem;
    font-weight: 600;
    line-height: 1.2;
    text-align: center;
    color: var(--ink-muted);
    cursor: pointer;
    transition:
      background var(--duration-quick) var(--ease-soft),
      color var(--duration-quick) var(--ease-soft);
  }
  label:hover {
    color: var(--ink);
  }
  label.on {
    background: var(--surface);
    color: var(--ink);
    box-shadow:
      0 0 0 1px var(--line-strong),
      0 1px 2px rgb(0 0 0 / 0.08);
  }
  input {
    position: absolute;
    inset: 0;
    opacity: 0;
    margin: 0;
    cursor: pointer;
  }
  label:has(input:focus-visible) {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    label {
      transition: none;
    }
  }
</style>
