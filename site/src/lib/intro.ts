// The intro veil is driven by CSS keyframes (styles.css) so it plays from first paint,
// before hydration. These helpers let scripts sync to it via its live Animation objects.

const PART_ANIMATION = 'veil-part';

function partAnimation(): CSSAnimation | undefined {
  const half = document.querySelector<HTMLElement>('.intro-veil .veil-left');
  if (!half || getComputedStyle(half).display === 'none') return undefined;
  return half
    .getAnimations()
    .find(
      (a): a is CSSAnimation => a instanceof CSSAnimation && a.animationName === PART_ANIMATION,
    );
}

/** Runs `cb` once the veil starts parting — immediately if there is no veil to wait for. */
export function onVeilOpen(cb: () => void): () => void {
  const anim = partAnimation();
  const target = anim?.effect instanceof KeyframeEffect ? anim.effect.target : null;
  const delay = anim?.effect?.getTiming().delay ?? 0;
  if (!anim || !target || Number(anim.currentTime ?? 0) >= delay) {
    cb();
    return () => {};
  }
  const onStart = (e: Event) => {
    if (e instanceof AnimationEvent && e.animationName === PART_ANIMATION) {
      target.removeEventListener('animationstart', onStart);
      cb();
    }
  };
  target.addEventListener('animationstart', onStart);
  return () => target.removeEventListener('animationstart', onStart);
}
