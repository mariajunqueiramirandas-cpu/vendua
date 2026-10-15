import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type Whatsapp as WhatsappData } from '../../lib/api.ts';
import { plural } from '../../lib/format.ts';
import { optimistic, qk, useMutation } from '../../lib/query.ts';
import { Card } from '../../ui/Card.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { SavedStepper, Toggle } from '../../ui/fields.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { toast } from '../../ui/Toast.tsx';

// The two reminders that sell, sent from the store's own WhatsApp (ADR 0026): the bag left
// behind, and the order of always. They live in Marketing › Lembretes; the WhatsApp screen
// links there. Bubble is what the shopper reads, shared with the order steps.

export const linkedOf = (d: WhatsappData) =>
  d.state === 'open' || d.state === 'connecting' || d.state === 'error';

function ConnectFirst() {
  return (
    <p className="t-caption text-muted">
      Funciona com o WhatsApp da loja conectado.{' '}
      <Link to="/whatsapp" className="font-semibold text-ink underline underline-offset-2">
        Conectar o WhatsApp
      </Link>
    </p>
  );
}

/** "Nos últimos 7 dias: 12 lembretes · 3 viraram pedido." */
export function reminderLine(d: WhatsappData) {
  const w = d.cartReminder.week;
  if (!w.sent) return undefined;
  const parts = [plural(w.sent, 'lembrete', 'lembretes')];
  if (w.ordered) parts.push(`${w.ordered} ${w.ordered === 1 ? 'virou pedido' : 'viraram pedido'}`);
  return `Nos últimos 7 dias: ${parts.join(' · ')}.`;
}

const REMINDER_RULES = [
  'Só para quem pedir: ao finalizar a compra, o cliente marca a opção abaixo.',
  'Uma mensagem por sacola, cerca de 1 hora depois que o cliente parou.',
  'Só com a loja aberta. À noite, espera a loja abrir (até 24 horas depois).',
  'Sai do número da loja. Quem responder SAIR não recebe mais.',
];

export function CartReminderCard({ data }: { data: WhatsappData }) {
  const qc = useQueryClient();
  const r = data.cartReminder;
  const save = useMutation({
    mutationFn: (p: { on: boolean; undo?: boolean }) => api.whatsappCartReminder(p.on),
    onMutate: (p) =>
      optimistic<WhatsappData>(qc, qk.whatsapp, (d) => ({
        ...d,
        cartReminder: { ...d.cartReminder, on: p.on },
      })),
    onSuccess: (d, p) => {
      qc.setQueryData(qk.whatsapp, d);
      // it changes what shoppers see at checkout: say so, and offer the way back
      if (!p.undo)
        toast(p.on ? 'Lembrete de sacola ligado' : 'Lembrete de sacola desligado', {
          undo: () => save.mutate({ on: !p.on, undo: true }),
        });
    },
    onError: (e, _p, ctx) => {
      ctx?.restore();
      toast.error(messageOf(e));
    },
  });
  const linked = data.state === 'open' || data.state === 'connecting' || data.state === 'error';
  return (
    <Card className="px-4">
      <Toggle
        checked={r.on && !r.vendedor}
        disabled={r.vendedor}
        onChange={(v) => save.mutate({ on: v })}
        label="Lembrar quem deixou a sacola"
        description="O cliente que pediu recebe uma mensagem se não terminar o pedido."
      />
      {r.vendedor ? (
        <Notice tone="info" className="mb-4" title="O Duá já cuida disso">
          Com o Duá ligado, ele mesmo chama quem parou no meio do pedido, então o lembrete fica
          desligado.
        </Notice>
      ) : (
        <div className="space-y-4 border-t border-line py-4">
          <ul className="t-body space-y-2">
            {REMINDER_RULES.map((rule) => (
              <li key={rule} className="flex gap-2.5">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-muted" />
                <span className="min-w-0">{rule}</span>
              </li>
            ))}
          </ul>
          <div>
            <p className="t-caption mb-1.5 text-muted">Ao finalizar a compra, o cliente vê:</p>
            <p className="t-body flex items-start gap-2.5 rounded-md bg-sunken px-3 py-2.5">
              <span
                aria-hidden
                className="mt-0.5 size-5 shrink-0 rounded-[5px] border-2 border-line-strong bg-surface"
              />
              <span className="min-w-0">Me lembre pelo WhatsApp se eu não terminar o pedido</span>
            </p>
          </div>
          <div>
            <p className="t-caption mb-1.5 text-muted">E, se não terminar, recebe:</p>
            <Bubble text={r.preview} />
          </div>
          {!linked ? <ConnectFirst /> : null}
        </div>
      )}
    </Card>
  );
}

