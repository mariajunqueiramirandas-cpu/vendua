<script lang="ts">
  import DemoFrame from '$lib/demos/DemoFrame.svelte';
  import PairSteps from './PairSteps.svelte';

  // Pairing, after the device-code flow of docs/adr/0027-print-agents.md: the app asks Core for a
  // code (8 letters and numbers, valid 10 minutes: packages/core/src/modules/printing/devices.ts
  // PAIRING_TTL_S), a manager types it in Impressoras and the app collects its credential.
</script>

<DemoFrame
  label="Simulação: conectar o app Venduá Impressora à loja"
  note="Simulação. Toque em conectar, no painel, para aprovar."
>
  {#snippet children({ live })}
    <PairSteps {live} />
  {/snippet}
</DemoFrame>
