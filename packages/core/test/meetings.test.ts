import { describe, expect, test } from 'bun:test';
import {
  MEETING_DEFAULTS,
  bookingToken,
  computeSlots,
  isFree,
  normalizeMeetingConfig,
  onGrid,
  selfCancelAllowed,
  slotFits,
  verifyBookingToken,
  weeklyToJson,
  type BusyWindow,
} from '../src/modules/meetings.ts';
import { localParts, zonedInstant, localDateOf } from '../src/platform/tz.ts';

const SECRET = 'test-staff-secret';
// 2026-09-20 is a Sunday; São Paulo is UTC-3 year-round since 2019.
const SUN = new Date('2026-09-20T15:00:00Z'); // 12:00 BRT
const MON_0900 = new Date('2026-09-21T12:00:00Z'); // seg 09:00 BRT

const cfg = (over: Record<string, unknown> = {}) =>
  normalizeMeetingConfig({ ...over });

// ---------- tz helpers ----------

describe('tz helpers', () => {
  test('zonedInstant: 09:00 São Paulo = 12:00 UTC (UTC-3)', () => {
    const t = zonedInstant('America/Sao_Paulo', { year: 2026, month: 9, day: 21, weekday: 1 }, 540);
    expect(t.toISOString()).toBe('2026-09-21T12:00:00.000Z');
  });
  test('localParts round-trips the instant', () => {
    const p = localParts(MON_0900, 'America/Sao_Paulo');
    expect([p.year, p.month, p.day, p.weekday, p.minutes]).toEqual([2026, 9, 21, 1, 540]);
  });
  test('localDateOf carries weekday', () => {
    expect(localDateOf(MON_0900, 'America/Sao_Paulo').weekday).toBe(1);
    expect(localDateOf(SUN, 'America/Sao_Paulo').weekday).toBe(0);
  });
});

// ---------- config ----------

describe('normalizeMeetingConfig', () => {
  test('empty row → defaults', () => {
    const c = cfg();
    expect(c.tz).toBe('America/Sao_Paulo');
    expect(c.slotMinutes).toBe(30);
    expect(c.bufferMinutes).toBe(15);
    expect(c.horizonDays).toBe(14);
    expect(c.weekly[0]).toEqual([]); // sun closed
    expect(c.weekly[1]).toEqual([
      [540, 720],
      [840, 1080],
    ]); // mon 09–12, 14–18
  });
  test('invalid tz falls back', () => {
    expect(cfg({ tz: 'Mars/Olympus' }).tz).toBe('America/Sao_Paulo');
  });
  test('weekly: malformed windows dropped, valid kept + sorted', () => {
    const c = cfg({
      weekly: {
        mon: [
          ['14:00', '18:00'],
          ['bogus', '12:00'],
          ['09:00', '12:00'],
          ['11:00', '10:00'], // open >= close → dropped
        ],
      },
    });
    expect(c.weekly[1]).toEqual([
      [540, 720],
      [840, 1080],
    ]);
    expect(c.weekly[2]).toEqual([]);
  });
  test('weeklyToJson round-trips', () => {
    const c = cfg();
    const j = weeklyToJson(c.weekly);
    expect(j.mon).toEqual([
      ['09:00', '12:00'],
      ['14:00', '18:00'],
    ]);
    expect(normalizeMeetingConfig({ weekly: j }).weekly).toEqual(c.weekly);
  });
});

// ---------- onGrid / slotFits ----------

