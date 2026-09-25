import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, CalendarClock, Check, UserX, Video, X } from 'lucide-react';
import type { Meeting } from '@/lib/api.ts';
import { MEETING_STATUS_LABEL } from '@/lib/labels.ts';
import { fmtDateTime } from '@/lib/format.ts';
import { cn } from '@/lib/cn.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { ConfirmButton, Fact } from '@/components/common.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';
import { useMeetingsStatus, usePatchMeeting } from './queries.ts';
import { dayKeyOf, dayLabel, fmtTime, wallTime, zonedToUtc } from './tz.ts';

type Status = Meeting['status'];

/** Block fill + left rule per status — tokens only, legible in both themes. */
export const STATUS_BLOCK: Record<Status, string> = {
  scheduled: 'border-l-primary bg-card',
  done: 'border-l-success bg-secondary text-muted-foreground',
  no_show: 'border-l-warning bg-warning-soft',
  cancelled: 'border-l-border-strong bg-muted text-muted-foreground [&_.mtg-who]:line-through',
};

export const STATUS_DOT: Record<Status, string> = {
  scheduled: 'bg-primary',
  done: 'bg-success',
  no_show: 'bg-warning',
  cancelled: 'bg-border-strong',
};

const STATUS_BADGE = {
  scheduled: 'outline',
  done: 'contacted',
  no_show: 'warn',
  cancelled: 'default',
} as const;

export function MeetingStatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <Badge variant={STATUS_BADGE[status]} className={className}>
      {MEETING_STATUS_LABEL[status]}
    </Badge>
  );
}

const SOURCE_LABEL: Record<Meeting['source'], string> = {
  link: 'link de agendamento',
  staff: 'equipe',
  agent: 'agente',
};

export const meetingWho = (m: Meeting) => m.leadName ?? m.bookerName ?? (m.leadId ? 'lead' : '—');

export function RoomLink({ m, className }: { m: Meeting; className?: string }) {
  if (!m.roomUrl || m.status !== 'scheduled') return null;
  return (
    <Button asChild variant="ghost" size="icon-sm" className={className}>
      <a
        href={m.roomUrl}
        target="_blank"
        rel="noopener"
        title="abrir sala"
        aria-label="abrir sala"
        onClick={(e) => e.stopPropagation()}
      >
        <Video />
      </a>
    </Button>
  );
}

/** Status transitions — same set as the old calendar, including the done↔no-show corrections. */
function MeetingActions({ m, onDone }: { m: Meeting; onDone?: () => void }) {
  const patch = usePatchMeeting();
  const set = (status: Status) =>
    patch.mutate({ id: m.id, patch: { status } }, { onSuccess: () => onDone?.() });
  const busy = patch.isPending;
  return (
    <>
      {m.status === 'scheduled' && (
        <>
          <Button variant="default" disabled={busy} onClick={() => set('done')}>
            <Check /> feita
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => set('no_show')}>
            <UserX /> no-show
          </Button>
          <ConfirmButton
            variant="destructive-outline"
            disabled={busy}
            confirm="cancelar?"
            onConfirm={() => set('cancelled')}
          >
            <X /> cancelar
          </ConfirmButton>
        </>
      )}
      {m.status === 'done' && (
        <Button variant="outline" disabled={busy} onClick={() => set('no_show')}>
          <UserX /> corrigir: foi no-show
        </Button>
      )}
      {m.status === 'no_show' && (
        <Button variant="outline" disabled={busy} onClick={() => set('done')}>
          <Check /> corrigir: foi realizada
        </Button>
      )}
    </>
  );
}

function Reschedule({ m, tz }: { m: Meeting; tz: string }) {
  const patch = usePatchMeeting();
  const [day, setDay] = useState(() => dayKeyOf(new Date(m.startsAt), tz).key);
  const [time, setTime] = useState(() => wallTime(m.startsAt, tz));
  useEffect(() => {
    setDay(dayKeyOf(new Date(m.startsAt), tz).key);
    setTime(wallTime(m.startsAt, tz));
  }, [m.startsAt, tz]);
  const start = zonedToUtc(day, time, tz);
  const durMs = new Date(m.endsAt).getTime() - new Date(m.startsAt).getTime();
  const changed = !!start && start.getTime() !== new Date(m.startsAt).getTime();
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!start || !changed) return;
        patch.mutate({
          id: m.id,
          patch: {
            startsAt: start.toISOString(),
            endsAt: new Date(start.getTime() + durMs).toISOString(),
          },
        });
      }}
    >
      <div className="flex items-center gap-1.5 text-[13px] font-semibold">
        <CalendarClock className="size-3.5 text-muted-foreground" /> reagendar
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          mantém {Math.round(durMs / 60_000)} min · {tz}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_8.5rem] gap-2">
        <Field label="dia" htmlFor="mtg-day">
          <Input id="mtg-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Field label="início" htmlFor="mtg-time">
          <Input
            id="mtg-time"
            type="time"
            step={300}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </Field>
      </div>
      <Button
        type="submit"
        variant="outline"
        disabled={!changed || patch.isPending}
        className="self-end"
      >
        {patch.isPending ? 'salvando…' : 'mover call'}
      </Button>
    </form>
  );
}

