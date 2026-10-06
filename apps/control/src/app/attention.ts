import { useEffect } from 'react';

type BadgeNavigator = Navigator & {
  setAppBadge?: (n?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

const BASE_TITLE = typeof document === 'undefined' ? '' : document.title;

/** What needs the team (drafts to review + overdue tasks) on the tab title and, installed, the
 *  app icon — so a backgrounded CRM still says "3 for you". */
export function useAttentionCount(n: number) {
  useEffect(() => {
    document.title = n > 0 ? `(${n > 99 ? '99+' : n}) ${BASE_TITLE}` : BASE_TITLE;
    const nav = navigator as BadgeNavigator;
    // unsupported or refused (not installed, no permission): the title still carries it
    const done = n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.();
    done?.catch(() => undefined);
  }, [n]);
  useEffect(
    () => () => {
      document.title = BASE_TITLE;
    },
    [],
  );
}
