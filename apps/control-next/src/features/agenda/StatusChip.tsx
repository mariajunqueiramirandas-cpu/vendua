import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarCheck, CalendarX } from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import { Fact } from '@/components/common.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/controls.tsx';
import { useMeetingsStatus } from './queries.ts';

const DAYS: [string, string][] = [
  ['mon', 'seg'],
  ['tue', 'ter'],
  ['wed', 'qua'],
  ['thu', 'qui'],
  ['fri', 'sex'],
  ['sat', 'sáb'],
  ['sun', 'dom'],
];

/** Google Calendar / room / booking config at a glance; details in a popover. */
export function MeetingsStatusChip() {
  const { data: s, error } = useMeetingsStatus();
  if (!s) return error ? <span className="text-xs text-muted-foreground">sem status</span> : null;
  const err = s.gcal.lastError || s.room.lastError;
  const Icon = err ? AlertTriangle : s.gcal.configured ? CalendarCheck : CalendarX;
  const label = err ? 'erro' : s.gcal.configured ? 'google' : 'sem google';
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-full border px-2 text-xs whitespace-nowrap text-muted-foreground hover:bg-hover pointer-coarse:h-9',
          err && 'border-warning/50 bg-warning-soft text-warning-foreground',
        )}
        aria-label="status da agenda"
      >
        <Icon className="size-3.5" />
        <span className="hidden sm:inline">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-3 text-sm">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Fact label="google agenda">
              {s.gcal.configured ? (s.gcal.calendarId ?? 'configurada') : 'não configurada'}
            </Fact>
            <Fact label="conta de serviço">{s.gcal.clientEmail ?? '—'}</Fact>
            <Fact label="sala">
              {s.room.provider === 'daily' ? 'daily (sala por call)' : 'sala fixa'}
            </Fact>
            <Fact label="fuso">{s.cfg.tz}</Fact>
            <Fact label="duração">
              {s.cfg.slotMinutes} min · folga {s.cfg.bufferMinutes} min
            </Fact>
            <Fact label="horizonte">{s.cfg.horizonDays} dias</Fact>
          </div>
          {s.gcal.lastError && (
            <p className="rounded-md bg-warning-soft px-2 py-1.5 text-xs text-warning-foreground">
              google: {s.gcal.lastError}
            </p>
          )}
          {s.room.lastError && (
            <p className="rounded-md bg-warning-soft px-2 py-1.5 text-xs text-warning-foreground">
              sala: {s.room.lastError}
            </p>
          )}
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground">disponibilidade</span>
            {DAYS.map(([k, l]) => {
              const w = s.cfg.weekly[k] ?? [];
              return (
                <div key={k} className="flex gap-2 text-xs">
                  <span className="w-8 text-muted-foreground">{l}</span>
                  <span className="tnum">
                    {w.length ? w.map(([a, b]) => `${a}–${b}`).join(', ') : '—'}
                  </span>
                </div>
              );
            })}
          </div>
          {s.cfg.bookingUrl && (
            <Fact label="link de agendamento">
              <a
                href={s.cfg.bookingUrl}
                target="_blank"
                rel="noopener"
                className="underline-offset-2 hover:underline"
              >
                {s.cfg.bookingUrl.replace(/^https?:\/\//, '')}
              </a>
            </Fact>
          )}
          <Link to="/config" className="text-xs text-muted-foreground hover:text-foreground">
            ajustar em config →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
