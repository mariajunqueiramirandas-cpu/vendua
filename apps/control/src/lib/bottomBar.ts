import { useEffect } from 'react';

/**
 * A bar that owns the screen's bottom edge while it's mounted (the pipeline's bulk actions, a
 * lead's quick actions on phones): `<html data-bottom-bar>` makes the floating setup pill
 * (app/Onboarding.tsx) step aside. Counted, so two bars don't unmark each other.
 */
export function useBottomBar() {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.bottomBar = String(Number(root.dataset.bottomBar ?? 0) + 1);
    return () => {
      const left = Number(root.dataset.bottomBar ?? 1) - 1;
      if (left > 0) root.dataset.bottomBar = String(left);
      else delete root.dataset.bottomBar;
    };
  }, []);
}
