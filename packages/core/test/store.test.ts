import { describe, expect, test } from 'bun:test';
import {
  deriveStatus,
  instagramHandle,
  upcomingSpecialDays,
  whatsappDigits,
  type StoreHours,
} from '../src/modules/store.ts';

const TZ = 'America/Sao_Paulo';
const at = (iso: string) => new Date(iso);

const daily9to22: StoreHours = {
  timezone: TZ,
  windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '09:00', close: '22:00' }],
};

describe('deriveStatus', () => {
  test('open inside a window', () => {
    // 2026-09-18 15:00 UTC = 12:00 Sao_Paulo
    const s = deriveStatus(daily9to22, null, null, at('2026-09-18T15:00:00Z'));
    expect(s.status).toBe('open');
    expect(s.resumesAt).toBeUndefined();
  });

  test('open by its hours says when the window ends', () => {
    // 12:00:30 Sao_Paulo → closes 22:00 Sao_Paulo = 01:00 UTC next day
    const s = deriveStatus(daily9to22, null, null, at('2026-09-18T15:00:30Z'));
    expect(s.closesAt).toBe('2026-09-19T01:00:00.000Z');
    const burger: StoreHours = {
      timezone: TZ,
      windows: [{ days: [2, 3, 4, 5, 6, 0], open: '18:00', close: '02:00' }],
    };
    // Friday 20:00 → 02:00 Saturday; Saturday 00:30 (Friday's window spilling over) → 02:00
    expect(deriveStatus(burger, null, null, at('2026-09-18T23:00:00Z')).closesAt).toBe(
      '2026-09-19T05:00:00.000Z',
    );
    expect(deriveStatus(burger, null, null, at('2026-09-19T03:30:00Z')).closesAt).toBe(
      '2026-09-19T05:00:00.000Z',
    );
  });

  test('closed outside a window, resumes at next open', () => {
    // 08:00 Sao_Paulo — before 09:00 open
    const s = deriveStatus(daily9to22, null, null, at('2026-09-18T11:00:00Z'));
    expect(s.status).toBe('closed');
    expect(s.resumesAt).toBeDefined();
    const resume = new Date(s.resumesAt!);
    expect(resume.getTime()).toBeGreaterThan(at('2026-09-18T11:00:00Z').getTime());
  });

  test('closed after close', () => {
    // 23:30 Sao_Paulo — after 22:00 close
    const s = deriveStatus(daily9to22, null, null, at('2026-09-19T02:30:00Z'));
    expect(s.status).toBe('closed');
  });

  test('overnight window stays open past midnight', () => {
    const burger: StoreHours = {
      timezone: TZ,
      windows: [{ days: [2, 3, 4, 5, 6, 0], open: '18:00', close: '02:00' }],
    };
    // Saturday 00:30 Sao_Paulo — inside Friday's 18:00–02:00 window
    const s = deriveStatus(burger, null, null, at('2026-09-19T03:30:00Z'));
    expect(s.status).toBe('open');
    // Tuesday 03:00 — previous day (Monday) has no window, today hasn't opened.
    const tue = deriveStatus(burger, null, null, at('2026-09-22T06:00:00Z'));
    expect(tue.status).toBe('closed');
  });

  test('manual pause override wins over open hours', () => {
    const s = deriveStatus(
      daily9to22,
      'paused',
      '2026-09-18T21:00:00Z',
      at('2026-09-18T15:00:00Z'),
    );
    expect(s.status).toBe('paused');
    expect(s.resumesAt).toBe('2026-09-18T21:00:00Z');
  });

  test('closed override produces closed', () => {
    const s = deriveStatus(daily9to22, 'closed', null, at('2026-09-18T15:00:00Z'));
    expect(s.status).toBe('closed');
  });

  test('empty windows → closed, no resume', () => {
    const s = deriveStatus({ timezone: TZ, windows: [] }, null, null, at('2026-09-18T15:00:00Z'));
    expect(s.status).toBe('closed');
    expect(s.resumesAt).toBeUndefined();
  });
});

