import { useEffect, useMemo, useState } from 'react';
import { cn } from './cn.ts';
import { Button } from './Button.tsx';
import { Mascote } from './Mascote.tsx';

// The first order, and the 10th/100th/1000th (§6.4): the only celebrations in the
// admin, so they land. Restrained lime + cream burst, max 40 particles, 1.2 s.

const SEEN = 'vendua-milestones';

export function milestoneFor(total: number): number | null {
  for (const m of [1000, 100, 10, 1]) if (total >= m) return m;
  return null;
}

export function unseenMilestone(storeId: string, total: number): number | null {
  const m = milestoneFor(total);
  // automated browsers (screenshots, CI) see the screen, not the one-time moment
  if (!m || navigator.webdriver) return null;
  try {
    const seen = JSON.parse(localStorage.getItem(SEEN) ?? '{}') as Record<string, number>;
    if ((seen[storeId] ?? 0) >= m) return null;
    return m;
  } catch {
    return null;
  }
}

export function markMilestone(storeId: string, m: number) {
  try {
    const seen = JSON.parse(localStorage.getItem(SEEN) ?? '{}') as Record<string, number>;
    seen[storeId] = Math.max(seen[storeId] ?? 0, m);
    localStorage.setItem(SEEN, JSON.stringify(seen));
  } catch {
    /* ignore */
  }
}

export function Confetti() {
  const bits = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        i,
        dx: `${(Math.random() - 0.5) * 520}px`,
        dy: `${-120 - Math.random() * 360}px`,
        rot: `${(Math.random() - 0.5) * 720}deg`,
        c: i % 3 === 0 ? 'var(--spark)' : i % 3 === 1 ? '#f7f4ea' : 'var(--chart)',
        d: 900 + Math.random() * 300,
      })),
    [],
  );
  return (
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2">
      {bits.map((b) => (
        <span
          key={b.i}
          className="absolute block h-3 w-2 rounded-[2px] motion-reduce:hidden"
          style={
            {
              background: b.c,
              '--dx': b.dx,
              '--dy': b.dy,
              '--rot': b.rot,
              animation: `confetti ${b.d}ms cubic-bezier(.2,.8,.2,1) forwards`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

export function Celebration({
  milestone,
  onClose,
  shareUrl,
}: {
  milestone: number;
  onClose: () => void;
  shareUrl?: string;
}) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const close = () => {
    setShown(false);
    onClose();
  };
  if (!shown) return null;
  const first = milestone === 1;
  const text = first ? 'Primeiro pedido!' : `${milestone.toLocaleString('pt-BR')} pedidos!`;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={text}
      className={cn('fixed inset-0 z-[80] grid place-items-center bg-[rgb(10_16_13/0.55)] p-6')}
      onClick={close}
    >
      <div
        className="animate-fade-up relative w-full max-w-sm overflow-visible rounded-xl bg-surface p-8 text-center depth-3"
        onClick={(e) => e.stopPropagation()}
      >
        <Confetti />
        <div className="mx-auto w-40 text-ink">
          <Mascote pose="sucesso" />
        </div>
        <p className="t-moment mt-2">{text}</p>
        <p className="t-body mt-2 text-muted">
          {first
            ? 'Sua loja começou a vender. Esse é o primeiro de muitos.'
            : 'Cada um deles foi alguém escolhendo a sua loja.'}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          {shareUrl ? (
            <Button
              variant="spark"
              size="lg"
              onClick={() =>
                window.open(
                  `https://wa.me/?text=${encodeURIComponent(`${text} Obrigada a todo mundo que pediu 💚 ${shareUrl}`)}`,
                  '_blank',
                )
              }
            >
              compartilhar no WhatsApp
            </Button>
          ) : null}
          <Button variant="ghost" size="lg" onClick={close}>
            continuar
          </Button>
        </div>
      </div>
    </div>
  );
}
