import { useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn.ts';
import { useIsMobile } from '@/lib/hooks.ts';
import { Checkbox } from './ui/controls.tsx';
import { LoadingRows } from './common.tsx';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** width/alignment utilities for both th and td */
  className?: string | undefined;
  align?: 'start' | 'end' | undefined;
}

export interface Selection {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}

/**
 * The list primitive: a dense table on ≥768px, purpose-built rows on phones
 * (`mobileRow`). Never reshape a table with CSS — give phones their own row.
 */
export function DataList<T>({
  rows,
  rowKey,
  columns,
  mobileRow,
  onRowClick,
  selection,
  loading,
  empty,
  className,
  rowClassName,
}: {
  rows: readonly T[];
  rowKey: (row: T) => string;
  columns: Column<T>[];
  mobileRow: (row: T) => ReactNode;
  onRowClick?: (row: T) => void | undefined;
  selection?: Selection | undefined;
  loading?: boolean | undefined;
  empty?: ReactNode | undefined;
  className?: string | undefined;
  rowClassName?: (row: T) => string | undefined;
}) {
  const mobile = useIsMobile();

  if (loading && !rows.length) return <LoadingRows className={cn('p-3', className)} />;
  if (!rows.length) return <div className={className}>{empty}</div>;

  const toggle = (id: string, on: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (on) next.add(id);
    else next.delete(id);
    selection.onChange(next);
  };

  if (mobile) {
    // phones: long-press a row to start selecting; checkboxes appear only while selecting
    const selecting = !!selection && selection.selected.size > 0;
    return (
      <ul className={cn('divide-y', className)}>
        {rows.map((row) => {
          const id = rowKey(row);
          const sel = selection?.selected.has(id) ?? false;
          return (
            <MobileRow
              key={id}
              selected={sel}
              selecting={selecting}
              onToggle={selection ? (on) => toggle(id, on) : undefined}
              onOpen={onRowClick ? () => onRowClick(row) : undefined}
              className={rowClassName?.(row)}
            >
              {mobileRow(row)}
            </MobileRow>
          );
        })}
      </ul>
    );
  }

  const allSel = !!selection && rows.every((r) => selection.selected.has(rowKey(r)));
  const someSel = !!selection && rows.some((r) => selection.selected.has(rowKey(r)));

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
          <tr className="border-b">
            {selection && (
              <th className="w-9 pl-3">
                <Checkbox
                  checked={allSel ? true : someSel ? 'indeterminate' : false}
                  onCheckedChange={(v) =>
                    selection.onChange(v === true ? new Set(rows.map(rowKey)) : new Set())
                  }
                  aria-label="selecionar todos"
                />
              </th>
            )}
            {columns.map((c, i) => (
              <th
                key={c.key}
                className={cn(
                  'h-8 px-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground',
                  i === 0 && !selection && 'pl-3',
                  i === columns.length - 1 && 'pr-3',
                  c.align === 'end' && 'text-right',
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = rowKey(row);
            const sel = selection?.selected.has(id) ?? false;
            return (
              <tr
                key={id}
                onClick={onRowClick && (() => onRowClick(row))}
                className={cn(
                  'h-10 border-b last:border-b-0 transition-colors hover:bg-hover',
                  onRowClick && 'cursor-pointer',
                  sel && 'bg-agent-soft hover:bg-agent-soft',
                  rowClassName?.(row),
                )}
              >
                {selection && (
                  <td className="w-9 pl-3" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={sel}
                      onCheckedChange={(v) => toggle(id, v === true)}
                      aria-label="selecionar"
                    />
                  </td>
                )}
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    className={cn(
                      'px-2 py-1.5 align-middle',
                      i === 0 && !selection && 'pl-3',
                      i === columns.length - 1 && 'pr-3',
                      c.align === 'end' && 'text-right tnum',
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MobileRow({
  selected,
  selecting,
  onToggle,
  onOpen,
  className,
  children,
}: {
  selected: boolean;
  selecting: boolean;
  onToggle: ((on: boolean) => void) | undefined;
  onOpen: (() => void) | undefined;
  className: string | undefined;
  children: ReactNode;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pressed = useRef(false);
  const cancel = () => clearTimeout(timer.current);
  const tap = () => {
    if (pressed.current) {
      pressed.current = false;
      return;
    }
    if (selecting && onToggle) onToggle(!selected);
    else onOpen?.();
  };
  return (
    <li
      className={cn(
        'flex min-h-14 items-stretch gap-3 px-3 transition-colors select-none',
        selected && 'bg-agent-soft',
        className,
      )}
    >
      {selecting && onToggle && (
        <span className="flex items-center">
          <Checkbox
            checked={selected}
            onCheckedChange={(v) => onToggle(v === true)}
            aria-label="selecionar"
          />
        </span>
      )}
      <div
        role={onOpen || onToggle ? 'button' : undefined}
        tabIndex={onOpen || onToggle ? 0 : undefined}
        onClick={tap}
        onKeyDown={(e) => {
          if (e.key === 'Enter') tap();
        }}
        onPointerDown={
          onToggle &&
          (() => {
            timer.current = setTimeout(() => {
              pressed.current = true;
              onToggle(!selected);
              navigator.vibrate?.(10);
            }, 450);
          })
        }
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => onToggle && e.preventDefault()}
        className="min-w-0 flex-1 py-2.5 active:bg-hover"
      >
        {children}
      </div>
    </li>
  );
}
