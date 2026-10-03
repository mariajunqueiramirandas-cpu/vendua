// A demo's timers: every wait resolves instantly under reduced motion, and none fires after the demo
// restarts or leaves the page (stop() is called from onDestroy).
export function clock(reduced: () => boolean) {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;
  return {
    wait(ms: number): Promise<void> {
      if (stopped) return new Promise(() => {});
      if (reduced()) return Promise.resolve();
      return new Promise((resolve) => {
        const t = setTimeout(() => {
          timers.delete(t);
          if (!stopped) resolve();
        }, ms);
        timers.add(t);
      });
    },
    stop() {
      stopped = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
  };
}
