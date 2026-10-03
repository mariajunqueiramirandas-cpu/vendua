<script lang="ts">
  import DemoFrame from './DemoFrame.svelte';
  import Board from './cozinha/Board.svelte';
</script>

<DemoFrame label="Simulação da tela da cozinha" note="Exemplo com pedidos da Bolos da Nena.">
  {#snippet children({ live, reduced })}
    <Board {live} {reduced} />
  {/snippet}
</DemoFrame>
