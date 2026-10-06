import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, BookmarkPlus, Check, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, type SavedView } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { useStoredState } from '@/lib/hooks.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { toastUndo } from '@/lib/undo.ts';
import { Button } from '@/components/ui/button.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/controls.tsx';
import { Input, Label, Select } from '@/components/ui/input.tsx';
import type { PipelineParams } from './params.ts';

const MEMBER_KEY = 'vendua-control-member';
/** with nobody listed in Config → Equipe, the views are the team's */
const TEAM = 'equipe';

type SettingsRes = { settings: { key: string; value: unknown }[] };

function useTeamNames() {
  return useQuery({
    queryKey: qk.settings(),
    queryFn: api.settings,
    select: (r: SettingsRes) => {
      const staff = r.settings.find((s) => s.key === 'staff')?.value as
        { members?: { name?: unknown }[] } | undefined;
      return (staff?.members ?? [])
        .map((m) => (typeof m.name === 'string' ? m.name.trim() : ''))
        .filter(Boolean)
        .slice(0, 20);
    },
  });
}

const same = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

/** Who this device belongs to, asked once — views are per staff member, kept in Core. */
function WhoAmI({ names, onPick }: { names: string[]; onPick: (m: string) => void }) {
  const [other, setOther] = useState('');
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">quem é você?</p>
      <p className="text-xs text-muted-foreground">
        suas visões ficam salvas no servidor — aparecem em qualquer aparelho em que você escolher o
        mesmo nome.
      </p>
      {names.length > 0 && (
        <Select
          aria-label="seu nome"
          value=""
          onChange={(e) => e.target.value && onPick(e.target.value)}
        >
          <option value="">escolha seu nome…</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      )}
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (other.trim()) onPick(other.trim());
        }}
      >
        <Input
          aria-label="outro nome"
          placeholder={names.length ? 'ou outro nome' : 'seu nome'}
          maxLength={80}
          value={other}
          onChange={(e) => setOther(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={!other.trim()}>
          ok
        </Button>
      </form>
    </div>
  );
}

/** Saved pipeline views: one click applies a named filter set; per staff member, any device. */
export function SavedViews({ p, compact }: { p: PipelineParams; compact?: boolean | undefined }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [stored, setMember] = useStoredState(MEMBER_KEY, '');
  const team = useTeamNames();
  const names = team.data ?? [];
  const member = stored || (team.isSuccess && !names.length ? TEAM : '');
  const [name, setName] = useState('');

  const key = qk.views(member);
  const views = useQuery({
    queryKey: key,
    queryFn: () => api.views(member),
    enabled: !!member,
    select: (r) => r.views,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: (v: { name: string; params: Record<string, string> }) =>
      api.createView({ member, ...v }),
    onSuccess: (r) => {
      setName('');
      toast.success(`visão “${r.view.name}” salva`);
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError && e.code === 'VIEW_EXISTS'
          ? 'já existe uma visão com esse nome'
          : errorMessage(e),
      ),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (v: SavedView) => api.deleteView(v.id),
    onSuccess: (_r, v) =>
      toastUndo(`visão “${v.name}” apagada`, async () => {
        await api.createView({ member: v.member, name: v.name, params: v.params });
        refresh();
      }),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: refresh,
  });

  const current = p.viewParams;
  const list = views.data ?? [];
  const active = list.find((v) => same(v.params, current));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={active ? 'secondary' : 'ghost'}
          size={compact ? 'icon' : 'sm'}
          aria-label="visões salvas"
          title="visões salvas"
        >
          <Bookmark />
          {!compact && <span className="max-w-32 truncate">{active?.name ?? 'visões'}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(18rem,calc(100vw-24px))] p-2">
        {!member ? (
          <div className="p-1">
            <WhoAmI names={names} onPick={setMember} />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 px-1.5 pt-0.5 pb-1">
              <Label className="min-w-0 flex-1 truncate text-muted-foreground">
                {member === TEAM ? 'visões da equipe' : `visões de ${member}`}
              </Label>
              {member !== TEAM && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  onClick={() => setMember('')}
                >
                  trocar
                </button>
              )}
            </div>
            {views.isPending ? (
              <p className="px-1.5 py-2 text-xs text-muted-foreground">carregando…</p>
            ) : !list.length ? (
              <p className="px-1.5 py-2 text-xs text-muted-foreground">
                nenhuma ainda — filtre a lista e salve abaixo
              </p>
            ) : (
              <ul className="flex max-h-64 flex-col overflow-auto">
                {list.map((v) => (
                  <li key={v.id} className="group flex items-center rounded-md hover:bg-hover">
                    <button
                      type="button"
                      className="flex h-8 min-w-0 flex-1 items-center gap-2 px-1.5 text-left text-[13px] pointer-coarse:h-10"
                      onClick={() => {
                        p.applyView(v.params);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          'size-3.5 shrink-0 text-primary',
                          active?.id !== v.id && 'invisible',
                        )}
                      />
                      <span className="truncate">{v.name}</span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`apagar visão ${v.name}`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(v)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="mt-1 flex gap-1.5 border-t px-0.5 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) create.mutate({ name: name.trim(), params: current });
              }}
            >
              <Input
                aria-label="nome da visão"
                placeholder={active ? 'salvar como…' : 'nome desta visão'}
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button
                type="submit"
                variant="outline"
                size="icon"
                aria-label="salvar visão atual"
                title="salvar os filtros atuais"
                disabled={!name.trim() || create.isPending}
              >
                <BookmarkPlus />
              </Button>
            </form>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
