import {
  ArrowRight,
  BellRinging,
  ChatCircleText,
  Checks,
  Copy,
  DeviceMobile,
  PaperPlaneTilt,
  WhatsappLogo,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api,
  type WaEvent,
  type WaMessage,
  type WaState,
  type Whatsapp as WhatsappData,
} from '../../lib/api.ts';
import { ago, dateShort, phone as phoneText, plural } from '../../lib/format.ts';
import { usePollWhenOffline } from '../../lib/live.ts';
import { maskPhone, parsePhone } from '../../lib/parse.ts';
import { optimistic, qk, useMutation } from '../../lib/query.ts';
import { useCan } from '../../lib/session.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { copyText } from '../../ui/CopyValue.tsx';
import { DuaNote, ErrorState, messageOf } from '../../ui/feedback.tsx';
import { Field, PhoneInput, Toggle } from '../../ui/fields.tsx';
import { HoldButton } from '../../ui/HoldButton.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { TONE, type Tone } from '../../ui/PaymentChip.tsx';
import { SectionsSkeleton } from '../../ui/skeletons.tsx';
import { Spinner } from '../../ui/Spinner.tsx';
import { toast } from '../../ui/Toast.tsx';

// WhatsApp da loja (ADR 0026): the store links its own number as a device (like WhatsApp Web)
// and each order step reaches the shopper from it. Core decides every word; this screen pairs,
// chooses the steps and shows what went out.

const STATUS: Record<WaState, { label: string; tone: Tone }> = {
  off: { label: 'desconectado', tone: 'neutral' },
  connecting: { label: 'conectando', tone: 'info' },
  pairing: { label: 'esperando o código', tone: 'warning' },
  open: { label: 'conectado', tone: 'success' },
  logged_out: { label: 'desvinculado', tone: 'danger' },
  banned: { label: 'recusado', tone: 'danger' },
  error: { label: 'sem conexão', tone: 'warning' },
};

// the order a shopper lives them in
const EVENTS: { id: WaEvent; label: string; hint: string }[] = [
  { id: 'placed', label: 'Pedido recebido', hint: 'Assim que o pedido chega.' },
  { id: 'paid', label: 'Pagamento confirmado', hint: 'Quando o Pix ou o cartão pelo site cai.' },
  { id: 'confirmed', label: 'Pedido aceito', hint: 'Quando você aceita, com o horário previsto.' },
  { id: 'preparing', label: 'Em preparo', hint: 'Quando você marca em preparo.' },
  { id: 'ready', label: 'Pronto para retirar', hint: 'Só em pedidos de retirada.' },
  { id: 'out_for_delivery', label: 'Saiu para entrega', hint: 'Quando o pedido sai.' },
  { id: 'delivered', label: 'Entregue', hint: 'Um obrigado depois da entrega.' },
  { id: 'cancelled', label: 'Cancelado', hint: 'Se o pedido for cancelado.' },
];
const EVENT_LABEL = Object.fromEntries(EVENTS.map((e) => [e.id, e.label])) as Record<
  WaEvent,
  string
>;

