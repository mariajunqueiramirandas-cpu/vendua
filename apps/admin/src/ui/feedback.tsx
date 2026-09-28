import { Lightbulb, X } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '../lib/api.ts';
import { cn } from './cn.ts';
import { Button } from './Button.tsx';
import { Mascote } from './Mascote.tsx';

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

/** Shaped like the content; shows only after 150 ms so fast loads don't flash (§11). */
export function Skeleton({ className, delay = 150 }: { className?: string; delay?: number }) {
  const [show, setShow] = useState(delay === 0);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return (
    <div
      aria-hidden
      className={cn('rounded-md', show ? 'skeleton' : 'bg-transparent', className)}
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
  INVALID_ORDER_TRANSITION: 'Esse pedido já mudou. A tela foi atualizada.',
  CATEGORY_NOT_EMPTY: 'Essa categoria ainda tem produtos. Mova ou esconda eles antes.',
  COUPON_EXISTS: 'Já existe um cupom com esse código.',
  LAST_OWNER: 'A loja precisa ter pelo menos um dono.',
  MEMBER_EXISTS: 'Esse celular já faz parte da equipe.',
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
