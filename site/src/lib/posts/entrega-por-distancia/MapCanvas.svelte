<script lang="ts">
  import {
    BRIDGE_Y,
    MAP_H,
    MAP_W,
    RIVER_HALF,
    STORE,
    km1,
    riverX,
    roadKm,
    route,
    type Pt,
  } from './model';
  import { sim } from './state.svelte';

  // The made-up streets around the Nena: a 0,8 km grid, a river with one bridge, rings every km in a
  // straight line, and the shaded area a car reaches within the maximum. The door is a button: drag
  // it, tap the map, or use the arrow keys.
  let { label, doorName }: { label: string; doorName: string } = $props();

  const STEP = 0.8;
  const xs = Array.from(
    { length: 18 },
    (_, i) => +(STORE.x - 6 * STEP + i * STEP).toFixed(2),
  ).filter((x) => x > 0 && x < MAP_W && (x < 8 || x > 9.4));
  const ys = Array.from(
    { length: 12 },
    (_, i) => +(STORE.y - 6 * STEP + i * STEP).toFixed(2),
  ).filter((y) => y > 0 && y < MAP_H);
  const bank = (y: number, side: -1 | 1) => riverX(y) + side * RIVER_HALF;
  const samples = Array.from({ length: 31 }, (_, i) => (i / 30) * MAP_H);
  const riverPath =
    samples.map((y, i) => `${i ? 'L' : 'M'}${bank(y, -1).toFixed(3)} ${y.toFixed(3)}`).join(' ') +
    ' ' +
    [...samples]
      .reverse()
      .map((y) => `L${bank(y, 1).toFixed(3)} ${y.toFixed(3)}`)
      .join(' ') +
    ' Z';
  const westClip =
    `M0 0 ` +
    samples.map((y) => `L${riverX(y).toFixed(3)} ${y.toFixed(3)}`).join(' ') +
    ` L0 ${MAP_H} Z`;
  const eastClip =
    `M${MAP_W} 0 ` +
    samples.map((y) => `L${riverX(y).toFixed(3)} ${y.toFixed(3)}`).join(' ') +
    ` L${MAP_W} ${MAP_H} Z`;

  const diamond = (c: Pt, r: number) =>
    r <= 0 ? '' : `M${c.x} ${c.y - r} L${c.x + r} ${c.y} L${c.x} ${c.y + r} L${c.x - r} ${c.y} Z`;

  const max = $derived(sim.knobs.maxKm);
  const westReach = $derived(diamond(STORE, max));
  const eastReach = $derived(
    diamond({ x: STORE.x, y: BRIDGE_Y }, max - Math.abs(STORE.y - BRIDGE_Y)),
  );
  const rings = [2, 4, 6];
  const path = $derived(
    route(sim.door)
      .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`)
      .join(' '),
  );
  const km = $derived(roadKm(sim.door));
  const pct = (p: Pt) => `left:${(p.x / MAP_W) * 100}%;top:${(p.y / MAP_H) * 100}%`;

  let box: HTMLDivElement | undefined = $state();
  let dragging = $state(false);

  function place(p: Pt) {
    let x = Math.min(MAP_W - 0.2, Math.max(0.2, p.x));
    const y = Math.min(MAP_H - 0.2, Math.max(0.2, p.y));
    // nobody lives in the river: step onto the nearer bank
    const r = riverX(y);
    if (Math.abs(x - r) < RIVER_HALF + 0.06)
      x = x < r ? r - RIVER_HALF - 0.06 : r + RIVER_HALF + 0.06;
    sim.door = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
    sim.doorId = null;
  }

  function fromEvent(e: { clientX: number; clientY: number }): Pt | null {
    if (!box) return null;
    const r = box.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * MAP_W,
      y: ((e.clientY - r.top) / r.height) * MAP_H,
    };
  }

  function onMapClick(e: MouseEvent) {
    const p = fromEvent(e);
    if (p) place(p);
  }

  function onDown(e: PointerEvent) {
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onMove(e: PointerEvent) {
    if (!dragging) return;
    const p = fromEvent(e);
    if (p) place(p);
  }
  function onUp() {
    dragging = false;
  }

  function onKey(e: KeyboardEvent) {
    const d = e.shiftKey ? 0.5 : 0.1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-d, 0],
      ArrowRight: [d, 0],
      ArrowUp: [0, -d],
      ArrowDown: [0, d],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    place({ x: sim.door.x + m[0], y: sim.door.y + m[1] });
  }
</script>

<!-- the map is a pointer convenience; the door button and the preset buttons do the same by keyboard -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="map" class:dragging bind:this={box} onclick={onMapClick}>
  <svg viewBox="0 0 {MAP_W} {MAP_H}" aria-hidden="true">
    <defs>
      <clipPath id="edd-west"><path d={westClip} /></clipPath>
      <clipPath id="edd-east"><path d={eastClip} /></clipPath>
    </defs>
    <rect class="land" width={MAP_W} height={MAP_H} />
    <path class="reach" d={westReach} clip-path="url(#edd-west)" />
    <path class="reach" d={eastReach} clip-path="url(#edd-east)" />
    {#each xs as x (x)}
      <line class="street" class:avenue={x === STORE.x} x1={x} y1="0" x2={x} y2={MAP_H} />
    {/each}
    {#each ys as y (y)}
      {#if y === BRIDGE_Y}
        <line class="street avenue" x1="0" y1={y} x2={MAP_W} y2={y} />
      {:else}
        <line class="street" class:avenue={y === STORE.y} x1="0" y1={y} x2={bank(y, -1)} y2={y} />
        <line class="street" x1={bank(y, 1)} y1={y} x2={MAP_W} y2={y} />
      {/if}
    {/each}
    <path class="river" d={riverPath} />
    <rect
      class="bridge"
      x={bank(BRIDGE_Y, -1) - 0.12}
      y={BRIDGE_Y - 0.13}
      width={RIVER_HALF * 2 + 0.24}
      height="0.26"
      rx="0.05"
    />
    {#each [1, 2, 3, 4, 5, 6, 7, 8] as r (r)}
      <circle class="ring" class:labelled={rings.includes(r)} cx={STORE.x} cy={STORE.y} {r} />
    {/each}
    <path class="route" d={path} />
  </svg>

  {#each rings as r (r)}
    <span
      class="ring-label"
      style={pct({ x: STORE.x - r * 0.7071, y: STORE.y - r * 0.7071 })}
      aria-hidden="true">{r} km</span
    >
  {/each}
  <span class="store" style={pct(STORE)} aria-hidden="true">
    <svg viewBox="0 0 20 20" width="14" height="14"
      ><path d="M3 9 10 3l7 6v8H3z" fill="currentColor" /></svg
    >
  </span>
  <span class="tag store-tag" style={pct(STORE)} aria-hidden="true">Bolos da Nena</span>

  <button
    type="button"
    class="door"
    style={pct(sim.door)}
    aria-label="{label}: {doorName}, {km1(
      km,
    )} km pelo caminho. Use as setas para mover a porta; com Shift, meio quilômetro por vez."
    onclick={(e) => e.stopPropagation()}
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onUp}
    onkeydown={onKey}
  >
    <span class="dot"></span>
  </button>
  <span class="tag door-tag" style={pct(sim.door)} aria-hidden="true">{doorName}</span>
</div>

<style>
  .map {
    position: relative;
    width: 100%;
    aspect-ratio: 14 / 9;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--surface-sunken);
    cursor: crosshair;
    user-select: none;
    -webkit-user-select: none;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .land {
    fill: var(--surface-sunken);
  }
  .reach {
    fill: color-mix(in srgb, var(--spark) 55%, transparent);
    stroke: color-mix(in srgb, var(--ink) 45%, transparent);
    stroke-width: 1.5px;
    stroke-dasharray: 5 4;
    vector-effect: non-scaling-stroke;
  }
  .street {
    stroke: var(--surface);
    stroke-width: 3px;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .street.avenue {
    stroke-width: 5px;
  }
  .river {
    fill: color-mix(in srgb, var(--info) 30%, var(--surface-sunken));
  }
  .bridge {
    fill: var(--surface);
    stroke: color-mix(in srgb, var(--ink) 35%, transparent);
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
  }
  .ring {
    fill: none;
    stroke: color-mix(in srgb, var(--ink) 16%, transparent);
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
  }
  .ring.labelled {
    stroke: color-mix(in srgb, var(--ink) 30%, transparent);
    stroke-dasharray: 3 3;
  }
  .route {
    fill: none;
    stroke: var(--ink);
    stroke-width: 3.5px;
    stroke-linejoin: round;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }

  .ring-label,
  .tag,
  .store,
  .door {
    position: absolute;
    translate: -50% -50%;
  }
  .ring-label {
    font: 600 0.75rem/1 var(--font-sans);
    color: var(--ink-muted);
    background: var(--surface-sunken);
    padding: 2px 4px;
    border-radius: 6px;
    pointer-events: none;
  }
  .store {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 8px;
    background: var(--primary);
    color: var(--on-primary);
    box-shadow: 0 0 0 3px var(--surface);
    pointer-events: none;
  }
  .tag {
    translate: -50% 0;
    margin-top: 16px;
    padding: 2px 7px;
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font: 600 0.75rem/1.4 var(--font-sans);
    white-space: nowrap;
    box-shadow: var(--shadow-e1);
    pointer-events: none;
  }
  .door-tag {
    margin-top: 18px;
  }

  .door {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    cursor: grab;
    touch-action: none;
    transition:
      left var(--duration-smooth) var(--ease-soft),
      top var(--duration-smooth) var(--ease-soft);
  }
  .dragging .door {
    cursor: grabbing;
    transition: none;
  }
  .dot {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--danger);
    box-shadow:
      0 0 0 4px var(--surface),
      var(--shadow-e2);
  }
  .door:focus-visible {
    outline: 3px solid var(--ink);
    outline-offset: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .door {
      transition: none;
    }
  }
  @media (prefers-color-scheme: dark) {
    .reach {
      fill: color-mix(in srgb, var(--spark) 22%, transparent);
    }
  }
</style>
