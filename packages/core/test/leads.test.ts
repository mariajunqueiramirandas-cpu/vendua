import { describe, expect, test } from 'bun:test';
import {
  LEAD_STATES,
  leadInsert,
  leadJson,
  leadPatch,
  leadState,
  type LeadRow,
} from '../src/modules/leads.ts';

const code = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code;
  }
};

describe('leadState', () => {
  test('every enum value passes', () => {
    for (const s of LEAD_STATES) expect(leadState(s)).toBe(s);
  });
  test('bad value → INVALID_STATE', () => {
    expect(code(() => leadState('bogus'))).toBe('INVALID_STATE');
    expect(code(() => leadState(''))).toBe('INVALID_STATE');
    expect(code(() => leadState(42))).toBe('INVALID_STATE');
    expect(code(() => leadState(null))).toBe('INVALID_STATE');
  });
});

describe('leadInsert', () => {
  test('name required → INVALID_LEAD', () => {
    expect(code(() => leadInsert({}))).toBe('INVALID_LEAD');
    expect(code(() => leadInsert({ name: '  ' }))).toBe('INVALID_LEAD');
    expect(code(() => leadInsert({ name: null }))).toBe('INVALID_LEAD');
  });
  test('name + optionals map to snake_case columns', () => {
    const out = leadInsert({
      name: 'Ana',
      businessName: 'Doces da Ana',
      phone: '2299',
      city: 'RJ',
    });
    expect(out).toEqual({
      name: 'Ana',
      business_name: 'Doces da Ana',
      phone: '2299',
      email: null,
      instagram: null,
      city: 'RJ',
      source: null,
    });
  });
  test('non-string field → BAD_REQUEST', () => {
    expect(code(() => leadInsert({ name: 'Ana', phone: 123 }))).toBe('BAD_REQUEST');
  });
});

describe('leadPatch', () => {
  test('partial fields only', () => {
    expect(leadPatch({ city: 'RJ' })).toEqual({ city: 'RJ' });
    expect(leadPatch({ state: 'contacted' })).toEqual({ state: 'contacted' });
  });
  test('explicit null clears a field', () => {
    expect(leadPatch({ phone: null })).toEqual({ phone: null });
  });
  test('name cannot be emptied', () => {
    expect(code(() => leadPatch({ name: null }))).toBe('INVALID_LEAD');
    expect(code(() => leadPatch({ name: '' }))).toBe('INVALID_LEAD');
  });
  test('bad state → INVALID_STATE', () => {
    expect(code(() => leadPatch({ state: 'archived' }))).toBe('INVALID_STATE');
  });
  test('empty patch → BAD_REQUEST', () => {
    expect(code(() => leadPatch({}))).toBe('BAD_REQUEST');
    expect(code(() => leadPatch({ unknownField: 'x' }))).toBe('BAD_REQUEST');
  });
});

describe('leadJson', () => {
  const row: LeadRow = {
    id: 'l1',
    name: 'Ana',
    business_name: 'Doces da Ana',
    phone: '2299',
    email: null,
    instagram: '@doces',
    city: 'RJ',
    source: 'indicação',
    state: 'contacted',
    notes: [{ at: '2026-09-19T00:00:00.000Z', body: 'primeira conversa' }],
    idempotency_key: null,
    created_at: '2026-09-18T00:00:00.000Z',
    updated_at: '2026-09-19T00:00:00.000Z',
  };
  test('snake_case row → camelCase contract', () => {
    const l = leadJson(row);
    expect(l.businessName).toBe('Doces da Ana');
    expect(l.createdAt).toBe('2026-09-18T00:00:00.000Z');
    expect(l.notes).toHaveLength(1);
    expect(l.notes[0]!.body).toBe('primeira conversa');
  });
  test('null notes → empty array', () => {
    expect(leadJson({ ...row, notes: null }).notes).toEqual([]);
  });
});
