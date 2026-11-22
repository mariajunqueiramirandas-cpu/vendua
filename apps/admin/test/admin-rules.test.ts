/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { packsLabel, parseQty } from '../src/features/menu/insumos/units.ts';
import { paymentTotals, refundAmount } from '../src/features/orders/payment-totals.ts';
import { ApiError, type OrderPayment } from '../src/lib/api.ts';
import { dateShort, moneyCompact } from '../src/lib/format.ts';
import {
  maskDocument,
  parseDocument,
  parseMoney,
  parsePhone,
  parseTime,
} from '../src/lib/parse.ts';
import { platform } from '../src/platform/index.ts';
import { messageOf, ValidationError } from '../src/ui/feedback.tsx';

describe('merchant input and display', () => {
  test('parses Brazilian money, phone numbers, documents and times', () => {
    expect(parseMoney('R$ 1.234,56')).toBe(123456);
    expect(parseMoney('12.50')).toBe(1250);
    expect(parseMoney('-12')).toBeNull();
    expect(parsePhone('+55 (22) 99876-5432')).toBe('22998765432');
    expect(parseDocument(maskDocument('52998224725'))).toBe('52998224725');
    expect(parseDocument('111.111.111-11')).toBeNull();
    expect(parseTime('9h30')).toBe('09:30');
    expect(parseTime('24:30')).toBeNull();
  });

  test('keeps calendar dates and formats large negative values compactly', () => {
    expect(dateShort('2026-11-22', 'Pacific/Kiritimati')).toBe('dom, 22 nov');
    expect(dateShort('2026-11-22T01:00:00Z', 'America/Sao_Paulo')).toBe('sáb, 21 nov');
    expect(moneyCompact(-1_050_000)).toBe('R$ -11 mil');
    expect(moneyCompact(-150_000_000)).toBe('R$ -1,5 mi');
  });

  test('limits ingredient quantities and accepts decimal zero for stock', () => {
    expect(parseQty('1.250,5', 'g')).toBe(1_250_500);
    expect(parseQty('2000', 'kg')).toBe(1_000_000_000);
    expect(parseQty('2000000', 'kg', 'stock')).toBe(1_000_000_000_000);
    expect(parseQty('0,0', 'kg', 'stock')).toBe(0);
    expect(parseQty('0.00', 'L', 'stock')).toBe(0);
    expect(parseQty('0,0', 'kg')).toBeNull();
    expect(parseQty('-1', 'g')).toBeNull();
    expect(packsLabel(2, 'galão', 5_000_000, 'ml')).toBe('2 galões de 5 L');
  });
});

function payment(id: string, cents: number, patch: Partial<OrderPayment> = {}): OrderPayment {
  return {
    id,
    kind: 'pix',
    status: 'approved',
    amountCents: cents,
    refundedCents: 0,
    refundableCents: cents,
    providerFeeCents: 50,
    netCents: cents - 50,
    approvedAt: null,
    createdAt: '',
    refunds: [],
    ...patch,
  };
}

test('a refund equal to just one capture remains partial for a two-payment order', () => {
  const totals = paymentTotals([
    payment('deposit', 1200, {
      charge: 'deposit',
      status: 'partially_refunded',
      refundedCents: 200,
      refundableCents: 1000,
    }),
    payment('balance', 3500, { charge: 'balance', kind: 'card' }),
  ]);
  expect(totals).toEqual({ amount: 4700, refunded: 200, refundable: 4500, fee: 100, net: 4600 });
  expect(refundAmount(3500, totals.refundable)).toBe(3500);
  expect(refundAmount(4500, totals.refundable)).toBeNull();
  const pending = payment('pending', 2000, { status: 'pending', netCents: null });
  expect(paymentTotals([pending]).refundable).toBe(0);
  expect(paymentTotals([pending]).net).toBeNull();
});

test('shows known Core errors and form validation in Portuguese', () => {
  for (const [code, words] of Object.entries({
    PAYMENT_LOCKED: 'processamento',
    CAIXA_CLOSED: 'caixa fechou',
    ORDER_ON_TAB: 'comanda',
    PAYMENT_PDV: 'registrado no caixa',
    TENANT_SUSPENDED: 'suspenso',
    NOT_AVAILABLE: 'disponível',
    INVOICE_NOT_OPEN: 'fatura',
    ORDER_BUSY: 'em andamento',
  })) {
    expect(messageOf(new ApiError(403, code, 'Internal API text'))).toContain(words);
  }
  expect(messageOf(new ValidationError('Digite uma quantidade.'))).toBe('Digite uma quantidade.');
  const original = platform.canPay;
  try {
    platform.canPay = false;
    for (const code of ['PLAN_REQUIRED', 'BILLING_HOLD', 'PAYER_DOCUMENT_REQUIRED'])
      expect(messageOf(new ApiError(422, code, 'Internal API text'))).toContain('navegador');
  } finally {
    platform.canPay = original;
  }
});
