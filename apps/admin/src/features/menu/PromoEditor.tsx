import { Plus, SealPercent } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { api, ApiError, type ProductDetail } from '../../lib/api.ts';
import { useAutosave } from '../../lib/autosave.ts';
import { money } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { Field, MoneyField, SaveMark, Toggle } from '../../ui/fields.tsx';
import { toast } from '../../ui/Toast.tsx';
import { MAX_WINDOWS, promoSentence, windowProblem, type ScheduleWindow } from './schedule.ts';
import { WindowRow } from './ScheduleEditor.tsx';

// the price stays empty until the merchant types one, so nothing saves before that
type Draft = { priceCents: number | null; windows: ScheduleWindow[] };
const FRESH: Draft = {
  priceCents: null,
  windows: [{ days: [1, 2, 3, 4, 5], from: '18:00', to: '20:00' }],
};

type Problem = { at: 'price' } | { at: 'window'; i: number | null };

/**
 * "Promoção por horário": a lower price on some days and hours (the same windows as "Dias e
 * horários"). Core serves it as the price inside them, the regular one struck through.
 */
export function PromoEditor({
  p,
  onSaved,
}: {
  p: ProductDetail;
  onSaved: (p: ProductDetail) => void;
}) {
  const [problem, setProblem] = useState<Problem | null>(null);
  const priceOk = (c: number | null): c is number => c !== null && c < p.priceCents;
  const valid = (d: Draft | null) =>
    !d ||
    (priceOk(d.priceCents) && d.windows.length > 0 && d.windows.every((w) => !windowProblem(w)));
  const { draft, setDraft, state } = useAutosave<Draft | null>(
    p.promoSchedule ?? null,
    async (d) => {
      try {
        const r = await api.updateProduct(p.id, {
          promoSchedule: d ? { priceCents: d.priceCents, windows: d.windows } : null,
        });
        setProblem(null);
        onSaved(r.product);
        return r.product.promoSchedule ?? null;
      } catch (e) {
        const f = e instanceof ApiError ? e.field : undefined;
        if (f === 'promoSchedule.priceCents') setProblem({ at: 'price' });
        else if (f?.startsWith('promoSchedule.windows')) {
          const i = /windows\[(\d+)\]/.exec(f)?.[1];
          setProblem({ at: 'window', i: i === undefined ? null : Number(i) });
        } else toast.error(messageOf(e));
        throw e;
      }
    },
    { valid },
  );
  const edit = (next: Draft | null | ((d: Draft | null) => Draft | null)) => {
    setProblem(null);
    setDraft(next);
  };
  // turning it off and on again brings the same promotion back
  const kept = useRef<Draft>(draft ?? FRESH);
  if (draft) kept.current = draft;
  const setWin = (i: number, w: ScheduleWindow) =>
    edit((d) => (d ? { ...d, windows: d.windows.map((x, k) => (k === i ? w : x)) } : d));
  // promoNow is Core's answer for what it holds; a draft still saving isn't that yet
  const synced = JSON.stringify(draft) === JSON.stringify(p.promoSchedule ?? null);

  return (
    <div className="space-y-4">
      <Toggle
        checked={!!draft}
        onChange={(v) => edit(v ? kept.current : null)}
        label="Preço menor em alguns dias e horários"
        description={
          draft
            ? 'Na hora da promoção, a loja mostra o preço normal riscado.'
            : 'Desligada: o preço é sempre o mesmo.'
        }
      />
      {draft ? (
        <>
          <div
            className="flex items-start gap-3 rounded-md bg-spark-soft px-4 py-3"
            aria-live="polite"
          >
            <SealPercent weight="duotone" className="mt-0.5 size-5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="t-body">
                {valid(draft) && draft.priceCents !== null
                  ? promoSentence(
                      { priceCents: draft.priceCents, windows: draft.windows },
                      p.priceCents,
                    )
                  : draft.priceCents === null
                    ? 'Escolha o preço da promoção para salvar.'
                    : 'Termine de preencher a promoção para salvar.'}
              </p>
              {synced && p.promoSchedule ? (
                p.promoNow ? (
                  <span className="t-caption mt-1.5 inline-block rounded-full bg-success-soft px-2 py-0.5 font-semibold text-success">
                    valendo agora
                  </span>
                ) : (
                  <p className="t-caption mt-1 text-muted">Fora do horário agora.</p>
                )
              ) : null}
            </div>
            <SaveMark state={state} />
          </div>
          <Field
            label="Preço na promoção"
            htmlFor={`promo-${p.id}`}
            helper={`O preço normal é ${money(p.priceCents)}.`}
            error={
              problem?.at === 'price'
                ? `Precisa ficar abaixo do preço normal, ${money(p.priceCents)}.`
                : null
            }
          >
            <MoneyField
              id={`promo-${p.id}`}
              cents={draft.priceCents}
              placeholder=""
              validate={(v) =>
                v >= p.priceCents ? `Precisa ficar abaixo de ${money(p.priceCents)}.` : null
              }
              onCommit={(v) => edit((d) => (d ? { ...d, priceCents: v } : d))}
            />
          </Field>
          <div className="space-y-2">
            <p className="t-label">Quando vale</p>
            <ol className="space-y-3">
              {draft.windows.map((w, i) => (
                <WindowRow
                  key={i}
                  n={i}
                  w={w}
                  many={draft.windows.length > 1}
                  error={
                    problem?.at === 'window' && (problem.i === i || problem.i === null)
                      ? 'Confira este horário.'
                      : null
                  }
                  onChange={(x) => setWin(i, x)}
                  onRemove={() =>
                    edit((d) => (d ? { ...d, windows: d.windows.filter((_, k) => k !== i) } : d))
                  }
                />
              ))}
            </ol>
          </div>
          {draft.windows.length < MAX_WINDOWS ? (
            <Button
              variant="ghost"
              icon={<Plus />}
              className="-ml-2"
              onClick={() =>
                edit((d) =>
                  d
                    ? { ...d, windows: [...d.windows, { days: [6], from: '09:00', to: '13:00' }] }
                    : d,
                )
              }
            >
              adicionar outro horário
            </Button>
          ) : (
            <p className="t-caption text-muted">Dá para ter até {MAX_WINDOWS} horários.</p>
          )}
        </>
      ) : null}
    </div>
  );
}
