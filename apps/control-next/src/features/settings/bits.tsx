import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import { Button } from '@/components/ui/button.tsx';
import { Textarea } from '@/components/ui/input.tsx';

const TZ_SUGGESTIONS = [
  'America/Sao_Paulo',
  'America/Fortaleza',
  'America/Recife',
  'America/Bahia',
  'America/Manaus',
  'America/Belem',
  'America/Rio_Branco',
];

/** datalist for the timezone pickers — rendered once by the page; inputs use `list="tz-list"`. */
export function TzList() {
  return (
    <datalist id="tz-list">
      {TZ_SUGGESTIONS.map((t) => (
        <option key={t} value={t} />
      ))}
    </datalist>
  );
}

/** Area section title + one-line explanation. */
export function SectionHead({
  title,
  sub,
  aside,
}: {
  title: ReactNode;
  sub?: ReactNode | undefined;
  aside?: ReactNode | undefined;
}) {
  return (
    <div className="mb-2 flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      {aside}
    </div>
  );
}

export const ErrorHint = ({ children }: { children: ReactNode }) => (
  <p className="text-xs text-destructive-foreground">{children}</p>
);

/**
 * Form actions row. On phones it sticks to the bottom of the scroll area while
 * its form is on screen, so long forms don't need a scroll back down to save.
 * `pinned` (usually = dirty) turns that on; `inCard` = last child of a padded
 * card body (bleeds to the card edges).
 */
export function SaveBar({
  children,
  pinned,
  inCard,
  className,
}: {
  children: ReactNode;
  pinned?: boolean | undefined;
  inCard?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2',
        inCard ? 'mt-3' : 'mt-1',
        pinned &&
          'sticky bottom-0 z-10 -mx-3 border-t px-3 py-2 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none',
        pinned && (inCard ? '-mb-3 rounded-b-lg bg-card/95 md:mb-0' : 'bg-background/95'),
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Escape hatch for keys the structured fields don't cover. */
export function RawJson({
  value,
  onSave,
}: {
  value: Record<string, unknown>;
  onSave: (v: Record<string, unknown>) => void;
}) {
  const [raw, setRaw] = useState('');
  const [err, setErr] = useState('');
  const save = () => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setErr('precisa ser um objeto JSON');
        return;
      }
      setErr('');
      onSave(parsed as Record<string, unknown>);
    } catch {
      setErr('JSON inválido');
    }
  };
  return (
    <details
      className="group mt-3 border-t pt-2"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open) setRaw(JSON.stringify(value, null, 2));
      }}
    >
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        json bruto
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <Textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
          rows={8}
          className="font-mono md:text-xs"
        />
        {err && <ErrorHint>{err}</ErrorHint>}
        <div>
          <Button size="sm" variant="outline" onClick={save}>
            salvar json
          </Button>
        </div>
      </div>
    </details>
  );
}
