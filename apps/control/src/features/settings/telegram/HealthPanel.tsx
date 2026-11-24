import { AlertTriangle, BellOff, Users } from 'lucide-react';
import type { TelegramOverview } from '@/lib/api.ts';
import { fmtDateTime, rel } from '@/lib/format.ts';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { KpiStrip } from '@/components/common.tsx';
import { useTelegramMute } from './queries.ts';

/** Is the bot keeping up: what went out, what waits, what failed and who receives DMs. */
export function HealthPanel({ d, onGoTeam }: { d: TelegramOverview; onGoTeam: () => void }) {
  const mute = useTelegramMute();
  const q = d.queue;
  const cats = new Map(d.catalog.categories.map((c) => [c.key, c]));
  const kinds = new Map(d.catalog.kinds.map((k) => [k.kind, k.label]));
  const mutes = Object.entries(d.state.mutes);

  return (
    <Panel title="saúde" aside="o que o bot fez nas últimas 24h">
      <KpiStrip
        items={[
          {
            label: 'enviados',
            value: q.sent,
            hint: q.last ? `último há ${rel(q.last)}` : 'nenhum ainda',
          },
          {
            label: 'na fila',
            value: q.pending,
            tone: q.pending > 20 ? 'warn' : undefined,
            hint: q.oldest ? `mais antigo há ${rel(q.oldest)}` : undefined,
          },
          { label: 'falharam', value: q.failed, tone: q.failed ? 'bad' : undefined },
          { label: 'pulados', value: q.skipped, hint: 'desligados ou sem DM' },
        ]}
      />

      {d.state.lastError && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-2.5 py-2 text-sm text-warning-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">
            {d.state.lastError.message}
            <span className="block text-xs opacity-80">{fmtDateTime(d.state.lastError.at)}</span>
          </span>
        </div>
      )}

      {d.failures.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-xs" aria-label="últimas falhas">
          {d.failures.map((f, i) => (
            <li key={i} className="flex min-w-0 gap-1.5">
              <span className="shrink-0 text-muted-foreground tnum">{fmtDateTime(f.at)}</span>
              <span className="shrink-0 font-medium">{kinds.get(f.kind) ?? f.kind}</span>
              <span className="min-w-0 truncate text-muted-foreground" title={f.error ?? ''}>
                {f.error}
              </span>
            </li>
          ))}
        </ul>
      )}

      {mutes.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5 border-t pt-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-foreground/80">
            <BellOff className="size-3.5" /> silenciados
          </p>
          {mutes.map(([k, until]) => (
            <div key={k} className="flex items-center gap-2 text-sm">
              <span>
                {cats.get(k)?.emoji} {cats.get(k)?.label ?? k}
              </span>
              <span className="text-xs text-muted-foreground">até {fmtDateTime(until)}</span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                disabled={mute.isPending}
                onClick={() => mute.mutate({ category: k, minutes: 0 })}
              >
                reativar
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
        <Users className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          {d.team.linked === 0 ? (
            'ninguém conectou o Telegram ainda'
          ) : (
            <>
              {d.team.linked} de {d.team.members}{' '}
              {d.team.members === 1 ? 'pessoa recebe' : 'pessoas recebem'} os avisos na DM
              <span className="block text-xs text-muted-foreground">
                {d.team.recipients
                  .map((r) => (r.username ? `${r.name} (@${r.username})` : r.name))
                  .join(' · ')}
              </span>
            </>
          )}
        </span>
        <Button size="sm" variant="outline" onClick={onGoTeam}>
          abrir equipe
        </Button>
      </div>
    </Panel>
  );
}
