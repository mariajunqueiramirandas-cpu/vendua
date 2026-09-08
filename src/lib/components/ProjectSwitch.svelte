<script lang="ts">
  import { onMount } from 'svelte';
  import { project } from '$lib/content/project';
  import ImageViewer from './ImageViewer.svelte';
  let active = $state(0);
  let ready = $state(false);
  let tabs: HTMLButtonElement[] = [];
  onMount(() => {
    ready = true;
  });
  function key(event: KeyboardEvent, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    active = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (index + 1) % 2;
    tabs[active].focus();
  }
</script>

{#if ready}<div class="tabs" role="tablist" aria-label="Dois lados da mesma loja">
    {#each project.views as view, i}<button
        bind:this={tabs[i]}
        role="tab"
        id={'tab-' + view.id}
        aria-controls={'panel-' + view.id}
        aria-selected={active === i}
        tabindex={active === i ? 0 : -1}
        onclick={() => (active = i)}
        onkeydown={(e) => key(e, i)}>{view.label}</button
      >{/each}
  </div>{/if}
{#each project.views as view, i}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (The enhanced panel implements the APG tabs pattern.) -->
  <section
    class="project-panel"
    id={'panel-' + view.id}
    role={ready ? 'tabpanel' : undefined}
    aria-labelledby={ready ? 'tab-' + view.id : undefined}
    tabindex={ready ? 0 : undefined}
    hidden={ready && active !== i}
  >
    <div class="panel-intro">
      <div>
        <p class="eyebrow">Quero Pudim Gourmet · {view.label}</p>
        <h3>{view.title}</h3>
        <p>{view.text}</p>
      </div>
      <ul class="benefits">
        {#each view.benefits as benefit}<li><span aria-hidden="true">✓</span> {benefit}</li>{/each}
      </ul>
    </div>
    <ImageViewer {view} />
  </section>
{/each}
