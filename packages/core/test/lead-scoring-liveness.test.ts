import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  assessInstagramActivity,
  assessMapsActivity,
  detectClosedPhrase,
  detectPausedPhrase,
  parsePostTimestamp,
  resolveLeadLiveness,
} from '../src/crm/liveness.ts';
import { passesAutoContactScore } from '../src/crm/guardrails.ts';
import { sweepOutreachBacklog } from '../src/crm/board.ts';
import { probeWhatsApp, setProbeSql } from '../src/platform-whatsapp/probe.ts';
import {
  setCachedPlatformSession,
  type PlatformSessionRow,
} from '../src/platform-whatsapp/session.ts';
import { whatsappRegistered } from '../src/crm/channels/whatsapp.ts';
import { buildSystemPrompt } from '../src/agent-host/agents/crm/prompts.ts';
import { DISCOVERY_TOOLS } from '../src/agent-host/agents/crm/discovery.ts';
import { CRM_STATES } from '../src/agent-host/agents/crm/index.ts';
import {
  DEFAULT_GUARDRAILS,
  DEFAULT_PITCH,
  upsertIntegration,
} from '../src/modules/integrations.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import type { Sql } from '../src/platform/db.ts';
import { crmBench, OWNER_URL } from './crm-harness.ts';

const NOW = new Date('2026-11-24T15:00:00Z');
const daysAgoIso = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const daysAgoUnixSec = (days: number) => Math.floor((NOW.getTime() - days * 86_400_000) / 1000);

describe('passesAutoContactScore', () => {
  test('default threshold is 7 and intent >= 6 boosts one point below', () => {
    expect(DEFAULT_GUARDRAILS.discoveryContactMinScore).toBe(7);
    expect(passesAutoContactScore(7, null, 7)).toBe(true);
    expect(passesAutoContactScore(8, 0, 7)).toBe(true);
    expect(passesAutoContactScore(6, 6, 7)).toBe(true);
    expect(passesAutoContactScore(6, 7, 7)).toBe(true);
    expect(passesAutoContactScore(6, 5, 7)).toBe(false);
    expect(passesAutoContactScore(6, null, 7)).toBe(false);
    expect(passesAutoContactScore(5, 10, 7)).toBe(false);
    expect(passesAutoContactScore(null, 10, 7)).toBe(false);
  });
});

