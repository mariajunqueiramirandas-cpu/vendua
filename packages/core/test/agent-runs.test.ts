import { describe, expect, test } from 'bun:test';
import { toolsFor } from '../src/agent/tools.ts';
import { DEFAULT_GUARDRAILS, validateSetting } from '../src/modules/integrations.ts';

describe('toolsets — research reaches triage/reply, not outreach', () => {
  const names = (kind: string) => toolsFor(kind).map((t) => t.name);

  test('triage gets the research kit', () => {
    const t = names('triage');
    for (const t_ of ['web_search', 'read_pages', 'serp', 'maps_lookup', 'instagram_profile']) {
      expect(t).toContain(t_);
    }
    // send stays out — a new lead can never be sent unreviewed
    expect(t).not.toContain('send_message');
    // strategist-only ledger stays discovery's
    expect(t).not.toContain('book');
    expect(t).not.toContain('plan');
  });

  test('reply gets light lookups only', () => {
    const r = names('reply');
    expect(r).toContain('serp');
    expect(r).toContain('web_search');
    expect(r).not.toContain('read_pages');
    expect(r).not.toContain('maps_lookup');
    expect(r).toContain('send_message');
  });

  test('outreach is untouched', () => {
    const o = names('outreach');
    expect(o).not.toContain('web_search');
    expect(o).not.toContain('serp');
    expect(o).toContain('send_message');
  });
});

describe('guardrails — pacing knobs', () => {
  test('defaults: inbound reply immediate, first contact off', () => {
    expect(DEFAULT_GUARDRAILS.inboundReplyDelayMin).toBe(0);
    expect(DEFAULT_GUARDRAILS.firstContactDelayMin).toBe(0);
  });

  test('validateSetting accepts the new keys in range', () => {
    expect(() =>
      validateSetting('guardrails', { inboundReplyDelayMin: 15, firstContactDelayMin: 60 }),
    ).not.toThrow();
    expect(() => validateSetting('guardrails', { inboundReplyDelayMin: 0 })).not.toThrow();
    expect(() => validateSetting('guardrails', { firstContactDelayMin: 0 })).not.toThrow();
  });

  test('validateSetting rejects out-of-range and non-integers', () => {
    expect(() => validateSetting('guardrails', { inboundReplyDelayMin: -1 })).toThrow();
    expect(() => validateSetting('guardrails', { inboundReplyDelayMin: 1441 })).toThrow();
    expect(() => validateSetting('guardrails', { inboundReplyDelayMin: 1.5 })).toThrow();
    expect(() => validateSetting('guardrails', { firstContactDelayMin: '60' })).toThrow();
    expect(() => validateSetting('guardrails', { firstContactDelayMin: 10081 })).toThrow();
  });
});
