<script lang="ts">
  import DemoFrame from './DemoFrame.svelte';
  import Builder from './loja/Builder.svelte';
</script>

<DemoFrame
  label="Simulação: o Duá monta a loja Bolos da Nena"
  note="Exemplo: na sua loja, é o seu nome, as suas cores e o seu cardápio."
>
  {#snippet children({ live, reduced })}
    <Builder {live} {reduced} />
  {/snippet}
</DemoFrame>
