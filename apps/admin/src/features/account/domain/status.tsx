import {
  ArrowsClockwise,
  CheckCircle,
  Clock,
  type Icon,
  Prohibit,
  WarningCircle,
} from '@phosphor-icons/react';
import type { Account, CustomDomainStatus } from '../../../lib/api.ts';
import { Chip, type Tone } from './kit.tsx';

export type Domain = NonNullable<Account['customDomain']>;
export type Order = NonNullable<Account['domainOrder']>;

export const DOMAIN: Record<CustomDomainStatus, { tone: Tone; icon: Icon; label: string }> = {
  ordering: { tone: 'info', icon: ArrowsClockwise, label: 'registrando' },
  pending_dns: { tone: 'warning', icon: Clock, label: 'esperando o DNS' },
  dns_ok: { tone: 'info', icon: ArrowsClockwise, label: 'ativando' },
  active: { tone: 'success', icon: CheckCircle, label: 'no ar' },
  repairing: { tone: 'danger', icon: WarningCircle, label: 'com problema' },
  lapsed: { tone: 'neutral', icon: Prohibit, label: 'desligado' },
  failed: { tone: 'danger', icon: WarningCircle, label: 'com problema' },
};

export function DomainChip({ status }: { status: CustomDomainStatus }) {
  const m = DOMAIN[status];
  return (
    <Chip tone={m.tone} icon={m.icon}>
      {m.label}
    </Chip>
  );
}

export const cleanHost = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');

export const HOST_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/;

// second-level public suffixes people actually type (Core holds the real list; it answers
// DOMAIN_NOT_ROOT when this guess is wrong)
const SLD =
  /\.(com|net|org|art|blog|eco|ind|inf|adv|arq|eng|med|ong|tur|tv|app|dev|log|rec|srv|edu|gov|co|ac)\.[a-z]{2}$/;

/** a single label under a public suffix: loja.com.br, loja.com, not www.loja.com.br */
export function isRoot(host: string) {
  if (!HOST_RE.test(host)) return false;
  const labels = host.split('.').length;
  return labels === (SLD.test(`.${host}`) && labels >= 3 ? 3 : 2);
}

/** a registry date with its year: "12 de outubro de 2027" */
export const dateLong = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(iso.length === 10 ? `${iso}T12:00:00` : iso),
  );

/** the steps the setup card shows, and where this domain is on them */
export function stepsOf(d: Domain): { steps: string[]; at: number } {
  const live = d.status === 'active' ? 2 : -1;
  if (d.source === 'included')
    return {
      steps: ['Registro', 'Configuração', 'No ar'],
      at: live >= 0 ? live : d.status === 'ordering' ? 0 : d.status === 'dns_ok' ? 2 : 1,
    };
  if (d.method === 'ns')
    return {
      steps: ['Conferir registros', 'Trocar servidores', 'No ar'],
      at: live >= 0 ? live : !d.recordsConfirmed ? 0 : d.status === 'dns_ok' ? 2 : 1,
    };
  return {
    steps: ['Criar os registros', 'DNS conferido', 'No ar'],
    at: live >= 0 ? live : d.status === 'dns_ok' ? 1 : 0,
  };
}
