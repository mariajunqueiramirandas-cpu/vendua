import type { ReactNode } from 'react';
import { cn } from '../cn.ts';
import { Bubble, type Voice } from './Bubble.tsx';
import { PersonaAvatar } from './PersonaAvatar.tsx';
import { SELLER } from './tones.ts';

export interface ChatLine {
  voice: Voice;
  text: string;
  time?: string | undefined;
}

/**
 * The onboarding's live WhatsApp preview, the counterpart of `MiniStore`: a small chat in
 * which Duá answers better at each step ("prévia no WhatsApp"), and the frame of "Peça para
 * mim", where the owner is the customer. `owner` flips the sides: the owner (as the customer)
 * on the right in forest, Duá on the left. Pass `lines` for a scripted preview, or children
 * (bubbles, receipts) for a live one; `composer` sits at the bottom.
 */
export function MiniChat({
  label,
  lines,
  children,
  typing,
  owner,
  composer,
  className,
}: {
  /** the caption on top: "prévia no WhatsApp", "teste · só você vê" */
  label?: ReactNode | undefined;
  lines?: ChatLine[] | undefined;
  children?: ReactNode | undefined;
  /** Duá is writing */
  typing?: boolean | undefined;
  /** the owner plays the customer: their lines are `you`, on the right */
  owner?: boolean | undefined;
  composer?: ReactNode | undefined;
  className?: string | undefined;
}) {
  return (
    <section
      aria-label={typeof label === 'string' ? label : 'conversa com o Duá'}
      className={cn('flex flex-col gap-1.5 rounded-lg bg-sunken p-3.5', className)}
    >
      {label ? (
        <p className="t-caption mb-1 flex items-center gap-1.5 self-start font-semibold text-muted">
          <PersonaAvatar size="xs" />
          {label}
        </p>
      ) : null}
      {lines?.map((l, i) => {
        const prev = lines[i - 1];
        return (
          <Bubble
            key={i}
            voice={l.voice}
            author={owner && l.voice === 'you' ? 'você, como cliente' : undefined}
            time={l.time}
            signed={l.voice === 'seller' && prev?.voice !== 'seller'}
            align={owner ? (l.voice === 'seller' ? 'start' : 'end') : undefined}
          >
            {l.text}
          </Bubble>
        );
      })}
      {children}
      {typing ? <Typing owner={owner} /> : null}
      {composer ? <div className="mt-2">{composer}</div> : null}
    </section>
  );
}

/** "Duá está escrevendo": three dots in his bubble, still under reduced motion */
function Typing({ owner }: { owner?: boolean | undefined }) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-1 rounded-[18px] px-4 py-3',
        owner ? 'self-start rounded-bl-md' : 'self-end rounded-br-md',
        SELLER,
      )}
    >
      <span className="sr-only">Duá está escrevendo</span>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className="animate-pulse-dot size-1.5 rounded-full bg-ink opacity-60"
          style={{ animationDelay: `${i * 180}ms` }}
        />
      ))}
    </div>
  );
}
