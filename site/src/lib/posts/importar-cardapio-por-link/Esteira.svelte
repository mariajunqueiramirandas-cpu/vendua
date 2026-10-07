<script lang="ts">
  import DemoFrame from '$lib/demos/DemoFrame.svelte';
  import Belt from './Belt.svelte';
</script>

<div class="esteira">
  <DemoFrame
    label="Simulação: o cardápio da Bolos da Nena vindo por um link"
    note="Simulação com a Bolos da Nena, com as palavras da tela de importar."
  >
    {#snippet children({ live, reduced })}
      <Belt {live} {reduced} />
    {/snippet}
  </DemoFrame>
</div>

<style>
  .esteira {
    min-width: 0;
    max-width: 100%;
    margin-block: 12px;
    padding: 18px;
    border-radius: var(--radius-lg);
    background: var(--surface-sunken);
  }
  .esteira :global(figcaption) {
    max-width: none;
  }
  @media (max-width: 420px) {
    .esteira {
      padding: 14px 12px;
    }
  }
</style>