export default function Whatsapp() {
  const settling = (d: WhatsappData | undefined) =>
    !!d && (d.state === 'connecting' || d.state === 'pairing' || d.disconnecting);
  // the stream pushes every change; polling is only the fallback while a pairing is under way
  const offlinePoll = usePollWhenOffline(4_000, 20_000);
  const { data, error, refetch } = useQuery({
    queryKey: qk.whatsapp,
    queryFn: api.whatsapp,
    refetchInterval: (q) => (settling(q.state.data) ? offlinePoll : false),
  });
  const owner = useCan('owner');
  // ?de=dua: Duá's onboarding sent the owner here, and the way back resumes it
  const [params] = useSearchParams();
  const dua = params.get('de') === 'dua' ? (owner ? '/vendedor/comecar' : '/vendedor') : null;
  if (error && !data)
    return (
      <PageBody>
        <ErrorState error={error} retry={() => void refetch()} />
      </PageBody>
    );
  return (
    <PageBody wide>
      <PageHeader
        title="WhatsApp"
        subtitle="Seus clientes recebem cada passo do pedido pelo número da loja."
        {...(dua ? { back: dua } : {})}
      />
      {dua && data?.state === 'open' ? (
        <Notice
          tone="success"
          role="status"
          className="mb-6"
          title="Pronto, o WhatsApp da loja está conectado"
          action={
            <ButtonLink to={dua}>
              voltar para o Duá <ArrowRight weight="bold" />
            </ButtonLink>
          }
        >
          O Duá já pode atender por ele.
        </Notice>
      ) : null}
      {!data ? (
        <SectionsSkeleton columns={2} />
      ) : (
        // phones read connection → steps → log; wide screens keep the log under the connection
        <div className="grid gap-8 lg:grid-cols-2 lg:grid-rows-[auto_1fr] [&>*]:min-w-0">
          <div className="lg:col-start-1 lg:row-start-1">
            <ConnectionCard data={data} owner={owner} />
          </div>
          <Section
            className="lg:col-start-2 lg:row-span-2 lg:row-start-1"
            title="Avisos aos clientes"
            hint="Escolha em que momentos o cliente recebe uma mensagem. Cada uma aparece como ele vai ler."
          >
            <EventsCard data={data} />
          </Section>
          <Section
            className="lg:col-start-1 lg:row-start-2"
            title="Últimas mensagens"
            hint={statsLine(data)}
          >
            <Recent data={data} />
          </Section>
        </div>
      )}
    </PageBody>
  );
}

function statsLine(d: WhatsappData) {
  if (!d.stats.sent && !d.stats.failed) return undefined;
  const parts = [plural(d.stats.sent, 'enviada', 'enviadas')];
  if (d.stats.failed) parts.push(plural(d.stats.failed, 'não enviada', 'não enviadas'));
  return `Nos últimos 7 dias: ${parts.join(' · ')}.`;
}

/** "+55 21 99999-0000" → "(21) 99999-0000"; other countries as digits */
const accountPhone = (p: string | null) =>
  p ? (p.startsWith('55') ? phoneText(p.slice(2)) : `+${p}`) : null;

function ConnectionCard({ data, owner }: { data: WhatsappData; owner: boolean }) {
  const st = STATUS[data.state];
  const linked = data.state === 'open' ? accountPhone(data.phone) : null;
  return (
    <Card as="section" aria-labelledby="wa-title" className="overflow-hidden">
      <div className="flex items-start gap-3 p-5 pb-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-whatsapp text-on-whatsapp">
          <WhatsappLogo weight="fill" className="size-7" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id="wa-title" className="t-title-2">
              WhatsApp da loja
            </h2>
            <span
              className={cn(
                't-caption inline-flex h-7 shrink-0 items-center rounded-full px-2.5 font-semibold',
                TONE[st.tone],
              )}
            >
              {st.label}
            </span>
          </div>
          <p className="t-caption tnum mt-0.5 text-muted">
            {linked ?? 'Os avisos saem do seu número, e as respostas chegam nele.'}
          </p>
        </div>
      </div>
      <div className="px-5 pb-5" aria-live="polite">
        <Body data={data} owner={owner} />
      </div>
    </Card>
  );
}

function Body({ data, owner }: { data: WhatsappData; owner: boolean }) {
  switch (data.state) {
    case 'open':
      return <Connected data={data} owner={owner} />;
    case 'pairing':
      return <Pairing data={data} owner={owner} />;
    case 'connecting':
      return <Connecting data={data} owner={owner} />;
    case 'error':
      return <Lost data={data} owner={owner} />;
    default:
      return <NotConnected data={data} owner={owner} />;
  }
}

function useSetData() {
  const qc = useQueryClient();
  return (d: WhatsappData) => qc.setQueryData(qk.whatsapp, d);
}

