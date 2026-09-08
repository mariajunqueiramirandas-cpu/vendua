<script lang="ts">
  import { onMount, tick } from 'svelte';
  let {
    view,
  }: {
    view: {
      src: string;
      original: string;
      width: number;
      height: number;
      alt: string;
      caption: string;
    };
  } = $props();
  let dialog: HTMLDialogElement;
  let trigger = $state<HTMLButtonElement>();
  let opened = $state(false);
  let ready = $state(false);
  let zoom = $state(false);
  onMount(() => {
    ready = true;
  });
  function trapFocus(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll<HTMLElement>('button, [tabindex="0"]')];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  function close() {
    dialog.close();
  }
</script>

<figure>
  <div class="capture">
    <img src={view.src} width={view.width} height={view.height} alt={view.alt} loading="lazy" />
  </div>
  <figcaption>
    <span>{view.caption}</span>{#if ready}<button
        class="text-button"
        bind:this={trigger}
        onclick={async () => {
          zoom = false;
          opened = true;
          await tick();
          dialog.showModal();
        }}>Ampliar imagem <span aria-hidden="true">↗</span></button
      >{:else}<a href={view.original}>Ampliar imagem ↗</a>{/if}
  </figcaption>
</figure>
<dialog
  onkeydown={trapFocus}
  bind:this={dialog}
  onclose={() => {
    opened = false;
    trigger?.focus();
  }}
  aria-label="Captura ampliada do Quero Pudim Gourmet"
>
  <div class="viewer-toolbar">
    <button class="button small outline" aria-pressed={zoom} onclick={() => (zoom = !zoom)}
      >{zoom ? 'Ajustar à tela' : 'Ver tamanho original'}</button
    ><button class="button small" onclick={close}>Fechar <span aria-hidden="true">×</span></button>
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard focus enables scrolling a full-resolution capture with arrow keys.) -->
  <div
    class="viewer-scroll"
    tabindex="0"
    role="region"
    aria-label="Imagem ampliada; use as setas para percorrer no tamanho original"
  >
    {#if opened}<img
        class:zoom
        src={view.original}
        width={view.width}
        height={view.height}
        alt={view.alt}
      />{/if}
  </div>
  <p class="fine">{view.caption}</p>
</dialog>
