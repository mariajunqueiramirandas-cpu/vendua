// Onboarding memory, per store and per device: where the merchant stopped, and whether
// they chose to leave. Only a convenience — the answers themselves are saved in Core.
const key = (storeId: string, what: 'step' | 'left' | 'reset') => `vendua-onboarding-${what}:${storeId}`;

export function readStep(storeId: string): string | null {
  try {
    return localStorage.getItem(key(storeId, 'step'));
  } catch {
    return null;
  }
}

export function saveStep(storeId: string, step: string) {
  try {
    localStorage.setItem(key(storeId, 'step'), step);
  } catch {
    /* private mode: the wizard restarts at the welcome */
  }
}

/** "Continuar depois" — Início stops steering a fresh store back into the wizard. */
export function markLeft(storeId: string) {
  try {
    localStorage.setItem(key(storeId, 'left'), '1');
  } catch {
    /* ignore */
  }
}

export function hasLeft(storeId: string): boolean {
  try {
    return localStorage.getItem(key(storeId, 'left')) === '1';
  } catch {
    return false;
  }
}

/** Staff reset the store (Core's onboarding.resetAt): this device forgets where it stood and
 *  that it left, so the owner lands in the wizard again from the start. */
export function forgetIfReset(storeId: string, resetAt: string | null | undefined) {
  if (!resetAt) return;
  try {
    if (localStorage.getItem(key(storeId, 'reset')) === resetAt) return;
    localStorage.removeItem(key(storeId, 'step'));
    localStorage.removeItem(key(storeId, 'left'));
    localStorage.setItem(key(storeId, 'reset'), resetAt);
  } catch {
    /* private mode: nothing was remembered either */
  }
}
