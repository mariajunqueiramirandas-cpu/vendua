import { CalendarCheck, Plus, X } from '@phosphor-icons/react';
import { useRef } from 'react';
import { api, type AvailabilitySchedule, type ProductDetail } from '../../lib/api.ts';
import { useAutosave } from '../../lib/autosave.ts';
import { WEEKDAYS, WEEKDAYS_LONG } from '../../lib/format.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { Chips, Field, SaveMark, Segmented, TimeInput, Toggle } from '../../ui/fields.tsx';
import {
  MAX_WINDOWS,
  scheduleSentence,
  WEEK_ORDER,
  windowProblem,
  type ScheduleWindow,
} from './schedule.ts';

const FRESH: ScheduleWindow = { days: [1, 2, 3, 4, 5] };
const DEFAULT: AvailabilitySchedule = { windows: [FRESH], outside: 'unavailable' };

const valid = (s: AvailabilitySchedule | null) =>
  !s || (s.windows.length > 0 && s.windows.every((w) => !windowProblem(w)));

/**
 * "Disponível em horários": the days (and optionally the hours) a product is sold, up to seven
 * windows, and what shoppers see outside them. Saves itself like the other product groups.
 */
export function ScheduleEditor({
  p,
  onSaved,
}: {
  p: ProductDetail;
  onSaved: (p: ProductDetail) => void;
}) {
  const { draft, setDraft, state } = useAutosave<AvailabilitySchedule | null>(
    p.availabilitySchedule ?? null,
    async (s) => {
      const r = await api.updateProduct(p.id, { availabilitySchedule: s });
      onSaved(r.product);
      return r.product.availabilitySchedule ?? null;
    },
    { valid },
  );
  // turning it off and on again brings the same windows back
  const kept = useRef<AvailabilitySchedule>(draft ?? DEFAULT);
  if (draft) kept.current = draft;

  const setWin = (i: number, w: ScheduleWindow) =>
    setDraft((d) => (d ? { ...d, windows: d.windows.map((x, k) => (k === i ? w : x)) } : d));

  return (
    <div className="space-y-4">
      <Toggle
        checked={!!draft}
        onChange={(v) => setDraft(v ? kept.current : null)}
        label="Só em alguns dias ou horários"
        description={
          draft
            ? 'Vale junto com o horário da loja: com a loja fechada, ninguém pede.'
            : 'Desligado: aparece sempre que a loja estiver aberta.'
        }
      />
      {draft ? (
        <>
          <div
            className="flex items-start gap-3 rounded-md bg-spark-soft px-4 py-3"
            aria-live="polite"
          >
            <CalendarCheck weight="duotone" className="mt-0.5 size-5 shrink-0" aria-hidden />
            <p className="t-body min-w-0 flex-1">
              {valid(draft)
                ? scheduleSentence(draft)
                : 'Termine de preencher os horários para salvar.'}
            </p>
            <SaveMark state={state} />
          </div>
          <ol className="space-y-3">
            {draft.windows.map((w, i) => (
              <WindowRow
                key={i}
                n={i}
                w={w}
                many={draft.windows.length > 1}
                onChange={(x) => setWin(i, x)}
                onRemove={() =>
                  setDraft((d) => (d ? { ...d, windows: d.windows.filter((_, k) => k !== i) } : d))
                }
              />
            ))}
          </ol>
          {draft.windows.length < MAX_WINDOWS ? (
            <Button
              variant="ghost"
              icon={<Plus />}
              className="-ml-2"
              onClick={() =>
                setDraft((d) =>
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
          <Field
            label="Fora desses horários"
            helper={
              draft.outside === 'hidden'
                ? 'Ninguém vê o produto até o próximo horário.'
                : 'O cliente vê o produto, com os dias em que ele sai, mas não consegue pedir.'
            }
          >
            <Chips
              label="fora desses horários"
              value={draft.outside}
              onChange={(v) => setDraft((d) => (d ? { ...d, outside: v } : d))}
              options={[
                { value: 'unavailable', label: 'aparece como indisponível' },
                { value: 'hidden', label: 'some do cardápio' },
              ]}
            />
          </Field>
        </>
      ) : null}
    </div>
  );
}

/** One window: its days, and the whole day or a range. The promotion's editor uses it too. */
export function WindowRow({
  n,
  w,
  many,
  onChange,
  onRemove,
  error,
}: {
  n: number;
  w: ScheduleWindow;
  many: boolean;
  onChange: (w: ScheduleWindow) => void;
  onRemove: () => void;
  /** Core's word on this window, when it refused it */
  error?: string | null | undefined;
}) {
  const problem = windowProblem(w) ?? error ?? null;
  const ranged = !!(w.from || w.to);
  const label = `horário ${n + 1}`;
  return (
    <li
      aria-label={label}
      className={cn('space-y-3 rounded-md p-3 ring-1', problem ? 'ring-danger/50' : 'ring-line')}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="t-label">Dias</p>
        {many ? (
          <IconButton
            label={`remover ${label}`}
            size="sm"
            className="-my-1 -mr-1"
            onClick={onRemove}
          >
            <X />
          </IconButton>
        ) : null}
      </div>
      <Chips
        multi
        label={`dias do ${label}`}
        value={w.days.map(String)}
        className="[&>button]:min-w-12 [&>button]:px-3"
        onChange={(v) => {
          const d = Number(v);
          onChange({
            ...w,
            days: w.days.includes(d) ? w.days.filter((x) => x !== d) : [...w.days, d].sort(),
          });
        }}
        options={WEEK_ORDER.map((d) => ({
          value: String(d),
          label: (
            <>
              <span aria-hidden>{WEEKDAYS[d]}</span>
              <span className="sr-only">{WEEKDAYS_LONG[d]}</span>
            </>
          ),
        }))}
      />
      <Segmented
        label={`horas do ${label}`}
        value={ranged ? 'range' : 'all'}
        onChange={(v) =>
          onChange(v === 'all' ? { days: w.days } : { days: w.days, from: '11:00', to: '15:00' })
        }
        options={[
          { value: 'all', label: 'o dia todo' },
          { value: 'range', label: 'só em um horário' },
        ]}
      />
      {ranged ? (
        <div className="flex items-center gap-2">
          <span className="t-body text-muted">das</span>
          <TimeInput
            label={`${label}: começa`}
            value={w.from ?? ''}
            onCommit={(t) => onChange({ ...w, from: t })}
          />
          <span className="t-body text-muted">às</span>
          <TimeInput
            label={`${label}: termina`}
            value={w.to ?? ''}
            onCommit={(t) => onChange({ ...w, to: t })}
          />
        </div>
      ) : null}
      {problem ? (
        <p className="t-caption text-danger" role="alert">
          {problem}
        </p>
      ) : null}
    </li>
  );
}
