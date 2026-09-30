import {
  ArrowSquareOut,
  CheckCircle,
  ClockCountdown,
  CreditCard,
  HandCoins,
  PixLogo,
  Plugs,
  ShieldWarning,
  TestTube,
  Wallet,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type Payments as PaymentsData } from '../../lib/api.ts';
import { dateShort } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { HoldButton } from '../../ui/HoldButton.tsx';
import { payError, TONE, type Tone } from '../../ui/PaymentChip.tsx';
import { toast } from '../../ui/Toast.tsx';

type Mp = PaymentsData['mercadoPago'];

const STATUS: Record<Mp['status'], { label: string; tone: Tone }> = {
  not_connected: { label: 'não conectado', tone: 'neutral' },
  connected: { label: 'conectado', tone: 'success' },
  expiring: { label: 'autorização vencendo', tone: 'warning' },
  disconnected: { label: 'desconectado', tone: 'danger' },
  restricted: { label: 'com restrição', tone: 'danger' },
};

const REASON: Record<string, string> = {
  access_denied: 'Você não autorizou no Mercado Pago. Tente de novo quando quiser.',
  denied: 'Você não autorizou no Mercado Pago. Tente de novo quando quiser.',
  state: 'O pedido de conexão venceu. Toque em conectar de novo.',
  invalid_state: 'O pedido de conexão venceu. Toque em conectar de novo.',
  expired: 'O pedido de conexão venceu. Toque em conectar de novo.',
  forbidden: 'Só quem é dono da loja conecta o Mercado Pago.',
};

/** Back from Mercado Pago's consent screen: say how it went once, then clean the address. */
export function useMpArrival() {
  const [search, setSearch] = useSearchParams();
  const qc = useQueryClient();
  const mp = search.get('mp');
  const reason = search.get('reason');
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (!mp) return;
    setSearch({}, { replace: true });
    // StrictMode runs this twice before the address is clean: say it once
    const key = `${mp}:${reason}`;
    if (said.current === key) return;
    said.current = key;
    if (mp === 'connected') {
      toast('Mercado Pago conectado ✓');
      void qc.invalidateQueries({ queryKey: qk.payments });
      void qc.invalidateQueries({ queryKey: qk.home });
    } else
      toast.error(
        (reason && REASON[reason]) ?? 'Não conseguimos conectar o Mercado Pago. Tente de novo.',
      );
  }, [mp, reason, qc, setSearch]);
}

const LAST_ERROR: Record<string, string> = {
  token_unreadable: 'Precisamos da sua autorização de novo.',
  token_expired: 'A autorização venceu.',
  invalid_grant: 'A autorização foi removida na sua conta Mercado Pago.',
  revoked: 'A autorização foi removida na sua conta Mercado Pago.',
};

/** Core may store a code: show only words a merchant can read, never the code itself. */
function lastErrorText(e: string | null) {
  if (!e) return null;
  if (LAST_ERROR[e]) return LAST_ERROR[e];
  return /\s/.test(e) && !/[_{}]/.test(e) ? `O Mercado Pago informou: ${e}` : null;
}

export const mpLive = (mp: Mp) => mp.status === 'connected' || mp.status === 'expiring';

function useConnect() {
  return useMutation({
    mutationFn: () => api.mpConnect(),
    onSuccess: ({ url }) => location.assign(url),
    onError: (e) => toast.error(payError(e)),
  });
}

export function MercadoPagoCard({ data, owner }: { data: PaymentsData; owner: boolean }) {
  const mp = data.mercadoPago;
  const st = STATUS[mp.status];
  return (
    <Card as="section" aria-labelledby="mp-title" className="overflow-hidden">
      <div className="flex items-start gap-3 p-5 pb-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-sunken">
          <Wallet weight="duotone" className="size-7" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id="mp-title" className="t-title-2">
              Mercado Pago
            </h2>
            {mp.available || mp.status !== 'not_connected' ? (
              <span
                className={cn(
                  't-caption inline-flex h-7 shrink-0 items-center rounded-full px-2.5 font-semibold',
                  TONE[st.tone],
                )}
              >
                {st.label}
              </span>
            ) : null}
          </div>
          <p className="t-caption mt-0.5 text-muted">Pix confirmado sozinho e cartão pelo site</p>
        </div>
      </div>
      <div className="px-5 pb-5">
        {mp.status === 'not_connected' ? (
          mp.available ? (
            <NotConnected owner={owner} />
          ) : (
            <Unavailable />
          )
        ) : mp.status === 'connected' || mp.status === 'expiring' ? (
          <Connected data={data} owner={owner} />
        ) : (
          <Lost data={data} owner={owner} />
        )}
      </div>
    </Card>
  );
}

