import { useState, type ReactNode } from 'react';
import { Download, ListFilter, Search, SlidersHorizontal, Upload, X } from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import { useIsMobile } from '@/lib/hooks.ts';
import { Button } from '@/components/ui/button.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/controls.tsx';
import { Field } from '@/components/ui/input.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';
import {
  ActiveFilters,
  activeFilterCount,
  FilterFields,
  SortSelect,
  UrlText,
  type Known,
} from './filters.tsx';
import type { PipelineParams } from './params.ts';
import { SavedViews } from './SavedViews.tsx';

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
          {/* unpicked it's already muted: a fainter count would fall under 4.5:1 */}
          <span className={cn('text-[11px] tnum', value === o.value && 'opacity-80')}>
            {o.count ?? '·'}
          </span>
        </button>
      ))}
    </div>
  );
}

export function PipelineToolbar({
  p,
  chips,
  known,
  onImport,
}: {
  p: PipelineParams;
  chips: ReactNode;
  known: Known;
  onImport: () => void;
}) {
  const mobile = useIsMobile();
  const [sheet, setSheet] = useState(false);
  const f = p.filters;
  const n = activeFilterCount(p);
  const count = n > 0 && <span className="text-[11px] text-muted-foreground tnum">{n}</span>;

  return (
    <div className="flex flex-col gap-2">
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
            <>
              <Button variant="outline" onClick={() => setSheet(true)} aria-label="filtros">
                <SlidersHorizontal /> filtros
                {count}
              </Button>
              <SavedViews p={p} compact />
            </>
          ) : (
            <>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" aria-label="filtros">
                    <ListFilter /> filtros
                    {count}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80">
                  <FilterFields p={p} known={known} />
                </PopoverContent>
              </Popover>
              <SortSelect p={p} className="w-36" />
              <SavedViews p={p} />
            </>
          )}
        </div>
      </div>
      <ActiveFilters p={p} />

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
            <FilterFields p={p} known={known} />
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
