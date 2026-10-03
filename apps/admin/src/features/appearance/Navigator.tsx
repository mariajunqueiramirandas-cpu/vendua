import {
  ArrowDown,
  ArrowUp,
  CaretRight,
  Eye,
  EyeSlash,
  Palette,
  Plus,
} from '@phosphor-icons/react';
import type { TemplateSection } from '../../lib/api.ts';
import { IconButton } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { sectionName, sectionSummary } from './fields.ts';
import { tplLabel, type Editor, type Selection, type TplId } from './useEditor.ts';

/**
 * Everything on the page, top to bottom as the customer sees it: the shared top (on every
 * page), this page's own parts, the shared footer. The colours sit above as one more thing
 * to pick, so there's one way in to everything: tap it here or in the preview.
 */
export function Navigator({
  ed,
  onPick,
  onAdd,
}: {
  ed: Editor;
  onPick: (s: Selection) => void;
  onAdd: () => void;
}) {
  const layout = ed.drafts.layout.sections;
  const ci = layout.findIndex((x) => x.type === 'sdk:page-content');
  const top = ci < 0 ? layout : layout.slice(0, ci);
  const bottom = ci < 0 ? [] : layout.slice(ci + 1);
  const pageSections = ed.drafts[ed.page].sections;
  const row = (tpl: TplId, list: TemplateSection[]) => (x: TemplateSection) => {
    const i = list.findIndex((y) => y.id === x.id);
    return (
      <Row
        key={`${tpl}:${x.id}`}
        sec={x}
        on={ed.sel?.kind === 'section' && ed.sel.tpl === tpl && ed.sel.id === x.id}
        changed={ed.dirtySection(tpl, x)}
        first={i === 0}
        last={i === list.length - 1}
        onPick={() => onPick({ kind: 'section', tpl, id: x.id })}
        onMove={(d) => ed.move(tpl, x.id, d)}
        onToggle={() => ed.toggle(tpl, x.id)}
      />
    );
  };
  const c = ed.tokens?.color;

  return (
    <nav aria-label="o que editar" className="space-y-6">
      <button
        type="button"
        onClick={() => onPick({ kind: 'style' })}
        aria-current={ed.sel?.kind === 'style' || undefined}
        className={cn(
          'press-row flex min-h-16 w-full items-center gap-3 rounded-md bg-surface px-3 text-left ring-1 transition-colors',
          ed.sel?.kind === 'style' ? 'bg-spark-soft ring-2 ring-spark' : 'ring-line',
        )}
      >
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-full ring-1 ring-line-strong"
          style={c ? { background: c.accent, color: c.onAccent } : undefined}
        >
          <Palette weight="fill" className="size-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 font-semibold">
            Cores e cantos
            {ed.tokensDirty ? <ChangedDot /> : null}
          </span>
          <span
            className={cn('t-caption block truncate', ed.tokensOk ? 'text-muted' : 'text-danger')}
          >
            {ed.tokensOk ? 'valem para a loja toda' : 'difícil de ler: ajuste para publicar'}
          </span>
        </span>
        <CaretRight className="size-5 shrink-0 text-muted" />
      </button>

      {top.length ? (
        <Group title="Topo" note="em todas as páginas">
          {top.map(row('layout', layout))}
        </Group>
      ) : null}

      <Group title={tplLabel(ed.page)} note="só nesta página">
        {pageSections.map(row(ed.page, pageSections))}
        <li>
          <button
            type="button"
            onClick={onAdd}
            className="press-row t-label flex min-h-14 w-full items-center justify-center gap-2 rounded-md border border-dashed border-line-strong text-ink hover:bg-hover"
          >
            <Plus className="size-5" /> adicionar parte
          </button>
        </li>
      </Group>

      {bottom.length ? (
        <Group title="Rodapé" note="em todas as páginas">
          {bottom.map(row('layout', layout))}
        </Group>
      ) : null}
    </nav>
  );
}

function Group({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-baseline gap-2 px-1">
        <span className="t-label">{title}</span>
        <span className="t-caption text-muted">{note}</span>
      </h3>
      <ol className="space-y-2">{children}</ol>
    </section>
  );
}

const ChangedDot = () => (
  <span className="inline-flex items-center" title="mudou desde a última publicação">
    <span className="size-2 rounded-full bg-primary" aria-hidden />
    <span className="sr-only">(mudou)</span>
  </span>
);

function Row({
  sec,
  on,
  changed,
  first,
  last,
  onPick,
  onMove,
  onToggle,
}: {
  sec: TemplateSection;
  on: boolean;
  changed: boolean;
  first: boolean;
  last: boolean;
  onPick: () => void;
  onMove: (d: -1 | 1) => void;
  onToggle: () => void;
}) {
  const name = sectionName(sec.type);
  const s = sectionSummary(sec.settings);
  const summary = s && s !== name ? s : null;
  return (
    <li>
      <div
        className={cn(
          'flex items-center gap-0.5 rounded-md bg-surface py-1 pl-1 pr-1 ring-1 transition-colors',
          on ? 'bg-spark-soft ring-2 ring-spark' : 'ring-line',
        )}
      >
        <button
          type="button"
          onClick={onPick}
          aria-current={on || undefined}
          className="press-row flex min-h-12 min-w-0 flex-1 flex-col justify-center rounded-sm px-2 text-left"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn('truncate font-semibold', sec.disabled && 'text-muted')}>
              {name}
            </span>
            {changed ? <ChangedDot /> : null}
          </span>
          {sec.disabled ? (
            <span className="t-caption flex items-center gap-1 text-muted">
              <EyeSlash className="size-3.5" /> escondida
            </span>
          ) : summary ? (
            <span className="t-caption block truncate text-muted">{summary}</span>
          ) : null}
        </button>
        <IconButton label="subir" size="sm" disabled={first} onClick={() => onMove(-1)}>
          <ArrowUp />
        </IconButton>
        <IconButton label="descer" size="sm" disabled={last} onClick={() => onMove(1)}>
          <ArrowDown />
        </IconButton>
        <IconButton label={sec.disabled ? 'mostrar' : 'esconder'} size="sm" onClick={onToggle}>
          {sec.disabled ? <EyeSlash /> : <Eye />}
        </IconButton>
      </div>
    </li>
  );
}
