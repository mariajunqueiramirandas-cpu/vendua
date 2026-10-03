import { useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ControlPlan, PlanFeature } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { EditableText, editableValueClass } from '@/components/EditableText.tsx';
import { MoneyEdit } from '@/components/MoneyEdit.tsx';
import { Switch } from '@/components/ui/controls.tsx';
import { Input } from '@/components/ui/input.tsx';
import { usePatchPlan } from './queries.ts';

export const FEATURES: { key: PlanFeature; label: string; short: string; hint: string }[] = [
  { key: 'kds', label: 'cozinha (KDS)', short: 'KDS', hint: 'tela da cozinha com os pedidos' },
  {
    key: 'printing',
    label: 'impressão automática',
    short: 'impressão',
    hint: 'agentes de impressão e impressoras',
  },
  {
    key: 'loyalty',
    label: 'cartão fidelidade',
    short: 'fidelidade',
    hint: 'cartão de selos da loja',
  },
  {
    key: 'vendedor',
    label: 'Duá (vendedor com IA)',
    short: 'Duá',
    hint: 'IA que vende no WhatsApp da loja',
  },
  {
    key: 'customDomain',
    label: 'domínio próprio',
    short: 'domínio',
    hint: 'loja no domínio do lojista',
  },
  {
    key: 'customSite',
    label: 'site sob medida',
    short: 'site',
    hint: 'site feito pelo nosso agente de IA',
  },
];
export const featureLabel = (k: PlanFeature) => FEATURES.find((f) => f.key === k)?.label ?? k;

export type AiField = 'aiConversations' | 'aiTrialConversations';
export type Change = { plan: ControlPlan } & (
  | { kind: 'price'; cents: number }
  | { kind: 'trial'; days: number }
  | { kind: 'ai'; field: AiField; n: number }
  | { kind: 'feature'; feature: PlanFeature; on: boolean }
);

export const TRIAL_MAX = 60;
export const AI_MAX = 100_000;
export const trialLabel = (days: number) =>
  days > 0 ? `${days} ${days === 1 ? 'dia' : 'dias'} grátis` : 'sem teste';
export const convLabel = (n: number) =>
  n > 0 ? `${n.toLocaleString('pt-BR')} ${n === 1 ? 'conversa' : 'conversas'}` : 'nenhuma';

/** Click-to-edit whole number in [min, max]; out-of-range input is refused with `rangeError`. */
export function CountEdit({
  value,
  label,
  unit,
  min = 0,
  max,
  display,
  rangeError,
  muted,
  onSave,
}: {
  value: number;
  label: string;
  unit: string;
  min?: number | undefined;
  max: number;
  display: (n: number) => string;
  rangeError: string;
  muted?: boolean | undefined;
  onSave: (n: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const settled = useRef(false);

  if (!editing) {
    return (
      <button
        type="button"
        className={cn(
          editableValueClass,
          'whitespace-nowrap tnum',
          (muted || !value) && 'text-muted-foreground',
        )}
        title="clique para editar"
        aria-label={`editar ${label}`}
        onClick={() => {
          settled.current = false;
          setEditing(true);
        }}
      >
        {display(value)}
      </button>
    );
  }
  const commit = (raw: string) => {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    const v = raw === '' ? min : Number(raw.replace(/\./g, ''));
    if (!Number.isInteger(v) || v < min || v > max) return void toast.error(rangeError);
    if (v !== value) onSave(v);
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <Input
        autoFocus
        inputMode="numeric"
        aria-label={label}
        defaultValue={String(value)}
        className="w-20 tnum"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            settled.current = true;
            setEditing(false);
          }
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value.trim());
        }}
        onBlur={(e) => commit(e.target.value.trim())}
      />
      {unit}
    </span>
  );
}

/**
 * Inline editors shared by the desktop table cells and the plan sheet. What changes what live
 * stores pay or can use goes through `ask` (the confirm dialog); the rest saves directly.
 */