describe('deriveStatus — merchant admin additions', () => {
  test('a timed pause ends by itself', () => {
    const s = deriveStatus(
      daily9to22,
      'paused',
      '2026-09-18T14:00:00Z',
      at('2026-09-18T15:00:00Z'),
    );
    expect(s.status).toBe('open');
  });

  test('a closed special day overrides the weekly hours and reopens the next day', () => {
    // 2026-09-18 is a Friday; 12:00 Sao_Paulo
    const s = deriveStatus(daily9to22, null, null, at('2026-09-18T15:00:00Z'), [
      { date: '2026-09-18', closed: true, label: 'Feriado' },
    ]);
    expect(s.status).toBe('closed');
    // next day 09:00 Sao_Paulo = 12:00 UTC
    expect(s.resumesAt).toBe('2026-09-19T12:00:00.000Z');
  });

  test('special hours replace the weekly window that day', () => {
    const special = [{ date: '2026-09-18', closed: false, open: '14:00', close: '18:00' }];
    expect(deriveStatus(daily9to22, null, null, at('2026-09-18T15:00:00Z'), special).status).toBe(
      'closed',
    );
    expect(deriveStatus(daily9to22, null, null, at('2026-09-18T18:00:00Z'), special).status).toBe(
      'open',
    );
  });
});

describe('upcomingSpecialDays', () => {
  const day = (date: string, extra: object = {}) => ({ date, closed: true, ...extra });

  test('today in store time and later, sorted, capped', () => {
    // 2026-09-19 02:30 UTC is still the 18th in São Paulo
    const now = at('2026-09-19T02:30:00Z');
    const days = [
      day('2026-12-25', { label: 'Natal' }),
      day('2026-09-17'),
      day('2026-09-18', { closed: false, open: '10:00', close: '14:00' }),
      day('2026-10-12'),
    ];
    expect(upcomingSpecialDays(days, TZ, now)).toEqual([
      { date: '2026-09-18', closed: false, open: '10:00', close: '14:00' },
      { date: '2026-10-12', closed: true },
      { date: '2026-12-25', closed: true, label: 'Natal' },
    ]);
    expect(upcomingSpecialDays(days, TZ, now, 1)).toHaveLength(1);
    // in UTC the 18th is already past
    expect(upcomingSpecialDays(days, 'UTC', now)[0]!.date).toBe('2026-10-12');
  });

  test('a malformed stored row is dropped, never thrown on', () => {
    const now = at('2026-09-18T15:00:00Z');
    expect(upcomingSpecialDays(null, TZ, now)).toEqual([]);
    expect(
      upcomingSpecialDays([null, { date: 'amanhã' }, day('2026-09-30')] as never, TZ, now),
    ).toEqual([{ date: '2026-09-30', closed: true }]);
  });
});

describe('store contacts: one form, the one /store serves', () => {
  test('WhatsApp: digits with 55, whatever was typed', () => {
    expect(whatsappDigits('(22) 98144-8322')).toBe('5522981448322');
    expect(whatsappDigits('+55 (22) 98144-8322')).toBe('5522981448322');
    expect(whatsappDigits('022 98144-8322')).toBe('5522981448322');
    expect(whatsappDigits('22 3344-5566')).toBe('552233445566');
    expect(whatsappDigits('5522981448322')).toBe('5522981448322');
    expect(whatsappDigits(21999990000)).toBe('5521999990000');
    // DDD 55 (Santa Maria, RS) keeps its own 55
    expect(whatsappDigits('(55) 99123-4567')).toBe('5555991234567');
    expect(whatsappDigits(whatsappDigits('(55) 99123-4567'))).toBe('5555991234567');
    for (const bad of ['2299', '+1 202 555 01234 99', '', null, undefined, {}])
      expect(whatsappDigits(bad)).toBeNull();
  });

  test('Instagram: the bare handle, from an @ or a profile link', () => {
    expect(instagramHandle('@queropudim_gourmet')).toBe('queropudim_gourmet');
    expect(instagramHandle('queropudim_gourmet')).toBe('queropudim_gourmet');
    expect(instagramHandle(' https://www.instagram.com/doce.ria/?igshid=abc ')).toBe('doce.ria');
    expect(instagramHandle('instagram.com/doce.ria/')).toBe('doce.ria');
    expect(instagramHandle('HTTP://Instagram.com/Doce')).toBe('Doce');
    for (const bad of [
      '',
      '@',
      'doce ria',
      'https://facebook.com/x',
      'facebook.com/doce',
      'https://linktr.ee/doce',
      null,
      42,
    ])
      expect(instagramHandle(bad)).toBeNull();
  });
});
