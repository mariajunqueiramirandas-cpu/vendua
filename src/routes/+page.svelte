<script lang="ts">
  import { onMount, tick } from 'svelte';
  import gsap from 'gsap';
  import { ScrollTrigger } from 'gsap/ScrollTrigger';
  import Seo from '$lib/components/Seo.svelte';
  import Closing from '$lib/components/Closing.svelte';
  import HeroShader from '$lib/components/HeroShader.svelte';
  import TxShader from '$lib/components/TxShader.svelte';
  import { site, signals, manifesto, transmissions, ritual, teaserFaqs } from '$lib/content/site';

  let root = $state<HTMLElement>();
  let dialogEl = $state<HTMLDialogElement>();
  let activeTx = $state<(typeof transmissions)[number]>();
  let lastTrigger: HTMLElement | null = null;

  const openTx = async (i: number) => {
    activeTx = transmissions[i];
    lastTrigger = document.activeElement as HTMLElement;
    await tick();
    if (!dialogEl) return;
    dialogEl.showModal();
    document.body.style.overflow = 'hidden';
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.fromTo(
      dialogEl,
      { opacity: 0, y: 30, scale: 0.96 },
      { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: 'power3.out' },
    );
    gsap.fromTo(
      '.tx-modal-head, .tx-modal-title, .tx-modal-detail, .tx-specs div, .tx-modal-foot',
      { opacity: 0, y: 12, filter: 'blur(4px)' },
      {
        opacity: 1,
        y: 0,
        filter: 'blur(0px)',
        duration: 0.5,
        stagger: 0.1,
        ease: 'power2.out',
        delay: 0.08,
      },
    );
  };

  const onClosed = () => {
    document.body.style.overflow = '';
    lastTrigger?.focus();
  };

  const closeTx = () => {
    const d = dialogEl;
    if (!d) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      d.close();
      return;
    }
    gsap.to(d, {
      opacity: 0,
      y: -12,
      filter: 'blur(4px)',
      duration: 0.15,
      ease: 'power2.out',
      overwrite: true,
      onComplete: () => {
        d.close();
        gsap.set(d, { clearProps: 'all' });
      },
    });
  };

  const onCancel = (e: Event) => {
    e.preventDefault();
    closeTx();
  };

  const onModalBackdrop = (e: MouseEvent) => {
    if (e.target === dialogEl) closeTx();
  };

  onMount(() => {
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize: true });
    const mm = gsap.matchMedia(root);
    mm.add({ reduce: '(prefers-reduced-motion: reduce)', desktop: '(min-width: 961px)' }, (ctx) => {
      const { reduce, desktop } = ctx.conditions as { reduce: boolean; desktop: boolean };
      if (reduce || !root) return;

      gsap.to('.scroll-progress', {
        scaleX: 1,
        ease: 'none',
        scrollTrigger: { trigger: root, start: 'top top', end: 'bottom bottom', scrub: 0.3 },
      });
      const veil = document.querySelector<HTMLElement>('.intro-veil');
      const introDelay = veil && getComputedStyle(veil).display !== 'none' ? 1.5 : 0;

      gsap
        .timeline({ defaults: { ease: 'power3.out' }, delay: introDelay })
        .from('.hero-gl', { opacity: 0, scale: 1.08, duration: 1.8, ease: 'power2.out' }, 0)
        .from('.hero-top > *', { opacity: 0, y: -14, duration: 0.7, stagger: 0.08 }, 0.15)
        .from('.line-mask > span', { yPercent: 115, duration: 1.1, stagger: 0.11 }, 0.3)
        .from('.hero-bottom > *', { opacity: 0, y: 22, duration: 0.8, stagger: 0.12 }, 0.8)
        .from('.scroll-cue', { opacity: 0, duration: 0.9 }, 1.1);

      gsap.fromTo(
        '.hero-inner',
        { yPercent: 0 },
        {
          yPercent: -12,
          ease: 'none',
          scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
        },
      );
      gsap.fromTo(
        '.hero-gl',
        { yPercent: 0, opacity: 1 },
        {
          yPercent: 16,
          opacity: 0.2,
          ease: 'none',
          scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
        },
      );

      gsap.from('.signal-item', {
        opacity: 0,
        y: 40,
        stagger: 0.12,
        duration: 0.7,
        ease: 'power2.out',
        scrollTrigger: { trigger: '.signals', start: 'top 80%' },
      });

      gsap.from('.manifesto .eyebrow', {
        opacity: 0,
        y: 20,
        duration: 0.7,
        ease: 'power2.out',
        scrollTrigger: { trigger: '.manifesto', start: 'top 70%' },
      });
      const manifestoText = root.querySelector('.manifesto-text');
      if (manifestoText) {
        const words = (manifestoText.textContent || '').trim().split(/\s+/);
        manifestoText.innerHTML = words
          .map(
            (w, i) => `<span class="mword${i === words.length - 1 ? ' accent' : ''}">${w}</span>`,
          )
          .join(' ');
        const mwords = root.querySelectorAll('.mword');
        gsap.set(mwords, { opacity: 0.16 });
        gsap
          .timeline({
            scrollTrigger: {
              trigger: '.manifesto',
              start: 'top top',
              end: '+=105%',
              pin: true,
              scrub: 0.4,
              anticipatePin: 1,
            },
          })
          .to(mwords, { opacity: 1, stagger: 0.05, ease: 'none' })
          .from('.manifesto .fine', { opacity: 0, y: 16, ease: 'none' }, '>-0.15');
      }

      const track = root.querySelector<HTMLElement>('.tx-track');
      if (track && desktop) {
        const distance = () => track.scrollWidth - window.innerWidth;
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: '.tx-stage',
            start: 'top top',
            end: () => `+=${distance() + innerHeight * 0.38}`,
            pin: true,
            scrub: 0.5,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        });
        tl.to(track, { x: () => -distance(), ease: 'none', duration: 100 });
        tl.to(track, { y: -72, opacity: 0, ease: 'power1.in', duration: 20 });
        const hTween = tl.getChildren(false, true, false)[0] as gsap.core.Tween;
        root.querySelectorAll('.tx-frame .tx-gl').forEach((img) => {
          gsap.fromTo(
            img,
            { xPercent: -5, scale: 1.12 },
            {
              xPercent: 5,
              scale: 1.12,
              ease: 'none',
              scrollTrigger: {
                trigger: img.closest('.tx-panel') as Element,
                containerAnimation: hTween,
                start: 'left right',
                end: 'right left',
                scrub: true,
              },
            },
          );
        });
        root.querySelectorAll('.tx-ghost').forEach((ghost) => {
          gsap.fromTo(
            ghost,
            { xPercent: 12 },
            {
              xPercent: -12,
              ease: 'none',
              scrollTrigger: {
                trigger: ghost.closest('.tx-panel') as Element,
                containerAnimation: hTween,
                start: 'left right',
                end: 'right left',
                scrub: true,
              },
            },
          );
        });
      } else if (track) {
        gsap.utils.toArray('.tx-panel').forEach((panel) => {
          gsap.from(panel as Element, {
            opacity: 0,
            y: 48,
            duration: 0.8,
            ease: 'power2.out',
            scrollTrigger: { trigger: panel as Element, start: 'top 85%' },
          });
        });
      }

      gsap.from('.ritual-head', {
        opacity: 0,
        y: 36,
        duration: 0.8,
        ease: 'power2.out',
        scrollTrigger: { trigger: '.ritual', start: 'top 78%' },
      });
      gsap.from('.ritual-row', {
        opacity: 0,
        y: 40,
        stagger: 0.14,
        duration: 0.7,
        ease: 'power2.out',
        scrollTrigger: { trigger: '.ritual', start: 'top 75%' },
      });
      gsap.from('.teaser-faq details', {
        opacity: 0,
        y: 24,
        stagger: 0.08,
        duration: 0.6,
        ease: 'power2.out',
        scrollTrigger: { trigger: '.teaser-faq', start: 'top 80%' },
      });
      gsap.from('.closing-inner > *', {
        opacity: 0,
        y: 34,
        stagger: 0.09,
        duration: 0.8,
        ease: 'power2.out',
        scrollTrigger: { trigger: '.closing', start: 'top 70%' },
      });
    });

    const onSummary = (e: Event) => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      e.preventDefault();
      const details = (e.currentTarget as HTMLElement).parentElement as HTMLDetailsElement;
      const body = details.querySelector('.faq-body') as HTMLElement;
      if (details.open) {
        gsap.to(body, {
          height: 0,
          opacity: 0,
          duration: 0.4,
          ease: 'power2.out',
          overwrite: true,
          onComplete: () => {
            details.open = false;
            gsap.set(body, { clearProps: 'all' });
          },
        });
      } else {
        details.open = true;
        gsap.fromTo(
          body,
          { height: 0, opacity: 0 },
          {
            height: 'auto',
            opacity: 1,
            duration: 0.55,
            ease: 'power3.out',
            overwrite: true,
            onComplete: () => gsap.set(body, { clearProps: 'all' }),
          },
        );
      }
    };
    const summaries = root?.querySelectorAll('.teaser-faq summary') ?? [];
    summaries.forEach((s) => s.addEventListener('click', onSummary));

    return () => {
      mm.revert();
      summaries.forEach((s) => s.removeEventListener('click', onSummary));
    };
  });
