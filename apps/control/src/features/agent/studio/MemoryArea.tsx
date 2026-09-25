import { useState, type ReactNode } from 'react';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type MemoryItem, type MemoryScope } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Input, Select } from '@/components/ui/input.tsx';
import { AreaIntro, EndpointState, ListEditor } from './bits.tsx';
import { MemoryRow } from './MemoryRow.tsx';
import type { SettingsMap, SettingWrite } from './settings.ts';

const SCOPES: { key: MemoryScope; label: string }[] = [
  { key: 'workspace', label: 'workspace — vale pra todo run' },
  { key: 'segment', label: 'por segmento — nicho do lead' },
  { key: 'debrief', label: 'debriefs — saem dos runs' },
];

const byPin = (a: MemoryItem, b: MemoryItem) => Number(b.pinned) - Number(a.pinned);

export function MemoryArea({
  map,
  gate,
  save,
  active,
}: {
  /** undefined until /settings is read — only the v1 list depends on it */
  map: SettingsMap | undefined;
  /** what shows in place of the v1 list while settings are unreadable */
  gate: ReactNode;
  save: (key: string, v: SettingWrite) => Promise<boolean>;
  active: boolean;
}) {
  // dormant until the area opens
  const qs = useQueries({
    queries: SCOPES.map(({ key }) => ({
      queryKey: qk.memory({ scope: key }),
      queryFn: () => api.memory({ scope: key }),
      enabled: active,
    })),
  });
  const error = qs.find((q) => q.error)?.error ?? null;
  const ready = qs.every((q) => q.data);
  const memoryV1 = (map?.agent_memory ?? { facts: [] }) as { facts?: string[] };
  const facts = memoryV1.facts ?? [];

  // three-way merge inside the save queue — rapid clicks accumulate against the freshest value
  const saveFacts = (next: string[]) => {
    const base = facts;
    void save('agent_memory', (cur: unknown) => {
      const curObj = (cur ?? {}) as { facts?: string[] };
      const curFacts = curObj.facts ?? [];
      const added = next.filter((f) => !base.includes(f));
      const removed = new Set(base.filter((f) => !next.includes(f)));
      return {
        ...curObj,
        facts: [
          ...curFacts.filter((f) => !removed.has(f)),
          ...added.filter((a) => !curFacts.includes(a)),
        ],
      };
    });
  };

  return (
    <>
      <AreaIntro>
        o que o agente carrega no contexto — workspace vale pra tudo, segmento por nicho, debrief
        sai de cada run
      </AreaIntro>
      <div className="flex flex-col gap-3">
        {!ready || error ? (
          <EndpointState
            title="memória v2"
            error={error}
            missing="GET/POST /agent/memory ainda não chegou neste servidor — quando chegar, os itens ficam agrupados por escopo e dá pra fixar o que importa sempre. Por ora a memória clássica abaixo segue valendo."
            onRetry={() => qs.forEach((q) => void q.refetch())}
          />
        ) : (
          <MemoryV2
            data={{
              workspace: qs[0]!.data!.items,
              segment: qs[1]!.data!.items,
              debrief: qs[2]!.data!.items,
            }}
          />
        )}
        {!map ? (
          gate
        ) : (
          <Panel
            title="memória clássica (v1)"
            aside="fatos guardados via tool `remember` — a v2 absorve"
          >
            <ListEditor
              items={facts}
              placeholder="grave um fato — ex.: a Lia sempre indica leads quentes"
              addLabel="lembrar"
              max={100}
              maxLen={500}
              onChange={saveFacts}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {facts.length} fato{facts.length === 1 ? '' : 's'} — o agente edita esta lista com a
              tool `remember` (guarda até 100); remover aqui apaga da memória dele.
            </p>
          </Panel>
        )}
      </div>
    </>
  );
}

function MemoryV2({ data }: { data: Record<MemoryScope, MemoryItem[]> }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<MemoryScope>('workspace');
  const [segment, setSegment] = useState('');
  const [draft, setDraft] = useState('');

  const onError = (e: unknown) => toast.error(`memória: ${errorMessage(e)}`);
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.memory() });
  const create = useMutation({
    mutationFn: api.createMemory,
    // a failed save never discards typed text
    onSuccess: () => {
      setDraft('');
      refresh();
    },
    onError,
  });

  const blocked = !draft.trim() || (scope === 'segment' && !segment.trim()) || create.isPending;
  const add = () => {
    const content = draft.trim();
    // same gate as the button's disabled state — covers the Enter path
    if (blocked) return;
    create.mutate({
      scope,
      ...(scope === 'segment' ? { segment: segment.trim() } : {}),
      content,
    });
  };

  const total = SCOPES.reduce((n, s) => n + data[s.key].length, 0);
  const segGroups = new Map<string, MemoryItem[]>();
  for (const m of data.segment) {
    const k = m.segment ?? '(sem nome)';
    segGroups.set(k, [...(segGroups.get(k) ?? []), m]);
  }

  return (
    <>
      <Panel>
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
                placeholder="nome do segmento — ex.: pizzarias"
                maxLength={80}
                onChange={(e) => setSegment(e.target.value)}
                className="md:w-56"
              />
            )}
          </div>
          <div className="flex min-w-0 flex-1 gap-2">
            <Input
              aria-label="nova memória"
              value={draft}
              placeholder="grave algo que vale pra todo run — ex.: 'a Lia sempre indica leads quentes'"
              maxLength={500}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <Button disabled={blocked} onClick={add}>
              guardar
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="tnum">{total}</span> ite{total === 1 ? 'm' : 'ns'} — fixados entram
          sempre no contexto do agente
        </p>
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
    </>
  );
}