export function usePlanEditors(ask: (c: Change) => void, onHide: () => void) {
  const patch = usePatchPlan();
  // next tick: the inline input unmounts first, or its focus loss dismisses the dialog
  const later = (c: Change) => setTimeout(() => ask(c), 0);
  return {
    pending: patch.isPending,
    name: (p: ControlPlan) => (
      <EditableText
        value={p.name}
        label={`nome do plano ${p.id}`}
        className="font-medium"
        onSave={(v) => {
          const name = v?.trim() ?? '';
          if (name.length < 2 || name.length > 40)
            return void toast.error('o nome precisa ter de 2 a 40 caracteres');
          patch.mutate({ id: p.id, name });
        }}
      />
    ),
    price: (p: ControlPlan) => (
      <MoneyEdit
        cents={p.priceCents}
        label={`preço do plano ${p.name}`}
        onSave={(cents) => {
          if (cents == null) return void toast.error('o preço não pode ficar vazio');
          if (cents < 100 || cents > 10_000_000)
            return void toast.error('o preço vai de R$ 1 a R$ 100.000');
          later({ kind: 'price', plan: p, cents });
        }}
      />
    ),
    trial: (p: ControlPlan) => (
      <CountEdit
        value={p.trialDays ?? 0}
        label={`dias de teste grátis do plano ${p.name}`}
        unit="dias"
        max={TRIAL_MAX}
        display={trialLabel}
        rangeError={`o teste vai de 0 a ${TRIAL_MAX} dias`}
        onSave={(days) => later({ kind: 'trial', plan: p, days })}
      />
    ),
    ai: (p: ControlPlan, field: AiField) => (
      <CountEdit
        value={p[field] ?? 0}
        label={
          field === 'aiConversations'
            ? `conversas do Duá por mês no plano ${p.name}`
            : `conversas do Duá no teste grátis do plano ${p.name}`
        }
        unit="conversas"
        max={AI_MAX}
        muted={!p.features?.vendedor}
        display={convLabel}
        rangeError={`as conversas vão de 0 a ${AI_MAX.toLocaleString('pt-BR')}`}
        onSave={(n) => later({ kind: 'ai', plan: p, field, n })}
      />
    ),
    feature: (p: ControlPlan, feature: PlanFeature) => (
      <Switch
        checked={!!p.features?.[feature]}
        aria-label={`${featureLabel(feature)} no plano ${p.name}`}
        disabled={patch.isPending}
        onCheckedChange={(on) => ask({ kind: 'feature', plan: p, feature, on })}
      />
    ),
    recommended: (p: ControlPlan) => (
      <Switch
        checked={p.recommended}
        disabled={patch.isPending}
        aria-label={`plano ${p.name} recomendado`}
        onCheckedChange={(v) =>
          v
            ? patch.mutate({ id: p.id, recommended: true })
            : // one plan always leads: the mark only moves
              toast('ligue o recomendado em outro plano para mover')
        }
      />
    ),
    available: (p: ControlPlan) => (
      <Switch
        checked={p.available}
        aria-label={`plano ${p.name} aberto para assinatura`}
        disabled={patch.isPending}
        onCheckedChange={(v) =>
          !v && p.recommended
            ? toast('o plano recomendado fica aberto: mova o recomendado antes')
            : patch.mutate({ id: p.id, available: v })
        }
      />
    ),
    public: (p: ControlPlan) => (
      <Switch
        checked={p.public}
        aria-label={`plano ${p.name} visível no cadastro`}
        disabled={patch.isPending}
        onCheckedChange={(v) => {
          if (!v) onHide();
          patch.mutate({ id: p.id, public: v });
        }}
      />
    ),
    confirm: (c: Change) =>
      patch.mutate(
        c.kind === 'price'
          ? { id: c.plan.id, priceCents: c.cents }
          : c.kind === 'trial'
            ? { id: c.plan.id, trialDays: c.days }
            : c.kind === 'ai'
              ? { id: c.plan.id, [c.field]: c.n }
              : { id: c.plan.id, features: { [c.feature]: c.on } },
      ),
  };
}
