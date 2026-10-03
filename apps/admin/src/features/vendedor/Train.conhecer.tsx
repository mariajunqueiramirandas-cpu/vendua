import { ArrowRight, Check, Copy, Robot, WhatsappLogo } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type AgentTone, type VendedorOnboarding } from '../../lib/api.ts';
import { phone as phoneText } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { usePollWhenOffline } from '../../lib/live.ts';
import { maskPhone, parsePhone } from '../../lib/parse.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { copyText } from '../../ui/CopyValue.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { Field, PhoneInput, Segmented, TextInput, Toggle } from '../../ui/fields.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { Spinner } from '../../ui/Spinner.tsx';
import { toast } from '../../ui/Toast.tsx';
import { articleOf, NAME_PRESETS, type Persona } from './Train.model.ts';
import { TrainFrame } from './Train.parts.tsx';

const TONES: { value: AgentTone; label: string }[] = [
  { value: 'relaxed', label: 'descontraído' },
  { value: 'balanced', label: 'equilibrado' },
  { value: 'formal', label: 'formal' },
];

/** A big preset answer (56 px) with its check, the store journey's way to skip blank fields. */
export function Preset({
  on,
  onClick,
  children,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  children: string;
  disabled?: boolean | undefined;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={() => {
        haptic.tick();
        onClick();
      }}
      className={cn(
        'press t-label flex min-h-14 min-w-0 items-center justify-center gap-2 rounded-lg px-3 ring-1 transition-[color,background-color,scale] duration-(--duration-quick) disabled:opacity-45',
        on
          ? 'bg-primary text-on-primary ring-primary depth-1'
          : 'bg-surface text-ink ring-line-strong hover:bg-hover',
      )}
    >
      {on ? <Check weight="bold" className="size-5 shrink-0" aria-hidden /> : null}
      <span className="truncate">{children}</span>
    </button>
  );
}

