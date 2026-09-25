import { useEffect, useState } from 'react';
import { CalendarCheck, Plus, Video, X } from 'lucide-react';
import type { MeetingStatus } from '@/lib/api.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { ErrorHint, RawJson, SaveBar, SectionHead } from './bits.tsx';
import { num, str, tzValid } from './queries.ts';

const DAY_NAMES: [string, string][] = [
  ['seg', 'mon'],
  ['ter', 'tue'],
  ['qua', 'wed'],
  ['qui', 'thu'],
  ['sex', 'fri'],
  ['sáb', 'sat'],
  ['dom', 'sun'],
];

type Win = [string, string];
type Weekly = Record<string, Win[]>;

const normWeekly = (w: unknown): Weekly => {
  const out: Weekly = {};
  if (w && typeof w === 'object' && !Array.isArray(w)) {
    for (const [day, list] of Object.entries(w as Record<string, unknown>)) {
      if (Array.isArray(list)) {
        out[day] = list.filter((p): p is Win => Array.isArray(p) && p.length === 2);
      }
    }
  }
  for (const [, k] of DAY_NAMES) if (!out[k]) out[k] = [];
  return out;
};

export function AgendaArea({
  value,
  status,
  onSave,
  saving,
}: {
  value: Record<string, unknown>;
  /** null while loading or when the probe failed */
  status: MeetingStatus | null;
  onSave: (v: Record<string, unknown>) => void;
  saving: boolean;
}) {
  return (
    <section>
      <SectionHead
        title="reunião"
        sub="objetivo 'reunião' — o link que o agente envia quando o lead topa"
      />
      <MeetingForm value={value} status={status} onSave={onSave} saving={saving} />
    </section>
  );
}

/**
 * Availability for /agendar + the booking link. roomUrl is the static room
 * unless DAILY_API_KEY mints per-meeting rooms; the page owns the status
 * fetch so checklist and form share one snapshot.
 */
