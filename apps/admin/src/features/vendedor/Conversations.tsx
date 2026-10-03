import { ChatsCircle, CheckCircle, MagnifyingGlass } from '@phosphor-icons/react';
import {
  keepPreviousData,
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePreload } from '../../app/routes.ts';
import { api, type ThreadFilter, type ThreadRow } from '../../lib/api.ts';
import { minutesSince } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { useCan, useSession } from '../../lib/session.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { EmptyState, ErrorState } from '../../ui/feedback.tsx';
import { Chips, TextInput } from '../../ui/fields.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { HelpButton, PageBody, PageHeader } from '../../ui/Page.tsx';
import { RowsSkeleton } from '../../ui/skeletons.tsx';
import { FloorChip, ReasonChip } from '../../ui/vendedor/index.ts';
import { ConversationPane, useAgentName, useMedia } from './Conversation.tsx';
import { Initials, dayLabel, msgTime } from './Conversation.parts.tsx';

const FILTERS: ThreadFilter[] = ['all', 'waiting', 'orders', 'agent', 'others'];

/**
 * Conversas (sales-agent-ux §3.3, §3.10): every WhatsApp conversation of the store, who is
 * answering each and who needs you. From 1200 px it is the inbox: the list beside the open
 * conversation (and, with room, the customer and "por quê"), with A · D · J/K · / at hand.
 */
