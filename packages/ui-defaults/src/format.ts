import { LOCALE } from '@vendua/kernel/rules';

// The formatters moved to the Kernel's pure rules (one implementation for the Kernel, these
// defaults, stores and the admin); the ui-defaults names stay as aliases.
export {
  formatCents as money,
  formatDateTime as dateTime,
  formatTime as time,
  formatDay as dayLabel,
  ORDER_STATE_LABEL,
  PAYMENT_LABEL,
  COUPON_REASON,
  MEDIA_WIDTHS,
  mediaSrcSet,
  countdown,
} from '@vendua/kernel/rules';

// Internal to the defaults (not re-exported from index.ts).

/** The zone to read instants in when a slot isn't handed the store's (an override, a fixture):
 *  the environment's, as `formatDateTime` does without one. */
export const zoneOr = (timeZone: string | undefined): string =>
  timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;

/** "sacola" → "Sacola", for a store word that opens a title. */
export const capitalize = (s: string): string => s.charAt(0).toLocaleUpperCase(LOCALE) + s.slice(1);
