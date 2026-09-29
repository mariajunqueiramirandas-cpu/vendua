import { Clock, Pause, Play, Storefront } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type SpecialDay, type StoreView } from '../../lib/api.ts';
import { clock, hhmm, isoDate, WEEKDAYS_LONG } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { Chips, Field, TextArea, TimeInput } from '../../ui/fields.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';

type Span = '15m' | '1h' | 'today' | 'indefinite';

export function StatusSheet({
  open,
  onOpenChange,
  store,
  startWith,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  store: StoreView;
  startWith?: 'hours';
}) {
  const qc = useQueryClient();
  const [span, setSpan] = useState<Span>('1h');
  const [message, setMessage] = useState(store.status.pauseMessage ?? '');
  const [editHours, setEditHours] = useState(startWith === 'hours');
  const tz = store.hours.timezone;
  const done = (s: StoreView) => {
    qc.setQueryData(qk.store, s);
    void qc.invalidateQueries({ queryKey: qk.home });
  };
  const pause = useMutation({
    mutationFn: () => api.pause({ for: span, message: message.trim() || null }),
    onSuccess: (s) => {
      done(s);
      onOpenChange(false);
      toast('Loja pausada. Ninguém consegue pedir até você voltar.', {
        undo: () => resume.mutate(),
      });
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const resume = useMutation({
    mutationFn: api.resume,
    onSuccess: (s) => {
      done(s);
      onOpenChange(false);
      toast(
        s.status.status === 'open'
          ? 'Loja aberta de novo ✓'
          : 'Pausa encerrada. A loja segue o horário normal.',
      );
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const paused = store.status.status === 'paused';
  const preview =
    message.trim() ||
    (span === '15m' || span === '1h'
      ? 'Voltamos a aceitar pedidos em instantes.'
      : 'Voltamos a aceitar pedidos em breve.');

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={paused ? 'Sua loja está pausada' : 'Pausar a loja'}
      description={
        paused
          ? store.status.resumesAt
            ? `Volta sozinha às ${clock(store.status.resumesAt, tz)}.`
            : 'Fica pausada até você voltar.'
          : 'Ninguém consegue fazer pedido enquanto estiver pausada. Os pedidos em andamento continuam.'
      }
      footer={
        paused ? (
          <Button
            size="lg"
            block
            icon={<Play weight="fill" />}
            loading={resume.isPending}
            onClick={() => resume.mutate()}
          >
            voltar a aceitar pedidos
          </Button>
        ) : editHours ? null : (
          <Button
            size="lg"
            block
            icon={<Pause weight="fill" />}
            loading={pause.isPending}
            onClick={() => pause.mutate()}
          >
            pausar agora
          </Button>
        )
      }
    >
      {editHours ? (
        <TodayHours store={store} onDone={() => setEditHours(false)} onSaved={done} />
      ) : (
        <div className="space-y-6 pt-2">
          {!paused ? (
            <>
              <Field label="Por quanto tempo?">
                <Chips
                  label="por quanto tempo"
                  value={span}
                  onChange={setSpan}
                  options={[
                    { value: '15m', label: '15 min' },
                    { value: '1h', label: '1 hora' },
                    { value: 'today', label: 'resto do dia' },
                    { value: 'indefinite', label: 'até eu voltar' },
                  ]}
                />
              </Field>
              <Field
                label="Recado para quem entrar na loja"
                optional
                htmlFor="pause-msg"
                helper="Aparece no topo da sua loja."
              >
                <TextArea
                  id="pause-msg"
                  maxLength={200}
                  value={message}
                  placeholder="Ex.: Voltamos às 18h com fornada nova!"
                  onChange={(e) => setMessage(e.target.value)}
                  className="min-h-20"
                />
              </Field>
              <div>
                <p className="t-caption mb-2 font-semibold text-muted">Como fica na loja</p>
                <div className="rounded-md bg-sunken p-3">
                  <div className="rounded-sm bg-surface p-3 depth-1">
                    <p className="font-semibold">Estamos pausados no momento</p>
                    <p className="t-body text-muted">{preview}</p>
                  </div>
                </div>
              </div>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => setEditHours(true)}
            className="flex min-h-14 w-full items-center gap-3 rounded-md px-3 text-left ring-1 ring-line hover:bg-hover"
          >
            <Clock className="size-6 shrink-0 text-muted" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Mudar o horário de hoje</span>
              <span className="t-caption block text-muted">{todayLabel(store)}</span>
            </span>
          </button>
        </div>
      )}
    </Sheet>
  );
}

function todayLabel(store: StoreView) {
  const tz = store.hours.timezone;
  const today = isoDate(new Date(), tz);
  const special = store.specialDays.find((d) => d.date === today);
  if (special)
    return special.closed
      ? 'Hoje: fechado (dia especial)'
      : `Hoje: ${hhmm(special.open!)} às ${hhmm(special.close!)}`;
  const dow = new Date(new Date().toLocaleString('en-US', { timeZone: tz })).getDay();
  const w = store.hours.windows.filter((x) => x.days.includes(dow));
  if (!w.length) return `Hoje (${WEEKDAYS_LONG[dow]}): fechado`;
  return `Hoje (${WEEKDAYS_LONG[dow]}): ${w.map((x) => `${hhmm(x.open)} às ${hhmm(x.close)}`).join(', ')}`;
}

function TodayHours({
  store,
  onDone,
  onSaved,
}: {
  store: StoreView;
  onDone: () => void;
  onSaved: (s: StoreView) => void;
}) {
  const tz = store.hours.timezone;
  const today = isoDate(new Date(), tz);
  const cur = store.specialDays.find((d) => d.date === today);
  const dow = new Date(new Date().toLocaleString('en-US', { timeZone: tz })).getDay();
  const weekly = store.hours.windows.find((x) => x.days.includes(dow));
  const [closed, setClosed] = useState(cur?.closed ?? false);
  const [open, setOpen] = useState(cur?.open ?? weekly?.open ?? '09:00');
  const [close, setClose] = useState(cur?.close ?? weekly?.close ?? '18:00');
  const save = useMutation({
    mutationFn: (days: SpecialDay[]) => api.updateStore({ specialDays: days }),
    onSuccess: (s) => {
      onSaved(s);
      toast('Horário de hoje atualizado ✓');
      onDone();
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const others = store.specialDays.filter((d) => d.date !== today);
  return (
    <div className="space-y-5 pt-2">
      <p className="t-body text-muted">Só vale para hoje. Amanhã volta o horário de sempre.</p>
      <Chips
        label="hoje"
        value={closed ? 'closed' : 'open'}
        onChange={(v) => setClosed(v === 'closed')}
        options={[
          { value: 'open', label: 'abrir hoje' },
          { value: 'closed', label: 'não abrir hoje' },
        ]}
      />
      {!closed ? (
        <div className="flex items-center gap-3">
          <TimeInput label="abre às" value={open} onCommit={setOpen} />
          <span className="text-muted">às</span>
          <TimeInput label="fecha às" value={close} onCommit={setClose} />
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onDone}>
          voltar
        </Button>
        <Button
          block
          loading={save.isPending}
          icon={<Storefront />}
          onClick={() =>
            save.mutate([
              ...others,
              closed
                ? { date: today, closed: true, label: 'Hoje' }
                : { date: today, closed: false, open, close, label: 'Hoje' },
            ])
          }
        >
          salvar horário de hoje
        </Button>
      </div>
      {cur ? (
        <Button variant="quiet" block onClick={() => save.mutate(others)}>
          voltar ao horário de sempre
        </Button>
      ) : null}
    </div>
  );
}
