<script lang="ts">
  import type { Snippet } from 'svelte';

  // A phone lock screen drawn in code (goes inside <Phone status={false}>): date, big clock, and
  // whatever notifications are passed as children. Sized in the phone's container units.
  let {
    time = '9:42',
    date = 'terça-feira, 29 de setembro',
    children,
  }: { time?: string; date?: string; children?: Snippet } = $props();
</script>

<div class="lock">
  <p class="date">{date}</p>
  <p class="time">{time}</p>
  <div class="notes">{@render children?.()}</div>
</div>

<style>
  .lock {
    aspect-ratio: 375 / 856;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 19cqw 5.5% 0;
    color: #f7f4ea;
    background:
      radial-gradient(120% 70% at 30% 8%, #2d7a60 0%, transparent 60%),
      radial-gradient(90% 50% at 90% 100%, rgb(217 248 117 / 0.18) 0%, transparent 70%),
      linear-gradient(165deg, #1d4a3d 0%, #123c32 45%, #0a100d 100%);
  }
  p {
    margin: 0;
  }
  .date {
    font: 600 4.6cqw/1.2 var(--font-sans);
    opacity: 0.85;
  }
  .time {
    font: 600 25cqw/1 var(--font-display);
    letter-spacing: -0.04em;
    margin-bottom: 9cqw;
  }
  .notes {
    width: 100%;
    display: grid;
    gap: 2.2cqw;
  }
</style>
