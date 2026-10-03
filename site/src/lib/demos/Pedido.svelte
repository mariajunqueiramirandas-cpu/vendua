<script lang="ts">
  import DemoFrame from './DemoFrame.svelte';
  import Play from './pedido/Play.svelte';

  // "Pedido chega": the push on the store's phone, accept with a prep time, move the order along, and
  // watch the customer's order page follow. Without JavaScript: the order already delivered.
</script>

<DemoFrame label="Pedido chega" note="Exemplo com um pedido da Bolos da Nena.">
  {#snippet children({ live, reduced })}
    {#if live}
      <Play {reduced} />
    {:else}
      <Play final />
    {/if}
  {/snippet}
</DemoFrame>
