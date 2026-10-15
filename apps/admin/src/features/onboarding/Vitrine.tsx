import type { ReactNode } from 'react';
import { cn } from '../../ui/cn.ts';
import type { Spot } from './flow.ts';

/** Where the open question's answer lands in the store, said under the phone. */
export const SPOT_LINE: Record<Spot, string> = {
  name: 'O nome vai no topo da loja.',
  logo: 'A foto vira o ícone da loja.',
  color: 'A cor vai na capa e no botão da sacola.',
  tagline: 'A frase fica embaixo do nome.',
  hours: 'O cliente vê se a loja está aberta agora.',
  how: 'Retirada e entrega aparecem ao lado do horário.',
  whatsapp: 'O botão do WhatsApp fica no canto da loja.',
  products: 'Os produtos entram no cardápio.',
  pay: 'O cliente escolhe como pagar na sacola.',
};

/** The store's colour as light: a dark accent is lifted so it still glows on forest. */
export const glowOf = (accent: string | null) =>
  accent ? `color-mix(in srgb, ${accent} 70%, var(--on-stage))` : 'var(--spark)';

/**
 * The shop window beside the questions from 1200 px: the store on forest, standing on a shelf,
 * lit in its own colour. The light swells once whenever an answer changed the store.
 */
export function Vitrine({
  phone,
  accent,
  spark,
  title,
  line,
}: {
  phone: ReactNode;
  accent: string | null;
  /** changes when an answer changed the store */
  spark: number;
  title: string;
  /** under the shelf: what the open question changes */
  line: ReactNode;
}) {
  return (
    <aside
      aria-label="prévia da sua loja"
      className="sticky top-0 hidden h-dvh flex-col overflow-hidden bg-stage text-on-stage lg:flex"
    >
      <div className="relative flex flex-1 flex-col items-center justify-center pt-6">
        <p className="t-label relative z-10 mb-6 flex items-center gap-2 text-on-stage">
          <span aria-hidden className="animate-pulse-dot size-2 rounded-full bg-spark" />
          {title}
        </p>
        <div className="relative w-full px-10">
          <span
            key={spark}
            aria-hidden
            className={cn(
              'pointer-events-none absolute left-1/2 top-[38%] aspect-square w-[min(40rem,130%)] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-55 transition-[background] duration-(--duration-smooth)',
              spark > 0 && 'animate-lamp',
            )}
            style={{
              background: `radial-gradient(closest-side, color-mix(in srgb, ${glowOf(accent)} 42%, transparent), transparent)`,
            }}
          />
          <div className="relative">{phone}</div>
        </div>
        {/* the shelf the phone stands on, and its shadow on it */}
        <div aria-hidden className="relative h-px w-full bg-stage-line">
          <span className="absolute left-1/2 top-0 h-5 w-56 -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-black/35 blur-md" />
        </div>
        <p className="t-body relative mt-6 max-w-72 text-balance px-6 text-center text-on-stage-muted">
          {line}
        </p>
      </div>
    </aside>
  );
}
