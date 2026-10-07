// The salão of the example: six tables, three with a comanda. A comanda's bill follows Core's
// (packages/core/src/modules/pdv/ledger.ts): rounds paid online and QR orders still waiting for the
// staff are listed but not owed; the service is on consumo minus desconto; what remains is the
// total minus what was paid; the split is splitShares over what remains.

import { serviceCents } from './money';

export interface Item {
  qty: number;
  name: string;
  unit: number;
}

export interface Round {
  number: number;
  /** pdv: the staff took it; qr: the customer ordered from the table's QR */
  source: 'pdv' | 'qr';
  /** a QR order still waiting for someone to accept it */
  waiting: boolean;
  paidOnline: boolean;
  items: Item[];
}

export interface Tab {
  rounds: Round[];
  customer: string | null;
  serviceFee: boolean;
  paid: { cents: number; method: string }[];
}

export interface Table {
  n: number;
  /** round tables seat two, square ones four */
  shape: 'round' | 'square';
  tab: Tab | null;
}

export const SERVICE_BPS = 1000;

const cenoura = (qty: number): Item => ({
  qty,
  name: 'Fatia de cenoura com brigadeiro',
  unit: 900,
});
const cafe = (qty: number): Item => ({ qty, name: 'Café coado 300 ml', unit: 650 });
const suco = (qty: number): Item => ({ qty, name: 'Suco de laranja 400 ml', unit: 1000 });
const fuba = (qty: number): Item => ({ qty, name: 'Fatia de fubá com goiabada', unit: 800 });

export const roundTotal = (r: Round) => r.items.reduce((n, i) => n + i.qty * i.unit, 0);

/** a round that joins the bill: accepted and not paid online */
export const owed = (r: Round) => !r.waiting && !r.paidOnline;

export function bill(t: Tab) {
  const consumo = t.rounds.filter(owed).reduce((n, r) => n + roundTotal(r), 0);
  const service = t.serviceFee ? serviceCents(SERVICE_BPS, consumo) : 0;
  const total = consumo + service;
  const paid = t.paid.reduce((n, p) => n + p.cents, 0);
  return { consumo, service, total, paid, remaining: total - paid };
}

/** the round a waiter adds to a free table in the example */
export const firstRound = (number: number): Round => ({
  number,
  source: 'pdv',
  waiting: false,
  paidOnline: false,
  items: [cenoura(2), cafe(2)],
});

export function floor(): Table[] {
  return [
    { n: 1, shape: 'round', tab: null },
    {
      n: 2,
      shape: 'square',
      tab: {
        customer: 'Bia',
        serviceFee: true,
        paid: [],
        rounds: [
          {
            number: 33,
            source: 'pdv',
            waiting: false,
            paidOnline: false,
            items: [fuba(2), cafe(2)],
          },
        ],
      },
    },
    { n: 3, shape: 'round', tab: null },
    {
      n: 4,
      shape: 'round',
      tab: {
        customer: null,
        serviceFee: true,
        paid: [],
        rounds: [
          {
            number: 35,
            source: 'pdv',
            waiting: false,
            paidOnline: false,
            items: [cafe(2)],
          },
          {
            number: 38,
            source: 'qr',
            waiting: true,
            paidOnline: false,
            items: [cenoura(2)],
          },
        ],
      },
    },
    {
      n: 5,
      shape: 'square',
      tab: {
        customer: null,
        serviceFee: true,
        paid: [{ cents: 2000, method: 'Dinheiro' }],
        rounds: [
          {
            number: 31,
            source: 'pdv',
            waiting: false,
            paidOnline: false,
            items: [cenoura(2), cafe(2)],
          },
          {
            number: 34,
            source: 'qr',
            waiting: false,
            paidOnline: true,
            items: [fuba(1), suco(1)],
          },
          {
            number: 36,
            source: 'pdv',
            waiting: false,
            paidOnline: false,
            items: [cenoura(2), suco(1)],
          },
        ],
      },
    },
    { n: 6, shape: 'square', tab: null },
  ];
}
