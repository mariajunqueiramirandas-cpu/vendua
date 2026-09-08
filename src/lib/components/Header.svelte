<script lang="ts">
  import { onMount } from 'svelte';
  let open = $state(false);
  let ready = $state(false);
  let toggle = $state<HTMLButtonElement>();
  onMount(() => {
    ready = true;
  });
  $effect(() => {
    if (!ready) return;
    document.body.classList.toggle('menu-visible', open);
    return () => document.body.classList.remove('menu-visible');
  });
  function escape(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      open = false;
      toggle?.focus();
    }
  }
</script>

<svelte:window onkeydown={escape} />
<a class="skip" href="#conteudo">Pular para o conteúdo</a>
<header class="header container">
  <a class="brand" href="/" aria-label="Venduá — início"
    ><img src="/assets/brand/mark-green.svg" width="36" height="36" alt="" />venduá<span
      class="brand-dot">.</span
    ></a
  >
  {#if ready}<button
      bind:this={toggle}
      class="menu-button"
      aria-expanded={open}
      aria-controls="navigation"
      aria-label={open ? 'Fechar menu' : 'Menu'}
      onclick={() => (open = !open)}
      ><span class="menu-label" aria-hidden="true">{open ? 'Fechar' : 'Menu'}</span>
      <span class="menu-icon" aria-hidden="true"><i></i><i></i></span></button
    >{#if open}<button
        class="menu-scrim"
        aria-label="Fechar menu"
        tabindex="-1"
        onclick={() => (open = false)}
      ></button>{/if}{/if}
  <nav id="navigation" aria-label="Principal" class:menu-open={open} class:enhanced={ready}>
    <a href="/#solucoes" onclick={() => (open = false)}>Soluções</a><a
      href="/#projeto"
      onclick={() => (open = false)}>Projeto real</a
    ><a href="/#processo" onclick={() => (open = false)}>Como funciona</a><a
      class="button small"
      href="/contato/"
      onclick={() => (open = false)}>Conversar <span aria-hidden="true">↗</span></a
    >
  </nav>
</header>
