import { ArrowLeft, Question } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { prevIs } from '../app/Router.tsx';
import { cn } from './cn.ts';
import { Button, IconButton } from './Button.tsx';
import { openHelp } from './help.ts';

/** Opens the help for the screen you're on (the Shell's sheet; "?" on a keyboard does the same). */
export function HelpButton({ className }: { className?: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={<Question weight="bold" />}
      onClick={openHelp}
      title="ajuda desta tela (?)"
      aria-haspopup="dialog"
      className={cn('min-h-12 text-muted hover:text-ink', className)}
    >
      ajuda
    </Button>
  );
}

/**
 * Page title block: title, subtitle, primary action top-right on desktop. `back` shows from
 * tablet up; phones go back from the header (Shell), where the store avatar sits.
 */
export function PageHeader({
  title,
  subtitle,
  back,
  actions,
  className,
  help = true,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: string | true;
  actions?: ReactNode;
  className?: string;
  /** the "ajuda" button for this screen's help; off on Ajuda itself */
  help?: boolean;
}) {
  const nav = useNavigate();
  return (
    <header className={cn('mb-5 flex items-start gap-2 md:mb-7', className)}>
      {back ? (
        <IconButton
          label="voltar"
          className="-ml-3 shrink-0 max-md:hidden"
          onClick={() =>
            back === true || prevIs(back) ? nav(-1) : nav(back, { state: { vt: 'pop' } })
          }
        >
          <ArrowLeft />
        </IconButton>
      ) : null}
      <div className="min-w-0 flex-1 pt-1.5">
        <h1 className="t-title-1">{title}</h1>
        {subtitle ? <p className="t-body mt-1 text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="hidden shrink-0 items-center gap-2 md:flex">{actions}</div> : null}
      {help ? <HelpButton className="-mr-2 shrink-0 md:mr-0" /> : null}
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
      data-action-bar
      className={cn(
        'glass fixed inset-x-0 bottom-(--tabbar-h) z-30 border-t border-line px-4 py-3 md:hidden',
        className,
      )}
    >
      <div className="mx-auto flex max-w-[880px] gap-2">{children}</div>
    </div>
  );
}
