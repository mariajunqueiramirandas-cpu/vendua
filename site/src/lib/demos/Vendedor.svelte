<script lang="ts">
  import DemoFrame from './DemoFrame.svelte';
  import Chat from './vendedor/Chat.svelte';
</script>

<DemoFrame
  label="Conversa de exemplo com a Ana, a vendedora da Bolos da Nena no WhatsApp"
  note="Simulação: na sua loja, a Ana responde com o seu cardápio e os seus preços."
>
  {#snippet children({ live, reduced })}
    <!-- the {#if} remounts on hydration, so the live chat starts from its first message -->
    {#if live}
      <Chat live {reduced} />
    {:else}
      <Chat live={false} {reduced} />
    {/if}
  {/snippet}
</DemoFrame>
