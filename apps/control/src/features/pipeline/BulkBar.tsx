import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Bot, Send, Tag, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, type BulkLeadPatch, type LeadListItem } from '@/lib/api.ts';
import { AGENT_GOALS, LEAD_STATE_LABEL, LEAD_STATES, type LeadState } from '@/lib/labels.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { useBottomBar } from '@/lib/bottomBar.ts';
import { toastUndo } from '@/lib/undo.ts';
import { Button } from '@/components/ui/button.tsx';
import { Popover, PopoverContent, PopoverTrigger, Segmented } from '@/components/ui/controls.tsx';
import { Field, Input, Select } from '@/components/ui/input.tsx';

export const BULK_MAX = 200;
export type Goal = 'negotiation' | 'meeting';
export type Channel = 'auto' | 'whatsapp' | 'instagram' | 'email';
const CHANNELS = [
  ['auto', 'auto'],
  ['whatsapp', 'whatsapp'],
  ['instagram', 'instagram'],
  ['email', 'email'],
] as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The selection's actions: move, tag, archive (each with "desfazer") and the agent dispatch.
 * Pinned to the scrollport bottom so the controls ride with a long list.
 */
export function BulkBar({
  leads,
  sel,
  onClear,
  stale,
  archivedView,
  tags,
  dispatch,
  dispatching,
}: {
  /** the visible rows — the selection never reaches past them */
  leads: LeadListItem[];
  sel: Set<string>;
  onClear: () => void;
  /** placeholder rows belong to the previous filters — never act on them */
  stale: boolean;
  archivedView: boolean;
  tags: string[];
  dispatch: (goal: Goal, channel: Channel) => void;
  dispatching: boolean;
}) {
  const qc = useQueryClient();
  const [goal, setGoal] = useState<Goal>('negotiation');
  const [channel, setChannel] = useState<Channel>('auto');
  const [tag, setTag] = useState('');
  const [tagOpen, setTagOpen] = useState(false);
  const rows = leads.filter((l) => sel.has(l.id));
  const ids = rows.map((l) => l.id);
  const n = ids.length;
  const tooMany = n > BULK_MAX;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['leads'] });
    void qc.invalidateQueries({ queryKey: ['lead'] });
    void qc.invalidateQueries({ queryKey: qk.stats() });
  };
  const bulk = useMutation({
    mutationFn: (b: BulkLeadPatch) => api.bulkLeads(b),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: refresh,
  });
  const undoWith = (patches: BulkLeadPatch[]) => async () => {
    for (const b of patches) if (b.ids.length) await api.bulkLeads(b);
    refresh();
  };
  const run = (b: Omit<BulkLeadPatch, 'ids'>, done: () => void) =>
    bulk.mutate(
      { ids, ...b },
      {
        onSuccess: () => {
          onClear();
          done();
        },
      },
    );

  const move = (state: LeadState) => {
    // the way back: each lead to the stage it came from
    const back = new Map<LeadState, string[]>();
    for (const l of rows)
      if (l.state !== state) back.set(l.state, [...(back.get(l.state) ?? []), l.id]);
    run({ state }, () =>
      toastUndo(
        `${plural(n, 'lead movido', 'leads movidos')} para ${LEAD_STATE_LABEL[state]}`,
        undoWith([...back].map(([s, group]) => ({ ids: group, state: s }))),
      ),
    );
  };
  const archive = (archived: boolean) =>
    run({ archived }, () =>
      archived
        ? toastUndo(
            plural(n, 'lead arquivado', 'leads arquivados'),
            undoWith([{ ids, archived: false }]),
          )
        : toast.success(plural(n, 'lead restaurado', 'leads restaurados')),
    );
  const addTag = () => {
    const t = tag.trim();
    if (!t) return;
    const lacking = rows
      .filter((l) => !l.tags.some((x) => x.toLowerCase() === t.toLowerCase()))
      .map((l) => l.id);
    setTagOpen(false);
    setTag('');
    run({ addTags: [t] }, () =>
      toastUndo(
        `tag “${t}” em ${plural(n, 'lead', 'leads')}`,
        undoWith([{ ids: lacking, removeTags: [t] }]),
      ),
    );
  };
  const busy = bulk.isPending || stale || tooMany;
  useBottomBar();

  return (
    <div className="sticky bottom-3 z-20 mt-3 flex kb:hidden flex-wrap items-center gap-x-2 gap-y-2 rounded-lg border bg-popover p-2 pl-3 shadow-lg">
      <span className="flex items-center gap-1 text-sm font-semibold">
        {n} selecionado{n === 1 ? '' : 's'}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClear}
          aria-label="limpar seleção"
          title="limpar seleção"
        >
          <X />
        </Button>
      </span>
      {tooMany && (
        <span className="text-xs text-warning-foreground">no máximo {BULK_MAX} por vez</span>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 max-sm:w-full">
        <Select
          aria-label="mover para"
          value=""
          disabled={busy}
          onChange={(e) => e.target.value && move(e.target.value as LeadState)}
          className="w-36 max-sm:flex-1"
        >
          <option value="">mover para…</option>
          {LEAD_STATES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Popover open={tagOpen} onOpenChange={setTagOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" disabled={busy}>
              <Tag /> tag
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64">
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addTag();
              }}
            >
              <Field label={`adicionar a ${plural(n, 'lead', 'leads')}`} htmlFor="bulk-tag">
                <Input
                  id="bulk-tag"
                  autoFocus
                  list="bulk-tags"
                  maxLength={40}
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  placeholder="nome da tag"
                />
                <datalist id="bulk-tags">
                  {tags.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </Field>
              <Button type="submit" size="sm" disabled={!tag.trim()}>
                aplicar
              </Button>
            </form>
          </PopoverContent>
        </Popover>
        {archivedView ? (
          <Button variant="outline" disabled={busy} onClick={() => archive(false)}>
            <ArchiveRestore /> restaurar
          </Button>
        ) : (
          <Button variant="outline" disabled={busy} onClick={() => archive(true)}>
            <Archive /> arquivar
          </Button>
        )}
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="agent" className="max-sm:w-full sm:ml-auto" disabled={stale}>
            <Bot /> agente…
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-auto max-w-[calc(100vw-24px)] flex-col gap-3">
          <Field label="objetivo">
            <Segmented size="sm" value={goal} onChange={setGoal} options={AGENT_GOALS} />
          </Field>
          <Field label="canal" hint="auto = o agente escolhe o canal alcançável">
            <Segmented size="sm" value={channel} onChange={setChannel} options={CHANNELS} />
          </Field>
          <Button
            variant="agent"
            disabled={dispatching || stale}
            onClick={() => dispatch(goal, channel)}
          >
            <Send /> {dispatching ? 'disparando…' : `disparar para ${plural(n, 'lead', 'leads')}`}
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
