<script lang="ts">
  import { page } from '$app/state';
  import NotFound from '$lib/components/NotFound.svelte';
</script>

{#if page.status === 404}<NotFound />{:else}<section class="container error-page">
    <h1>Algo falhou deste lado.</h1>
    <p>Tente de novo. Se continuar, volte ao início e entre pelo direct.</p>
    <a href="/" class="button">Voltar ao início</a>
  </section>{/if}
