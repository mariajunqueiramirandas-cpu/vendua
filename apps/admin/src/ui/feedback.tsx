import { Lightbulb, X } from '@phosphor-icons/react';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ApiError } from '../lib/api.ts';
import { cn } from './cn.ts';
import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { Mascote, type Pose } from './Mascote.tsx';

/** Illustration + one sentence + one action — never a bare "Nenhum item" (§2.2.2). */
export function EmptyState({
  art,
  title,
  body,
  action,
  className,
}: {
  art: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-10 text-center', className)}>
      <div className="mb-4 w-40 text-ink [&_svg]:h-auto [&_svg]:w-full">{art}</div>
      <p className="t-title-2 max-w-sm">{title}</p>
      {body ? <p className="t-body mt-2 max-w-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Duá beside a short message: the calm states inside a screen (all done, nothing waiting). */
export function DuaNote({
  pose,
  title,
  children,
  action,
  className,
}: {
  pose: Pose;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex items-center gap-4 p-4 pr-5', className)}>
      <span className="dua-disc grid size-[76px] shrink-0 place-items-center">
        <Mascote pose={pose} size={72} className="size-[72px]" />
      </span>
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="t-body text-muted">{children}</div> : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </Card>
  );
}

/** The app opening (the session check, the sign-in's code): Duá after a beat, so a fast
 *  start never flashes it. */
export function Splash({ text = 'Abrindo sua loja…' }: { text?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 300);
    return () => clearTimeout(t);
  }, []);
  return (
    <div
      role="status"
      aria-busy
      className="grid min-h-dvh place-items-center px-6"
      aria-label={text}
    >
      {show ? (
        <div className="animate-fade-up flex flex-col items-center text-center">
          <span className="dua-disc grid size-44 place-items-center">
            <Mascote pose="carregando" size={160} className="w-40" />
          </span>
          <p className="t-body mt-3 text-muted">{text}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Shaped like the content; shows only after 150 ms so fast loads don't flash (§11). */
export function Skeleton({
  className,
  delay = 150,
  style,
}: {
  className?: string;
  delay?: number;
  style?: CSSProperties;
}) {
  const [show, setShow] = useState(delay === 0);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return (
    <div
      aria-hidden
      style={style}
      className={cn(
        // a caller's own radius (a round avatar) must win over the default
        !/\brounded/.test(className ?? '') && 'rounded-md',
        show ? 'skeleton' : 'bg-transparent',
        className,
      )}
    />
  );
}

export function Loading({
  lines = 3,
  className,
  delay,
}: {
  lines?: number;
  className?: string;
  delay?: number;
}) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label="carregando">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          {...(delay === undefined ? {} : { delay })}
          className={cn('h-20', i === 0 && 'h-32')}
        />
      ))}
    </div>
  );
}

/** Errors say what happened, in words, and how to fix it. */
export function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'TIMEOUT') return 'A conexão está lenta. Confira a internet e tente de novo.';
    if (err.status === 0) return 'Sem conexão. Confira a internet e tente de novo.';
    if (err.status === 403)
      return 'Seu acesso não permite fazer isso. Peça para quem é dono da loja.';
    if (err.status === 429) return 'Muitas tentativas seguidas. Espere um minuto e tente de novo.';
    if (err.status >= 500)
      return 'Algo deu errado do nosso lado. Já estamos vendo. Tente de novo em instantes.';
    return FRIENDLY[err.code] ?? 'Não deu certo. Confira os dados e tente de novo.';
  }
  return 'Não deu certo. Tente de novo.';
}

const FRIENDLY: Record<string, string> = {
  INVALID_CODE: 'Código errado ou vencido. Confira ou peça outro.',
  INVALID_PHONE: 'Digite o celular com DDD, como (22) 99999-0000.',
  REASON_REQUIRED: 'Escolha um motivo para avisar o cliente.',
  IDEMPOTENCY_IN_PROGRESS: 'Ainda estamos salvando isso. Espere um instante.',
  INVALID_ORDER_TRANSITION: 'Esse pedido já mudou. A tela foi atualizada.',
  CATEGORY_NOT_EMPTY: 'Essa categoria ainda tem produtos. Mova ou esconda eles antes.',
  COUPON_EXISTS: 'Já existe um cupom com esse código.',
  LAST_OWNER: 'A loja precisa ter pelo menos um dono.',
  MEMBER_EXISTS: 'Esse celular já faz parte da equipe. Toque na pessoa para mudar o papel.',
  BILLING_HOLD:
    'A loja abre para pedidos assim que o primeiro pagamento do plano for confirmado. Veja em Conta e plano.',
  INVALID_PIX: 'Essa chave Pix não parece certa. Confira o tipo e a chave.',
  INVALID_TOKENS: 'Essas cores ficam difíceis de ler. Ajuste o contraste.',
  TEMPLATE_VERSION_CONFLICT: 'Alguém mudou essa página agora há pouco. Recarregamos a versão nova.',
  CONFIRMATION_MISMATCH: 'Os números não conferem. Digite os 4 últimos dígitos do celular.',
  NOTHING_TO_IMPORT: 'Não achamos linhas como "Nome - 12,50". Confira o texto colado.',
  UNSUPPORTED_MEDIA: 'Esse arquivo não é uma foto que a gente consiga usar. Tente JPG ou PNG.',
  PAYLOAD_TOO_LARGE: 'Essa foto é muito grande. Tente outra.',
  OTP_UNAVAILABLE: 'Não conseguimos enviar o código agora. Tente de novo em instantes.',
  RATE_LIMITED: 'Muitas tentativas seguidas. Espere um minuto e tente de novo.',
};

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <EmptyState
      art={<Mascote pose={error instanceof ApiError && error.status === 0 ? 'offline' : 'erro'} />}
      title="Não conseguimos carregar"
      body={messageOf(error)}
      action={
        retry ? (
          <Button variant="secondary" onClick={retry}>
            tentar de novo
          </Button>
        ) : undefined
      }
    />
  );
}

/** Teach in place, once (§2.2.12): never returns after it's dismissed. */
export function Hint({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  const key = `vendua-hint:${id}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== '1';
    } catch {
      return true;
    }
  });
  if (!open) return null;
  return (
    <div
      className={cn(
        'animate-fade-up flex items-start gap-3 rounded-md bg-spark-soft p-4',
        className,
      )}
    >
      <Lightbulb weight="duotone" className="mt-0.5 size-5 shrink-0" aria-hidden />
      <p className="t-body min-w-0 flex-1">{children}</p>
      <button
        type="button"
        aria-label="entendi, não mostrar de novo"
        onClick={() => {
          setOpen(false);
          try {
            localStorage.setItem(key, '1');
          } catch {
            /* ignore */
          }
        }}
        className="-mr-1 -mt-1 grid size-10 shrink-0 place-items-center rounded-full hover:bg-press"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
