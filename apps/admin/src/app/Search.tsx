import { MagnifyingGlass, Receipt, User } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { ago, money, phone } from '../lib/format.ts';
import { Sheet } from '../ui/Sheet.tsx';
import { StateChip } from '../ui/StateChip.tsx';
import { TextInput } from '../ui/fields.tsx';
import { EmptyState } from '../ui/feedback.tsx';
import { RowsSkeleton } from '../ui/skeletons.tsx';
import { Mascote } from '../ui/Mascote.tsx';

/** One field, three kinds of answer, grouped, as they type (§3.2). */
export function SearchSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const nav = useNavigate();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 160);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);
  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.search(debounced),
    enabled: debounced.length > 0,
    placeholderData: (p) => p,
  });
  const go = (to: string) => {
    onOpenChange(false);
    nav(to);
  };
  const empty = data && !data.orders.length && !data.products.length && !data.customers.length;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Buscar" wide>
      <div className="sticky top-0 z-10 bg-surface pb-3 pt-1">
        <TextInput
          autoFocus
          type="search"
          enterKeyHint="search"
          aria-label="buscar pedidos, produtos e clientes"
          placeholder="Pedido, nome, telefone ou produto"
          lead={<MagnifyingGlass className="size-5" />}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {!debounced ? (
        <p className="t-body px-1 text-muted">
          Digite o número do pedido (ex.: 128), o nome ou o telefone do cliente, ou o nome de um
          produto.
        </p>
      ) : empty && !isFetching ? (
        <EmptyState
          art={<Mascote pose="sem-resultados" />}
          title={`Nada encontrado para "${debounced}"`}
          body="Confira a grafia ou tente só uma parte do nome."
        />
      ) : !data ? (
        <RowsSkeleton rows={4} />
      ) : (
        <div className="space-y-5">
          {data?.orders.length ? (
            <Group title="Pedidos">
              {data.orders.map((o) => (
                <Hit
                  key={o.id}
                  onClick={() => go(`/pedidos/${o.id}`)}
                  icon={<Receipt className="size-5" />}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      #{o.number} · {o.name}
                    </span>
                    <span className="t-caption text-muted">
                      {money(o.totalCents)} · {ago(o.placedAt)}
                    </span>
                  </span>
                  <StateChip state={o.state} />
                </Hit>
              ))}
            </Group>
          ) : null}
          {data?.products.length ? (
            <Group title="Produtos">
              {data.products.map((p) => (
                <Hit
                  key={p.id}
                  onClick={() => go(`/cardapio/produto/${p.id}`)}
                  icon={
                    <span className="block size-10 overflow-hidden rounded-sm bg-sunken">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" className="size-full object-cover" />
                      ) : null}
                    </span>
                  }
                >
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                  <span className="tnum text-muted">{money(p.priceCents)}</span>
                </Hit>
              ))}
            </Group>
          ) : null}
          {data?.customers.length ? (
            <Group title="Clientes">
              {data.customers.map((c) => (
                <Hit
                  key={c.phone}
                  onClick={() => go(`/clientes/${c.phone}`)}
                  icon={<User className="size-5" />}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{c.name}</span>
                    <span className="t-caption text-muted">
                      {phone(c.phone)} · {c.orders} {c.orders === 1 ? 'pedido' : 'pedidos'}
                    </span>
                  </span>
                </Hit>
              ))}
            </Group>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="t-caption mb-1.5 px-1 font-semibold uppercase tracking-wide text-muted">
        {title}
      </h3>
      <ul className="overflow-hidden rounded-md ring-1 ring-line">{children}</ul>
    </section>
  );
}

function Hit({
  children,
  onClick,
  icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <li className="border-b border-line last:border-0">
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-16 w-full items-center gap-3 px-3 text-left hover:bg-hover"
      >
        <span className="grid size-10 shrink-0 place-items-center text-muted">{icon}</span>
        {children}
      </button>
    </li>
  );
}