function useDisconnect(done: string) {
  const setData = useSetData();
  return useMutation({
    mutationFn: () => api.whatsappDisconnect(),
    onSuccess: (d) => {
      setData(d);
      toast(done);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
}

function Benefit({
  Icon,
  title,
  children,
}: {
  Icon: typeof WhatsappLogo;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-spark-soft">
        <Icon weight="duotone" className="size-5.5" />
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="font-semibold">{title}</p>
        <p className="t-body text-muted">{children}</p>
      </div>
    </li>
  );
}

function NotConnected({ data, owner }: { data: WhatsappData; owner: boolean }) {
  const setData = useSetData();
  const [value, setValue] = useState(() => maskPhone(data.pairPhone ?? data.suggestedPhone ?? ''));
  const digits = parsePhone(value);
  const pair = useMutation({
    mutationFn: (phone: string) => api.whatsappPair(phone),
    onSuccess: setData,
    onError: (e) => toast.error(messageOf(e)),
  });
  const notice = notConnectedNotice(data);
  return (
    <div className="space-y-5">
      {notice}
      {data.state === 'off' && !notice ? (
        <ul className="space-y-4">
          <Benefit Icon={BellRinging} title="Um aviso a cada passo">
            O cliente sabe quando o pedido foi aceito, saiu para entrega ou está pronto, sem
            precisar perguntar.
          </Benefit>
          <Benefit Icon={WhatsappLogo} title="Do número da sua loja">
            As mensagens saem do seu WhatsApp, e as respostas dos clientes chegam nele, como sempre.
          </Benefit>
          <Benefit Icon={DeviceMobile} title="Você continua usando o celular">
            A Venduá entra como um aparelho conectado, igual ao WhatsApp Web.
          </Benefit>
        </ul>
      ) : null}
      {data.disconnecting ? (
        <p className="t-caption flex items-center gap-2 text-muted">
          <Spinner className="size-4" /> Removendo a Venduá dos aparelhos conectados…
        </p>
      ) : null}
      {!data.available ? (
        <Notice tone="warning" title="O WhatsApp da Venduá está fora do ar agora">
          Tente conectar de novo em alguns minutos.
        </Notice>
      ) : owner ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (digits) pair.mutate(digits);
          }}
        >
          <Field
            label="Número do WhatsApp da loja"
            htmlFor="wa-phone"
            helper="O número que seus clientes já usam para falar com você."
          >
            <PhoneInput id="wa-phone" value={value} onChange={(v) => setValue(v)} />
          </Field>
          <Button type="submit" size="lg" block disabled={!digits} loading={pair.isPending}>
            gerar código
          </Button>
          <p className="t-caption text-center text-muted">
            Você digita o código no WhatsApp do celular da loja.
          </p>
        </form>
      ) : (
        <p className="t-body rounded-md bg-sunken px-4 py-3 text-muted">
          Só quem é dono da loja conecta o WhatsApp.
        </p>
      )}
    </div>
  );
}

function notConnectedNotice(data: WhatsappData) {
  if (data.state === 'logged_out')
    return (
      <Notice tone="danger" role="status" title="O WhatsApp desconectou a Venduá">
        Alguém removeu a Venduá em Aparelhos conectados, ou o celular da loja ficou muitos dias sem
        abrir o WhatsApp. Gere um código novo para voltar a avisar seus clientes.
      </Notice>
    );
  if (data.state === 'banned')
    return (
      <Notice
        tone="danger"
        role="status"
        title="O WhatsApp recusou o número da loja"
        action={
          <Link
            to="/ajuda"
            className="t-label inline-flex min-h-11 items-center gap-1.5 rounded-full bg-surface px-4 depth-1"
          >
            falar com a Venduá <ArrowRight className="size-4" aria-hidden />
          </Link>
        }
      >
        Isso acontece quando o WhatsApp restringe o número. Fale com a gente antes de tentar de
        novo.
      </Notice>
    );
  if (data.detail === 'pair_expired')
    return (
      <Notice tone="warning" role="status" title="O código venceu">
        Gere outro e digite no WhatsApp em até 3 minutos.
      </Notice>
    );
  if (data.detail === 'pair_failed' || data.detail === 'bad_phone')
    return (
      <Notice tone="warning" role="status" title="O WhatsApp não gerou o código">
        Confira se o número é o do WhatsApp da loja, com DDD, e tente de novo.
      </Notice>
    );
  if (data.detail === 'unlinked_offline')
    return (
      <Notice tone="info" title="WhatsApp desconectado">
        Para tirar a Venduá da lista do celular, abra o WhatsApp da loja em Aparelhos conectados e
        remova o aparelho da Venduá.
      </Notice>
    );
  return null;
}

