import { Pause, Play } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError, api, type VendedorSettings } from '../../lib/api.ts';
import { until } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';

export type PauseSpan = '1h' | 'tomorrow';

const failText = (e: unknown) =>
  e instanceof ApiError && e.code === 'VENDEDOR_OFF'
    ? 'O Duá está desligado: não há o que pausar.'
    : messageOf(e);

/**
 * "Pausar 1 h / até amanhã" (Core: a gate on every conversation, lifted by the clock). Pausing
 * offers "desfazer"; coming back early answers who wrote meanwhile.
 */
export function usePause() {
  const qc = useQueryClient();
  const put = (s: VendedorSettings) => {
    qc.setQueryData(qk.vendedor.settings, s);
    void qc.invalidateQueries({ queryKey: ['vendedor'] });
  };
  const resume = useMutation({
    mutationFn: () => api.vendedor.resume(),
    onSuccess: (s) => {
      put(s);
      haptic.tick();
      toast('O Duá voltou a atender.');
    },
    onError: (e) => toast.error(failText(e)),
  });
  const pause = useMutation({
    mutationFn: (span: PauseSpan) => api.vendedor.pause(span),
    onSuccess: (s) => {
      put(s);
      haptic.commit();
      toast(
        s.pausedUntil ? `Duá pausado. Volta sozinho ${until(s.pausedUntil)}.` : 'Duá pausado.',
        { undo: () => resume.mutate() },
      );
    },
    onError: (e) => toast.error(failText(e)),
  });
  return { pause, resume };
}

/** The screen showing a pause reads Core again when it lapses, so it never says "pausado" late. */
export function useLapse(pausedUntil: string | null | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!pausedUntil) return;
    const ms = new Date(pausedUntil).getTime() - Date.now() + 1500;
    // a timer past ~24 days overflows; a pause never lasts that long
    if (ms > 2 ** 31 - 1) return;
    const t = setTimeout(() => void qc.invalidateQueries({ queryKey: ['vendedor'] }), ms);
    return () => clearTimeout(t);
  }, [qc, pausedUntil]);
}

/** In Configurar, under the switch: the pause, or how long it still holds and "voltar agora". */
export function PauseRow({ pausedUntil }: { pausedUntil: string | null | undefined }) {
  const { pause, resume } = usePause();
  useLapse(pausedUntil);
  if (pausedUntil)
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line py-3">
        <p className="t-body min-w-0 flex-1 basis-52">
          <span className="flex items-center gap-2 font-semibold">
            <Pause weight="fill" className="size-4 shrink-0" aria-hidden />
            Pausado
          </span>
          <span className="text-muted">
            Volta sozinho {until(pausedUntil)}. Até lá, as conversas ficam com você.
          </span>
        </p>
        <Button
          variant="secondary"
          icon={<Play weight="fill" />}
          loading={resume.isPending}
          onClick={() => resume.mutate()}
        >
          voltar agora
        </Button>
      </div>
    );
  return (
    <div className="flex flex-col gap-2 border-t border-line py-3">
      <div>
        <p className="font-semibold">Pausar por um tempo</p>
        <p className="t-body text-muted">
          Ele para de responder e volta sozinho. As conversas ficam com você enquanto isso.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          loading={pause.isPending && pause.variables === '1h'}
          disabled={pause.isPending}
          onClick={() => pause.mutate('1h')}
        >
          pausar 1 hora
        </Button>
        <Button
          variant="secondary"
          loading={pause.isPending && pause.variables === 'tomorrow'}
          disabled={pause.isPending}
          onClick={() => pause.mutate('tomorrow')}
        >
          até amanhã
        </Button>
      </div>
    </div>
  );
}

/** From Início do Duá: "pausar" opens the two spans (two taps, like pausing the store). */
export function PauseSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { pause } = usePause();
  const go = (span: PauseSpan) => pause.mutate(span, { onSuccess: () => onOpenChange(false) });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Pausar o Duá"
      description="Ele para de responder e volta sozinho. As conversas ficam com você enquanto isso."
    >
      <div className="flex flex-col gap-2 pb-2 pt-1">
        <Button
          size="lg"
          variant="secondary"
          block
          loading={pause.isPending && pause.variables === '1h'}
          disabled={pause.isPending}
          onClick={() => go('1h')}
        >
          por 1 hora
        </Button>
        <Button
          size="lg"
          variant="secondary"
          block
          loading={pause.isPending && pause.variables === 'tomorrow'}
          disabled={pause.isPending}
          onClick={() => go('tomorrow')}
        >
          até amanhã, às 6h
        </Button>
      </div>
    </Sheet>
  );
}
