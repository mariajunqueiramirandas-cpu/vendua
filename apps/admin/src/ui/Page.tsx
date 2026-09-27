import { ArrowLeft } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from './cn.ts';
import { IconButton } from './Button.tsx';

/** Page title block: back (phones), title, subtitle, primary action top-right on desktop. */
export function PageHeader({
  title,
  subtitle,
  back,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: string | true;
  actions?: ReactNode;
  className?: string;
}) {
  const nav = useNavigate();
  return (
    <header className={cn('mb-5 flex items-start gap-2 md:mb-7', className)}>
      {back ? (
        <IconButton
          label="voltar"
          className="-ml-3 shrink-0"
          onClick={() => (back === true ? nav(-1) : nav(back))}
        >
          <ArrowLeft />
        </IconButton>
      ) : null}
      <div className="min-w-0 flex-1 pt-1.5">
        <h1 className="t-title-1">{title}</h1>
        {subtitle ? <p className="t-body mt-1 text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="hidden shrink-0 items-center gap-2 md:flex">{actions}</div> : null}
    </header>
  );
}

export function PageBody({
  children,
  className,
  wide,
}: {
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 pb-32 pt-4 md:px-8 md:pb-16 md:pt-8',
        wide ? 'max-w-[1320px]' : 'max-w-[880px]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Sticky primary action in the thumb zone on phones, safe-area aware (§2.2.6). */
export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'glass fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 border-t border-line px-4 py-3 md:hidden',
        className,
      )}
    >
      <div className="mx-auto flex max-w-[880px] gap-2">{children}</div>
    </div>
  );
}
