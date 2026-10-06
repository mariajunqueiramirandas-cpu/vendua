import { Cardholder, CreditCard, Money, PixLogo, Ticket, type Icon } from '@phosphor-icons/react';
import type { PdvMethod } from '../../lib/api.ts';

/** The counter's methods in the order a cashier reaches for them. */
export const PDV_METHODS: PdvMethod[] = ['cash', 'pix', 'credit', 'debit', 'voucher'];

export const PDV_METHOD_ICON: Record<PdvMethod, Icon> = {
  cash: Money,
  pix: PixLogo,
  credit: CreditCard,
  debit: Cardholder,
  voucher: Ticket,
};