describe('onGrid', () => {
  const c = cfg();
  test('monday 09:00 on the grid, 09:15 off it', () => {
    expect(onGrid(c, MON_0900, 30, SUN)).toBe(true);
    expect(onGrid(c, new Date('2026-09-21T12:15:00Z'), 30, SUN)).toBe(false);
  });
  test('outside window, closed days, past, beyond horizon → off', () => {
    expect(onGrid(c, new Date('2026-09-21T11:00:00Z'), 30, SUN)).toBe(false); // 08:00 BRT
    expect(onGrid(c, new Date('2026-09-20T15:00:00Z'), 30, SUN)).toBe(false); // sun closed
    expect(onGrid(c, new Date('2026-09-19T15:00:00Z'), 30, SUN)).toBe(false); // past
    // horizon 14d from sep 20 → sep 21..oct 4 (oct 3 is day 13, the last in-range)
    expect(onGrid(c, new Date('2026-10-05T12:00:00Z'), 30, SUN)).toBe(false); // day 15
    expect(onGrid(c, new Date('2026-10-02T12:00:00Z'), 30, SUN)).toBe(true); // fri, in range
  });
  test('slot spilling past window close is off-grid', () => {
    expect(onGrid(c, new Date('2026-09-21T14:45:00Z'), 30, SUN)).toBe(false); // 11:45+30>12:00
    expect(onGrid(c, new Date('2026-09-21T14:30:00Z'), 30, SUN)).toBe(true); // 11:30–12:00
  });
});

describe('isFree/slotFits', () => {
  const c = cfg();
  const busy: BusyWindow[] = [{ start: MON_0900, end: new Date('2026-09-21T12:30:00Z') }];
  test('buffer pads busy both sides', () => {
    // busy seg 09:00–09:30 BRT, buffer 15 → kills 08:30, 09:00, 09:30 slots
    expect(isFree(new Date('2026-09-21T11:30:00Z'), new Date('2026-09-21T12:00:00Z'), busy, 15)).toBe(false);
    expect(isFree(new Date('2026-09-21T12:00:00Z'), new Date('2026-09-21T12:30:00Z'), busy, 15)).toBe(false);
    expect(isFree(new Date('2026-09-21T12:30:00Z'), new Date('2026-09-21T13:00:00Z'), busy, 15)).toBe(false);
    expect(isFree(new Date('2026-09-21T12:45:00Z'), new Date('2026-09-21T13:15:00Z'), busy, 15)).toBe(true);
  });
  test('slotFits combines grid + busy', () => {
    expect(slotFits(c, MON_0900, 30, SUN, busy)).toBe(false);
    // 10:00 BRT: on-grid, past busy end 09:30 + 15min buffer → free
    expect(slotFits(c, new Date('2026-09-21T13:00:00Z'), 30, SUN, busy)).toBe(true);
    // off-grid instants never fit even with empty busy
    expect(slotFits(c, new Date('2026-09-21T12:15:00Z'), 30, SUN, [])).toBe(false);
  });
});

// ---------- computeSlots ----------

describe('computeSlots', () => {
  const c = cfg();
  const slots = computeSlots(c, SUN, []);
  test('only weekdays, only window times, all in the future', () => {
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      const p = localParts(s.start, 'America/Sao_Paulo');
      expect([1, 2, 3, 4, 5]).toContain(p.weekday);
      expect(p.second).toBe(0);
      expect(s.start.getTime()).toBeGreaterThan(SUN.getTime());
      const inWindow = p.minutes >= 540 && p.minutes + 30 <= 720 || p.minutes >= 840 && p.minutes + 30 <= 1080;
      expect(inWindow).toBe(true);
    }
  });
  test('first slot is monday 09:00 BRT', () => {
    expect(slots[0]!.start.toISOString()).toBe('2026-09-21T12:00:00.000Z');
  });
  test('no sunday slots, sorted ascending, no dupes', () => {
    const seen = new Set<number>();
    for (const s of slots) {
      expect(localDateOf(s.start, 'America/Sao_Paulo').weekday).not.toBe(0);
      expect(seen.has(s.start.getTime())).toBe(false);
      seen.add(s.start.getTime());
    }
  });
  test('busy windows knock out buffered slots', () => {
    const busy: BusyWindow[] = [{ start: MON_0900, end: new Date('2026-09-21T12:30:00Z') }];
    const withBusy = computeSlots(c, SUN, busy);
    const mondayStarts = withBusy
      .filter((s) => s.start.toISOString().startsWith('2026-09-21'))
      .map((s) => s.start.toISOString());
    expect(mondayStarts).not.toContain('2026-09-21T12:00:00.000Z');
    expect(mondayStarts).not.toContain('2026-09-21T12:30:00.000Z'); // buffer after busy
    expect(mondayStarts).not.toContain('2026-09-21T11:30:00.000Z'); // buffer before busy
    expect(mondayStarts).toContain('2026-09-21T13:00:00.000Z'); // 10:00 BRT — free
    expect(withBusy.length).toBeLessThan(slots.length);
  });
  test('past slots excluded when now is mid-day', () => {
    const monday11am = new Date('2026-09-21T14:00:00Z'); // 11:00 BRT
    const s2 = computeSlots(c, monday11am, []);
    for (const s of s2) {
      expect(s.start.getTime()).toBeGreaterThan(monday11am.getTime());
    }
    const firsts = s2.map((s) => s.start.toISOString());
    expect(firsts).not.toContain('2026-09-21T12:00:00.000Z'); // 09:00 already past
    expect(firsts).toContain('2026-09-21T14:30:00.000Z'); // 11:30 BRT still ahead
  });
  test('horizon bounds the last slot', () => {
    const short = cfg({ horizonDays: 1 });
    const s = computeSlots(short, SUN, []);
    expect(s.length).toBe(0); // sunday closed → nothing inside 1d horizon
    const s2 = computeSlots(short, new Date('2026-09-20T23:00:00Z'), []); // still sun
    expect(s2.length).toBe(0);
    // horizon 2 from sunday noon → monday is day 1, inside
    const s3 = computeSlots(cfg({ horizonDays: 2 }), SUN, []);
    const maxDay = localDateOf(s3.at(-1)!.start, 'America/Sao_Paulo');
    expect([maxDay.month, maxDay.day]).toEqual([9, 21]); // all monday
  });
});

