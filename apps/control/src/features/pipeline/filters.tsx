import { useEffect, useState, type InputHTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { useDebounced } from '@/lib/hooks.ts';
import { Switch } from '@/components/ui/controls.tsx';
import { Field, Input, Select } from '@/components/ui/input.tsx';
import { ARCHIVED, SORTS, type FilterKey, type LeadSort, type PipelineParams } from './params.ts';

/** Values already in the pipe, offered as suggestions. */
export interface Known {
  tags: string[];
  segments: string[];
  sources: string[];
  cities: string[];
}

/** Text input that owns its keystrokes and commits to the URL after a pause. */
export function UrlText({
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
  // external change (limpar, back/forward, a saved view) wins over the local draft
  useEffect(() => setV(value), [value]);
  return (
    <Input value={v} onChange={(e) => setV(e.target.value)} className={className} {...props} />
  );
}

export function SortSelect({ p, className }: { p: PipelineParams; className?: string }) {
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

const TEXT: { k: 'tag' | 'segment' | 'source' | 'city'; label: string; known: keyof Known }[] = [
  { k: 'tag', label: 'tag', known: 'tags' },
  { k: 'segment', label: 'segmento', known: 'segments' },
  { k: 'source', label: 'origem', known: 'sources' },
  { k: 'city', label: 'cidade', known: 'cities' },
];

const FLAGS: { k: 'draft' | 'overdue'; label: string; hint: string }[] = [
  { k: 'draft', label: 'com rascunho', hint: 'o agente escreveu e espera aprovação' },
  { k: 'overdue', label: 'tarefa atrasada', hint: 'uma tarefa aberta passou do prazo' },
];

/** The filters beyond stage and search — in a popover on desktop, the sheet on phones. */
export function FilterFields({ p, known }: { p: PipelineParams; known: Known }) {
  const f = p.filters;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {TEXT.map(({ k, label, known: list }) => (
          <Field key={k} label={label} htmlFor={`pf-${k}`}>
            <UrlText
              id={`pf-${k}`}
              value={f[k]}
              onCommit={(v) => p.setFilter(k, v.trim())}
              list={`pf-${k}-list`}
              placeholder="qualquer"
              maxLength={120}
            />
            <datalist id={`pf-${k}-list`}>
              {known[list].map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>
        ))}
      </div>
      {FLAGS.map(({ k, label, hint }) => (
        <label key={k} className="flex items-center gap-3 text-sm pointer-coarse:min-h-10">
          <span className="flex min-w-0 flex-1 flex-col">
            {label}
            <span className="text-xs text-muted-foreground">{hint}</span>
          </span>
          <Switch
            checked={!!f[k]}
            onCheckedChange={(on) => p.setFilter(k, on ? '1' : '')}
            aria-label={label}
          />
        </label>
      ))}
      <Field label="mostrar" htmlFor="pf-archived">
        <Select
          id="pf-archived"
          value={f.archived}
          onChange={(e) => p.setFilter('archived', e.target.value)}
        >
          {ARCHIVED.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

const CHIP_KEYS: FilterKey[] = ['tag', 'segment', 'source', 'city', 'draft', 'overdue', 'archived'];
const CHIP_LABEL: Partial<Record<FilterKey, string>> = {
  tag: 'tag',
  segment: 'segmento',
  source: 'origem',
  city: 'cidade',
};

function chipText(k: FilterKey, v: string): string {
  if (k === 'draft') return 'com rascunho';
  if (k === 'overdue') return 'tarefa atrasada';
  if (k === 'archived') return ARCHIVED.find(([a]) => a === v)?.[1] ?? v;
  return `${CHIP_LABEL[k]}: ${v}`;
}

export const activeFilterCount = (p: PipelineParams) =>
  CHIP_KEYS.filter((k) => !!p.filters[k]).length;

/** The active extra filters as removable chips — what a saved view or a shared link turned on. */
export function ActiveFilters({ p }: { p: PipelineParams }) {
  const on = CHIP_KEYS.filter((k) => !!p.filters[k]);
  if (!on.length) return null;
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {on.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => p.setFilter(k, '')}
          title="remover filtro"
          className="inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-full border bg-card pr-1.5 pl-2.5 text-xs text-foreground shadow-card hover:bg-hover pointer-coarse:h-8"
        >
          <span className="truncate">{chipText(k, p.filters[k])}</span>
          <X className="size-3 shrink-0 text-muted-foreground" />
        </button>
      ))}
      <button
        type="button"
        onClick={p.clearFilters}
        className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline pointer-coarse:h-8"
      >
        limpar tudo
      </button>
    </div>
  );
}
