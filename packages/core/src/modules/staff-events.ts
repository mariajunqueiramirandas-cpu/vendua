import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { controlTx } from './control.ts';

// ADR 0023: what happened across the stack, for the team. Domain code records an event in the
// same transaction as the change (`recordStaffEventTx`); the `discord` scheduler job delivers it.
// The catalog below is closed and typed: a new kind needs a data shape, a category and a label.

export const STAFF_CATEGORIES = [
  'atendimento',
  'crm',
  'vendas',
  'assinaturas',
  'frota',
  'agente',
  'sistema',
  'resumo',
] as const;
export type StaffCategory = (typeof STAFF_CATEGORIES)[number];

export const CATEGORY_META: Record<StaffCategory, { emoji: string; label: string; hint: string }> =
  {
    atendimento: {
      emoji: '🙋',
      label: 'atendimento',
      hint: 'alguém da equipe precisa agir: handoffs, rascunhos, pedidos de ajuda',
    },
    crm: { emoji: '💬', label: 'crm', hint: 'leads novos, respostas, calls e marcos do funil' },
    vendas: { emoji: '🛍️', label: 'vendas', hint: 'pedidos e pagamentos das lojas' },
    assinaturas: {
      emoji: '🧾',
      label: 'assinaturas',
      hint: 'cadastros, planos, onboarding e domínios',
    },
    frota: {
      emoji: '🚀',
      label: 'frota',
      hint: 'releases, implantações, provisionamento e incidentes',
    },
    agente: {
      emoji: '🤖',
      label: 'agente',
      hint: 'runs que falharam, teto de custo, canais caídos',
    },
    sistema: { emoji: '🛠️', label: 'sistema', hint: 'Core, erros 500, rotinas e status page' },
    resumo: { emoji: '📊', label: 'resumo', hint: 'o resumo diário' },
  };

/** how loud a kind is: off = not posted, silent = no notification, ping = mentions the staff role */
export const STAFF_LEVELS = ['off', 'silent', 'normal', 'ping'] as const;
export type StaffLevel = (typeof STAFF_LEVELS)[number];

