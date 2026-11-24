import { useState } from 'react';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type MemoryItem, type MemoryScope } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Input, Select } from '@/components/ui/input.tsx';
import { EndpointState } from './bits.tsx';
import { MemoryRow } from './MemoryRow.tsx';

const SCOPES: { key: MemoryScope; label: string }[] = [
  { key: 'workspace', label: 'workspace — vale pra toda execução' },
  { key: 'segment', label: 'por segmento — nicho do lead' },
  { key: 'debrief', label: 'debriefs — aprendizados das caçadas' },
];

const byPin = (a: MemoryItem, b: MemoryItem) => Number(b.pinned) - Number(a.pinned);

/** Active agent memory (v2 — agent_memory_items); legacy v1 settings panel removed. */
export function MemoryPanel() {
  const qc = useQueryClient();
  const [scope, setScope] = useState<MemoryScope>('workspace');
  const [segment, setSegment] = useState('');
  const [draft, setDraft] = useState('');

  const qs = useQueries({
    queries: SCOPES.map(({ key }) => ({
      queryKey: qk.memory({ scope: key }),
      queryFn: () => api.memory({ scope: key }),
    })),
  });
  const error = qs.find((q) => q.error)?.error ?? null;
  const ready = qs.every((q) => q.data);

  const onError = (e: unknown) => toast.error(`memória: ${errorMessage(e)}`);
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.memory() });
  const create = useMutation({
    mutationFn: api.createMemory,
    onSuccess: () => {
      setDraft('');
      refresh();
    },
    onError,
  });

  const blocked = !draft.trim() || (scope === 'segment' && !segment.trim()) || create.isPending;
  const add = () => {
    const content = draft.trim();
    if (blocked) return;
    create.mutate({
      scope,
      ...(scope === 'segment' ? { segment: segment.trim() } : {}),
      content,
    });
  };

  if (!ready || error) {
    return (
      <EndpointState
        title="memória"
        error={error}
        missing="GET/POST /agent/memory ainda não está disponível neste servidor."
        onRetry={() => qs.forEach((q) => void q.refetch())}
      />
    );
  }

  const data: Record<MemoryScope, MemoryItem[]> = {
    workspace: qs[0]!.data!.items,
    segment: qs[1]!.data!.items,
    debrief: qs[2]!.data!.items,
  };
  const total = SCOPES.reduce((n, s) => n + data[s.key].length, 0);
  const segGroups = new Map<string, MemoryItem[]>();
  for (const m of data.segment) {
    const k = m.segment ?? '(sem nome)';
    segGroups.set(k, [...(segGroups.get(k) ?? []), m]);
  }

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="memória do agente"
        aside={`${total} ite${total === 1 ? 'm' : 'ns'} · fixados entram sempre no contexto`}
      >
        <p className="mb-2.5 text-xs text-muted-foreground">
          aprendizados acumulados pelo agente e pela equipe (diferente das instruções fixas acima).
          Alterações aqui salvam na hora.
        </p>
        <div className="flex flex-col gap-2 md:flex-row">
          <div className="flex gap-2">
            <Select
              aria-label="escopo"
              value={scope}
              onChange={(e) => setScope(e.target.value as MemoryScope)}
              className="w-36 shrink-0"
            >
              <option value="workspace">workspace</option>
              <option value="segment">segmento</option>
              <option value="debrief">debrief</option>
            </Select>
            {scope === 'segment' && (
              <Input
                aria-label="segmento"
                value={segment}
                placeholder="ex.: pizzarias"
                maxLength={80}
                onChange={(e) => setSegment(e.target.value)}
                className="md:w-48"
              />
            )}
          </div>
          <div className="flex min-w-0 flex-1 gap-2">
            <Input
              aria-label="nova memória"
              value={draft}
              placeholder="grave um aprendizado — ex.: 'padarias respondem melhor após 14h'"
              maxLength={500}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <Button disabled={blocked} onClick={add}>
              guardar
            </Button>
          </div>
        </div>
      </Panel>

      <div className="grid items-start gap-3 lg:grid-cols-2 min-[90rem]:grid-cols-3">
        {SCOPES.map((g) => (
          <Panel
            key={g.key}
            title={g.label}
            aside={<span className="tnum">{data[g.key].length}</span>}
            flush
          >
            {data[g.key].length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">nada aqui ainda</p>
            )}
            {g.key === 'segment' ? (
              [...segGroups.entries()].map(([seg, items]) => (
                <div key={seg}>
                  <div className="border-b bg-muted/50 px-3 py-1 text-[11px] font-medium text-muted-foreground">
                    {seg}
                  </div>
                  <ul className="divide-y border-b last:border-b-0">
                    {[...items].sort(byPin).map((m) => (
                      <MemoryRow key={m.id} m={m} onError={onError} onChanged={refresh} />
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <ul className="divide-y">
                {[...data[g.key]].sort(byPin).map((m) => (
                  <MemoryRow key={m.id} m={m} onError={onError} onChanged={refresh} />
                ))}
              </ul>
            )}
          </Panel>
        ))}
      </div>
    </div>
  );
}
