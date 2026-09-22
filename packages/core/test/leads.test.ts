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
      whatsapp: null,
      whatsapp_verified: false,
      email: null,
      instagram: null,
      website: null,
      city: 'RJ',
      segment: null,
      source: null,
      owner: null,
      lost_reason: null,
      discovered_via: null,
      fit_reason: null,
      intent_reason: null,
    });
  });
  test('non-string field → BAD_REQUEST', () => {
    expect(code(() => leadInsert({ name: 'Ana', phone: 123 }))).toBe('BAD_REQUEST');
  });
  test('agentGoal + fitScore map to snake_case columns', () => {
    const out = leadInsert({ name: 'Ana', agentGoal: 'meeting', fitScore: 8 });
    expect(out.agent_goal).toBe('meeting');
    expect(out.fit_score).toBe(8);
  });
  test('bad agentGoal / fitScore → 422', () => {
    expect(code(() => leadInsert({ name: 'A', agentGoal: 'spam' }))).toBe('INVALID_AGENT_GOAL');
    expect(code(() => leadInsert({ name: 'A', fitScore: 11 }))).toBe('BAD_REQUEST');
    expect(code(() => leadInsert({ name: 'A', fitScore: 3.5 }))).toBe('BAD_REQUEST');
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
  test('whatsapp writes carry the verified flag', () => {
    expect(leadPatch({ whatsapp: '5522999990000' })).toEqual({
      whatsapp: '5522999990000',
      whatsapp_verified: true,
    });
    expect(leadPatch({ whatsapp: null })).toEqual({ whatsapp: null, whatsapp_verified: false });
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
    whatsapp: '85999990000',
    whatsapp_verified: true,
    email: null,
    instagram: '@doces',
    website: null,
    city: 'RJ',
    segment: 'doceria',
    source: 'indicação',
    owner: null,
    tags: ['vip'],
    deal_value_cents: 12000,
    state: 'contacted',
    agent_mode: 'draft',
    agent_goal: 'negotiation',
    agent_plan: [
      { step: 'contexto: o que vende', status: 'done', note: 'dossiê lido' },
      { step: 'commit: enviar proposta', status: 'todo', note: null },
    ],
    fit_score: null,
    fit_reason: null,
    intent_score: null,
    intent_reason: null,
    email_bounced_at: null,
    next_action_at: null,
    lost_reason: null,
    archived_at: null,
    unsubscribed_at: null,
    discovered_via: null,
    created_at: '2026-09-18T00:00:00.000Z',
    updated_at: '2026-09-19T00:00:00.000Z',
  };
  test('snake_case row → camelCase contract', () => {
    const l = leadJson(row);
    expect(l.businessName).toBe('Doces da Ana');
    expect(l.createdAt).toBe('2026-09-18T00:00:00.000Z');
    expect(l.tags).toEqual(['vip']);
    expect(l.agentMode).toBe('draft');
    expect(l.dealValueCents).toBe(12000);
    expect(l.agentPlan).toEqual([
      { step: 'contexto: o que vende', status: 'done', note: 'dossiê lido' },
      { step: 'commit: enviar proposta', status: 'todo', note: null },
    ]);
  });
  test('null tags → empty array', () => {
    expect(leadJson({ ...row, tags: null }).tags).toEqual([]);
  });
});