export const SEVERITIES = ['info', 'success', 'warning', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

type Id = string;
type Name = string;
type Opt<T> = T | null;

export type OrderStep =
  | 'paid'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export type OnboardingStep =
  'paid' | 'live' | 'first_login' | 'setup' | 'payments' | 'first_order' | 'domain';

/** The day in numbers: CRM and agent from their tables, commerce, billing and system from the
 *  event log itself (staff reads never need a cross-tenant query on orders). */
export interface DailyDigest {
  /** local date (guardrails.timezone) the summary closes */
  date: string;
  crm: {
    newLeads: number;
    replies: number;
    meetingsBooked: number;
    meetingsNext24h: number;
    milestones: number;
    pendingDrafts: number;
    openTasks: number;
  };
  agent: { runs: number; failedRuns: number; costCents: number };
  vendas: {
    orders: number;
    gmvCents: number;
    cancelled: number;
    stores: number;
    top: { storeName: string; orders: number; gmvCents: number }[];
    firstOrders: string[];
  };
  assinaturas: { newStores: number; paid: number; paidCents: number; problems: number };
  frota: { storesLive: number; openIncidents: number; failedDeployments: number };
  sistema: { errors: number; boots: number; failingJobs: string[] };
}

/** One data shape per kind. Ids, names and amounts only: never a shopper's name or phone. */
export interface StaffEventMap {
  // atendimento
  'handoff.requested': {
    taskId: Id;
    leadId: Id;
    leadName: Name;
    business: Opt<string>;
    channel: Opt<string>;
    threadId: Opt<Id>;
    reason: string;
  };
  'handoff.taken': { taskId: Id; leadId: Id; by: Name };
  'handoff.resolved': { taskId: Id; leadId: Id; by: Opt<Name> };
  'draft.pending': {
    messageId: Id;
    threadId: Id;
    leadId: Id;
    leadName: Name;
    business: Opt<string>;
    channel: string;
    subject: Opt<string>;
    body: string;
  };
  'draft.resolved': {
    messageId: Id;
    outcome: 'approved' | 'rejected' | 'superseded';
    by: Opt<Name>;
  };
  'merchant.help': {
    storeName: Name;
    slug: Opt<string>;
    who: Opt<Name>;
    /** the help form's topic ('pedidos', 'pagamentos'… or 'geral') */
    topic: Opt<string>;
    message: string;
    contact: Opt<string>;
  };
  'store.request': { storeName: Name; title: string; detail: Opt<string> };
  'billing.manual': {
    storeName: Name;
    invoiceId: Id;
    amountCents: number;
    plan: Opt<string>;
  };
  // crm
  'lead.created': {
    leadId: Id;
    leadName: Name;
    business: Opt<string>;
    channel: string;
    excerpt: Opt<string>;
  };
  'lead.replied': {
    leadId: Id;
    leadName: Name;
    business: Opt<string>;
    channel: string;
    threadId: Id;
    messageId: Id;
    excerpt: Opt<string>;
  };
  'lead.milestone': {
    leadId: Id;
    leadName: Name;
    business: Opt<string>;
    from: string;
    to: string;
    by: string;
  };
  'lead.unsubscribed': {
    leadId: Id;
    leadName: Name;
    business: Opt<string>;
    by: 'agent' | 'staff' | 'complaint';
    reason: Opt<string>;
  };
  'meeting.booked': {
    meetingId: Id;
    leadId: Id;
    leadName: Name;
    business: Opt<string>;
    startsAt: string;
    source: 'link' | 'staff' | 'agent';
    roomUrl: Opt<string>;
  };
  'meeting.changed': {
    meetingId: Id;
    leadId: Id;
    leadName: Name;
    change: 'cancelled' | 'rescheduled';
    by: 'lead' | 'staff';
    startsAt: string;
  };
  // vendas
  'order.placed': {
    orderId: Id;
    number: number;
    storeName: Name;
    totalCents: number;
    method: string;
    fulfillment: Opt<string>;
    items: number;
    scheduledFor: Opt<string>;
  };
  'order.updated': {
    orderId: Id;
    number: number;
    storeName: Name;
    to: OrderStep;
    actor: Opt<string>;
  };
  'store.first_order': {
    orderId: Id;
    number: number;
    storeName: Name;
    totalCents: number;
    method: string;
  };
  'payment.problem': {
    orderId: Opt<Id>;
    number: Opt<number>;
    storeName: Name;
    status: string;
    amountCents: Opt<number>;
  };
  'payments.connection': { storeName: Name; connected: boolean; detail: Opt<string> };
  /** a store's own WhatsApp (ADR 0026): linked, dropped, back, unlinked by the phone, refused */
  'whatsapp.store': {
    storeName: Name;
    step: 'connected' | 'back' | 'lost' | 'logged_out' | 'banned' | 'disconnected';
    detail: Opt<string>;
  };
  // assinaturas
  'store.created': {
    storeName: Name;
    slug: string;
    source: 'signup' | 'invite' | 'access_code';
    owner: Opt<Name>;
    leadId: Opt<Id>;
    plan: Opt<string>;
    /** what the store sells (signup's answer) — null when nobody asked */
    segment: Opt<string>;
    /** the store started on a free trial that ends then (ADR 0025) */
    trialEndsAt?: Opt<string>;
  };
  'store.onboarding': { step: OnboardingStep };
  'billing.paid': {
    storeName: Name;
    invoiceId: Id;
    amountCents: number;
    first: boolean;
    method: Opt<string>;
    plan: Opt<string>;
  };
  'billing.problem': {
    storeName: Name;
    problem: 'card_rejected' | 'past_due' | 'cancelled' | 'trial_ended' | 'pix_mismatch' | 'other';
    detail: Opt<string>;
  };
  'domain.ready': { storeName: Name; host: string };
  'domain.live': { storeName: Name; host: string };
  'domain.tls_stuck': { storeName: Name; host: string };
  'domain.repairing': { storeName: Name; host: string };
  'domain.lapsed': { storeName: Name; host: string };
  'domain.ordered': { storeName: Name; host: string };
  'domain.registered': { storeName: Name; host: string };
  'domain.order_failed': { storeName: Name; host: string; reason: 'conflict' | 'error' };
  'domain.renewed': { storeName: Name; host: string; until: Opt<string> };
  'domain.renewal_failed': { storeName: Name; host: string };
  // frota
  'release.published': {
    releaseId: Id;
    bundle: string;
    kernel: Opt<string>;
    promoted: number;
  };
  'deployment.failed': {
    deploymentId: Id;
    storeName: Name;
    host: Opt<string>;
    releaseId: Id;
    rolledBackTo: Opt<Id>;
    reason: string;
  };
  'deployment.manual': {
    action: 'promote' | 'rollback' | 'pin' | 'unpin';
    storeName: Name;
    releaseId: Opt<Id>;
    by: Name;
  };
  'store.live': { storeName: Name; host: Opt<string> };
  'incident.opened': {
    incidentId: Id;
    kind: string;
    severity: 'warning' | 'critical';
    subject: string;
    summary: string;
    storeName: Opt<Name>;
  };
  'incident.updated': {
    incidentId: Id;
    change: 'escalated' | 'acked' | 'resolved';
    by: Opt<Name>;
    summary: Opt<string>;
  };
  // agente
  'agent.run_failed': {
    runId: Id;
    job: string;
    leadId: Opt<Id>;
    leadName: Opt<Name>;
    error: string;
    attempts: number;
  };
  'agent.cost_cap': { leadId: Id; leadName: Name; spentCents: number; capCents: number };
  /** Agent Runtime v3 (ADR 0030): a turn that exhausted its retries. Ids only, never the shopper. */
  'agent.turn_failed': {
    agentId: string;
    actorId: Id;
    turnId: Id;
    version: string;
    storeName: Opt<Name>;
    error: string;
    attempts: number;
  };
  'agent.version_rollback': {
    agentId: string;
    version: string;
    stage: string;
    reasons: string[];
  };
  'agent.qa_alert': {
    agentId: string;
    version: string;
    mean: number;
    threshold: number;
    window: number;
  };
  /** The Vendedor (ADR 0031): a store's verifier blocks, handoffs or opt-outs jumped today. */
  'vendedor.monitor': {
    storeName: Opt<Name>;
    metric: 'blocks' | 'handoffs' | 'optouts';
    today: number;
    baseline: number;
    volume: number;
  };
  /** whatsapp_lojas = the wa-gateway that runs every store's own WhatsApp (ADR 0026) */
  'channel.down': {
    channel: 'whatsapp' | 'instagram' | 'email' | 'whatsapp_lojas';
    detail: string;
  };
  'channel.up': {
    channel: 'whatsapp' | 'instagram' | 'email' | 'whatsapp_lojas';
    detail: Opt<string>;
  };
  // sistema
  'system.boot': { bootsLastHour: number; version: Opt<string> };
  'system.error': { method: string; path: string; message: string; count: number };
  'job.failing': { job: string; label: string; error: string };
  'job.recovered': { job: string; label: string; failingSince: Opt<string> };
  'status.opened': { incidentId: Id; title: string; severity: string; body: Opt<string> };
  'status.updated': { incidentId: Id; title: string; severity: string; resolved: boolean };
  'discord.test': { by: Opt<Name> };
  // resumo
  'digest.daily': DailyDigest;
}

export type StaffEventKind = keyof StaffEventMap;

export interface KindMeta<K extends StaffEventKind = StaffEventKind> {
  category: StaffCategory;
  /** default level; the `discord` setting overrides it per kind */
  level: StaffLevel;
  severity: Severity | ((d: StaffEventMap[K]) => Severity);
  /** CRM label (pt-BR) */
  label: string;
  hint?: string;
  /** events about one thing: `opens` posts a new card, `follows` edits the latest one */
  anchor?: {
    key: (d: StaffEventMap[K], tenantId: string | null) => string;
    role: 'opens' | 'follows';
  };
  /** not shown in the CRM (always delivered at its default level) */
  fixed?: boolean;
}

type Catalog = { [K in StaffEventKind]: KindMeta<K> };

export const STAFF_EVENT_KINDS: Catalog = {
  'handoff.requested': {
    category: 'atendimento',
    level: 'ping',
    severity: 'warning',
    label: 'agente pediu ajuda',
    hint: 'o agente pausou a conversa e passou para a equipe',
    anchor: { role: 'opens', key: (d) => `handoff:${d.taskId}` },
  },
  'handoff.taken': {
    category: 'atendimento',
    level: 'off',
    severity: 'info',
    label: 'handoff assumido',
    hint: 'edita o cartão; ligado, também avisa no canal',
    anchor: { role: 'follows', key: (d) => `handoff:${d.taskId}` },
  },
  'handoff.resolved': {
    category: 'atendimento',
    level: 'off',
    severity: 'success',
    label: 'handoff resolvido',
    hint: 'a tarefa [humano] foi concluída',
    anchor: { role: 'follows', key: (d) => `handoff:${d.taskId}` },
  },
  'draft.pending': {
    category: 'atendimento',
    level: 'normal',
    severity: 'info',
    label: 'rascunho para aprovar',
    hint: 'o agente escreveu e espera um ok — aprove ou rejeite pelo próprio Discord',
    anchor: { role: 'opens', key: (d) => `draft:${d.messageId}` },
  },
  'draft.resolved': {
    category: 'atendimento',
    level: 'off',
    severity: 'info',
    label: 'rascunho aprovado ou rejeitado',
    hint: 'edita o cartão do rascunho',
    anchor: { role: 'follows', key: (d) => `draft:${d.messageId}` },
  },
  'merchant.help': {
    category: 'atendimento',
    level: 'ping',
    severity: 'warning',
    label: 'lojista pediu ajuda',
    hint: 'pedido de ajuda enviado pelo painel da loja',
  },
  'store.request': {
    category: 'atendimento',
    level: 'normal',
    severity: 'info',
    label: 'pedido de uma loja',
    hint: 'site sob medida e outros pedidos que a equipe atende',
  },
  'billing.manual': {
    category: 'atendimento',
    level: 'normal',
    severity: 'warning',
    label: 'fatura esperando baixa manual',
    hint: 'loja aberta com código de acesso — marque como paga no CRM',
  },
  'lead.created': {
    category: 'crm',
    level: 'normal',
    severity: 'info',
    label: 'lead novo',
    hint: 'alguém escreveu pela primeira vez — whatsapp, email ou instagram',
  },
  'lead.replied': {
    category: 'crm',
    level: 'silent',
    severity: 'info',
    label: 'lead respondeu',
    hint: 'mensagem nova de um lead que já estava no funil',
  },
  'lead.milestone': {
    category: 'crm',
    level: 'normal',
    severity: 'success',
    label: 'lead avançou',
    hint: 'virou convidado ou a loja dele entrou no ar',
  },
  'lead.unsubscribed': {
    category: 'crm',
    level: 'silent',
    severity: 'info',
    label: 'lead pediu para sair',
  },
  'meeting.booked': {
    category: 'crm',
    level: 'normal',
    severity: 'success',
    label: 'call marcada',
    hint: 'pelo link, pelo agente ou pela equipe',
    anchor: { role: 'opens', key: (d) => `meeting:${d.meetingId}` },
  },
  'meeting.changed': {
    category: 'crm',
    level: 'normal',
    severity: (d) => (d.change === 'cancelled' ? 'warning' : 'info'),
    label: 'call remarcada ou cancelada',
    anchor: { role: 'follows', key: (d) => `meeting:${d.meetingId}` },
  },
  'order.placed': {
    category: 'vendas',
    level: 'normal',
    severity: 'info',
    label: 'pedido novo',
    hint: 'um cartão por pedido, atualizado quando é pago, entregue ou cancelado',
    anchor: { role: 'opens', key: (d) => `order:${d.orderId}` },
  },
  'order.updated': {
    category: 'vendas',
    level: 'normal',
    severity: (d) => (d.to === 'cancelled' || d.to === 'refunded' ? 'warning' : 'info'),
    label: 'pedido pago, entregue ou cancelado',
    hint: 'edita o cartão do pedido; cancelamento e reembolso também avisam',
    anchor: { role: 'follows', key: (d) => `order:${d.orderId}` },
  },
  'store.first_order': {
    category: 'vendas',
    level: 'ping',
    severity: 'success',
    label: 'primeiro pedido de uma loja',
  },
  'payment.problem': {
    category: 'vendas',
    level: 'normal',
    severity: (d) => (d.status === 'charged_back' ? 'critical' : 'warning'),
    label: 'estorno, contestação ou pagamento recusado',
  },
  'payments.connection': {
    category: 'vendas',
    level: 'normal',
    severity: (d) => (d.connected ? 'success' : 'warning'),
    label: 'Mercado Pago conectado ou desconectado',
  },
  'whatsapp.store': {
    category: 'vendas',
    level: 'normal',
    severity: (d) =>
      d.step === 'connected' || d.step === 'back'
        ? 'success'
        : d.step === 'disconnected'
          ? 'info'
          : d.step === 'banned'
            ? 'critical'
            : 'warning',
    label: 'WhatsApp de uma loja conectou, caiu ou foi desvinculado',
    hint: 'os avisos de pedido aos clientes saem pelo número da própria loja',
  },
  'store.created': {
    category: 'assinaturas',
    level: 'normal',
    severity: 'success',
    label: 'loja nova',
    hint: 'cadastro ou convite — o cartão acompanha o onboarding até o primeiro pedido',
    anchor: { role: 'opens', key: (_d, t) => `onboarding:${t}` },
  },
  'store.onboarding': {
    category: 'assinaturas',
    level: 'off',
    severity: 'success',
    label: 'passo do onboarding',
    hint: 'edita o cartão da loja; ligado, também avisa no canal',
    anchor: { role: 'follows', key: (_d, t) => `onboarding:${t}` },
  },
  'billing.paid': {
    category: 'assinaturas',
    level: 'normal',
    severity: 'success',
    label: 'plano pago',
    hint: 'primeira fatura ou renovação',
  },
  'billing.problem': {
    category: 'assinaturas',
    level: 'normal',
    severity: 'warning',
    label: 'cartão recusado, assinatura vencida ou cancelada, teste grátis sem pagamento',
  },
  'domain.ready': {
    category: 'assinaturas',
    level: 'silent',
    severity: 'success',
    label: 'domínio próprio pronto',
  },
  'domain.live': {
    category: 'assinaturas',
    level: 'silent',
    severity: 'success',
    label: 'domínio próprio no ar',
  },
  'domain.tls_stuck': {
    category: 'assinaturas',
    level: 'normal',
    severity: 'warning',
    label: 'certificado do domínio próprio travado',
  },
  'domain.repairing': {
    category: 'assinaturas',
    level: 'normal',
    severity: 'warning',
    label: 'domínio próprio parou de apontar para a Venduá',
  },
  'domain.lapsed': {
    category: 'assinaturas',
    level: 'silent',
    severity: 'info',
    label: 'domínio próprio desligado (plano sem domínio)',
  },
  'domain.ordered': {
    category: 'assinaturas',
    level: 'silent',
    severity: 'info',
    label: 'domínio pedido ao registrador',
  },
  'domain.registered': {
    category: 'assinaturas',
    level: 'silent',
    severity: 'success',
    label: 'domínio registrado',
  },
  'domain.order_failed': {
    category: 'assinaturas',
    level: 'normal',
    severity: 'warning',
    label: 'registro de domínio falhou',
  },
  'domain.renewed': {
    category: 'assinaturas',
    level: 'silent',
    severity: 'success',
    label: 'domínio renovado',
  },
  'domain.renewal_failed': {
    category: 'assinaturas',
    level: 'normal',
    severity: 'critical',
    label: 'renovação de domínio falhou',
  },
  'release.published': {
    category: 'frota',
    level: 'silent',
    severity: 'info',
    label: 'release publicado',
    hint: 'o cartão mostra quantas lojas já estão nele',
    anchor: { role: 'opens', key: (d) => `release:${d.releaseId}` },
  },
  'deployment.failed': {
    category: 'frota',
    level: 'normal',
    severity: 'warning',
    label: 'implantação falhou',
    hint: 'a loja voltou sozinha para o release anterior',
  },
  'deployment.manual': {
    category: 'frota',
    level: 'silent',
    severity: 'info',
    label: 'promote, rollback ou pin pela equipe',
  },
  'store.live': {
    category: 'frota',
    level: 'normal',
    severity: 'success',
    label: 'loja no ar',
    hint: 'o provisionamento terminou',
  },
  'incident.opened': {
    category: 'frota',
    level: 'normal',
    severity: (d) => d.severity,
    label: 'incidente aberto',
    hint: 'sonda falhando, implantação ou provisionamento travado — crítico sempre menciona',
    anchor: { role: 'opens', key: (d) => `incident:${d.incidentId}` },
  },
  'incident.updated': {
    category: 'frota',
    level: 'normal',
    severity: (d) =>
      d.change === 'escalated' ? 'critical' : d.change === 'resolved' ? 'success' : 'info',
    label: 'incidente escalado ou resolvido',
    anchor: { role: 'follows', key: (d) => `incident:${d.incidentId}` },
  },
  'agent.run_failed': {
    category: 'agente',
    level: 'normal',
    severity: 'warning',
    label: 'run do agente falhou de vez',
  },
  'agent.turn_failed': {
    category: 'agente',
    level: 'normal',
    severity: 'warning',
    label: 'turno do agente falhou de vez',
    hint: 'runtime v3: a conversa caiu no plano B (link da loja ou a loja assume)',
  },
  'agent.version_rollback': {
    category: 'agente',
    level: 'ping',
    severity: 'critical',
    label: 'versão do agente voltou atrás',
    hint: 'os monitores do anel pioraram e a versão anterior voltou para todas as lojas',
    anchor: { role: 'opens', key: (d) => `agent-version:${d.version}` },
  },
  'agent.qa_alert': {
    category: 'agente',
    level: 'normal',
    severity: 'warning',
    label: 'nota de qualidade do agente caiu',
    anchor: { role: 'opens', key: (d) => `agent-qa:${d.agentId}:${d.version}` },
  },
  'vendedor.monitor': {
    category: 'agente',
    level: 'normal',
    severity: 'warning',
    label: 'O Duá de uma loja saiu do normal',
    hint: 'bloqueios do verificador, passagens para a loja ou pedidos para parar subiram hoje',
  },
  'agent.cost_cap': {
    category: 'agente',
    level: 'normal',
    severity: 'warning',
    label: 'lead bateu o teto de custo',
  },
  'channel.down': {
    category: 'agente',
    level: 'ping',
    severity: 'critical',
    label: 'canal caiu',
    hint: 'whatsapp desconectado, instagram ou email fora do ar',
    anchor: { role: 'opens', key: (d) => `channel:${d.channel}` },
  },
  'channel.up': {
    category: 'agente',
    level: 'normal',
    severity: 'success',
    label: 'canal voltou',
    anchor: { role: 'follows', key: (d) => `channel:${d.channel}` },
  },
  'system.boot': {
    category: 'sistema',
    level: 'silent',
    severity: (d) => (d.bootsLastHour >= 3 ? 'warning' : 'info'),
    label: 'Core reiniciou',
    hint: 'cada deploy reinicia; vários na mesma hora é um loop de crash',
  },
  'system.error': {
    category: 'sistema',
    level: 'normal',
    severity: 'warning',
    label: 'erro 500 no Core',
    hint: 'agrupado por rota — no máximo um aviso a cada 10 min',
  },
  'job.failing': {
    category: 'sistema',
    level: 'normal',
    severity: 'warning',
    label: 'rotina falhando',
    anchor: { role: 'opens', key: (d) => `job:${d.job}` },
  },
  'job.recovered': {
    category: 'sistema',
    level: 'normal',
    severity: 'success',
    label: 'rotina voltou',
    anchor: { role: 'follows', key: (d) => `job:${d.job}` },
  },
  'status.opened': {
    category: 'sistema',
    level: 'normal',
    severity: (d) => (d.severity === 'outage' ? 'critical' : 'warning'),
    label: 'aviso na status page',
    hint: 'o que os lojistas leem em Ajuda e em status.vendua.com.br',
    anchor: { role: 'opens', key: (d) => `status:${d.incidentId}` },
  },
  'status.updated': {
    category: 'sistema',
    level: 'normal',
    severity: (d) => (d.resolved ? 'success' : 'info'),
    label: 'aviso da status page atualizado',
    anchor: { role: 'follows', key: (d) => `status:${d.incidentId}` },
  },
  'discord.test': {
    category: 'sistema',
    level: 'normal',
    severity: 'info',
    label: 'mensagem de teste',
    fixed: true,
  },
  'digest.daily': {
    category: 'resumo',
    level: 'normal',
    severity: 'info',
    label: 'resumo diário',
  },
};

export const STAFF_EVENT_KIND_LIST = Object.keys(STAFF_EVENT_KINDS) as StaffEventKind[];

export function isStaffEventKind(v: unknown): v is StaffEventKind {
  return typeof v === 'string' && Object.hasOwn(STAFF_EVENT_KINDS, v);
}

export function kindMeta<K extends StaffEventKind>(kind: K): KindMeta<K> {
  return STAFF_EVENT_KINDS[kind] as unknown as KindMeta<K>;
}

export function severityOf<K extends StaffEventKind>(kind: K, data: StaffEventMap[K]): Severity {
  const s = kindMeta(kind).severity;
  return typeof s === 'function' ? s(data) : s;
}

const MAX_STRING = 1800;
const MAX_ITEMS = 50;
const MAX_BYTES = 12_000;

/** Bounded copy: long strings cut with an ellipsis, long arrays trimmed, nesting capped. */
export function boundData(value: unknown, maxString = MAX_STRING, depth = 0): unknown {
  if (typeof value === 'string')
    return value.length > maxString ? `${value.slice(0, maxString - 1)}…` : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= 4) return null;
  if (Array.isArray(value))
    return value.slice(0, MAX_ITEMS).map((v) => boundData(v, maxString, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ITEMS)) {
      if (v !== undefined) out[k.slice(0, 60)] = boundData(v, maxString, depth + 1);
    }
    return out;
  }
  return null;
}

