<script lang="ts">
  import { onMount } from 'svelte';

  let dark = $state(false);

  onMount(() => {
    dark = document.documentElement.dataset.theme === 'dark';
  });

  const toggleTheme = () => {
    dark = !dark;
    const h = document.documentElement;
    const freeze = document.createElement('style');
    freeze.append(document.createTextNode('*,*::before,*::after{transition:none !important}'));
    document.head.append(freeze);
    if (dark) h.dataset.theme = 'dark';
    else delete h.dataset.theme;
    try {
      localStorage.setItem('vnd-theme', dark ? 'dark' : 'light');
    } catch {}
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#0a100d' : '#f7f4ea');
    window.dispatchEvent(new Event('vnd:theme'));
    void document.body.offsetHeight;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => freeze.remove());
    });
  };
</script>

<a class="skip" href="#conteudo">Pular para o conteúdo</a>
<div class="header-bar">
  <header class="header container">
    <a class="brand" href="/" aria-label="Venduá · início"
      ><img
        class="mark mark-light"
        src="/assets/brand/mark-green.svg"
        width="36"
        height="36"
        alt=""
      /><img
        class="mark mark-dark"
        src="/assets/brand/mark-lime.svg"
        width="36"
        height="36"
        alt=""
      />venduá<span class="brand-dot">.</span></a
    >
    <nav id="navigation" aria-label="Principal">
      <span class="dev-status"><span class="signal-dot"></span>Em desenvolvimento</span>
      <button
        class="theme-toggle"
        type="button"
        onclick={toggleTheme}
        aria-pressed={dark}
        aria-label="Alternar entre tema claro e escuro"
        ><span class="tt-label">{dark ? 'Claro' : 'Escuro'}</span></button
      >
      <a class="button small" href="/contato/">Acesso <span aria-hidden="true">↗</span></a>
    </nav>
  </header>
</div>
