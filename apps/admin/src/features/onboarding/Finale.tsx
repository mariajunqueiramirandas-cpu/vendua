import {
  ArrowRight,
  ArrowSquareOut,
  Copy,
  DownloadSimple,
  Gift,
  InstagramLogo,
  WhatsappLogo,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { haptic } from '../../lib/haptics.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { Confetti } from '../../ui/Celebration.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { Qr, qrPng } from '../../ui/Qr.tsx';
import { toast } from '../../ui/Toast.tsx';
import { glowOf } from './Vitrine.tsx';

export interface Pending {
  id: string;
  label: string;
  /** into the wizard (`/bem-vindo?passo=…`) or the screen that holds it */
  to: string;
}

const copy = (text: string, done: string) =>
  void navigator.clipboard.writeText(text).then(
    () => toast(done),
    () => toast.error('Não deu para copiar. Segure o texto para copiar.'),
  );

/** "Sua loja está no ar!", or "pronta" while the plan's first payment is on its way. */
const titleOf = (live: boolean) => (live ? 'Sua loja está no ar!' : 'Sua loja está pronta!');
const lineOf = (live: boolean, name: string) =>
  live
    ? `Parabéns, ${name}. Agora é só contar para todo mundo.`
    : 'Ela abre para pedidos assim que o pagamento do plano for confirmado.';

/**
 * The finale's top on phones and tablets: the shop window one last time, as the card the store
 * has worn the whole way, the finished store rising out of it lit, with Duá beside it holding
 * the flag. (From 1200 px the window is beside the page.)
 */
export function FinaleHero({
  name,
  live,
  phone,
  accent,
}: {
  name: string;
  live: boolean;
  /** the store, as built */
  phone: ReactNode;
  accent: string | null;
}) {
  return (
    <section
      className="relative overflow-hidden rounded-xl text-on-stage depth-2"
      style={{ background: 'linear-gradient(180deg, var(--stage) 0%, var(--stage-deep) 100%)' }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-40 left-1/2 aspect-square w-[32rem] -translate-x-1/2 rounded-full opacity-70"
        style={{
          background: `radial-gradient(closest-side, color-mix(in srgb, ${glowOf(accent)} 45%, transparent), transparent)`,
        }}
      />
      <div className="relative px-5 pt-6 sm:px-7">
        <h1 className="t-moment text-balance text-[2.25rem] leading-[2.5rem] sm:text-[2.5rem] sm:leading-[2.75rem]">
          {titleOf(live)}
        </h1>
        <p className="t-body-lg mt-2 text-pretty text-on-stage-muted">{lineOf(live, name)}</p>
      </div>
      <div className="relative mx-auto mt-6 h-[14rem] w-[13rem] overflow-hidden">
        {live ? <Confetti /> : null}
        {phone}
      </div>
      {/* Duá on the shelf beside the store, on a cream disc (on forest, always) */}
      <span
        aria-hidden
        data-dark
        className="dua-disc absolute bottom-4 left-[max(1rem,calc(50%-11.5rem))] grid size-20 place-items-center depth-2"
      >
        <Mascote pose={live ? 'publicar' : 'loja'} size={80} className="size-[4.5rem]" />
      </span>
      {/* the shelf */}
      <div aria-hidden className="relative mx-5 h-px bg-stage-line">
        <span className="absolute left-1/2 top-0 h-4 w-44 -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-black/40 blur-md" />
      </div>
      <div aria-hidden className="h-5" />
    </section>
  );
}

/**
 * The last screen. Live: the address, the QR and the words to tell everyone. Still waiting on the
 * plan's first payment: the store is ready, and the payment that opens it is right here.
 */
export function Finale({
  url,
  name,
  live,
  trialEndsAt = null,
  waiting,
  pending,
}: {
  url: string;
  name: string;
  /** false while billing_hold keeps the store closed */
  live: boolean;
  /** the store runs on a free trial until then */
  trialEndsAt?: string | null;
  /** what opens it (the plan's Pix, or a line saying who confirms it) */
  waiting: ReactNode;
  pending: Pending[];
}) {
  const bare = url.replace(/^https?:\/\//, '');
  const text = useMemo(() => `A ${name} agora tem loja online! Peça por aqui: ${url}`, [name, url]);
  const bio = `Peça online 👉 ${bare}`;
  const [png, setPng] = useState<string | null>(null);
  useEffect(() => {
    if (live) haptic.commit();
  }, [live]);
  useEffect(() => {
    let on = true;
    qrPng(url).then(
      (u) => on && setPng(u),
      () => undefined,
    );
    return () => {
      on = false;
    };
  }, [url]);
  return (
    <div className="animate-fade-up space-y-6">
      {/* from 1200 px the lit window is beside it: the page's own top stays on paper */}
      <section className="relative hidden items-end gap-6 pb-2 lg:flex">
        {live ? <Confetti /> : null}
        <span className="dua-disc grid size-32 shrink-0 place-items-center bg-spark-soft">
          <Mascote pose={live ? 'publicar' : 'loja'} size={128} className="size-[7.5rem]" />
        </span>
        <div className="min-w-0 pb-2">
          <h1 className="t-moment text-balance text-[3rem] leading-[3.25rem]">{titleOf(live)}</h1>
          <p className="t-body-lg mt-2 text-pretty text-muted">{lineOf(live, name)}</p>
        </div>
      </section>
      {live && trialEndsAt ? (
        <p className="t-body flex items-start gap-3 rounded-lg bg-spark-soft px-4 py-3 text-ink">
          <Gift weight="duotone" className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>
            Teste grátis até{' '}
            <strong className="whitespace-nowrap">
              {new Date(trialEndsAt).toLocaleDateString('pt-BR', {
                day: 'numeric',
                month: 'long',
              })}
            </strong>
            : nada é cobrado até lá. Depois, é só escolher Pix ou cartão em{' '}
            <Link to="/conta" className="font-semibold underline underline-offset-2">
              Conta
            </Link>
            .
          </span>
        </p>
      ) : null}

      {live ? null : (
        <Card className="space-y-4 p-5">
          <div>
            <p className="t-title-2">Falta só isso para abrir</p>
            <p className="t-body mt-1 text-muted">
              Enquanto isso, o link já funciona: quem entrar vê que a loja abre em breve.
            </p>
          </div>
          {waiting}
        </Card>
      )}

      <Card className="p-5">
        <p className="t-title-2">Conte para todo mundo</p>
        <p className="t-body mt-1 text-muted">
          O link é o endereço da sua loja. O QR code vai bem no balcão e na sacola.
        </p>
        <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start">
          {/* while the plan's Pix QR is on screen, a second QR would get scanned by mistake */}
          {live ? (
            <div className="flex shrink-0 flex-col items-center gap-2 self-center sm:self-start">
              <span className="rounded-lg bg-surface p-2 ring-1 ring-line">
                <Qr value={url} alt={`QR code para ${bare}`} className="size-36 rounded-sm" />
              </span>
              {png ? (
                <a
                  href={png}
                  download={`qr-${bare.split('.')[0]}.png`}
                  className="t-label inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 hover:bg-hover"
                >
                  <DownloadSimple className="size-5" /> baixar para imprimir
                </a>
              ) : null}
            </div>
          ) : null}
          <div className="min-w-0 flex-1 space-y-3">
            <button
              type="button"
              onClick={() => copy(url, 'Link copiado')}
              className="press flex w-full items-center gap-2 rounded-md bg-sunken py-2 pl-4 pr-2 text-left"
              aria-label={`copiar o link ${bare}`}
            >
              <span className="tnum min-w-0 flex-1 truncate font-display text-[1.0625rem] font-semibold tracking-[-0.01em]">
                {bare}
              </span>
              <span className="t-label inline-flex min-h-10 items-center gap-1 rounded-sm bg-surface px-3 depth-1">
                <Copy className="size-4" /> copiar
              </span>
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(text)}`}
              target="_blank"
              rel="noreferrer"
              className="t-label press flex min-h-14 items-center justify-center gap-2 rounded-lg bg-whatsapp px-5 text-on-whatsapp depth-1"
            >
              <WhatsappLogo weight="fill" className="size-6" /> Avisar no WhatsApp
            </a>
            <Button
              variant="secondary"
              block
              icon={<InstagramLogo />}
              onClick={() => copy(bio, 'Texto da bio copiado. Cole no Instagram.')}
            >
              Copiar texto para a bio do Instagram
            </Button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="t-label inline-flex min-h-11 items-center gap-1 underline underline-offset-2"
            >
              ver como o cliente vê <ArrowSquareOut className="size-4" />
            </a>
          </div>
        </div>
      </Card>

      {pending.length ? (
        <Card className="p-5">
          <p className="t-title-2">Ficou para depois</p>
          <p className="t-body mt-1 text-muted">Sem pressa. Quando der, é só tocar.</p>
          <ul className="mt-3">
            {pending.map((p) => (
              <li key={p.id}>
                <Link
                  to={p.to}
                  className="press-row -mx-2 flex min-h-12 items-center justify-between gap-3 rounded-md px-2 hover:bg-hover"
                >
                  {p.label} <ArrowRight className="size-4 text-faint" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <ButtonLink to="/" size="lg" block>
        Ir para o meu painel
      </ButtonLink>
    </div>
  );
}
