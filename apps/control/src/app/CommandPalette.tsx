import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { ArrowRight, MessageSquare, Plus, Search, Store, SunMoon, User } from 'lucide-react';
import { api } from '@/lib/api.ts';
import { useDebounced } from '@/lib/hooks.ts';
import { LEAD_STATE_LABEL } from '@/lib/labels.ts';
import { qk } from '@/lib/query.ts';
import { useTheme } from '@/lib/theme.ts';
import { DialogPrimitive } from '@/components/ui/overlay.tsx';
import { DESTINATIONS } from './nav.ts';

const group =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground';
const item =
  'flex h-9 cursor-default items-center gap-2.5 rounded-md px-2 text-sm data-[selected=true]:bg-hover [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground pointer-coarse:h-11';

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 200);
  const nav = useNavigate();
  const theme = useTheme();

  const leads = useQuery({
    queryKey: ['leads', { q: dq, limit: '6', palette: '1' }],
    queryFn: () => api.leads({ q: dq, limit: '6' }),
    enabled: open && dq.length >= 2,
    refetchInterval: false,
  });
  const stores = useQuery({
    queryKey: qk.storeSearch(dq),
    queryFn: () => api.searchStores(dq),
    enabled: open && dq.length >= 2,
    refetchInterval: false,
  });
  const threads = useQuery({
    queryKey: ['threads', { q: dq, palette: '1' }],
    queryFn: () => api.threads({ q: dq }),
    enabled: open && dq.length >= 2,
    refetchInterval: false,
  });

  // cmdk keeps a group's heading even with no items under it
  const newLead = match(q, 'novo lead');
  const themeAction = match(q, 'alternar tema escuro claro');
  const dests = DESTINATIONS.filter((d) => match(q, `${d.label} ${d.group}`));

  const go = (to: string) => {
    onOpenChange(false);
    setQ('');
    nav(to);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <DialogPrimitive.Content className="fixed top-[max(8px,calc(var(--vvo,0px)+8px))] left-1/2 z-50 w-[calc(100%-16px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl outline-none md:top-[14vh]">
          <DialogPrimitive.Title className="sr-only">buscar</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            buscar leads, lojas, conversas e telas
          </DialogPrimitive.Description>
          <Command shouldFilter={false} loop>
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="size-4 text-muted-foreground" />
              <Command.Input
                value={q}
                onValueChange={setQ}
                placeholder="buscar leads, lojas, conversas…"
                className="h-12 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
              />
            </div>
            <Command.List className="max-h-[min(60vh,420px)] overflow-auto p-1.5">
              <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
                nada encontrado
              </Command.Empty>
              {!!leads.data?.leads.length && (
                <Command.Group heading="Leads" className={group}>
                  {leads.data.leads.map((l) => (
                    <Command.Item
                      key={l.id}
                      value={`lead-${l.id}`}
                      onSelect={() => go(`/pipeline/${l.id}`)}
                      className={item}
                    >
                      <User />
                      <span className="truncate">{l.name}</span>
                      {l.businessName && (
                        <span className="truncate text-xs text-muted-foreground">
                          {l.businessName}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {LEAD_STATE_LABEL[l.state]}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!!stores.data?.stores.length && (
                <Command.Group heading="Lojas" className={group}>
                  {stores.data.stores.map((st) => (
                    <Command.Item
                      key={st.id}
                      value={`store-${st.id}`}
                      onSelect={() => go(`/lojas/${st.id}`)}
                      className={item}
                    >
                      <Store />
                      <span className="truncate">{st.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {st.host ?? st.slug}
                      </span>
                      {st.status === 'suspended' && (
                        <span className="ml-auto text-xs text-muted-foreground">suspensa</span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!!threads.data?.threads.length && (
                <Command.Group heading="Conversas" className={group}>
                  {threads.data.threads.slice(0, 6).map((t) => (
                    <Command.Item
                      key={t.id}
                      value={`thread-${t.id}`}
                      onSelect={() => go(`/inbox/${t.id}`)}
                      className={item}
                    >
                      <MessageSquare />
                      <span className="truncate">{t.leadName}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {t.lastBody ?? t.channel}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {(newLead || themeAction) && (
                <Command.Group heading="Ações" className={group}>
                  {newLead && (
                    <Command.Item
                      value="novo-lead"
                      onSelect={() => go('/pipeline?novo=1')}
                      className={item}
                    >
                      <Plus /> novo lead
                    </Command.Item>
                  )}
                  {themeAction && (
                    <Command.Item value="tema" onSelect={theme.cycle} className={item}>
                      <SunMoon /> alternar tema
                    </Command.Item>
                  )}
                </Command.Group>
              )}
              {dests.length > 0 && (
                <Command.Group heading="Ir para" className={group}>
                  {dests.map((d) => (
                    <Command.Item
                      key={d.to}
                      value={`go-${d.to}`}
                      onSelect={() => go(d.to)}
                      className={item}
                    >
                      <ArrowRight />
                      {d.label}
                      <span className="ml-auto text-xs text-muted-foreground">{d.group}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function match(q: string, text: string) {
  const t = fold(q.trim());
  return !t || fold(text).includes(t);
}