function boundedJson(data: unknown): Record<string, unknown> {
  for (const cap of [MAX_STRING, 600, 200, 60]) {
    const out = boundData(data, cap) as Record<string, unknown>;
    if (Buffer.byteLength(JSON.stringify(out), 'utf8') <= MAX_BYTES) return out;
  }
  return { truncated: true };
}

const eventLog = log.child({ mod: 'staff-events' });

export interface RecordOpts {
  /** the store it concerns; inside a store's own transaction it must be that store */
  tenantId?: string | null;
  /** at most one event per key — a replayed webhook or sweep records nothing new */
  dedupeKey?: string;
}

type Savepointable = { savepoint: <T>(fn: (sp: Sql) => Promise<T>) => Promise<T> };

/** Records a staff event inside the caller's transaction: a control tx, or the store's own
 *  tenant tx (insert-only policy). Runs in a savepoint and never throws — a bad event must not
 *  abort the change it describes. Await it on its own, never inside a Promise.all with other
 *  statements of the same tx: a rolled-back savepoint would take interleaved ones with it. */
export async function recordStaffEventTx<K extends StaffEventKind>(
  tx: Sql,
  kind: K,
  data: StaffEventMap[K],
  opts: RecordOpts = {},
): Promise<void> {
  try {
    const meta = kindMeta(kind);
    const tenantId = opts.tenantId ?? null;
    const anchor = meta.anchor ? meta.anchor.key(data, tenantId).slice(0, 120) : null;
    const severity = severityOf(kind, data);
    const dedupe = opts.dedupeKey ? opts.dedupeKey.slice(0, 200) : null;
    const json = boundedJson(data);
    await (tx as unknown as Savepointable).savepoint(
      (sp) => sp`
        insert into staff_events (kind, tenant_id, severity, anchor, dedupe_key, data)
        values (${kind}, ${tenantId}, ${severity}, ${anchor}, ${dedupe}, ${sp.json(json as never)})
      `,
    );
  } catch (e) {
    // a dedupe hit is the point of the key
    if ((e as { code?: string }).code === '23505') return;
    eventLog.warn({ err: e, kind }, 'staff event not recorded');
  }
}