function Unavailable() {
  return (
    <div className="rounded-md bg-sunken px-4 py-3">
      <p className="font-semibold">Ainda não disponível na sua loja</p>
      <p className="t-body mt-1 text-muted">
        Enquanto isso, seus clientes pagam com Pix pela sua chave, cartão na entrega ou dinheiro,
        como hoje.
      </p>
    </div>
  );
}

function Benefit({
  Icon,
  title,
  children,
}: {
  Icon: typeof PixLogo;
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

function NotConnected({ owner }: { owner: boolean }) {
  const connect = useConnect();
  return (
    <>
      <ul className="space-y-4">
        <Benefit Icon={PixLogo} title="Pix confirmado na hora">
          O pedido chega pago. Você não precisa conferir no banco nem marcar “recebi”.
        </Benefit>
        <Benefit Icon={CreditCard} title="Cartão pelo site">
          O cliente paga com cartão na sua loja, na tela segura do Mercado Pago.
        </Benefit>
        <Benefit Icon={HandCoins} title="Dinheiro na sua conta Mercado Pago">
          O Mercado Pago desconta a taxa dele em cada pagamento. A Venduá não cobra por pedido.
        </Benefit>
      </ul>
      {owner ? (
        <div className="mt-5">
          <Button
            size="lg"
            block
            loading={connect.isPending}
            onClick={() => connect.mutate()}
            icon={<ArrowSquareOut />}
          >
            conectar Mercado Pago
          </Button>
          <p className="t-caption mt-2 text-center text-muted">
            Você entra na sua conta do Mercado Pago, autoriza a Venduá e volta para cá.
          </p>
        </div>
      ) : (
        <p className="t-body mt-5 rounded-md bg-sunken px-4 py-3 text-muted">
          Só quem é dono da loja conecta o Mercado Pago.
        </p>
      )}
    </>
  );
}

function Connected({ data, owner }: { data: PaymentsData; owner: boolean }) {
  const mp = data.mercadoPago;
  const qc = useQueryClient();
  const connect = useConnect();
  const [confirming, setConfirming] = useState(false);
  const disconnect = useMutation({
    mutationFn: () => api.mpDisconnect(),
    onSuccess: (d) => {
      qc.setQueryData(qk.payments, d);
      void qc.invalidateQueries({ queryKey: qk.home });
      setConfirming(false);
      toast('Mercado Pago desconectado');
    },
    onError: (e) => toast.error(payError(e)),
  });
  const card = data.methods.includes('card_online');
  return (
    <div className="space-y-4">
      {mp.status === 'expiring' ? (
        <Callout tone="warning" Icon={ClockCountdown} title="A autorização está vencendo">
          {mp.expiresAt ? `Ela vale até ${dateShort(mp.expiresAt)}. ` : ''}Reconecte para o Pix
          continuar confirmando sozinho e o cartão seguir na loja.
          {owner ? (
            <Button
              className="mt-3"
              loading={connect.isPending}
              onClick={() => connect.mutate()}
              icon={<ArrowSquareOut />}
            >
              reconectar
            </Button>
          ) : null}
        </Callout>
      ) : null}

      <dl className="t-body divide-y divide-line rounded-md bg-sunken px-4">
        {mp.accountId ? (
          <div className="flex justify-between gap-3 py-2.5">
            <dt className="text-muted">Conta</dt>
            <dd className="tnum min-w-0 truncate font-semibold">nº {mp.accountId}</dd>
          </div>
        ) : null}
        {mp.connectedAt ? (
          <div className="flex justify-between gap-3 py-2.5">
            <dt className="text-muted">Conectado desde</dt>
            <dd className="font-semibold">{dateShort(mp.connectedAt)}</dd>
          </div>
        ) : null}
        {mp.liveMode !== null ? (
          <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-muted">Pagamentos</dt>
            <dd>
              {mp.liveMode ? (
                <span
                  className={cn(
                    't-caption inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 font-semibold',
                    TONE.success,
                  )}
                >
                  <CheckCircle weight="bold" className="size-4" aria-hidden /> de verdade
                </span>
              ) : (
                <span
                  className={cn(
                    't-caption inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 font-semibold',
                    TONE.warning,
                  )}
                >
                  <TestTube weight="bold" className="size-4" aria-hidden /> modo de teste
                </span>
              )}
            </dd>
          </div>
        ) : null}
      </dl>
      {mp.liveMode === false ? (
        <p className="t-caption text-muted">
          No modo de teste nenhum dinheiro de verdade muda de lugar.
        </p>
      ) : null}

      <p className="t-body text-muted">
        Na sua loja: Pix com confirmação automática{card ? ' e cartão pelo site' : ''}.
      </p>

      {owner ? (
        confirming ? (
          <div className="space-y-3 rounded-md bg-danger-soft/60 p-4">
            <p className="font-semibold">Desconectar o Mercado Pago?</p>
            <p className="t-body text-muted">
              O Pix volta para a sua chave, e você confere cada um no banco. O cartão pelo site sai
              da loja. Pedidos já pagos não mudam.
            </p>
            <HoldButton onConfirm={() => disconnect.mutate()} disabled={disconnect.isPending}>
              {disconnect.isPending ? 'desconectando…' : 'segure para desconectar'}
            </HoldButton>
            <Button variant="ghost" block onClick={() => setConfirming(false)}>
              manter conectado
            </Button>
          </div>
        ) : (
          <Button variant="ghost" className="-ml-3 text-muted!" onClick={() => setConfirming(true)}>
            desconectar
          </Button>
        )
      ) : null}
    </div>
  );
}

function Lost({ data, owner }: { data: PaymentsData; owner: boolean }) {
  const mp = data.mercadoPago;
  const connect = useConnect();
  const restricted = mp.status === 'restricted';
  return (
    <div className="space-y-4">
      <Callout
        tone="danger"
        Icon={restricted ? ShieldWarning : Plugs}
        title={restricted ? 'O Mercado Pago limitou sua conta' : 'O Mercado Pago foi desconectado'}
      >
        {restricted
          ? 'Resolva a pendência no app do Mercado Pago e depois conecte de novo.'
          : 'A autorização acabou ou foi removida na sua conta Mercado Pago.'}
        {lastErrorText(mp.lastError) ? (
          <span className="mt-1 block">{lastErrorText(mp.lastError)}</span>
        ) : null}
      </Callout>
      <div>
        <p className="t-label">O que o cliente vê agora</p>
        <ul className="t-body mt-1.5 list-disc space-y-1 pl-5 text-muted">
          <li>O Pix volta para a chave da loja: você confere cada um no banco.</li>
          <li>O cartão pelo site sumiu da loja.</li>
        </ul>
      </div>
      {owner ? (
        <Button
          size="lg"
          block
          loading={connect.isPending}
          onClick={() => connect.mutate()}
          icon={<ArrowSquareOut />}
        >
          conectar de novo
        </Button>
      ) : (
        <p className="t-body text-muted">Peça para quem é dono da loja conectar de novo.</p>
      )}
    </div>
  );
}

function Callout({
  tone,
  Icon,
  title,
  children,
}: {
  tone: 'warning' | 'danger';
  Icon: typeof Plugs;
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex gap-3 rounded-md px-4 py-3',
        tone === 'danger' ? 'bg-danger-soft' : 'bg-warning-soft',
      )}
    >
      <Icon
        weight="bold"
        className={cn('mt-0.5 size-5 shrink-0', tone === 'danger' ? 'text-danger' : 'text-warning')}
        aria-hidden
      />
      <div className="min-w-0">
        <p className={cn('font-semibold', tone === 'danger' ? 'text-danger' : 'text-warning')}>
          {title}
        </p>
        <div className="t-body mt-0.5 text-ink">{children}</div>
      </div>
    </div>
  );
}
