import {
  ArrowRight,
  ArrowSquareOut,
  Copy,
  DownloadSimple,
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

/**
 * The last screen. Live: the address, the QR and the words to tell everyone. Still waiting on the
 * plan's first payment: the store is ready, and the payment that opens it is right here.
 */
export function Finale({
  url,
  name,
  live,
  waiting,
  pending,
}: {
  url: string;
  name: string;
  /** false while billing_hold keeps the store closed */
  live: boolean;
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
      <section className="relative overflow-visible rounded-xl bg-primary p-6 text-on-primary depth-2 md:p-8">
        {live ? <Confetti /> : null}
        <div className="flex items-center gap-5">
          <span className="dua-disc hidden size-28 shrink-0 place-items-center bg-[#f7f4ea] sm:grid">
            <Mascote pose={live ? 'publicar' : 'loja'} size={104} className="w-24" />
          </span>
          <div className="min-w-0">
            <h1 className="t-moment text-[2.25rem] leading-[2.5rem]">
              {live ? 'Sua loja está no ar!' : 'Sua loja está pronta!'}
            </h1>
            <p className="t-body-lg mt-2 opacity-85">
              {live
                ? `Parabéns, ${name}. Agora é só contar para todo mundo.`
                : 'Ela abre para pedidos assim que o pagamento do plano for confirmado.'}
            </p>
          </div>
        </div>
      </section>

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
        <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
          {/* while the plan's Pix QR is on screen, a second QR would get scanned by mistake */}
          {live ? (
            <div className="flex shrink-0 flex-col items-center gap-2 self-center sm:self-start">
              <Qr value={url} alt={`QR code para ${bare}`} className="size-36 rounded-md" />
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
              <span className="tnum min-w-0 flex-1 truncate font-semibold">{bare}</span>
              <span className="t-label inline-flex min-h-10 items-center gap-1 rounded-sm bg-surface px-3 depth-1">
                <Copy className="size-4" /> copiar
              </span>
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(text)}`}
              target="_blank"
              rel="noreferrer"
              className="t-label press flex min-h-14 items-center justify-center gap-2 rounded-lg bg-spark px-5 text-on-spark"
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
        <Card className="p-4">
          <p className="t-title-2">Ficou para depois</p>
          <p className="t-body mt-1 text-muted">Sem pressa. Quando der, é só tocar.</p>
          <ul className="mt-3">
            {pending.map((p) => (
              <li key={p.id}>
                <Link
                  to={p.to}
                  className="press-row flex min-h-12 items-center justify-between gap-3 rounded-md px-2 hover:bg-hover"
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
