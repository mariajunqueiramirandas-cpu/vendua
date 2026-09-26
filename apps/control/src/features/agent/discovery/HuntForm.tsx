import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Loader2 } from 'lucide-react';
import { api, type AgentRun, type SegmentStat } from '@/lib/api.ts';
import { useIsMobile } from '@/lib/hooks.ts';
import { errorMessage } from '@/lib/query.ts';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { TARGETS } from './journal.ts';

const TARGET_OPTS = TARGETS.map((n) => [String(n), String(n)] as const);

/** Compact brief for a one-off hunt: segment, city, target, focus → launch. */
export function HuntForm({
  segments,
  liveRun,
  target,
  onTarget,
  onLaunched,
  onWatch,
}: {
  segments: SegmentStat[];
  liveRun: AgentRun | undefined;
  target: number;
  onTarget: (n: number) => void;
  onLaunched: (runId: string) => void;
  onWatch: (runId: string) => void;
}) {
  const client = useQueryClient();
  const mobile = useIsMobile();
  const [segment, setSegment] = useState('');
  const [city, setCity] = useState('');
  const [focus, setFocus] = useState('');
  const [launching, setLaunching] = useState(false);
  const [err, setErr] = useState('');

  const canLaunch = Boolean(segment.trim() || city.trim() || focus.trim()) && !launching;
  const launch = async () => {
    if (!canLaunch) return;
    setLaunching(true);
    setErr('');
    const query =
      focus.trim() ||
      [segment.trim(), city.trim()].filter(Boolean).join(' em ') ||
      'negócios de alimentação no instagram';
    try {
      const r = await api.requestAgent({
        kind: 'discovery',
        params: {
          query,
          ...(segment.trim() ? { segment: segment.trim() } : {}),
          ...(city.trim() ? { city: city.trim() } : {}),
          target,
        },
      });
      if (r.runId) onLaunched(r.runId);
      void client.invalidateQueries({ queryKey: ['runs'] });
    } catch (e) {
      setErr(errorMessage(e) || 'falhou ao lançar');
    } finally {
      setLaunching(false);
    }
  };

  return (
    <Panel
      title="nova caçada"
      aside={mobile ? undefined : 'o agente busca, qualifica e cria os leads no CRM'}
      actions={
        liveRun && (
          <Button size="sm" variant="ghost" onClick={() => onWatch(liveRun.id)}>
            <span className="relative mr-0.5 inline-flex size-2" aria-hidden>
              <span className="absolute inset-0 animate-ping rounded-full bg-agent" />
              <span className="relative size-2 rounded-full bg-agent" />
            </span>
            rolando agora · assistir
          </Button>
        )
      }
    >
      <form
        className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          void launch();
        }}
      >
        <Field label="segmento" htmlFor="hunt-seg">
          <Input
            id="hunt-seg"
            list="hunt-segs"
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
            placeholder="doceria, padaria, marmita…"
            autoComplete="off"
          />
          <datalist id="hunt-segs">
            {segments.map((s) => (
              <option key={s.segment} value={s.segment} />
            ))}
          </datalist>
        </Field>
        <Field label="cidade" htmlFor="hunt-city">
          <Input
            id="hunt-city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="fortaleza, são paulo… (vazio = brasil)"
          />
        </Field>
        <Field label="meta" className="md:col-span-2 xl:col-span-1">
          <Segmented
            value={String(target)}
            onChange={(v) => onTarget(Number(v))}
            options={TARGET_OPTS}
            className="self-start"
          />
        </Field>
        <Field
          label="objetivo"
          htmlFor="hunt-focus"
          className="md:col-span-2 xl:col-span-3"
          hint={err ? <span className="text-destructive-foreground">{err}</span> : undefined}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="hunt-focus"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="ex: confeitarias que vendem pelo instagram e não têm site"
              className="sm:flex-1"
            />
            <Button type="submit" variant="agent" disabled={!canLaunch}>
              {launching ? (
                <>
                  <Loader2 className="animate-spin" /> acordando…
                </>
              ) : (
                <>
                  lançar a caçada <ArrowRight />
                </>
              )}
            </Button>
          </div>
        </Field>
      </form>
    </Panel>
  );
}