/** seconds left until an instant, ticking each second; null when there's none */
function useSecondsLeft(iso: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [iso]);
  return iso ? Math.max(0, Math.round((Date.parse(iso) - now) / 1000)) : null;
}

function Pairing({ data, owner }: { data: WhatsappData; owner: boolean }) {
  const qc = useQueryClient();
  const left = useSecondsLeft(data.pairCodeExpiresAt);
  const cancel = useDisconnect('Conexão cancelada');
  const code = data.pairCode ?? '';
  const shown = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
  useEffect(() => {
    if (left === 0) void qc.invalidateQueries({ queryKey: qk.whatsapp });
  }, [left, qc]);
  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-sunken px-4 py-5 text-center">
        <p className="t-body text-muted">
          Digite este código no WhatsApp do número{' '}
          <span className="tnum font-semibold text-ink">{phoneText(data.pairPhone)}</span>
        </p>
        <p
          className="tnum mt-3 select-all font-mono text-[2.25rem] font-bold leading-none tracking-[0.12em]"
          aria-label={`código ${code.split('').join(' ')}`}
        >
          {shown}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<Copy />}
            onClick={async () => {
              if (await copyText(code)) toast('Código copiado');
            }}
          >
            copiar
          </Button>
          {left !== null ? (
            <span className="t-caption tnum text-muted">
              {left > 0
                ? `vale por mais ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
                : 'venceu'}
            </span>
          ) : null}
        </div>
      </div>
      <ol className="t-body space-y-2.5">
        {[
          'Abra o WhatsApp no celular da loja.',
          'Toque em ⋮ (Android) ou em Configurações (iPhone) e depois em Aparelhos conectados.',
          'Toque em Conectar aparelho e depois em “Conectar com número de telefone”.',
          'Digite o código acima.',
        ].map((step, i) => (
          <li key={step} className="flex gap-3">
            <span className="t-caption grid size-7 shrink-0 place-items-center rounded-full bg-spark-soft font-semibold">
              {i + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
      <p className="t-caption text-muted">
        O WhatsApp também pode mostrar uma notificação pedindo o código. É só tocar nela.
      </p>
      {owner ? (
        <Button
          variant="ghost"
          className="-ml-3 text-muted!"
          loading={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          cancelar
        </Button>
      ) : null}
    </div>
  );
}

function Connecting({ data, owner }: { data: WhatsappData; owner: boolean }) {
  const cancel = useDisconnect('Conexão cancelada');
  if (data.detail === 'gateway_offline')
    return (
      <Notice tone="warning" role="status" title="O WhatsApp da Venduá está fora do ar">
        Os avisos ficam na fila e saem quando ele voltar, por até 6 horas. Não precisa fazer nada.
      </Notice>
    );
  const asking = data.detail === 'pair_requested';
  return (
    <div className="space-y-4">
      <div role="status" className="flex items-center gap-3 rounded-md bg-sunken px-4 py-4">
        <Spinner className="size-6 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">
            {asking ? 'Pedindo o código ao WhatsApp…' : 'Reconectando…'}
          </p>
          <p className="t-body text-muted">
            {asking
              ? 'Leva só alguns segundos.'
              : 'Os avisos esperam e saem assim que a conexão voltar.'}
          </p>
        </div>
      </div>
      {asking && owner ? (
        <Button
          variant="ghost"
          className="-ml-3 text-muted!"
          loading={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          cancelar
        </Button>
      ) : null}
    </div>
  );
}

function Lost({ data, owner }: { data: WhatsappData; owner: boolean }) {
  return (
    <div className="space-y-4">
      <Notice tone="warning" role="status" title="O WhatsApp da loja está sem conexão">
        A Venduá segue tentando reconectar. Confira se o celular da loja está com internet. Os
        avisos esperam na fila por até 6 horas.
      </Notice>
      {owner ? <Disconnect data={data} /> : null}
    </div>
  );
}

function Connected({ data, owner }: { data: WhatsappData; owner: boolean }) {
  const setData = useSetData();
  const test = useMutation({
    mutationFn: () => api.whatsappTest(),
    onSuccess: (d) => {
      setData(d);
      toast('Teste a caminho do seu WhatsApp');
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  return (
    <div className="space-y-4">
      <dl className="t-body divide-y divide-line rounded-md bg-sunken px-4">
        {data.phone ? (
          <div className="flex justify-between gap-3 py-2.5">
            <dt className="text-muted">Número</dt>
            <dd className="tnum min-w-0 truncate font-semibold">{accountPhone(data.phone)}</dd>
          </div>
        ) : null}
        {data.name ? (
          <div className="flex justify-between gap-3 py-2.5">
            <dt className="text-muted">Nome</dt>
            <dd className="min-w-0 truncate font-semibold">{data.name}</dd>
          </div>
        ) : null}
        {data.connectedAt ? (
          <div className="flex justify-between gap-3 py-2.5">
            <dt className="text-muted">Conectado desde</dt>
            <dd className="font-semibold">{dateShort(data.connectedAt)}</dd>
          </div>
        ) : null}
      </dl>
      <Button
        variant="secondary"
        block
        icon={<PaperPlaneTilt />}
        loading={test.isPending}
        onClick={() => test.mutate()}
      >
        mandar um teste para mim
      </Button>
      <p className="t-caption text-muted">
        Deixe o celular da loja com internet e abra o WhatsApp nele de vez em quando: o WhatsApp
        desconecta aparelhos de um celular que passa semanas sem abrir.
      </p>
      {owner ? <Disconnect data={data} /> : null}
    </div>
  );
}

function Disconnect({ data }: { data: WhatsappData }) {
  const [confirming, setConfirming] = useState(false);
  const disconnect = useDisconnect('WhatsApp desconectado');
  if (!confirming)
    return (
      <Button variant="ghost" className="-ml-3 text-muted!" onClick={() => setConfirming(true)}>
        desconectar
      </Button>
    );
  return (
    <div className="space-y-3 rounded-md bg-danger-soft/60 p-4">
      <p className="font-semibold">Desconectar o WhatsApp da loja?</p>
      <p className="t-body text-muted">
        Seus clientes param de receber os avisos dos pedidos
        {data.phone ? ` pelo ${accountPhone(data.phone)}` : ''}. O WhatsApp do celular continua
        igual.
      </p>
      <HoldButton onConfirm={() => disconnect.mutate()} disabled={disconnect.isPending}>
        {disconnect.isPending ? 'desconectando…' : 'segure para desconectar'}
      </HoldButton>
      <Button variant="ghost" block onClick={() => setConfirming(false)}>
        manter conectado
      </Button>
    </div>
  );
}

function EventsCard({ data }: { data: WhatsappData }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (p: { id: WaEvent; on: boolean }) => api.whatsappSettings({ [p.id]: p.on }),
    onMutate: (p) =>
      optimistic<WhatsappData>(qc, qk.whatsapp, (d) => ({
        ...d,
        events: { ...d.events, [p.id]: p.on },
      })),
    onSuccess: (d) => qc.setQueryData(qk.whatsapp, d),
    onError: (e, _p, ctx) => {
      ctx?.restore();
      toast.error(messageOf(e));
    },
  });
  return (
    <Card className="divide-y divide-line px-4">
      {EVENTS.map((e) => {
        const on = data.events[e.id];
        const preview = data.previews[e.id];
        return (
          <div key={e.id} className="py-2">
            <Toggle
              checked={on}
              onChange={(v) => save.mutate({ id: e.id, on: v })}
              label={e.label}
              description={e.hint}
            />
            {on && preview ? <Bubble text={preview} /> : null}
          </div>
        );
      })}
      <p className="t-caption py-3 text-muted">
        A primeira mensagem para cada cliente diz como parar: é só responder SAIR.
      </p>
    </Card>
  );
}

/** what the shopper reads, the way WhatsApp shows it (sample order #128 for Ana) */
function Bubble({ text }: { text: string }) {
  return (
    <div className="mb-2 mt-0.5 flex">
      <p className="t-body relative max-w-[34ch] whitespace-pre-line rounded-lg rounded-tl-sm bg-success-soft px-3 py-2 text-ink">
        {text.replace(/_/g, '')}
      </p>
    </div>
  );
}

const SKIPPED: Record<string, string> = {
  opted_out: 'pediu para parar',
  disconnected: 'desconectado',
};

function statusOf(m: WaMessage): { label: string; tone: Tone; read?: boolean } {
  switch (m.status) {
    case 'sent':
      if (m.readAt) return { label: 'lida', tone: 'success', read: true };
      if (m.deliveredAt) return { label: 'entregue', tone: 'success' };
      return { label: 'enviada', tone: 'info' };
    case 'pending':
    case 'sending':
      return { label: 'na fila', tone: 'neutral' };
    case 'failed':
      return {
        label: m.error === 'not_on_whatsapp' ? 'sem WhatsApp' : 'não enviada',
        tone: 'danger',
      };
    case 'skipped':
      return { label: SKIPPED[m.error ?? ''] ?? 'não enviada', tone: 'neutral' };
    case 'expired':
      return { label: 'passou da hora', tone: 'neutral' };
  }
}

function titleOf(m: WaMessage) {
  if (m.kind === 'opt_out') return 'Cliente pediu para parar';
  if (m.kind === 'opt_in') return 'Cliente voltou a receber';
  if (m.kind === 'test') return 'Teste para você';
  const step = m.event ? EVENT_LABEL[m.event] : 'Aviso';
  return m.orderNumber ? `#${m.orderNumber} · ${step}` : step;
}

function Recent({ data }: { data: WhatsappData }) {
  if (!data.recent.length)
    return (
      <DuaNote pose="sem-pedidos" title="Nenhuma mensagem ainda">
        Quando um pedido mudar de etapa, o aviso para o cliente aparece aqui.
      </DuaNote>
    );
  return (
    <div className="space-y-3">
      <Card className="divide-y divide-line overflow-hidden">
        {data.recent.map((m) => {
          const s = statusOf(m);
          const row = (
            <>
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sunken">
                {m.kind === 'order' ? (
                  <ChatCircleText weight="duotone" className="size-5" />
                ) : (
                  <WhatsappLogo weight="duotone" className="size-5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold leading-snug">{titleOf(m)}</span>
                <span className="t-caption text-muted">{ago(m.sentAt ?? m.createdAt)}</span>
              </span>
              <span
                className={cn(
                  't-caption inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 font-semibold',
                  TONE[s.tone],
                )}
              >
                {s.read ? <Checks weight="bold" className="size-4" aria-hidden /> : null}
                {s.label}
              </span>
            </>
          );
          return m.orderId ? (
            <Link
              key={m.id}
              to={`/pedidos/${m.orderId}`}
              className="press-row flex min-h-16 items-center gap-3 px-4 py-2 hover:bg-hover"
            >
              {row}
            </Link>
          ) : (
            <div key={m.id} className="flex min-h-16 items-center gap-3 px-4 py-2">
              {row}
            </div>
          );
        })}
      </Card>
      {data.stats.optouts ? (
        <p className="t-caption px-1 text-muted">
          {plural(data.stats.optouts, 'cliente pediu', 'clientes pediram')} para não receber os
          avisos.
        </p>
      ) : null}
    </div>
  );
}