/** "12 clientes pediram · 5 lembretes nos últimos 7 dias · 2 viraram pedido." */
export function usualLine(d: WhatsappData) {
  const u = d.usualReminder;
  if (!u.asked && !u.week.sent) return undefined;
  const parts = [`${plural(u.asked, 'cliente pediu', 'clientes pediram')}`];
  if (u.week.sent) parts.push(`${plural(u.week.sent, 'lembrete', 'lembretes')} nos últimos 7 dias`);
  if (u.week.ordered)
    parts.push(`${u.week.ordered} ${u.week.ordered === 1 ? 'virou pedido' : 'viraram pedido'}`);
  return `${parts.join(' · ')}.`;
}

const USUAL_RULES = [
  'Só para quem pedir: marcando a opção ao finalizar a compra, ou respondendo LEMBRAR à mensagem de pedido entregue.',
  'No máximo uma mensagem por semana para cada cliente, e só depois de uma semana sem pedir.',
  'Com um link da loja e a sacola de sempre pronta, com os preços de hoje. O cliente confere e paga como sempre.',
  'Só com a loja aberta, espaçadas ao longo do dia. Quem responder SAIR não recebe mais.',
];

export function UsualReminderCard({ data }: { data: WhatsappData }) {
  const qc = useQueryClient();
  const u = data.usualReminder;
  const save = useMutation({
    mutationFn: (p: { on?: boolean; perDay?: number; undo?: boolean }) =>
      api.whatsappUsualReminder({
        ...(p.on !== undefined ? { on: p.on } : {}),
        ...(p.perDay !== undefined ? { perDay: p.perDay } : {}),
      }),
    onMutate: (p) =>
      optimistic<WhatsappData>(qc, qk.whatsapp, (d) => ({
        ...d,
        usualReminder: {
          ...d.usualReminder,
          ...(p.on !== undefined ? { on: p.on } : {}),
          ...(p.perDay !== undefined ? { perDay: p.perDay } : {}),
        },
      })),
    onSuccess: (d, p) => {
      qc.setQueryData(qk.whatsapp, d);
      if (p.on !== undefined && !p.undo)
        toast(
          p.on ? 'Lembrete do pedido de sempre ligado' : 'Lembrete do pedido de sempre desligado',
          {
            undo: () => save.mutate({ on: !p.on, undo: true }),
          },
        );
    },
    onError: (e, _p, ctx) => {
      ctx?.restore();
      toast.error(messageOf(e));
    },
  });
  const linked = data.state === 'open' || data.state === 'connecting' || data.state === 'error';
  return (
    <Card className="px-4">
      <Toggle
        checked={u.on}
        onChange={(v) => save.mutate({ on: v })}
        label="Lembrar do pedido de sempre"
        description="Uma vez por semana, no máximo, quem pediu recebe o pedido de sempre pronto para repetir."
      />
      <div className="space-y-4 border-t border-line py-4">
        <ul className="t-body space-y-2">
          {USUAL_RULES.map((rule) => (
            <li key={rule} className="flex gap-2.5">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-muted" />
              <span className="min-w-0">{rule}</span>
            </li>
          ))}
        </ul>
        {u.on ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="t-label">Por dia, no máximo</p>
              <p className="t-caption text-muted">Para a loja não parecer mandar em massa.</p>
            </div>
            <SavedStepper
              label="lembretes por dia, no máximo"
              value={u.perDay}
              min={1}
              max={200}
              step={5}
              onSave={(perDay) => save.mutateAsync({ perDay })}
            />
          </div>
        ) : null}
        <div>
          <p className="t-caption mb-1.5 text-muted">Ao finalizar a compra, o cliente vê:</p>
          <p className="t-body flex items-start gap-2.5 rounded-md bg-sunken px-3 py-2.5">
            <span
              aria-hidden
              className="mt-0.5 size-5 shrink-0 rounded-[5px] border-2 border-line-strong bg-surface"
            />
            <span className="min-w-0">
              Me lembre do meu pedido de sempre (no máximo 1 mensagem por semana)
            </span>
          </p>
        </div>
        <div>
          <p className="t-caption mb-1.5 text-muted">E, uma semana depois do último pedido:</p>
          <Bubble text={u.preview} />
        </div>
        {!linked ? <ConnectFirst /> : null}
      </div>
    </Card>
  );
}

/** what the shopper reads, the way WhatsApp shows it (sample order #128 for Ana) */
export function Bubble({ text }: { text: string }) {
  return (
    <div className="mb-2 mt-0.5 flex">
      <p className="t-body relative max-w-[34ch] whitespace-pre-line rounded-lg rounded-tl-sm bg-success-soft px-3 py-2 text-ink">
        {text.replace(/_/g, '')}
      </p>
    </div>
  );
}