</script>

<Seo
  title="Venduá — em desenvolvimento"
  description="A próxima loja não vem de prateleira. É projetada para o seu negócio. A Venduá segue em desenvolvimento — o acesso antecipado é pelo direct."
/>
<div bind:this={root}>
  <div class="scroll-progress" aria-hidden="true"></div>
  <section class="hero">
    <HeroShader />
    <div class="hero-inner container">
      <div class="hero-top">
        <p class="eyebrow">
          <span class="signal-dot"></span>Sinal 01 · Em desenvolvimento · Lançamento em breve
        </p>
        <p class="hero-meta">
          VND//WORK —
          <a
            class="hero-coords"
            href="https://www.google.com/maps/place/Par%C3%B3quia+Nossa+Senhora+de+Nazareth/@-22.9368365,-42.4931146,19.25z/data=!4m12!1m5!3m4!2zMjLCsDU2JzEyLjIiUyA0MsKwMjknMzMuOCJX!8m2!3d-22.936731!4d-42.492717!3m5!1s0x975f36efe0ca53:0x79108549f256b0db!8m2!3d-22.9368695!4d-42.4926159!16s%2Fg%2F11f5tfffbv"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Ver localização no Google Maps">22°56'12.23"S 42°29'33.78"W</a
          >
        </p>
      </div>
      <h1>
        <span class="line-mask"><span>A próxima loja</span></span>
        <span class="line-mask"><span>não vem de <em class="stroke">prateleira.</em></span></span>
        <span class="line-mask"><span class="serif">É projetada para você.</span></span>
      </h1>
      <div class="hero-bottom">
        <p class="intro">
          A Venduá está trocando o feito à mão por algo que ainda não tem nome público — e que segue
          em desenvolvimento. O lançamento vem depois; os detalhes ficam com quem entrar primeiro.
        </p>
        <div class="hero-cta">
          <a class="button" href={site.instagramDmUrl} target="_blank" rel="noreferrer"
            >Pedir acesso <span aria-hidden="true">↗</span><span class="sr-only">(nova aba)</span
            ></a
          >
          <p class="fine">
            <span>Lista do lançamento</span><span>convites apenas pelo direct</span><span
              >@vendua.digital</span
            >
          </p>
        </div>
      </div>
    </div>
    <p class="scroll-cue" aria-hidden="true"><span>Scroll</span></p>
  </section>
  <section class="signals container" aria-labelledby="signals-title">
    <p class="eyebrow" id="signals-title">O que já pode ser dito</p>
    <div class="signals-grid">
      {#each signals as item, i}<div class="signal-item">
          <span class="signal-number">0{i + 1}</span>
          <div>
            <h2>{item[0]}</h2>
            <p>{item[1]}</p>
          </div>
        </div>{/each}
    </div>
  </section>
  <section class="manifesto" aria-labelledby="manifesto-title">
    <div class="manifesto-inner container">
      <p class="eyebrow" id="manifesto-title">Manifesto</p>
      <p class="manifesto-text">{manifesto}</p>
      <p class="fine">Venduá · próximo capítulo</p>
    </div>
  </section>
  <section class="transmissions" aria-labelledby="tx-title">
    <div class="tx-head container">
      <p class="eyebrow" id="tx-title">Interceptado · Fragmentos</p>
      <h2>Sinais do sistema<br />em desenvolvimento.</h2>
    </div>
    <div class="tx-stage">
      <div class="tx-track">
        <article class="tx-panel tx-intro">
          <p class="eyebrow">Três fragmentos</p>
          <h3>A peça inteira<br />só existe para<br />quem entra.</h3>
        </article>
        {#each transmissions as t, i}<figure class="tx-panel">
            <span class="tx-ghost" aria-hidden="true">0{i + 1}</span>
            <div class="tx-card">
              <div class="tx-card-head" aria-hidden="true">
                <span>{t.id} · Fragmento</span><span class="tx-open-hint">Abrir ↗</span>
              </div>
              <div class="tx-frame"><TxShader mode={i} /></div>
              <button
                class="tx-hit"
                type="button"
                onclick={() => openTx(i)}
                aria-label={`${t.title} — como funciona`}><span class="sr-only">Abrir</span></button
              >
            </div>
            <figcaption>
              <span class="tx-id">{t.id}</span>
              <span class="tx-title">{t.title}</span>
              <span class="tx-caption-text">{t.text}</span>
            </figcaption>
          </figure>{/each}
      </div>
    </div>
  </section>
  <section class="ritual container" aria-labelledby="ritual-title">
    <div class="ritual-head">
      <p class="eyebrow" id="ritual-title">O ritual</p>
      <h2>Três passos.<br />Nenhum formulário.</h2>
    </div>
    {#each ritual as item, i}<div class="ritual-row">
        <span class="ritual-index">0{i + 1}</span>
        <h3>{item[0]}</h3>
        <p>{item[1]}</p>
      </div>{/each}
  </section>
  <section class="teaser-faq container" aria-labelledby="faq-title">
    <div>
      <p class="eyebrow" id="faq-title">Perguntas que aceitamos</p>
      <h2>Poucas<br />respostas.</h2>
    </div>
    <div>
      {#each teaserFaqs as faq}<details>
          <summary>{faq[0]}<span class="faq-plus" aria-hidden="true">+</span></summary>
          <div class="faq-body"><p>{faq[1]}</p></div>
        </details>{/each}
    </div>
  </section>
  <Closing />
  <dialog
    class="tx-modal"
    bind:this={dialogEl}
    onclose={onClosed}
    oncancel={onCancel}
    onclick={onModalBackdrop}
    aria-labelledby="tx-modal-title"
  >
    {#if activeTx}
      <div class="tx-modal-head">
        <span>{activeTx.id} · Transmissão</span><span aria-hidden="true">VND//WORK</span>
        <button class="tx-modal-close" type="button" onclick={closeTx}
          >Fechar <span aria-hidden="true">✕</span></button
        >
      </div>
      <h3 class="tx-modal-title" id="tx-modal-title">{activeTx.title}</h3>
      <p class="tx-modal-detail">{activeTx.detail}</p>
      <dl class="tx-specs">
        {#each activeTx.specs as [k, v]}<div>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>{/each}
      </dl>
      <p class="fine tx-modal-foot">O resto fica com quem entra.</p>
    {/if}
  </dialog>
</div>
