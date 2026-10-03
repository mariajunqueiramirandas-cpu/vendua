import { ArrowClockwise, Copy, QrCode, Timer } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { haptic } from '../lib/haptics.ts';
import { clock, money, until } from '../lib/format.ts';
import { Button } from './Button.tsx';
import { cn } from './cn.ts';
import { copyText } from './CopyValue.tsx';
import { Qr } from './Qr.tsx';
import { toast } from './Toast.tsx';

/** A Pix copia-e-cola as a QR. */
export function PixQr({ code, className, alt }: { code: string; className?: string; alt: string }) {
  return <Qr value={code} alt={alt} className={cn('rounded-md p-2', className)} />;
}

const HOUR = 3_600_000;

/** ms until the deadline, ticking every second in its last hour (the countdown shows seconds). */
function useMsLeft(expiresAt: string | null | undefined) {
  const [now, setNow] = useState(Date.now);
  const at = expiresAt ? Date.parse(expiresAt) : NaN;
  const close = at - now <= HOUR;
  useEffect(() => {
    if (Number.isNaN(at)) return;
    const t = setInterval(() => setNow(Date.now()), close ? 1000 : 30_000);
    return () => clearInterval(t);
  }, [at, close]);
  return Number.isNaN(at) ? null : at - now;
}

/** "24:13": minutes and seconds, as only the last hour counts down */
function countdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Asks for an invoice's Pix when it has none: once on arrival, and again only after the code it
 * showed went away (Core stops returning a Pix once it expires).
 */
export function useIssuePix(
  inv: { id: string; pix: { copyPaste: string } | null } | undefined,
  wanted: boolean,
  issue: (id: string) => void,
) {
  const shown = useRef<string | null>(null);
  const asked = useRef<string | null>(null);
  const ask = useRef(issue);
  ask.current = issue;
  useEffect(() => {
    if (!inv) return;
    if (inv.pix) {
      shown.current = inv.pix.copyPaste;
      return;
    }
    const key = `${inv.id}:${shown.current ?? ''}`;
    if (!wanted || asked.current === key) return;
    asked.current = key;
    ask.current(inv.id);
  }, [inv, wanted]);
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
  /** a fresh code once this one expires: called by itself at the deadline, then from a button */
  onRenew?: () => void;
  renewing?: boolean;
  className?: string;
}) {
  const left = useMsLeft(expiresAt);
  const expired = left !== null && left <= 0;
  const renewed = useRef<string | null>(null);
  useEffect(() => {
    if (!expired || !onRenew || renewed.current === expiresAt) return;
    renewed.current = expiresAt!;
    onRenew();
  }, [expired, expiresAt, onRenew]);
  const auto = !!onRenew && (renewing || renewed.current !== expiresAt);
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
          {auto
            ? 'Gerando um Pix novo…'
            : `Era válido até ${clock(expiresAt!)}. Gere outro para pagar.`}
        </p>
        {onRenew && !auto ? (
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
        </p>
        {left !== null ? (
          <p
            className={cn(
              't-caption flex items-center gap-1.5',
              left <= 5 * 60_000 ? 'font-semibold text-warning' : 'text-muted',
            )}
          >
            <Timer weight="bold" className="size-4 shrink-0" aria-hidden />
            {left <= HOUR ? (
              <span>
                Vence em{' '}
                <span role="timer" className="tnum">
                  {countdown(left)}
                </span>{' '}
                · {until(expiresAt!)}
              </span>
            ) : (
              <span>Vale até {until(expiresAt!)}</span>
            )}
          </p>
        ) : null}
      </div>
    </div>
  );
}
