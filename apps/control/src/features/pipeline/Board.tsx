import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightLeft, Check, MoreHorizontal } from 'lucide-react';
import type { LeadListItem } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtMoney, rel } from '@/lib/format.ts';
import { LEAD_STATES } from '@/lib/labels.ts';
import { useIsMobile } from '@/lib/hooks.ts';
import { StateChip } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  ResponsiveSheet,
} from '@/components/ui/overlay.tsx';

type Stage = LeadListItem['state'];
type Move = (lead: LeadListItem, state: Stage) => Promise<void>;

function LeadCard({
  lead: l,
  move,
  onMove,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  lead: LeadListItem;
  move: Move;
  /** phones: open the stage sheet instead of the inline menu */
  onMove?: (() => void) | undefined;
  dragging?: boolean | undefined;
  onDragStart?: (() => void) | undefined;
  onDragEnd?: (() => void) | undefined;
}) {
  const nav = useNavigate();
  const open = () => nav(`/pipeline/${l.id}`);
  return (
    <article
      draggable={!!onDragStart}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', l.id);
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
      onClick={open}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && open()}
      tabIndex={0}
      aria-label={l.name}
      className={cn(
        'group flex cursor-pointer flex-col gap-1 rounded-md border bg-card p-2 transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring',
        dragging && 'opacity-40',
      )}
    >
      <div className="flex min-w-0 items-start gap-1">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] leading-5 font-medium">{l.name}</div>
          {l.businessName && l.businessName !== l.name && (
            <div className="truncate text-xs leading-4 text-muted-foreground">{l.businessName}</div>
          )}
        </div>
        {onMove ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="-mt-0.5 -mr-1"
            aria-label="mover para estágio"
            onClick={(e) => {
              e.stopPropagation();
              onMove();
            }}
          >
            <ArrowRightLeft />
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="-mt-0.5 -mr-1 size-6"
                aria-label="mover para estágio"
                title="mover para estágio"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
              <DropdownMenuLabel>mover para</DropdownMenuLabel>
              {LEAD_STATES.map(([v, label]) => (
                <DropdownMenuItem key={v} onSelect={() => void move(l, v)}>
                  {l.state === v ? <Check /> : <span className="size-4" />} {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
        {l.agentMode !== 'off' && !l.agentPausedAt && <Badge variant="agent">agente</Badge>}
        {l.agentPausedAt && <Badge variant="warn">pausado</Badge>}
        {l.city && <Badge className="max-w-28 truncate">{l.city}</Badge>}
        {l.dealValueCents != null && <span className="tnum">{fmtMoney(l.dealValueCents)}</span>}
        {l.pendingDrafts > 0 && <Badge variant="warn">{l.pendingDrafts} rasc.</Badge>}
        {l.openTasks > 0 && <Badge>{l.openTasks} tarefas</Badge>}
        <span className="ml-auto text-[11px] text-muted-foreground tnum">
          {rel(l.lastActivityAt ?? l.updatedAt)}
        </span>
      </div>
    </article>
  );
}

function columnSum(items: LeadListItem[]) {
  return items.reduce((acc, l) => acc + (l.dealValueCents ?? 0), 0);
}

function DesktopBoard({ leads, move }: { leads: LeadListItem[]; move: Move }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-4 items-start gap-2 lg:gap-3">
      {LEAD_STATES.map(([key, label]) => {
        const items = leads.filter((l) => l.state === key);
        const sum = columnSum(items);
        return (
          <section
            key={key}
            aria-label={label}
            className={cn(
              'flex min-w-0 flex-col gap-1.5 rounded-lg border bg-muted/50 p-1.5 transition-colors',
              over === key && dragId && 'border-ring bg-agent-soft',
            )}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDragEnter={() => setOver(key)}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const lead = leads.find((l) => l.id === dragId);
              if (lead) void move(lead, key);
              setDragId(null);
              setOver(null);
            }}
          >
            <header className="flex min-w-0 items-baseline gap-1.5 px-1 pt-0.5">
              <StateChip state={key} />
              <span className="text-xs text-muted-foreground tnum">{items.length}</span>
              {sum > 0 && (
                <span className="ml-auto truncate text-xs text-muted-foreground tnum">
                  {fmtMoney(sum)}
                </span>
              )}
            </header>
            {items.map((l) => (
              <LeadCard
                key={l.id}
                lead={l}
                move={move}
                dragging={dragId === l.id}
                onDragStart={() => setDragId(l.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setOver(null);
                }}
              />
            ))}
            {!items.length && (
              <p className="px-1 pb-1 text-xs text-muted-foreground">
                {dragId ? 'solte aqui' : 'nenhum lead'}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function MobileBoard({ leads, stage, move }: { leads: LeadListItem[]; stage: Stage; move: Move }) {
  const [moving, setMoving] = useState<LeadListItem | null>(null);
  const items = leads.filter((l) => l.state === stage);
  const sum = columnSum(items);
  // the sheet shows the live card, not the snapshot taken when it opened
  const current = moving && (leads.find((l) => l.id === moving.id) ?? moving);
  return (
    <>
      <div className="mb-2 flex items-baseline gap-2 text-xs text-muted-foreground">
        <span>
          {items.length} lead{items.length === 1 ? '' : 's'}
        </span>
        {sum > 0 && <span className="ml-auto tnum">{fmtMoney(sum)}</span>}
      </div>
      <div className="flex flex-col gap-2">
        {items.map((l) => (
          <LeadCard key={l.id} lead={l} move={move} onMove={() => setMoving(l)} />
        ))}
        {!items.length && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            nenhum lead neste estágio
          </p>
        )}
      </div>
      <ResponsiveSheet
        open={!!moving}
        onOpenChange={(o) => !o && setMoving(null)}
        title="mover para"
        description={current?.name}
      >
        <div className="flex flex-col gap-1">
          {LEAD_STATES.map(([v, label]) => (
            <Button
              key={v}
              variant={current?.state === v ? 'secondary' : 'ghost'}
              className="justify-start"
              onClick={() => {
                if (current) void move(current, v);
                setMoving(null);
              }}
            >
              {current?.state === v ? <Check /> : <span className="size-4" />}
              <StateChip state={v} />
              <span className="ml-auto text-xs text-muted-foreground tnum">
                {leads.filter((l) => l.state === v).length}
              </span>
              <span className="sr-only">{label}</span>
            </Button>
          ))}
        </div>
      </ResponsiveSheet>
    </>
  );
}

export function Board({ leads, stage, move }: { leads: LeadListItem[]; stage: Stage; move: Move }) {
  const mobile = useIsMobile();
  return mobile ? (
    <MobileBoard leads={leads} stage={stage} move={move} />
  ) : (
    <DesktopBoard leads={leads} move={move} />
  );
}
