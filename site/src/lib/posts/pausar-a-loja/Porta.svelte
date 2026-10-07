<script lang="ts">
  import DemoFrame from '$lib/demos/DemoFrame.svelte';
  import Cena from './Cena.svelte';
</script>

<div class="porta-fig">
  <DemoFrame
    label="Simulação: a Nena pausa a Bolos da Nena e a loja muda na porta"
    note="Simulação com a Bolos da Nena, sábado às 13:30, com os textos e as regras reais da loja."
  >
    {#snippet children({ reduced })}
      <Cena {reduced} />
    {/snippet}
  </DemoFrame>
</div>

<style>
  .porta-fig {
    margin-block: 12px;
    padding: 18px 14px 10px;
    border-radius: var(--radius-lg);
    background: var(--surface-sunken);
  }
  @media (min-width: 600px) {
    .porta-fig {
      padding: 22px 20px 12px;
    }
  }
</style>
