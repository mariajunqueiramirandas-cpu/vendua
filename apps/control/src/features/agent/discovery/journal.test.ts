// @ts-nocheck -- apps/control has no @types/bun, and its tsc includes every .ts; run with `bun test`
import { describe, expect, test } from 'bun:test';
import { argHint, callNames, foundLeads, outHint, TOOL_LABEL } from './journal.ts';

const LEAD_ID = '6f1c2b2e-3a4d-4e5f-8a9b-0c1d2e3f4a5b';

// what runs.ts journal() hands the screen for a create_lead step: the tool's `data`
const createdStep = {
  type: 'tool',
  name: 'create_lead',
  args: {
    name: 'Divinos Doces e Bolos',
    city: 'Cabo Frio',
    whatsapp: '+5522999990000',
    fitScore: 8,
  },
  out: {
    lead: { ref: 'l2', name: 'Divinos Doces e Bolos', state: 'lead' },
    firstContactQueued: true,
    contactChannel: 'whatsapp',
    leadsCreated: 2,
    cap: 10,
    leadId: LEAD_ID,
    created: true,
  },
};

describe('foundLeads', () => {
  test('counts a lead the tool filed under an alias, by its real id', () => {
    const leads = foundLeads([createdStep]);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      id: LEAD_ID,
      name: 'Divinos Doces e Bolos',
      duplicate: false,
    });
    expect(leads[0].contact).toEqual(['whatsapp']);
  });

  test('older journals with lead.id still count', () => {
    const old = { ...createdStep, out: { lead: { id: LEAD_ID } } };
    expect(foundLeads([old])[0]?.id).toBe(LEAD_ID);
  });

  test('a merge into an existing lead is listed as a duplicate, linked to that lead', () => {
    const dup = {
      ...createdStep,
      out: { duplicate: true, merged: ['instagram'], leadId: LEAD_ID, created: false },
    };
    expect(foundLeads([dup])).toMatchObject([{ id: LEAD_ID, duplicate: true }]);
  });

  test('a refused or pending create_lead is not a lead', () => {
    expect(foundLeads([{ ...createdStep, out: { error: 'DISCOVERY_CAP' } }])).toEqual([]);
    expect(foundLeads([{ ...createdStep, pending: true }])).toEqual([]);
  });
});

describe('stream lines', () => {
  test('create_lead says + lead and the auto contact', () => {
    expect(outHint(createdStep)).toBe('+ lead · contato auto');
  });

  test('book shows the prospect, its verdict and the channels found', () => {
    const step = {
      type: 'tool',
      name: 'book',
      args: { action: 'upsert', name: 'Lá Choccolato', status: 'dead' },
      out: { entry: { name: 'Lá Choccolato', status: 'dead', channels: { instagram: '@x' } } },
    };
    expect(TOOL_LABEL.book).toBe('anotando prospect');
    expect(argHint(step)).toBe('Lá Choccolato · descartado');
    expect(outHint(step)).toBe('descartado');
    const open = {
      ...step,
      args: { action: 'upsert', name: 'Bolo Nosso' },
      out: { entry: { status: 'open', channels: { whatsapp: '+55', instagram: '@b' } } },
    };
    expect(argHint(open)).toBe('Bolo Nosso');
    expect(outHint(open)).toBe('whatsapp + instagram');
  });

  test('a burst of the same tool collapses to a count', () => {
    expect(callNames(['book', 'book', 'book', { name: 'read_pages' }, 'book'])).toBe(
      'book ×4, read_pages',
    );
  });

  test('every discovery tool has a label', () => {
    for (const t of ['plan', 'book', 'maps_lookup', 'instagram_profile', 'serp'])
      expect(TOOL_LABEL[t]).toBeTruthy();
  });
});