function MeetingForm({
  value,
  status,
  onSave,
  saving,
}: {
  value: Record<string, unknown>;
  status: MeetingStatus | null;
  onSave: (v: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const cur = {
    bookingUrl: str(value.bookingUrl, ''),
    roomUrl: str(value.roomUrl, ''),
    publicBaseUrl: str(value.publicBaseUrl, 'https://crm.vendua.com.br'),
    tz: str(value.tz, 'America/Sao_Paulo'),
    slotMinutes: num(value.slotMinutes, 30),
    bufferMinutes: num(value.bufferMinutes, 15),
    horizonDays: num(value.horizonDays, 14),
    weekly: normWeekly(value.weekly ?? status?.cfg.weekly),
  };
  const curKey = JSON.stringify(cur);
  const [edit, setEdit] = useState(cur);
  // `touched` gates hydration: a late response must not mark an untouched
  // form dirty or persist the all-closed weekly
  const [touched, setTouched] = useState(false);
  const update = (next: typeof cur) => {
    setTouched(true);
    setEdit(next);
  };
  const dirty = JSON.stringify(edit) !== curKey;
  // mirrors validateSetting('meeting'): IANA tz, ≤6 windows/day, open < close
  const badWin = Object.values(edit.weekly).some(
    (ws) => ws.length > 6 || ws.some(([a, b]) => !a || !b || a >= b),
  );
  const badTz = !tzValid(edit.tz);
  const invalid = badTz || badWin;
  useEffect(() => {
    if (status && !touched) {
      setEdit({ ...cur, weekly: normWeekly(value.weekly ?? status.cfg.weekly) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, curKey]);
  // clear the flag on save convergence so later refreshes can hydrate again
  useEffect(() => {
    if (touched && JSON.stringify(edit) === curKey) setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curKey]);

  const setDay = (day: string, wins: Win[]) =>
    update({ ...edit, weekly: { ...edit.weekly, [day]: wins } });
  const numIn = (k: 'slotMinutes' | 'bufferMinutes' | 'horizonDays', v: string) =>
    update({ ...edit, [k]: Number(v) });

  return (
    <div className="grid gap-3 lg:grid-cols-2 lg:grid-rows-[auto_auto_1fr] lg:items-start [&>*]:min-w-0">
      <Panel title="links e duração" className="lg:col-start-1 lg:row-start-1">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={status?.room.provider === 'daily' ? 'agent' : 'default'}>
              <Video />
              sala:{' '}
              {status
                ? status.room.provider === 'daily'
                  ? 'daily.co (por call)'
                  : 'estática'
                : '…'}
            </Badge>
            <Badge variant={status?.gcal.configured ? 'agent' : 'warn'}>
              <CalendarCheck />
              {status
                ? status.gcal.configured
                  ? 'google agenda conectada'
                  : 'google agenda: não configurada'
                : '…'}
            </Badge>
          </div>
          {status?.room.provider === 'daily' && status.room.lastError && (
            <p className="rounded-md bg-warning-soft px-2 py-1 text-xs text-warning-foreground">
              daily: {status.room.lastError}
            </p>
          )}
          {status?.gcal.lastError && (
            <p
              className="truncate rounded-md bg-destructive-soft px-2 py-1 text-xs text-destructive-foreground"
              title={status.gcal.lastError}
            >
              erro google: {status.gcal.lastError}
            </p>
          )}
          {status?.gcal.configured && (status.gcal.calendarId || status.gcal.clientEmail) && (
            <p className="truncate text-xs text-muted-foreground">
              {[status.gcal.calendarId, status.gcal.clientEmail].filter(Boolean).join(' · ')}
            </p>
          )}
          <Field
            label="link da sala (estático)"
            hint="usado quando o provider é estático — o lead recebe na confirmação"
          >
            <Input
              value={edit.roomUrl}
              placeholder="https://meet.google.com/…"
              maxLength={500}
              inputMode="url"
              onChange={(e) => update({ ...edit, roomUrl: e.target.value })}
            />
          </Field>
          <Field label="base pública do link" hint="prefixo do link de agendamento — /agendar?t=…">
            <Input
              value={edit.publicBaseUrl}
              placeholder="https://crm.vendua.com.br"
              maxLength={500}
              inputMode="url"
              onChange={(e) => update({ ...edit, publicBaseUrl: e.target.value })}
            />
          </Field>
          <Field label="fallback manual (objetivo reunião sem link interno)">
            <Input
              value={edit.bookingUrl}
              placeholder="https://calendar.google.com/calendar/appointments/…"
              maxLength={500}
              inputMode="url"
              onChange={(e) => update({ ...edit, bookingUrl: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_1fr_1.5fr]">
            <Field label="duração (min)">
              <Input
                type="number"
                inputMode="numeric"
                min={5}
                max={120}
                value={edit.slotMinutes}
                onChange={(e) => numIn('slotMinutes', e.target.value)}
              />
            </Field>
            <Field label="intervalo (min)">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={180}
                value={edit.bufferMinutes}
                onChange={(e) => numIn('bufferMinutes', e.target.value)}
              />
            </Field>
            <Field label="horizonte (dias)">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={60}
                value={edit.horizonDays}
                onChange={(e) => numIn('horizonDays', e.target.value)}
              />
            </Field>
            <Field label="fuso">
              <Input
                list="tz-list"
                value={edit.tz}
                aria-invalid={badTz}
                className="aria-invalid:border-destructive"
                onChange={(e) => update({ ...edit, tz: e.target.value })}
              />
            </Field>
          </div>
          {badTz && <ErrorHint>fuso IANA inválido</ErrorHint>}
        </div>
      </Panel>

      <Panel
        title="disponibilidade semanal"
        aside={`fuso ${edit.tz || '…'}`}
        className="lg:col-start-2 lg:row-span-3 lg:row-start-1"
      >
        <div className="flex flex-col divide-y">
          {DAY_NAMES.map(([label, day]) => (
            <DayRow
              key={day}
              label={label}
              wins={edit.weekly[day] ?? []}
              onChange={(w) => setDay(day, w)}
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          janelas no fuso {edit.tz || '…'} — fora delas nenhum slot aparece
        </p>
        {badWin && <ErrorHint>janela com abertura depois do fechamento não salva</ErrorHint>}
      </Panel>

      <div className="lg:col-start-1 lg:row-start-2">
        <RawJson value={value} onSave={onSave} />
      </div>
      {/* last child of the grid so it stays pinned on phones while any part of the form shows */}
      <SaveBar pinned={dirty} className="lg:col-start-1 lg:row-start-3">
        <Button
          disabled={!dirty || invalid || saving}
          onClick={() => onSave({ ...value, ...edit })}
        >
          salvar agenda
        </Button>
        {dirty && (
          <Button
            variant="ghost"
            onClick={() => {
              setTouched(false);
              setEdit(cur);
            }}
          >
            desfazer
          </Button>
        )}
        {dirty && !invalid && (
          <span className="text-xs text-muted-foreground">alterações não salvas</span>
        )}
      </SaveBar>
    </div>
  );
}

function DayRow({
  label,
  wins,
  onChange,
}: {
  label: string;
  wins: Win[];
  onChange: (w: Win[]) => void;
}) {
  const full = wins.length >= 6;
  const set = (i: number, w: Win) => onChange(wins.map((x, j) => (j === i ? w : x)));
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="w-9 shrink-0 pt-1.5 text-xs font-medium text-muted-foreground pointer-coarse:pt-2.5">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {wins.map((w, i) => {
          const bad = !w[0] || !w[1] || w[0] >= w[1];
          return (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-1 aria-invalid:border-destructive"
              aria-invalid={bad}
            >
              <input
                type="time"
                aria-label={`${label} abre`}
                value={w[0]}
                onChange={(e) => set(i, [e.target.value, w[1]])}
                className="h-7 bg-transparent px-1 text-base tnum outline-none md:text-xs pointer-coarse:h-9"
              />
              <span className="text-muted-foreground">–</span>
              <input
                type="time"
                aria-label={`${label} fecha`}
                value={w[1]}
                onChange={(e) => set(i, [w[0], e.target.value])}
                className="h-7 bg-transparent px-1 text-base tnum outline-none md:text-xs pointer-coarse:h-9"
              />
              <Button
                size="icon-sm"
                variant="ghost"
                title="remover janela"
                aria-label="remover janela"
                onClick={() => onChange(wins.filter((_, j) => j !== i))}
              >
                <X />
              </Button>
            </span>
          );
        })}
        {wins.length === 0 && <span className="text-xs text-muted-foreground">fechado</span>}
      </div>
      <Button
        size="icon-sm"
        variant="outline"
        title={full ? 'máx 6 janelas/dia' : 'adicionar janela'}
        aria-label="adicionar janela"
        disabled={full}
        onClick={() => onChange([...wins, ['09:00', '12:00']])}
      >
        <Plus />
      </Button>
    </div>
  );
}