export function MeetingSheet({
  meeting: m,
  tz,
  onClose,
}: {
  meeting: Meeting | null;
  tz: string;
  onClose: () => void;
}) {
  const status = useMeetingsStatus().data;
  const k = m ? dayKeyOf(new Date(m.startsAt), tz) : null;
  return (
    <ResponsiveSheet
      open={!!m}
      onOpenChange={(o) => !o && onClose()}
      title={m ? meetingWho(m) : ''}
      description={
        m && k
          ? `${dayLabel(k, { weekday: 'long', day: 'numeric', month: 'long' })} · ${fmtTime(m.startsAt, tz)}–${fmtTime(m.endsAt, tz)}`
          : undefined
      }
      footer={m && <MeetingActions m={m} />}
    >
      {m && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <MeetingStatusBadge status={m.status} />
            {m.source === 'agent' && (
              <Badge variant="agent">
                <Bot /> marcada pelo agente
              </Badge>
            )}
            {m.roomUrl && m.status === 'scheduled' && (
              <Button asChild size="sm" variant="outline" className="ml-auto">
                <a href={m.roomUrl} target="_blank" rel="noopener">
                  <Video /> abrir sala
                </a>
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="lead">
              {m.leadId ? (
                <Link to={`/pipeline/${m.leadId}`} className="underline-offset-2 hover:underline">
                  {m.leadName ?? m.bookerName ?? 'lead'}
                </Link>
              ) : (
                '—'
              )}
            </Fact>
            <Fact label="quem agendou">{m.bookerName ?? '—'}</Fact>
            <Fact label="contato">{m.bookerContact ?? '—'}</Fact>
            <Fact label="origem">{SOURCE_LABEL[m.source]}</Fact>
            <Fact label="sala">
              {m.roomUrl ? (
                <a
                  href={m.roomUrl}
                  target="_blank"
                  rel="noopener"
                  className="underline-offset-2 hover:underline"
                >
                  {m.roomUrl.replace(/^https?:\/\//, '')}
                </a>
              ) : (
                'sem sala'
              )}
            </Fact>
            <Fact label="google agenda">
              {m.gcalEventId
                ? 'sincronizada'
                : status?.gcal.configured
                  ? 'não sincronizada'
                  : 'não configurada'}
            </Fact>
            <Fact label="lembrete 24h">
              {m.reminder24hAt ? fmtDateTime(m.reminder24hAt) : 'não enviado'}
            </Fact>
            <Fact label="lembrete 1h">
              {m.reminder1hAt ? fmtDateTime(m.reminder1hAt) : 'não enviado'}
            </Fact>
            <Fact label="criada">{fmtDateTime(m.createdAt)}</Fact>
            {m.cancelledAt && <Fact label="cancelada">{fmtDateTime(m.cancelledAt)}</Fact>}
          </div>
          {m.status === 'scheduled' && <Reschedule m={m} tz={tz} />}
        </div>
      )}
    </ResponsiveSheet>
  );
}

/** Compact meeting row for day lists (phones, Hoje). */
export function MeetingRow({
  m,
  tz,
  onOpen,
  className,
}: {
  m: Meeting;
  tz: string;
  onOpen: (m: Meeting) => void;
  className?: string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(m)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(m)}
      className={cn(
        'flex min-h-12 items-center gap-3 rounded-md border border-l-[3px] px-2.5 py-1.5 transition-colors hover:bg-hover',
        STATUS_BLOCK[m.status],
        className,
      )}
    >
      <div className="w-[5.5rem] shrink-0 text-xs tnum">
        {fmtTime(m.startsAt, tz)}–{fmtTime(m.endsAt, tz)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mtg-who truncate text-sm font-medium">{meetingWho(m)}</div>
        {m.bookerContact && (
          <div className="truncate text-xs text-muted-foreground">{m.bookerContact}</div>
        )}
      </div>
      {m.source === 'agent' && <Bot className="size-3.5 shrink-0 text-muted-foreground" />}
      <MeetingStatusBadge status={m.status} />
      <RoomLink m={m} />
    </div>
  );
}