/** What the store needs before she can sell: a menu, hours and a way to get the order. */
export function NotReady({ ob }: { ob: VendedorOnboarding }) {
  const missing = [
    !ob.readiness.menu && { label: 'o cardápio', to: '/bem-vindo?passo=produtos' },
    !ob.readiness.hours && { label: 'o horário', to: '/bem-vindo?passo=horarios' },
    !ob.readiness.fulfilment && { label: 'retirada ou entrega', to: '/bem-vindo?passo=como' },
  ].filter((x): x is { label: string; to: string } => !!x);
  if (!missing.length) return null;
  return (
    <Notice tone="warning" title="Antes, a loja precisa estar pronta">
      <p>Eu vendo com o que a loja informa. Falta {missing.map((m) => m.label).join(', ')}.</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {missing.map((m) => (
          <li key={m.to}>
            <Link
              to={m.to}
              className="t-label inline-flex min-h-11 items-center gap-1.5 rounded-full bg-surface px-4 depth-1"
            >
              {m.label} <ArrowRight className="size-4" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Notice>
  );
}

export function NameStep({
  ob,
  draft,
  setDraft,
  onNext,
  busy,
  eyebrow,
}: {
  ob: VendedorOnboarding;
  draft: Persona;
  setDraft: (p: Partial<Persona>) => void;
  onNext: () => void;
  busy: boolean;
  eyebrow: string;
}) {
  const preset = (NAME_PRESETS as readonly string[]).includes(draft.name);
  const [other, setOther] = useState(!preset);
  const ok = draft.name.trim().length >= 2;
  return (
    <TrainFrame
      eyebrow={eyebrow}
      title="Nome e jeito de falar"
      next={onNext}
      busy={busy}
      disabled={!ok}
    >
      <NotReady ob={ob} />
      <div role="group" aria-label="Nome" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {NAME_PRESETS.map((n) => (
          <Preset
            key={n}
            on={!other && draft.name === n}
            onClick={() => {
              setOther(false);
              setDraft({ name: n });
            }}
          >
            {n}
          </Preset>
        ))}
        <Preset
          on={other}
          onClick={() => {
            setOther(true);
            if (preset) setDraft({ name: '' });
          }}
        >
          outro
        </Preset>
      </div>
      {other ? (
        <Field label="Qual nome?" htmlFor="tr-name" helper="Até 20 letras.">
          <TextInput
            id="tr-name"
            autoFocus
            maxLength={20}
            autoComplete="off"
            value={draft.name}
            placeholder="Ex.: Duda"
            onChange={(e) => setDraft({ name: e.target.value })}
          />
        </Field>
      ) : null}
      <Card className="divide-y divide-line px-4">
        <Toggle
          checked={draft.disclose}
          onChange={(v) => setDraft({ disclose: v })}
          label="Dizer que é assistente virtual"
          description={`Desligado, ${draft.name.trim() ? `${articleOf(draft.name)} ${draft.name.trim()}` : 'ela'} não se anuncia, mas nunca diz que é uma pessoa e conta a verdade se perguntarem.`}
        />
        <div className="space-y-2 py-4">
          <p className="t-label" id="tr-tone">
            Jeito de falar
          </p>
          <Segmented
            label="Jeito de falar"
            value={draft.tone}
            onChange={(t) => setDraft({ tone: t })}
            options={TONES}
          />
        </div>
      </Card>
    </TrainFrame>
  );
}

/** "+55 21 99999-0000" → "(21) 99999-0000" */
const accountPhone = (p: string | null) =>
  p ? (p.startsWith('55') ? phoneText(p.slice(2)) : `+${p}`) : null;

export function WhatsappStep({
  name,
  onNext,
  back,
  eyebrow,
}: {
  name: string;
  onNext: () => void;
  back: () => void;
  eyebrow: string;
}) {
  const poll = usePollWhenOffline(4_000, 20_000);
  const wa = useQuery({
    queryKey: qk.whatsapp,
    queryFn: api.whatsapp,
    refetchInterval: (q) =>
      q.state.data && (q.state.data.state === 'pairing' || q.state.data.state === 'connecting')
        ? poll
        : false,
  });
  const linked = wa.data?.state === 'open';
  // a linked number that lost its connection (or the gateway being down) needs no new code
  const lost =
    !!wa.data &&
    (wa.data.state === 'error' ||
      (wa.data.state === 'connecting' && wa.data.detail !== 'pair_requested'));
  return (
    <TrainFrame
      eyebrow={eyebrow}
      title="O WhatsApp da loja"
      hint={`${articleOf(name).toUpperCase()} ${name} atende no número que seus clientes já usam. Você continua usando o celular normalmente.`}
      next={onNext}
      nextLabel={linked || lost || !wa.data ? 'continuar' : 'conectar depois'}
      back={back}
    >
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-whatsapp text-on-whatsapp">
            <WhatsappLogo weight="fill" className="size-7" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">WhatsApp da loja</p>
            <p className="t-caption tnum text-muted">
              {!wa.data
                ? 'Conferindo…'
                : linked
                  ? `conectado · ${accountPhone(wa.data.phone) ?? ''}`
                  : lost
                    ? 'conectado · sem conexão agora'
                    : 'ainda não conectado'}
            </p>
          </div>
          {linked ? (
            <span className="t-caption inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-success-soft px-2.5 font-semibold text-success">
              <Check weight="bold" className="size-4" aria-hidden /> pronto
            </span>
          ) : null}
        </div>
        {lost ? (
          <p role="status" className="t-body mt-4 rounded-md bg-sunken px-4 py-3 text-muted">
            A Venduá segue tentando reconectar. As mensagens esperam e saem assim que a conexão
            voltar.
          </p>
        ) : null}
        {wa.data && !linked && !lost ? (
          <div className="mt-4" aria-live="polite">
            <Pair data={wa.data} />
          </div>
        ) : null}
      </Card>

      <Notice
        tone="info"
        icon={<Robot weight="bold" className="size-5" />}
        title="Desligue a IA do WhatsApp Business"
      >
        Se o app do WhatsApp Business tem respostas automáticas ou um assistente de IA ligado,
        desligue nas ferramentas comerciais do app. Duas IAs respondendo confunde o cliente.
      </Notice>
    </TrainFrame>
  );
}

/** The pairing code right here (ADR 0026): the full screen stays in WhatsApp. */
function Pair({ data }: { data: NonNullable<Awaited<ReturnType<typeof api.whatsapp>>> }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(() => maskPhone(data.pairPhone ?? data.suggestedPhone ?? ''));
  const digits = parsePhone(value);
  const pair = useMutation({
    mutationFn: (p: string) => api.whatsappPair(p),
    onSuccess: (d) => qc.setQueryData(qk.whatsapp, d),
    onError: (e) => toast.error(messageOf(e)),
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (data.state !== 'pairing') return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [data.state]);
  if (!data.available)
    return (
      <p className="t-body rounded-md bg-sunken px-4 py-3 text-muted">
        O WhatsApp da Venduá está fora do ar agora. Tente de novo em alguns minutos, ou siga e
        conecte depois.
      </p>
    );
  if (data.state === 'connecting')
    return (
      <p role="status" className="t-body flex items-center gap-3 rounded-md bg-sunken px-4 py-3">
        <Spinner className="size-5 shrink-0" /> Pedindo o código ao WhatsApp…
      </p>
    );
  if (data.state === 'pairing' && data.pairCode) {
    const code = data.pairCode;
    const shown = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
    const left = data.pairCodeExpiresAt
      ? Math.max(0, Math.round((Date.parse(data.pairCodeExpiresAt) - now) / 1000))
      : null;
    return (
      <div className="space-y-3">
        <div className="rounded-lg bg-sunken px-4 py-4 text-center">
          <p className="t-body text-muted">
            No WhatsApp do número{' '}
            <span className="tnum font-semibold text-ink">{phoneText(data.pairPhone)}</span>, abra
            Aparelhos conectados, Conectar com número de telefone, e digite:
          </p>
          <p
            className="tnum mt-3 select-all font-mono text-[2rem] font-bold leading-none tracking-[0.12em]"
            aria-label={`código ${code.split('').join(' ')}`}
          >
            {shown}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
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
        <Link
          to="/whatsapp"
          className="t-label inline-flex min-h-11 items-center gap-1 text-muted underline underline-offset-2"
        >
          ver o passo a passo
        </Link>
      </div>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (digits) pair.mutate(digits);
      }}
    >
      {data.detail === 'pair_expired' ? (
        <p className="t-caption font-semibold text-warning" role="status">
          O código venceu. Gere outro e digite em até 3 minutos.
        </p>
      ) : null}
      <Field label="Número do WhatsApp da loja" htmlFor="tr-wa">
        <PhoneInput id="tr-wa" value={value} onChange={(v) => setValue(v)} />
      </Field>
      <Button type="submit" block disabled={!digits} loading={pair.isPending}>
        gerar código
      </Button>
    </form>
  );
}