// ---------- booking tokens ----------

describe('bookingToken / verifyBookingToken', () => {
  const leadId = 'a1b2c3d4-0000-4000-8000-000000000000';
  test('roundtrip', () => {
    const t = bookingToken(leadId, SECRET, SUN);
    expect(verifyBookingToken(t, SECRET, SUN)).toBe(leadId);
  });
  test('same input → same token (deterministic idempotency anchor)', () => {
    expect(bookingToken(leadId, SECRET, SUN)).toBe(bookingToken(leadId, SECRET, SUN));
  });
  test('wrong secret / tampered lead → null', () => {
    const t = bookingToken(leadId, SECRET, SUN);
    expect(verifyBookingToken(t, 'other-secret', SUN)).toBeNull();
    const parts = t.split('.');
    const tampered = `${parts[0]}.b1b2c3d4-0000-4000-8000-000000000000.${parts[2]}.${parts[3]}`;
    expect(verifyBookingToken(tampered, SECRET, SUN)).toBeNull();
  });
  test('expired → null', () => {
    const t = bookingToken(leadId, SECRET, SUN);
    const later = new Date(SUN.getTime() + 31 * 86_400_000); // >30d TTL
    expect(verifyBookingToken(t, SECRET, later)).toBeNull();
  });
  test('malformed → null', () => {
    for (const bad of ['', 'x', 'vbt', `vbt.${leadId}`, 'vbt.abc.def.ghi', 'vbt.abc.notanint.x']) {
      expect(verifyBookingToken(bad, SECRET, SUN)).toBeNull();
    }
  });
});

// ---------- cancel window ----------

describe('selfCancelAllowed', () => {
  test('>12h ok, inside 12h not, past not', () => {
    const now = SUN.getTime();
    expect(selfCancelAllowed(now + 12 * 3600_000 + 60_000, now)).toBe(true);
    expect(selfCancelAllowed(now + 12 * 3600_000, now)).toBe(false);
    expect(selfCancelAllowed(now + 6 * 3600_000, now)).toBe(false);
    expect(selfCancelAllowed(now - 1000, now)).toBe(false);
  });
});

// ---------- defaults sanity ----------

describe('MEETING_DEFAULTS', () => {
  test('publicBaseUrl is https, tz is São Paulo', () => {
    expect(MEETING_DEFAULTS.publicBaseUrl).toBe('https://crm.vendua.com.br');
    expect(MEETING_DEFAULTS.tz).toBe('America/Sao_Paulo');
  });
});
