// Onboarding memory, per store and per device: where the merchant stopped, and whether
// they chose to leave. Only a convenience — the answers themselves are saved in Core.
const key = (storeId: string, what: 'step' | 'left') => `vendua-onboarding-${what}:${storeId}`;

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
