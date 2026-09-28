// Android vibration (§5.3): a tick on toggles, a double pulse on a new order,
// a firm tap when a swipe commits. Never on scroll. Silent where unsupported.
const v = (p: number | number[]) => {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* unsupported */
  }
};
export const haptic = {
  tick: () => v(8),
  commit: () => v(22),
  newOrder: () => v([180, 90, 180]),
  error: () => v([30, 40, 30]),
};
