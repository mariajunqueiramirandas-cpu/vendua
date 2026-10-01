// Android only: iOS has no programmatic haptics for web pages (iOS 26.5), and
// navigator.vibrate is ignored outside a user gesture anyway. Never on scroll.

function buzz(ms: number) {
  const nav = globalThis.navigator as
    (Navigator & { vibrate?: (p: number) => boolean }) | undefined;
  try {
    nav?.vibrate?.(ms);
  } catch {
    /* blocked (iframe policy, no activation) — haptics are a nicety */
  }
}

export const haptic = {
  /** add-to-bag success, stepper steps */
  tick: () => buzz(8),
  /** a swipe that commits (sheet dismissed by drag) */
  commit: () => buzz(18),
};
