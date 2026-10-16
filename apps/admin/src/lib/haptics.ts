import { platform } from '../platform/index.ts';

// Vibration (§5.3): a tick on toggles, a double pulse on a new order, a firm tap when a swipe
// commits. Never on scroll. Android's browser and the app (iOS too); silent elsewhere.
export const haptic = platform.haptic;