/** Outside a transaction (after a commit, a worker, a boot hook): its own control tx. */
export async function recordStaffEvent<K extends StaffEventKind>(
  sql: Sql,
  kind: K,
  data: StaffEventMap[K],
  opts: RecordOpts = {},
): Promise<void> {
  try {
    await controlTx(sql, (tx) => recordStaffEventTx(tx, kind, data, opts));
  } catch (e) {
    eventLog.warn({ err: e, kind }, 'staff event not recorded');
  }
}

export interface StoreEventItem {
  id: number;
  kind: StaffEventKind;
  label: string;
  category: StaffCategory;
  severity: Severity;
  data: Record<string, unknown>;
  createdAt: string;
}

export const STORE_EVENTS_MAX = 100;

/** One store's events, newest first, paged by id (`before` = the last id of the previous page).
 *  Rows are pruned after 30 days, so this is the store's recent history, not an archive. */
export async function listStoreEventsTx(
  tx: Sql,
  tenantId: string,
  o: { before?: number | null; limit?: number; category?: StaffCategory | null } = {},
): Promise<{ events: StoreEventItem[]; nextBefore: number | null }> {
  const limit = Math.min(Math.max(o.limit ?? 30, 1), STORE_EVENTS_MAX);
  const kinds = o.category
    ? STAFF_EVENT_KIND_LIST.filter((k) => STAFF_EVENT_KINDS[k].category === o.category)
    : null;
  const rows = await tx<
    {
      id: string;
      kind: string;
      severity: Severity;
      data: Record<string, unknown>;
      created_at: Date;
    }[]
  >`
    select id, kind, severity, data, created_at from staff_events
    where tenant_id = ${tenantId}
      and (${o.before ?? null}::bigint is null or id < ${o.before ?? null}::bigint)
      and (${kinds}::text[] is null or kind = any(${kinds}::text[]))
    order by id desc
    limit ${limit + 1}
  `;
  const events = rows
    .slice(0, limit)
    .filter((r) => isStaffEventKind(r.kind))
    .map((r) => {
      const kind = r.kind as StaffEventKind;
      return {
        id: Number(r.id),
        kind,
        label: STAFF_EVENT_KINDS[kind].label,
        category: STAFF_EVENT_KINDS[kind].category,
        severity: r.severity,
        data: r.data ?? {},
        createdAt: r.created_at.toISOString(),
      };
    });
  const last = rows[limit - 1];
  return { events, nextBefore: rows.length > limit && last ? Number(last.id) : null };
}
