<script lang="ts">
  import '@fontsource-variable/figtree/wght.css';
  import '@fontsource-variable/space-grotesk/wght.css';
  import '$lib/styles/theme.css';
  import '$lib/styles/base.css';
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { trackPageview } from '$lib/analytics';
  import { startGoogleTag } from '$lib/gtag';

  let { children }: { children: Snippet } = $props();

  afterNavigate(trackPageview);
  onMount(startGoogleTag);
</script>

<a class="skip" href="#conteudo">Pular para o conteúdo</a>
{@render children()}