describe('business liveness detection', () => {
  test('detects permanent closure and temporary pause without matching weekly schedules', () => {
    expect(detectClosedPhrase('Fechado permanentemente')).toBeTruthy();
    expect(
      detectClosedPhrase('Obrigado clientes! Encerramos nossas atividades em 2025.'),
    ).toBeTruthy();
    expect(detectClosedPhrase('Fechamos as portas, perfil desativado.')).toBeTruthy();
    expect(detectClosedPhrase('Não estamos mais atendendo encomendas.')).toBeTruthy();
    expect(detectPausedPhrase('Temporariamente fechado para reforma')).toBeTruthy();
    expect(detectPausedPhrase('Pausamos os pedidos até o próximo mês')).toBeTruthy();

    // Normal operating-hours text must never trigger false positives.
    expect(detectClosedPhrase('Aberto terça a domingo 10h-20h. Fechado às segundas.')).toBeNull();
    expect(detectClosedPhrase('Não atendemos aos domingos. Pedidos pelo WhatsApp!')).toBeNull();
    expect(detectClosedPhrase('Bolo de despedida e festas corporativas sob encomenda')).toBeNull();
    expect(detectPausedPhrase('Encomendas abertas para o fim de semana')).toBeNull();
  });

  test('parsePostTimestamp parses ISO strings and Unix seconds/ms', () => {
    expect(parsePostTimestamp('2026-11-10T12:00:00Z', NOW)?.toISOString().slice(0, 10)).toBe(
      '2026-11-10',
    );
    expect(parsePostTimestamp(daysAgoUnixSec(10), NOW)?.toISOString().slice(0, 10)).toBe(
      '2026-11-14',
    );
    expect(
      parsePostTimestamp(NOW.getTime() - 5 * 86_400_000, NOW)
        ?.toISOString()
        .slice(0, 10),
    ).toBe('2026-11-19');
    expect(parsePostTimestamp('not-a-date', NOW)).toBeNull();
  });

  test('assessInstagramActivity uses newest post even when an old post is pinned first', () => {
    const act = assessInstagramActivity(
      {
        biography: 'Bolos artesanais 🍰 Pedidos no link abaixo',
        postsCount: 42,
        latestPosts: [
          {
            timestamp: daysAgoIso(400),
            caption: 'Post fixado antigo de boas-vindas',
            isPinned: true,
          },
          { timestamp: daysAgoIso(8), caption: 'Cardápio de Natal aberto! Peça no WhatsApp.' },
          { timestamp: daysAgoIso(25), caption: 'Bolo de pistache fresquinho hoje' },
        ],
      },
      NOW,
    );
    expect(act.status).toBe('active');
    expect(act.daysSinceLastPost).toBe(8);
    expect(act.postsLast30d).toBe(2);
    expect(act.postsLast90d).toBe(2);
    expect(act.recentPosts[0]?.caption).toContain('Cardápio de Natal');
  });

  test('assessInstagramActivity classifies quiet, stale, closed, paused, private, and unknown', () => {
    expect(
      assessInstagramActivity({ latestPosts: [{ timestamp: daysAgoIso(95) }] }, NOW).status,
    ).toBe('quiet');
    expect(
      assessInstagramActivity({ latestPosts: [{ timestamp: daysAgoIso(220) }] }, NOW).status,
    ).toBe('stale');
    expect(assessInstagramActivity({ postsCount: 0, latestPosts: [] }, NOW).status).toBe('stale');
    expect(
      assessInstagramActivity(
        {
          biography: 'Encerramos nossas atividades. Obrigado!',
          latestPosts: [{ timestamp: daysAgoIso(5) }],
        },
        NOW,
      ).status,
    ).toBe('closed');
    expect(
      assessInstagramActivity(
        {
          biography: 'Doces sob encomenda',
          latestPosts: [{ timestamp: daysAgoIso(3), caption: 'Comunicado: fechamos as portas.' }],
        },
        NOW,
      ).status,
    ).toBe('closed');
    expect(assessInstagramActivity({ biography: 'Temporariamente fechado' }, NOW).status).toBe(
      'paused',
    );
    expect(assessInstagramActivity({ private: true, latestPosts: [] }, NOW).status).toBe('private');
    expect(assessInstagramActivity({ biography: 'Padaria do Bairro' }, NOW).status).toBe('unknown');
  });

  test('assessMapsActivity classifies permanentlyClosed, temporarilyClosed, and operational', () => {
    expect(
      assessMapsActivity({ name: 'Doceria Antiga', permanentlyClosed: true }, NOW),
    ).toMatchObject({ status: 'closed', permanentlyClosed: true });
    expect(
      assessMapsActivity({ name: 'Doceria Pausa', business_status: 'CLOSED_TEMPORARILY' }, NOW),
    ).toMatchObject({ status: 'paused', temporarilyClosed: true });
    const open = assessMapsActivity(
      {
        name: 'Padaria Viva',
        businessStatus: 'OPERATIONAL',
        reviewsCount: 84,
        openingHours: ['Seg-Sab 07:00-19:00'],
        reviews: [{ publishedAtDate: daysAgoIso(12) }],
      },
      NOW,
    );
    expect(open).toMatchObject({
      status: 'active',
      permanentlyClosed: false,
      reviewsCount: 84,
      hasOpeningHours: true,
      daysSinceLastReview: 12,
    });
  });

  test('resolveLeadLiveness: active Maps overrides stale IG, while closed always wins', () => {
    const staleIg = {
      key: '@padariaviva',
      source: 'instagram' as const,
      status: 'stale' as const,
      reason: 'Instagram @padariaviva: sem postagem há 240 dias',
    };
    const activeMaps = {
      key: 'name:padaria viva',
      source: 'maps' as const,
      status: 'active' as const,
      reason: 'Google Maps operacional (84 avaliações), com horário ativo',
    };
    const closedMaps = {
      key: 'name:padaria morta',
      source: 'maps' as const,
      status: 'closed' as const,
      reason: 'Google Maps: fechado permanentemente',
    };

    // IG-only stale → stays stale
    expect(
      resolveLeadLiveness([staleIg], { instagram: '@padariaviva', name: 'Padaria Viva' }).status,
    ).toBe('stale');

    // Stale IG + active Maps → active (many local food shops operate without posting on IG)
    expect(
      resolveLeadLiveness([staleIg, activeMaps], {
        instagram: '@padariaviva',
        name: 'Padaria Viva',
      }).status,
    ).toBe('active');

    // Permanently closed always wins
    expect(resolveLeadLiveness([closedMaps], { name: 'Padaria Morta' }).status).toBe('closed');
  });
});

describe('probeWhatsApp transaction safety', () => {
  afterEach(() => setProbeSql(null));

  test('returns null immediately instead of hanging 8s when given an uncommitted tx without a root pool', async () => {
    const fakeTx = { savepoint: async () => null } as unknown as Sql;
    const t0 = Date.now();
    const res = await probeWhatsApp(fakeTx, '+5511999990000', 5000);
    expect(res).toBeNull();
    expect(Date.now() - t0).toBeLessThan(200);
  });
});

