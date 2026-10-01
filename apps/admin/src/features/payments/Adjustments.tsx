import { PencilSimple, Plus } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { adjustmentKind, adjustmentText } from '@vendua/kernel/rules';
import {
  api,
  ApiError,
  type PaymentAdjustment,
  type Payments as PaymentsData,
  type PayMethod,
} from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import { moneyInput, parseMoney } from '../../lib/parse.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { messageOf } from '../../ui/feedback.tsx';
import { Field, Segmented, TextInput } from '../../ui/fields.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';

/** Under a payment method's toggle: what the shopper gets, and the way to change it. */
export function AdjustmentLine({
  method,
  label,
  data,
  canEdit,
}: {
  method: PayMethod;
  label: string;
  data: PaymentsData;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const adj = data.adjustments?.[method];
  const text = adjustmentText(adj);
  const discount = adjustmentKind(adj) === 'discount';
  if (!text && !canEdit) return null;
  return (
    <div className="-mt-1 pb-2">
      {text ? (
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => setOpen(true)}
          aria-label={canEdit ? `${label}: ${text}. Mudar` : undefined}
          className={cn(
            't-caption inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 font-semibold',
            discount ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning',
          )}
        >
          {text}
          {canEdit ? <PencilSimple weight="bold" className="size-3.5" aria-hidden /> : null}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="t-caption -ml-2 inline-flex min-h-10 items-center gap-1 rounded-full px-2 font-semibold text-muted hover:bg-hover hover:text-ink"
        >
          <Plus weight="bold" className="size-3.5" aria-hidden />
          desconto ou acréscimo
        </button>
      )}
      {canEdit ? (
        <AdjustmentSheet
          open={open}
          onOpenChange={setOpen}
          method={method}
          label={label}
          data={data}
        />
      ) : null}
    </div>
  );
}

type Kind = 'discount' | 'surcharge';

function AdjustmentSheet({
  open,
  onOpenChange,
  method,
  label,
  data,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  method: PayMethod;
  label: string;
  data: PaymentsData;
}) {
  const qc = useQueryClient();
  const saved = data.adjustments?.[method];
  // Core's bounds, either sign
  const maxPct = data.adjustmentBounds.maxPercentBps / 100;
  const maxFixed = data.adjustmentBounds.maxFixedCents;
  const [kind, setKind] = useState<Kind>('discount');
  const [pct, setPct] = useState('');
  const [fixedText, setFixedText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const sign = (saved?.percentBps ?? 0) || (saved?.fixedCents ?? 0);
    setKind(sign > 0 ? 'surcharge' : 'discount');
    setPct(
      saved?.percentBps
        ? (Math.abs(saved.percentBps) / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
        : '',
    );
    setFixedText(saved?.fixedCents ? moneyInput(Math.abs(saved.fixedCents)) : '');
    setErr(null);
  }, [open, saved?.percentBps, saved?.fixedCents]);

  const pctNum = pct.trim() ? Number(pct.replace(',', '.').replace('%', '').trim()) : 0;
  const pctBad = !Number.isFinite(pctNum) || pctNum < 0 || pctNum > maxPct;
  const fixed = fixedText.trim() ? parseMoney(fixedText) : 0;
  const fixedBad = fixed === null || fixed > maxFixed;
  const sign = kind === 'discount' ? -1 : 1;
  const next: PaymentAdjustment = {
    ...(pctNum && !pctBad ? { percentBps: sign * Math.round(pctNum * 100) } : {}),
    ...(fixed ? { fixedCents: sign * fixed } : {}),
  };
  const preview = adjustmentText(next);

  const save = useMutation({
    mutationFn: (adj: PaymentAdjustment | null) => {
      // PATCH replaces the whole map: send the others as they are
      const { [method]: _, ...rest } = data.adjustments ?? {};
      return api.updatePayments({ adjustments: adj ? { ...rest, [method]: adj } : rest });
    },
    onSuccess: (d, adj) => {
      qc.setQueryData(qk.payments, d);
      onOpenChange(false);
      toast(adj ? `${label}: ${adjustmentText(adj)}` : `${label} sem desconto ou acréscimo`);
    },
    onError: (e) =>
      setErr(
        e instanceof ApiError && e.code === 'INVALID_ADJUSTMENT'
          ? `Confira os valores: até ${maxPct}% e até ${money(maxFixed)}.`
          : messageOf(e),
      ),
  });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Desconto ou acréscimo no ${label}`}
      description="Vale sobre os produtos, depois do cupom. A taxa de entrega não entra."
      footer={
        <div className="flex gap-2">
          {saved ? (
            <Button
              variant="ghost"
              loading={save.isPending && save.variables === null}
              onClick={() => save.mutate(null)}
            >
              tirar
            </Button>
          ) : null}
          <Button
            size="lg"
            block
            loading={save.isPending && save.variables !== null}
            disabled={!preview || pctBad || fixedBad}
            onClick={() => save.mutate(next)}
          >
            salvar
          </Button>
        </div>
      }
    >
      <div className="space-y-5 pt-2">
        <Segmented
          label="desconto ou acréscimo"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'discount', label: 'Desconto' },
            { value: 'surcharge', label: 'Acréscimo' },
          ]}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Porcentagem" htmlFor="adj-pct" error={pctBad ? `De 0 a ${maxPct}%.` : null}>
            <TextInput
              id="adj-pct"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={pct}
              maxLength={6}
              trail="%"
              aria-invalid={pctBad || undefined}
              onChange={(e) => setPct(e.target.value)}
              className="tnum"
            />
          </Field>
          <Field
            label="Valor fixo"
            htmlFor="adj-fixed"
            error={
              fixed === null
                ? 'Digite um valor, como 2,50.'
                : fixedBad
                  ? `Até ${money(maxFixed)}.`
                  : null
            }
          >
            <TextInput
              id="adj-fixed"
              lead="R$"
              inputMode="decimal"
              autoComplete="off"
              value={fixedText}
              maxLength={12}
              aria-invalid={fixedBad || undefined}
              onChange={(e) => setFixedText(e.target.value)}
              className="tnum"
            />
          </Field>
        </div>
        <p className="t-caption text-muted">Use um dos dois, ou os dois juntos.</p>
        <div
          className={cn(
            'rounded-md p-4',
            preview ? (kind === 'discount' ? 'bg-success-soft' : 'bg-warning-soft') : 'bg-sunken',
          )}
          aria-live="polite"
        >
          <p className="t-caption text-muted">Como fica</p>
          <p className="t-body-lg font-semibold">
            {preview ? `${label}: ${preview}` : `${label}: sem desconto ou acréscimo`}
          </p>
        </div>
        {err ? (
          <p className="t-body text-danger" role="alert">
            {err}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
