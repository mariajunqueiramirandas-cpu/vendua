<script lang="ts">
  import { page } from '$app/state';
  import NotFound from '$lib/components/NotFound.svelte';
</script>

{#if page.status === 404}<NotFound />{:else}<section class="container error-page">
    <h1>Não foi possível abrir esta página.</h1>
    <p>Tente novamente ou volte ao início.</p>
    <a href="/" class="button">Voltar ao início</a>
  </section>{/if}