export default function Conversations() {
  const desktop = useMedia('(min-width: 1200px)');
  const roomy = useMedia('(min-width: 1440px)');
  const [params, setParams] = useSearchParams();
  const filter = (FILTERS as string[]).includes(params.get('f') ?? '')
    ? (params.get('f') as ThreadFilter)
    : 'all';
  const [q, setQ] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(q.trim());
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const setParam = (k: string, v: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: true },
    );
  useEffect(() => {
    if ((params.get('q') ?? '') !== debounced) setParam('q', debounced || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const list = useInfiniteQuery({
    queryKey: qk.vendedor.threads(filter, debounced),
    queryFn: ({ pageParam }) =>
      api.vendedor.threads({
        filter,
        ...(debounced ? { q: debounced } : {}),
        ...(pageParam ? { before: pageParam } : {}),
      }),
    initialPageParam: '',
    getNextPageParam: (l) => l.next,
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.pages.flatMap((p) => p.threads) ?? [];
  const search = useRef<HTMLInputElement>(null);

  const selected = desktop ? (params.get('c') ?? rows[0]?.id ?? null) : null;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const selRef = useRef(selected);
  selRef.current = selected;

  // the inbox's keys: J/K next and previous, "/" searches this list (not the global search)
  useEffect(() => {
    if (!desktop) return;
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        el.closest('input, textarea, select, [contenteditable]')
      )
        return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === '/') {
        e.preventDefault();
        e.stopImmediatePropagation();
        search.current?.focus();
        return;
      }
      const k = e.key.toLowerCase();
      if (k !== 'j' && k !== 'k') return;
      const all = rowsRef.current;
      if (!all.length) return;
      const i = all.findIndex((r) => r.id === selRef.current);
      const next = all[Math.min(all.length - 1, Math.max(0, i + (k === 'j' ? 1 : -1)))];
      if (next) {
        setParam('c', next.id);
        document.getElementById(`thread-${next.id}`)?.scrollIntoView({ block: 'nearest' });
      }
    };
    // capture: ahead of the Shell's own "/" (global search)
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop]);

  const tools = (
    <ListTools
      filter={filter}
      onFilter={(f) => setParam('f', f === 'all' ? null : f)}
      q={q}
      onQ={setQ}
      search={search}
      desktop={desktop}
    />
  );
  const body = (
    <ThreadList
      list={list}
      rows={rows}
      filter={filter}
      q={debounced}
      selected={selected}
      desktop={desktop}
      onPick={(id) => setParam('c', id)}
    />
  );

  if (desktop)
    return (
      <div className="flex h-dvh min-h-0">
        <section
          aria-label="lista de conversas"
          className="flex w-[360px] shrink-0 flex-col border-r border-line"
        >
          <div className="px-5 pb-3 pt-7">
            <div className="mb-4 flex items-center gap-2">
              <h1 className="t-title-1 min-w-0 flex-1">Conversas</h1>
              <HelpButton className="-mr-2" />
            </div>
            {tools}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">{body}</div>
        </section>
        {selected ? (
          <ConversationPane
            key={selected}
            id={selected}
            embedded
            rail={roomy}
            keys
            row={rows.find((r) => r.id === selected)}
          />
        ) : (
          <div className="grid min-w-0 flex-1 place-items-center p-8">
            <EmptyState
              art={<ChatsCircle weight="duotone" className="text-muted" />}
              title="Escolha uma conversa"
              body="Ela abre aqui, com a sacola e quem está atendendo."
            />
          </div>
        )}
      </div>
    );

  return (
    <PageBody wide>
      <PageHeader title="Conversas" back="/vendedor" />
      <div className="mb-4">{tools}</div>
      {body}
    </PageBody>
  );
}

function ListTools({
  filter,
  onFilter,
  q,
  onQ,
  search,
  desktop,
}: {
  filter: ThreadFilter;
  onFilter: (f: ThreadFilter) => void;
  q: string;
  onQ: (q: string) => void;
  search: RefObject<HTMLInputElement>;
  desktop: boolean;
}) {
  const name = useAgentName();
  const waiting = useSession().vendedor?.waiting ?? 0;
  return (
    <div className="space-y-3">
      <TextInput
        ref={search}
        type="search"
        aria-label="buscar conversa"
        placeholder={desktop ? 'Nome ou telefone  ( / )' : 'Nome ou telefone'}
        lead={<MagnifyingGlass className="size-5" />}
        value={q}
        maxLength={60}
        onChange={(e) => onQ(e.target.value)}
      />
      <Chips
        label="mostrar"
        value={filter}
        onChange={onFilter}
        className="scroll-row -mx-4 flex-nowrap px-4 md:mx-0 md:flex-wrap md:px-0 lg:-mx-5 lg:flex-nowrap lg:px-5 [&>button]:shrink-0"
        options={[
          { value: 'all', label: 'todas' },
          {
            value: 'waiting',
            label: waiting ? `precisa de você · ${waiting}` : 'precisa de você',
          },
          { value: 'orders', label: 'com pedido' },
          { value: 'agent', label: `${name} atendendo` },
          { value: 'others', label: 'outros' },
        ]}
      />
    </div>
  );
}

type ListQuery = UseInfiniteQueryResult<
  InfiniteData<{ threads: ThreadRow[]; next: string | null }>,
  Error
>;

function ThreadList({
  list,
  rows,
  filter,
  q,
  selected,
  desktop,
  onPick,
}: {
  list: ListQuery;
  rows: ThreadRow[];
  filter: ThreadFilter;
  q: string;
  selected: string | null;
  desktop: boolean;
  onPick: (id: string) => void;
}) {
  if (list.error) return <ErrorState error={list.error} retry={() => void list.refetch()} />;
  if (list.isPending) return <RowsSkeleton rows={6} />;
  if (!rows.length) return <Empty filter={filter} q={q} />;
  return (
    <>
      {filter === 'others' ? (
        <p className="t-caption mb-3 px-1 text-muted">
          Números que não parecem clientes (fornecedores, entregadores, família). Ficam aqui, sem
          resposta automática.
        </p>
      ) : null}
      <Card
        as="section"
        aria-busy={list.isPlaceholderData}
        className={cn(
          'overflow-hidden transition-opacity',
          desktop ? 'bg-transparent shadow-none' : 'divide-y divide-line',
          list.isPlaceholderData && 'opacity-60',
        )}
      >
        <ul className={cn(desktop ? 'flex flex-col gap-0.5' : 'divide-y divide-line')}>
          {rows.map((r) => (
            <li key={r.id}>
              <Row r={r} selected={selected === r.id} desktop={desktop} onPick={onPick} />
            </li>
          ))}
        </ul>
      </Card>
      {list.hasNextPage ? (
        <Button
          variant="secondary"
          block
          className="mt-4"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          carregar mais
        </Button>
      ) : null}
    </>
  );
}

const rowWhen = (iso: string) => {
  const d = dayLabel(iso);
  return d === 'hoje' ? msgTime(iso) : d;
};

function Row({
  r,
  selected,
  desktop,
  onPick,
}: {
  r: ThreadRow;
  selected: boolean;
  desktop: boolean;
  onPick: (id: string) => void;
}) {
  const name = useAgentName();
  const preload = usePreload();
  const to = desktop
    ? `/vendedor/conversas?c=${encodeURIComponent(r.id)}`
    : `/vendedor/conversas/${r.id}`;
  const waited = r.waitingSince ? minutesSince(r.waitingSince) : null;
  const by =
    r.previewAuthor === 'agent'
      ? `${name}: `
      : r.previewAuthor === 'merchant'
        ? 'você: '
        : r.previewAuthor === 'core'
          ? 'loja: '
          : '';
  return (
    <Link
      id={`thread-${r.id}`}
      to={to}
      replace={desktop}
      {...(desktop ? {} : preload(to))}
      onClick={
        desktop
          ? (e) => {
              e.preventDefault();
              onPick(r.id);
            }
          : undefined
      }
      aria-current={selected ? 'true' : undefined}
      data-vt-src={desktop ? undefined : `thread:${r.id}`}
      className={cn(
        'press-row flex min-h-18 items-start gap-3 px-4 py-3 hover:bg-hover',
        desktop && 'rounded-md px-3',
        selected && 'bg-surface depth-1 hover:bg-surface',
      )}
    >
      <Initials name={r.name} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 truncate', r.unread ? 'font-bold' : 'font-semibold')}>
            {r.name}
          </span>
          <time dateTime={r.lastAt} className="t-caption shrink-0 text-muted">
            {rowWhen(r.lastAt)}
          </time>
        </span>
        <span
          className={cn('t-body block truncate', r.unread ? 'font-medium text-ink' : 'text-muted')}
        >
          {r.unread ? <span className="sr-only">nova mensagem: </span> : null}
          {by}
          {r.preview ?? '…'}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {r.waitingSince ? (
            <>
              {r.reason ? (
                <ReasonChip reason={r.reason} />
              ) : (
                <FloorChip floor={r.floor} waiting name={name} />
              )}
              <span
                className={cn(
                  't-caption',
                  waited != null && waited >= 5 ? 'font-semibold text-warning' : 'text-muted',
                )}
              >
                esperando há {Math.max(1, waited ?? 1)} min
              </span>
            </>
          ) : r.orderNumber ? (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-success-soft px-2.5 text-[0.8125rem] font-semibold text-success">
              <CheckCircle weight="bold" className="size-[15px]" aria-hidden />
              pedido #{r.orderNumber}
            </span>
          ) : (
            <FloorChip floor={r.floor} name={name} />
          )}
        </span>
      </span>
    </Link>
  );
}

function Empty({ filter, q }: { filter: ThreadFilter; q: string }) {
  const name = useAgentName();
  const test = useCan('manager');
  if (q)
    return (
      <EmptyState
        art={<Mascote pose="sem-resultados" />}
        title={`Nenhuma conversa com "${q}"`}
        body="Tente parte do nome ou os últimos números do telefone."
      />
    );
  const copy: Record<ThreadFilter, { title: string; body: string }> = {
    all: {
      title: 'Ninguém escreveu ainda',
      body: `A ${name} responde assim que alguém chamar no WhatsApp da loja.`,
    },
    waiting: {
      title: 'Ninguém esperando por você',
      body: 'Quando um cliente precisar de você, ele aparece aqui e o celular avisa.',
    },
    orders: {
      title: 'Nenhuma conversa virou pedido ainda',
      body: `Os pedidos que a ${name} fechar aparecem aqui.`,
    },
    agent: {
      title: `A ${name} não está atendendo ninguém agora`,
      body: 'As conversas dela aparecem aqui enquanto ela atende.',
    },
    others: {
      title: 'Nenhum número em “outros”',
      body: 'Fornecedores, entregadores e família ficam aqui, sem resposta automática.',
    },
  };
  return (
    <EmptyState
      art={<Mascote pose={filter === 'waiting' ? 'sucesso' : 'carinho'} />}
      title={copy[filter].title}
      body={copy[filter].body}
      action={
        filter === 'all' && test ? (
          <ButtonLink to="/vendedor/testar" variant="secondary">
            testar como cliente
          </ButtonLink>
        ) : undefined
      }
    />
  );
}
