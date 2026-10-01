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
