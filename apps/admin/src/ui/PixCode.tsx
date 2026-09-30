import { ArrowClockwise, Copy, QrCode } from '@phosphor-icons/react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { haptic } from '../lib/haptics.ts';
import { clock, money } from '../lib/format.ts';
import { Button } from './Button.tsx';
import { cn } from './cn.ts';
import { copyText } from './CopyValue.tsx';
import { Skeleton } from './feedback.tsx';
import { toast } from './Toast.tsx';

/** A Pix copia-e-cola as a QR (always dark on light, so a camera reads it in either theme). */
export function PixQr({ code, className, alt }: { code: string; className?: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void QRCode.toDataURL(code, {
      margin: 1,
      width: 400,
      color: { dark: '#123c32', light: '#fffdf8' },
    }).then((u) => live && setSrc(u));
    return () => {
      live = false;
    };
  }, [code]);
  return src ? (
    <img src={src} alt={alt} className={cn('rounded-md bg-[#fffdf8] p-2', className)} />
  ) : (
    <Skeleton className={cn('rounded-md', className)} delay={0} />
  );
}

function useMinutesLeft(expiresAt: string | null | undefined) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [expiresAt]);
  if (!expiresAt) return null;
  return Math.ceil((Date.parse(expiresAt) - now) / 60_000);
}

/**
 * Pay-by-Pix block: the amount, the copia-e-cola (the phone that shows it is usually the one
 * that pays, so copying comes first) and the QR for paying from another phone.
 */
export function PixCode({
  copyPaste,
  amountCents,
  expiresAt,
  onRenew,
  renewing,
  className,
}: {
  copyPaste: string;
  amountCents?: number;
  expiresAt?: string | null;
  /** a fresh code once this one expires */
  onRenew?: () => void;
  renewing?: boolean;
  className?: string;
}) {
  const left = useMinutesLeft(expiresAt);
  const expired = left !== null && left <= 0;
  const box = useRef<HTMLParagraphElement>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 2500);
    return () => clearTimeout(t);
  }, [done]);

  if (expired)
    return (
      <div
        className={cn('rounded-lg bg-sunken p-5 text-center', className)}
        role="status"
        aria-live="polite"
      >
        <QrCode weight="duotone" className="mx-auto size-10 text-faint" aria-hidden />
        <p className="mt-2 font-semibold">Esse Pix venceu</p>
        <p className="t-body mt-1 text-muted">
          Era válido até {clock(expiresAt!)}. Gere outro para pagar.
        </p>
        {onRenew ? (
          <Button className="mt-4" icon={<ArrowClockwise />} loading={!!renewing} onClick={onRenew}>
            gerar outro Pix
          </Button>
        ) : null}
      </div>
    );

  return (
    <div className={cn('grid gap-5 md:grid-cols-[auto_minmax(0,1fr)] md:items-center', className)}>
      <div className="order-2 flex flex-col items-center gap-2 md:order-1">
        <PixQr
          code={copyPaste}
          alt="QR code do Pix"
          className="size-44 ring-1 ring-line md:size-52"
        />
        <p className="t-caption text-muted md:hidden">ou escaneie de outro celular</p>
      </div>
      <div className="order-1 min-w-0 space-y-3 md:order-2">
        {amountCents !== undefined ? (
          <div>
            <p className="t-caption text-muted">Valor</p>
            <p className="tnum font-display text-[2rem] font-semibold leading-10">
              {money(amountCents)}
            </p>
          </div>
        ) : null}
        <div>
          <p className="t-caption mb-1 text-muted">Pix copia e cola</p>
          <p
            ref={box}
            className="tnum line-clamp-2 select-all break-all rounded-sm bg-sunken px-3 py-2 font-mono text-[0.8125rem] leading-5 text-muted"
          >
            {copyPaste}
          </p>
        </div>
        <Button
          size="lg"
          block
          icon={<Copy />}
          onClick={async () => {
            if (await copyText(copyPaste, box.current)) {
              haptic.tick();
              setDone(true);
              toast('Código Pix copiado. Cole no app do seu banco.');
            } else toast('Selecionamos o código: segure e toque em copiar.', { tone: 'info' });
          }}
        >
          {done ? 'copiado ✓' : 'copiar código Pix'}
        </Button>
        <p className="t-caption text-muted">
          No app do banco: Pix → Pix copia e cola → cole o código.
          {left !== null ? ` Vale até ${clock(expiresAt!)}.` : null}
        </p>
      </div>
    </div>
  );
}
