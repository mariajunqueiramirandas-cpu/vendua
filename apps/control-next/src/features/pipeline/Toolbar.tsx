import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Download, Search, SlidersHorizontal, Upload, X } from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import { useDebounced, useIsMobile } from '@/lib/hooks.ts';
import { Button } from '@/components/ui/button.tsx';
import { Field, Input, Select } from '@/components/ui/input.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';
import { ARCHIVED, SORTS, type LeadSort, type PipelineParams } from './params.ts';

/** Stage filter pills with counts — one scrollable row on phones. */
export function StageChips({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; count: number | undefined }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="estágio"
      className="no-scrollbar -mx-3 flex min-w-0 gap-1 overflow-x-auto px-3 md:mx-0 md:px-0"
    >
      {options.map((o) => (
        <button
          key={o.value || 'all'}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-hover hover:text-foreground pointer-coarse:h-9',
            'aria-checked:border-primary aria-checked:bg-primary aria-checked:text-primary-foreground',
          )}
        >
          {o.label}
          <span className="text-[11px] opacity-75 tnum">{o.count ?? '·'}</span>
        </button>
      ))}
    </div>
  );
}

/** Text input that owns its keystrokes and commits to the URL after a pause. */
function UrlText({
  value,
  onCommit,
  className,
  ...props
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string | undefined;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(value);
  const deb = useDebounced(v, 250);
  // commit only when the typed value settles, not when the URL value changes
  useEffect(() => void (deb !== value && onCommit(deb)), [deb]);
  // external change (limpar, back/forward) wins over the local draft
  useEffect(() => setV(value), [value]);
  return (
    <Input value={v} onChange={(e) => setV(e.target.value)} className={className} {...props} />
  );
}

function SortSelect({ p, className }: { p: PipelineParams; className?: string }) {
  return (
    <Select
      value={p.filters.sort}
      onChange={(e) => p.setFilter('sort', e.target.value as LeadSort)}
      title="ordenar"
      aria-label="ordenar"
      className={className}
    >
      {SORTS.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </Select>
  );
}

function ArchivedSelect({ p, className }: { p: PipelineParams; className?: string }) {
  return (
    <Select
      value={p.filters.archived}
      onChange={(e) => p.setFilter('archived', e.target.value)}
      title="arquivados"
      aria-label="arquivados"
      className={className}
    >
      {ARCHIVED.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </Select>
  );
}

function TagInput({
  p,
  tags,
  className,
}: {
  p: PipelineParams;
  tags: string[];
  className?: string;
}) {
  return (
    <>
      <UrlText
        value={p.filters.tag}
        onCommit={(v) => p.setFilter('tag', v.trim())}
        list="pipeline-tags"
        placeholder="tag…"
        title="filtrar por tag"
        aria-label="filtrar por tag"
        className={className}
      />
      <datalist id="pipeline-tags">
        {tags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </>
  );
}

export function PipelineToolbar({
  p,
  chips,
  tags,
  onImport,
}: {
  p: PipelineParams;
  chips: ReactNode;
  tags: string[];
  onImport: () => void;
}) {
  const mobile = useIsMobile();
  const [sheet, setSheet] = useState(false);
  const f = p.filters;
  const extra = (f.sort !== 'new' ? 1 : 0) + (f.tag ? 1 : 0) + (f.archived ? 1 : 0);

  return (
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      {chips}
      <div className="flex min-w-0 items-center gap-2 md:ml-auto">
        <div className="relative min-w-0 flex-1 md:w-52 md:flex-none">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <UrlText
            type="search"
            value={f.q}
            onCommit={(v) => p.setFilter('q', v)}
            placeholder="buscar lead…"
            aria-label="buscar lead"
            className="pl-8"
          />
        </div>
        {mobile ? (
          <Button
            variant="outline"
            onClick={() => setSheet(true)}
            aria-label="filtros"
            className="relative"
          >
            <SlidersHorizontal /> filtros
            {extra > 0 && <span className="text-[11px] text-muted-foreground tnum">{extra}</span>}
          </Button>
        ) : (
          <>
            <TagInput p={p} tags={tags} className="w-28" />
            <SortSelect p={p} className="w-36" />
            <ArchivedSelect p={p} className="w-28" />
          </>
        )}
        {p.filtered && !mobile && (
          <Button variant="ghost" size="sm" onClick={p.clearFilters} title="limpar filtros">
            <X /> limpar
          </Button>
        )}
      </div>

      {mobile && (
        <ResponsiveSheet
          open={sheet}
          onOpenChange={setSheet}
          title="filtros"
          footer={
            <>
              {p.filtered && (
                <Button variant="outline" onClick={p.clearFilters}>
                  <X /> limpar
                </Button>
              )}
              <Button onClick={() => setSheet(false)}>ver leads</Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field label="ordenar por">
              <SortSelect p={p} />
            </Field>
            <Field label="tag">
              <TagInput p={p} tags={tags} />
            </Field>
            <Field label="mostrar">
              <ArchivedSelect p={p} />
            </Field>
            <Field label="planilha">
              <div className="flex gap-2 [&>*]:flex-1">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSheet(false);
                    onImport();
                  }}
                >
                  <Upload /> importar csv
                </Button>
                <Button variant="outline" asChild>
                  <a href="/control/v1/leads/export" download="leads.csv">
                    <Download /> exportar
                  </a>
                </Button>
              </div>
            </Field>
          </div>
        </ResponsiveSheet>
      )}
    </div>
  );
}
