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
 * The shop window from 1200 px: a rounded window cut into the paper beside the questions, as tall
 * as the screen, with the store standing lit on a shelf inside it. The light is the store's own
 * colour and swells once whenever an answer changed the store; one line under the shelf says where
 * the open question's answer lands.
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
      // under the sticky header, with the same breath above and below
      className="hidden lg:sticky lg:top-[5.5rem] lg:block lg:h-[calc(100dvh-7rem)] lg:self-start"
    >
      <div
        className="relative flex h-full flex-col overflow-hidden rounded-xl text-on-stage depth-2"
        style={{ background: 'linear-gradient(180deg, var(--stage) 0%, var(--stage-deep) 100%)' }}
      >
        <p className="t-label relative z-10 flex items-center gap-2 px-7 pt-6">
          <span aria-hidden className="animate-pulse-dot size-2 rounded-full bg-spark" />
          {title}
        </p>
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6">
          <span
            key={spark}
            aria-hidden
            className={cn(
              'pointer-events-none absolute left-1/2 top-[44%] aspect-square w-[min(36rem,150%)] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 transition-[background] duration-(--duration-smooth)',
              spark > 0 && 'animate-lamp',
            )}
            style={{
              background: `radial-gradient(closest-side, color-mix(in srgb, ${glowOf(accent)} 40%, transparent), transparent)`,
            }}
          />
          <div className="relative">{phone}</div>
        </div>
        {/* the shelf the phone stands on, and its shadow on it */}
        <div aria-hidden className="relative mx-6 h-px bg-stage-line">
          <span className="absolute left-1/2 top-0 h-5 w-52 -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-black/40 blur-md" />
        </div>
        <p className="t-body relative mx-auto max-w-72 text-balance px-6 pb-7 pt-5 text-center text-on-stage-muted">
          {line}
        </p>
      </div>
    </aside>
  );
}
