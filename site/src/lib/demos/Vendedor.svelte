<script lang="ts">
  import DemoFrame from './DemoFrame.svelte';
  import Chat from './vendedor/Chat.svelte';
</script>

<DemoFrame
  label="Conversa de exemplo no WhatsApp da Bolos da Nena, atendida pelo Duá"
  note="Simulação: na sua loja, o Duá responde com o seu cardápio e os seus preços."
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