describe('scoring & liveness prompts', () => {
  test('discovery prompt documents liveness checks and aligned fit/intent guides with default 7', () => {
    const p = buildSystemPrompt(
      'discovery',
      DEFAULT_PITCH,
      '',
      { facts: [] },
      {
        tools: new Set(DISCOVERY_TOOLS),
        autoContact: { enabled: true, minScore: 7 },
      },
    );
    expect(p).toContain('## Verificação de negócio ativo');
    expect(p).toContain('180 dias');
    expect(p).toContain('fitScore ≥ 7 (ou fitScore ≥ 6 com intentScore ≥ 6)');
    expect(p).toContain('WhatsApp, Instagram ou e-mail');
    expect(p).toContain('atrito observável');
  });

  test('reply prompt instructs updating fitScore/intentScore during live conversations', () => {
    const p = buildSystemPrompt(
      'reply',
      DEFAULT_PITCH,
      '',
      { facts: [] },
      {
        tools: new Set(CRM_STATES.reply),
      },
    );
    expect(p).toContain('Atualize fitScore/intentScore');
  });
});

describe.skipIf(!OWNER_URL)('discovery liveness gate + backlog sweep (db)', () => {
  const b = crmBench('score-liveness');
  const origFetch = globalThis.fetch;
  const origMonid = process.env.MONID_API_KEY;
  beforeAll(b.setup);
  beforeEach(() => b.mine.clear());
  afterEach(() => {
    globalThis.fetch = origFetch;
    if (origMonid === undefined) delete process.env.MONID_API_KEY;
    else process.env.MONID_API_KEY = origMonid;
  });
  afterAll(b.teardown);

  const stubMonid = (outputs: Record<string, unknown>[][]) => {
    process.env.MONID_API_KEY = 'test-key';
    let idx = 0;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ output: outputs[idx++] ?? [], cost: 0.003 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
  };

  test('create_lead rejects permanently closed or IG-only stale shops, and accepts active ones', async () => {
    await b.settings('autopilot', { discoveryContactMinScore: 7 });
    stubMonid([
      [
        {
          name: `Doceria Fechada ${b.nonce}`,
          phone: '+55 11 99111-2222',
          permanentlyClosed: true,
        },
        {
          name: `Padaria Ativa ${b.nonce}`,
          phone: '+55 11 99222-3333',
          businessStatus: 'OPERATIONAL',
          reviewsCount: 55,
          openingHours: ['Seg-Dom 07:00-20:00'],
        },
      ],
      [
        {
          username: `stale_${b.nonce}`,
          fullName: `Doces Parados ${b.nonce}`,
          biography: 'Doces artesanais',
          postsCount: 5,
          latestPosts: [{ timestamp: daysAgoIso(250), caption: 'Feliz 2025' }],
        },
      ],
    ]);

    const { outcomes } = await b.runTools(
      [
        ['maps_lookup', { query: 'doceria', city: 'São Paulo', limit: 2 }],
        ['instagram_profile', { handle: `@stale_${b.nonce}` }],
        [
          'create_lead',
          {
            name: `Doceria Fechada ${b.nonce}`,
            phone: '+55 11 99111-2222',
            fitScore: 8,
            findings: 'Doceria de bairro encontrada no Google Maps com telefone celular.',
          },
        ],
        [
          'create_lead',
          {
            name: `Doces Parados ${b.nonce}`,
            instagram: `@stale_${b.nonce}`,
            fitScore: 8,
            findings: 'Doces artesanais encontrados no Instagram sem link próprio.',
          },
        ],
        [
          'create_lead',
          {
            name: `Padaria Ativa ${b.nonce}`,
            email: `ativa-${b.nonce}@example.com`,
            fitScore: 6,
            intentScore: 6,
            findings: 'Padaria operacional no Google Maps com 55 avaliações e pedidos no balcão.',
          },
        ],
      ],
      { kind: 'discovery', payload: { query: 'docerias' } },
    );

    const dataOf = <T>(o: (typeof outcomes)[number] | undefined): T => {
      if (!o || 'blocked' in o) throw new Error(`unexpected blocked outcome: ${JSON.stringify(o)}`);
      return o.data as T;
    };

    const closedRes = dataOf<{ error?: string }>(outcomes[2]);
    expect(closedRes.error).toContain('BUSINESS_CLOSED');

    const staleRes = dataOf<{ error?: string }>(outcomes[3]);
    expect(staleRes.error).toContain('BUSINESS_STALE');

    const activeRes = dataOf<{ leadId?: string; firstContactQueued?: boolean }>(outcomes[4]);
    expect(activeRes.leadId).toBeTruthy();
    if (activeRes.leadId) b.mine.add(activeRes.leadId);
  });

  test('instagram whatsappNumber verifies WhatsApp and dual-score fit=6 + intent=6 queues first contact', async () => {
    await b.settings('autopilot', { discoveryContactMinScore: 7 });
    const waNum = b.phone();
    stubMonid([
      [
        {
          username: `doces_${b.nonce}`,
          fullName: `Doces Vivos ${b.nonce}`,
          biography: 'Encomendas pelo WhatsApp!',
          whatsappNumber: waNum,
          postsCount: 25,
          latestPosts: [{ timestamp: daysAgoIso(4), caption: 'Bolo de cenoura saindo agora!' }],
        },
      ],
    ]);

    const { outcomes } = await b.runTools(
      [
        ['instagram_profile', { handle: `@doces_${b.nonce}` }],
        [
          'create_lead',
          {
            name: `Doces Vivos ${b.nonce}`,
            instagram: `@doces_${b.nonce}`,
            whatsapp: waNum,
            fitScore: 6,
            intentScore: 6,
            findings:
              'Doceria ativa no Instagram (post há 4 dias) recebendo encomendas no WhatsApp.',
          },
        ],
      ],
      { kind: 'discovery', payload: { query: 'docerias' } },
    );
    const out1 = outcomes[1];
    if (!out1 || 'blocked' in out1) throw new Error('expected unblocked create_lead');
    const created = out1.data as {
      leadId: string;
      firstContactQueued?: boolean;
      contactChannel?: string;
    };
    b.mine.add(created.leadId);
    expect(created.firstContactQueued).toBe(true);
    expect(created.contactChannel).toBe('whatsapp');
    const [row] = await b.sql<{ whatsapp_verified: boolean }[]>`
      select whatsapp_verified from leads where id = ${created.leadId}`;
    expect(row!.whatsapp_verified).toBe(true);
  });

  test('sweepOutreachBacklog queues first contact for eligible untouched leads once (idempotent)', async () => {
    await b.settings('autopilot', { discoveryContactMinScore: 7 });
    await upsertIntegration(
      b.sql,
      { kind: 'email', driver: 'log', enabled: true },
      `em-${b.nonce}`,
    );
    const lead = (
      await controlTx(b.sql, (tx) =>
        insertLeadTx(tx, {
          name: `Backlog ${b.nonce}`,
          email: `backlog-${b.nonce}@example.com`,
          fit_score: 7,
          intent_score: 5,
          agent_mode: 'auto',
          discovered_via: 'agente·test',
        }),
      )
    ).body.lead;
    b.mine.add(lead.id);

    const first = await sweepOutreachBacklog(b.sql);
    expect(first.n).toBeGreaterThanOrEqual(1);
    const mail = await b.mail(lead.id);
    expect(mail.filter((m) => m.kind === 'lead.first_contact')).toHaveLength(1);

    // Second pass must not duplicate the first contact.
    await sweepOutreachBacklog(b.sql);
    expect((await b.mail(lead.id)).filter((m) => m.kind === 'lead.first_contact')).toHaveLength(1);
  });

  test('whatsappRegistered inside an uncommitted tx commits probe on root pool so wa-gateway answers', async () => {
    const prevTransport = process.env.WA_PLATFORM_TRANSPORT;
    process.env.WA_PLATFORM_TRANSPORT = 'gateway';
    setProbeSql(b.sql);
    const openSession: PlatformSessionRow = {
      name: 'vendua',
      wanted: true,
      state: 'open',
      detail: null,
      pair_code: null,
      pair_code_expires_at: null,
      phone: '5511900000000',
      account_name: 'Venduá',
      connected_at: new Date(),
      state_changed_at: new Date(),
      lease_until: null,
    };
    setCachedPlatformSession(openSession);
    const target = `55119${String(Date.now()).slice(-8)}`;
    try {
      const res = await b.sql.begin(async (tx) => {
        const asked = whatsappRegistered(target, tx as unknown as Sql);
        // Simulate wa-gateway reading on a separate connection while `tx` is still open.
        for (let i = 0; i < 40; i++) {
          const [p] = await b.sql<{ id: string }[]>`
            select id from platform_wa_probes where phone = ${target} and answered_at is null`;
          if (p) {
            await b.sql`update platform_wa_probes set result = true, answered_at = now() where id = ${p.id}`;
            break;
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        return asked;
      });
      expect(res).toBe(true);
    } finally {
      setProbeSql(null);
      setCachedPlatformSession(null);
      if (prevTransport === undefined) delete process.env.WA_PLATFORM_TRANSPORT;
      else process.env.WA_PLATFORM_TRANSPORT = prevTransport;
      await b.sql`delete from platform_wa_probes where phone = ${target}`;
    }
  });
});
