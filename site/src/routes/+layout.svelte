<script lang="ts">
  import '@fontsource-variable/figtree/wght.css';
  import '@fontsource-variable/space-grotesk/wght.css';
  import '@fontsource/instrument-serif/latin-400-italic.css';
  import '$lib/styles/theme.css';
  import '$lib/styles/base.css';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<a class="skip" href="#conteudo">Pular para o conteúdo</a>
{@render children()}
