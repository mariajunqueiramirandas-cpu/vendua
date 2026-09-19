import { describe, expect, test } from 'bun:test';
import { deriveStatus, type StoreHours } from '../src/modules/store.ts';

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
