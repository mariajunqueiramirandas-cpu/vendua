import { describe, expect, test } from 'bun:test';
import { validateSetting } from '../src/modules/integrations.ts';
import { normalizeStaff, normalizeWhatsapp } from '../src/modules/staff-config.ts';

const code = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code;
  }
};

describe('normalizeWhatsapp', () => {
  test('canonicalizes to +E.164, BR by default', () => {
    expect(normalizeWhatsapp('(11) 99999-0000')).toBe('+5511999990000');
    expect(normalizeWhatsapp('11 3333-4444')).toBe('+551133334444');
    expect(normalizeWhatsapp('55 11 99999 0000')).toBe('+5511999990000');
    expect(normalizeWhatsapp('+1 415 555 0100')).toBe('+14155550100');
    expect(normalizeWhatsapp('9999')).toBeNull();
    expect(normalizeWhatsapp('abc')).toBeNull();
  });
});

describe('normalizeStaff', () => {
  test('trims, lowercases email and formats whatsapp', () => {
    expect(
      normalizeStaff({
        members: [{ name: ' Ana ', email: ' Ana@Vendua.App ', whatsapp: '(11) 99999-0000' }],
      }),
    ).toEqual({
      members: [{ name: 'Ana', email: 'ana@vendua.app', whatsapp: '+5511999990000' }],
      events: { handoff: true, meeting: true, fleet: true },
    });
  });

  test('email-only and whatsapp-only people are fine; events toggle', () => {
    const cfg = normalizeStaff({
      members: [{ email: 'a@b.co' }, { whatsapp: '11999990000' }],
      events: { meeting: false },
    });
    expect(cfg.members.map((m) => [m.email, m.whatsapp])).toEqual([
      ['a@b.co', ''],
      ['', '+5511999990000'],
    ]);
    expect(cfg.events).toEqual({ handoff: true, meeting: false, fleet: true });
  });

  test('rejects bad shapes', () => {
    expect(code(() => validateSetting('staff', 'x'))).toBe('BAD_REQUEST');
    expect(code(() => validateSetting('staff', { members: {} }))).toBe('BAD_REQUEST');
    expect(code(() => validateSetting('staff', { members: [{ name: 'x' }] }))).toBe('BAD_REQUEST');
    expect(code(() => validateSetting('staff', { members: [{ email: 'nope' }] }))).toBe(
      'BAD_REQUEST',
    );
    expect(code(() => validateSetting('staff', { members: [{ whatsapp: '12' }] }))).toBe(
      'BAD_REQUEST',
    );
    expect(code(() => validateSetting('staff', { events: { spam: true } }))).toBe('BAD_REQUEST');
    expect(code(() => validateSetting('staff', { events: { handoff: 'yes' } }))).toBe(
      'BAD_REQUEST',
    );
    expect(validateSetting('staff', {})).toBeUndefined();
  });
});
