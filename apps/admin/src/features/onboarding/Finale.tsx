import { ArrowRight, Copy, WhatsappLogo } from '@phosphor-icons/react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Confetti } from '../../ui/Celebration.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { haptic } from '../../lib/haptics.ts';
import { toast } from '../../ui/Toast.tsx';

export interface Pending {
  id: string;
  label: string;
  href: string;
}

/** The last screen: the store is real, here is its address, tell everyone. */
export function Finale({ url, name, pending }: { url: string; name: string; pending: Pending[] }) {
  const [qr, setQr] = useState<string | null>(null);
  const text = useMemo(() => `A ${name} agora tem loja online! Peça por aqui: ${url}`, [name, url]);
  useEffect(() => {
    haptic.commit();
    void QRCode.toDataURL(url, {
      margin: 1,
      width: 400,
      color: { dark: '#123c32', light: '#fffdf8' },
    }).then(setQr);
  }, [url]);
  return (
    <div className="animate-fade-up space-y-6">
      <section className="relative overflow-visible rounded-xl bg-primary p-6 text-on-primary depth-2 md:p-8">
        <Confetti />
        <p className="t-moment text-[2.25rem] leading-[2.5rem]">Sua loja está no ar!</p>
        <p className="t-body-lg mt-2 opacity-85">
          Parabéns, {name}. Agora é só contar para todo mundo.
        </p>
        <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-center">
          {qr ? <img src={qr} alt={`QR code para ${url}`} className="size-40 rounded-md" /> : null}
          <div className="hidden w-40 shrink-0 rounded-xl bg-[#f7f4ea] p-2 md:block">
            <Mascote pose="publicar" size={144} />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <p className="tnum break-all font-display text-xl font-semibold">
              {url.replace('https://', '')}
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={`https://wa.me/?text=${encodeURIComponent(text)}`}
                target="_blank"
                rel="noreferrer"
                className="t-label inline-flex min-h-14 items-center gap-2 rounded-lg bg-spark px-5 text-on-spark"
              >
                <WhatsappLogo weight="fill" className="size-6" /> Avisar no WhatsApp
              </a>
              <Button
                variant="ghost"
                size="lg"
                className="text-on-primary"
                icon={<Copy />}
                onClick={() =>
                  void navigator.clipboard.writeText(url).then(() => toast('Link copiado'))
                }
              >
                Copiar link
              </Button>
            </div>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="t-label inline-flex min-h-11 items-center gap-1 underline underline-offset-2"
            >
              ver como o cliente vê <ArrowRight className="size-4" />
            </a>
          </div>
        </div>
      </section>
      {pending.length ? (
        <div className="rounded-lg bg-surface p-4 depth-1">
          <p className="t-title-2">Ficou para depois</p>
          <p className="t-body mt-1 text-muted">Sem pressa. Quando der, é só tocar.</p>
          <ul className="mt-3">
            {pending.map((p) => (
              <li key={p.id}>
                <Link
                  to={p.href}
                  className="flex min-h-12 items-center justify-between gap-3 rounded-md px-2 hover:bg-hover"
                >
                  {p.label} <ArrowRight className="size-4 text-faint" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <ButtonLink to="/" size="lg" block>
        Ir para o meu painel
      </ButtonLink>
    </div>
  );
}
