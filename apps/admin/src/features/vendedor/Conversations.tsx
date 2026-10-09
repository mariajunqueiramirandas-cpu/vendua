import {
  ChatsCircle,
  CheckCircle,
  CheckSquare,
  ListChecks,
  MagnifyingGlass,
  Square,
} from '@phosphor-icons/react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePreload } from '../../app/routes.ts';
import { api, type ThreadFilter, type ThreadList, type ThreadRow } from '../../lib/api.ts';
import { minutesSince, plural } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { useCan, useSession } from '../../lib/session.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { EmptyState, ErrorState, messageOf } from '../../ui/feedback.tsx';
import { Chips, TextInput } from '../../ui/fields.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { HelpButton, PageBody, PageHeader } from '../../ui/Page.tsx';
import { RowsSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';
import { ClassChip, FloorChip, ReasonChip, triaged } from '../../ui/vendedor/index.ts';
import { ConversationPane, useMedia } from './Conversation.tsx';
import { Initials, dayLabel, msgTime } from './Conversation.parts.tsx';

const FILTERS: ThreadFilter[] = ['all', 'waiting', 'ask', 'orders', 'agent', 'personal', 'others'];
/** what Core takes in one go */
const BULK_MAX = 100;
/** a bulk decision waits this long with "desfazer" before it reaches Core ("pessoal" erases) */
const HOLD_MS = 6000;

/**
 * Several "para decidir" at once (undo beats confirm): the rows leave the list now, the decision
 * goes to Core after the toast's "desfazer" window, and "desfazer" just brings them back.
 */
function holdClassify(qc: QueryClient, ids: string[], as: 'shopper' | 'personal') {
  const drop = new Set(ids);
  qc.setQueriesData<InfiniteData<ThreadList>>(
    { queryKey: ['vendedor', 'threads', 'ask'] },
    (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((p, i) => ({
              ...p,
              threads: p.threads.filter((t) => !drop.has(t.id)),
              ...(i === 0 && p.counts?.ask !== undefined
                ? { counts: { ...p.counts, ask: Math.max(0, p.counts.ask - ids.length) } }
                : {}),
            })),
          }
        : old,
  );
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['vendedor'] });
    void qc.invalidateQueries({ queryKey: qk.session });
  };
  const timer = window.setTimeout(() => {
    api.vendedor.classifyMany(ids, as).then(
      (r) => {
        refresh();
        if (r.skipped.length)
          toast(
            `${plural(r.skipped.length, 'contato mudou', 'contatos mudaram')} antes e ficou como estava.`,
            { tone: 'info' },
          );
      },
      (e) => {
        refresh();
        toast.error(messageOf(e));
      },
    );
  }, HOLD_MS);
  const n = ids.length;
  toast(
    as === 'shopper'
      ? n === 1
        ? 'Marcado como cliente. O Duá atende este contato.'
        : `${n} contatos marcados como clientes. O Duá atende todos.`
      : n === 1
        ? 'Marcado como pessoal. O Duá não responde este contato.'
        : `${n} contatos marcados como pessoais. O Duá não responde nenhum.`,
    {
      ms: HOLD_MS,
      undo: () => {
        window.clearTimeout(timer);
        refresh();
      },
    },
  );
}

const fold = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** The search term marked in the words Core matched (accents ignored, as Core does). */
function Highlight({ text, q }: { text: string; q: string }) {
  const needle = fold(q);
  // per character, so an index here is the same index in `text`
  const flat = [...text]
    .map((c) => {
      const f = c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      return f.length === c.length ? f : c;
    })
    .join('');
  const at = needle ? flat.indexOf(needle) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[3px] bg-spark-soft px-0.5 font-semibold text-ink">
        {text.slice(at, at + needle.length)}
      </mark>
      {text.slice(at + needle.length)}
    </>
  );
}

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
  const toDecide = list.data?.pages[0]?.counts?.ask;
  const search = useRef<HTMLInputElement>(null);

  // "para decidir": pick several and decide them at once
  const qc = useQueryClient();
  const canPersonal = useCan('manager');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    setSelecting(false);
    setPicked(new Set());
  }, [filter, debounced]);
  const selectable = filter === 'ask' && rows.length > 1;
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else if (n.size < BULK_MAX) n.add(id);
      return n;
    });
  const decide = (as: 'shopper' | 'personal') => {
    holdClassify(qc, [...picked], as);
    setSelecting(false);
    setPicked(new Set());
  };
  const bulk =
    selectable && selecting ? (
      <BulkBar
        rows={rows}
        picked={picked}
        canPersonal={canPersonal}
        onAll={(all) => setPicked(new Set(all ? rows.slice(0, BULK_MAX).map((r) => r.id) : []))}
        onDecide={decide}
        onCancel={() => {
          setSelecting(false);
          setPicked(new Set());
        }}
        desktop={desktop}
      />
    ) : null;

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
      toDecide={toDecide}
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
      selecting={selectable && selecting}
      picked={picked}
      onToggle={toggle}
      lead={
        selectable && !selecting ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<ListChecks weight="bold" />}
            className="-my-1 h-11 shrink-0"
            onClick={() => setSelecting(true)}
          >
            selecionar
          </Button>
        ) : null
      }
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
          {bulk}
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
      {bulk}
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
  toDecide,
}: {
  filter: ThreadFilter;
  onFilter: (f: ThreadFilter) => void;
  q: string;
  onQ: (q: string) => void;
  search: RefObject<HTMLInputElement>;
  desktop: boolean;
  /** contacts waiting for the owner to say who they are, when Core counts them */
  toDecide?: number | undefined;
}) {
  const waiting = useSession().vendedor?.waiting ?? 0;
  return (
    <div className="space-y-3">
      <TextInput
        ref={search}
        type="search"
        aria-label="buscar conversa"
        placeholder={
          desktop ? 'Nome, pedido ou mensagem  ( / )' : 'Nome, telefone, pedido ou mensagem'
        }
        lead={<MagnifyingGlass className="size-5" />}
        value={q}
        maxLength={60}
        onChange={(e) => onQ(e.target.value)}
      />
      <Chips
        label="mostrar"
        value={filter}
        onChange={onFilter}
        className="scroll-row -mx-4 px-4 max-md:flex-nowrap md:mx-0 md:px-0 lg:-mx-5 lg:flex-nowrap lg:px-5 [&>button]:shrink-0"
        options={[
          { value: 'all', label: 'todas' },
          {
            value: 'waiting',
            label: waiting ? `precisa de você · ${waiting}` : 'precisa de você',
          },
          { value: 'ask', label: toDecide ? `para decidir · ${toDecide}` : 'para decidir' },
          { value: 'orders', label: 'com pedido' },
          { value: 'agent', label: 'Duá atendendo' },
          { value: 'personal', label: 'pessoais' },
          { value: 'others', label: 'outros' },
        ]}
      />
    </div>
  );
}

type ListQuery = UseInfiniteQueryResult<InfiniteData<ThreadList>, Error>;

/** what each quiet list holds, above its rows */
const LEAD: Partial<Record<ThreadFilter, string>> = {
  ask: 'Números que o Duá não sabe se são clientes. Ele não responde até você decidir.',
  personal: 'Amigos, família e outras conversas suas. O Duá não responde esses números.',
  others:
    'Números que não parecem clientes (fornecedores, entregadores, família). Ficam aqui, sem resposta automática.',
};

function ThreadList({
  list,
  rows,
  filter,
  q,
  selected,
  desktop,
  onPick,
  selecting,
  picked,
  onToggle,
  lead,
}: {
  list: ListQuery;
  rows: ThreadRow[];
  filter: ThreadFilter;
  q: string;
  selected: string | null;
  desktop: boolean;
  onPick: (id: string) => void;
  selecting: boolean;
  picked: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** beside the list's lead line ("selecionar") */
  lead?: ReactNode;
}) {
  if (list.error) return <ErrorState error={list.error} retry={() => void list.refetch()} />;
  if (list.isPending) return <RowsSkeleton rows={6} />;
  if (!rows.length) return <Empty filter={filter} q={q} />;
  return (
    <>
      {LEAD[filter] || lead ? (
        <div className="mb-3 flex items-start gap-3 px-1">
          {LEAD[filter] ? (
            <p className="t-caption min-w-0 flex-1 text-muted">{LEAD[filter]}</p>
          ) : null}
          {lead}
        </div>
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
              {selecting ? (
                <PickRow
                  r={r}
                  q={q}
                  checked={picked.has(r.id)}
                  desktop={desktop}
                  onToggle={onToggle}
                />
              ) : (
                <Row r={r} q={q} selected={selected === r.id} desktop={desktop} onPick={onPick} />
              )}
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
  q,
  selected,
  desktop,
  onPick,
}: {
  r: ThreadRow;
  q: string;
  selected: boolean;
  desktop: boolean;
  onPick: (id: string) => void;
}) {
  const preload = usePreload();
  const to = desktop
    ? `/vendedor/conversas?c=${encodeURIComponent(r.id)}`
    : `/vendedor/conversas/${r.id}`;
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
      <RowBody r={r} q={q} />
    </Link>
  );
}

/** A row while picking several: the whole row toggles it. */
function PickRow({
  r,
  q,
  checked,
  desktop,
  onToggle,
}: {
  r: ThreadRow;
  q: string;
  checked: boolean;
  desktop: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onToggle(r.id)}
      className={cn(
        'press-row flex min-h-18 w-full items-start gap-3 px-4 py-3 text-left hover:bg-hover',
        desktop && 'rounded-md px-3',
        checked && 'bg-sunken hover:bg-sunken',
      )}
    >
      <span aria-hidden className="grid size-11 shrink-0 place-items-center">
        {checked ? (
          <CheckSquare weight="fill" className="size-7 text-ink" />
        ) : (
          <Square weight="bold" className="size-7 text-muted" />
        )}
      </span>
      <RowBody r={r} q={q} />
    </button>
  );
}

function RowBody({ r, q }: { r: ThreadRow; q: string }) {
  const waited = r.waitingSince ? minutesSince(r.waitingSince) : null;
  const by =
    r.previewAuthor === 'agent'
      ? 'Duá: '
      : r.previewAuthor === 'merchant'
        ? 'você: '
        : r.previewAuthor === 'core'
          ? 'loja: '
          : '';
  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-baseline gap-2">
        <span className={cn('min-w-0 flex-1 truncate', r.unread ? 'font-bold' : 'font-semibold')}>
          {r.name}
        </span>
        <time dateTime={r.lastAt} className="t-caption shrink-0 text-muted">
          {rowWhen(r.lastAt)}
        </time>
      </span>
      {r.match && r.class !== 'personal' ? (
        <span className="t-body block truncate text-muted">
          <span className="sr-only">trecho da conversa: </span>
          <Highlight text={r.match} q={q} />
        </span>
      ) : (
        <span
          className={cn('t-body block truncate', r.unread ? 'font-medium text-ink' : 'text-muted')}
        >
          {r.unread ? <span className="sr-only">nova mensagem: </span> : null}
          {r.class === 'personal' ? (
            // the team shares this list: a friend's words stay in the owner's phone
            'conversa pessoal'
          ) : (
            <>
              {by}
              {r.preview ?? '…'}
            </>
          )}
        </span>
      )}
      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {r.waitingSince ? (
          <>
            {r.reason ? <ReasonChip reason={r.reason} /> : <FloorChip floor={r.floor} waiting />}
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
        ) : triaged(r.class) ? (
          <ClassChip cls={r.class} />
        ) : (
          <FloorChip floor={r.floor} />
        )}
      </span>
    </span>
  );
}

/** Picking several "para decidir": how many, all, and the two decisions (pessoal: managers). */
function BulkBar({
  rows,
  picked,
  canPersonal,
  onAll,
  onDecide,
  onCancel,
  desktop,
}: {
  rows: ThreadRow[];
  picked: ReadonlySet<string>;
  canPersonal: boolean;
  onAll: (all: boolean) => void;
  onDecide: (as: 'shopper' | 'personal') => void;
  onCancel: () => void;
  desktop: boolean;
}) {
  const n = picked.size;
  const all = n > 0 && n >= Math.min(rows.length, BULK_MAX);
  return (
    <section
      aria-label="decidir vários contatos"
      className={cn(
        'glass z-20 flex flex-col gap-2.5 border-t border-line px-3.5 pb-4 pt-3',
        desktop
          ? 'shrink-0'
          : 'sticky bottom-(--tabbar-h) -mx-4 mt-4 md:bottom-0 md:-mx-8 md:rounded-lg md:border-0 md:depth-2',
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={all ? true : n ? 'mixed' : false}
          // "selecionar" goes away as this opens: focus lands here, not at the top of the page
          autoFocus
          onClick={() => onAll(!all)}
          className="press -ml-1 inline-flex h-12 items-center gap-2 rounded-md px-1 font-semibold"
        >
          {all ? (
            <CheckSquare weight="fill" className="size-6 text-ink" aria-hidden />
          ) : (
            <Square weight="bold" className="size-6 text-muted" aria-hidden />
          )}
          todos
        </button>
        <p className="t-body min-w-0 flex-1 text-muted" aria-live="polite">
          {n ? plural(n, 'escolhido', 'escolhidos') : 'toque nos contatos'}
        </p>
        <Button variant="ghost" size="sm" className="-mr-2 h-12" onClick={onCancel}>
          cancelar
        </Button>
      </div>
      <div className="flex gap-2">
        <Button className="min-w-0 flex-1" disabled={!n} onClick={() => onDecide('shopper')}>
          {n > 1 ? 'são clientes' : 'é cliente'}
        </Button>
        {canPersonal ? (
          <Button
            variant="secondary"
            className="min-w-0 flex-1"
            disabled={!n}
            onClick={() => onDecide('personal')}
          >
            {n > 1 ? 'são pessoais' : 'é pessoal'}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function Empty({ filter, q }: { filter: ThreadFilter; q: string }) {
  const test = useCan('manager');
  if (q)
    return (
      <EmptyState
        art={<Mascote pose="sem-resultados" />}
        title={`Nenhuma conversa com "${q}"`}
        body="Tente parte do nome, os últimos números do telefone, o número do pedido ou uma palavra que o cliente escreveu."
      />
    );
  const copy: Record<ThreadFilter, { title: string; body: string }> = {
    all: {
      title: 'Ninguém escreveu ainda',
      body: 'O Duá responde assim que alguém chamar no WhatsApp da loja.',
    },
    waiting: {
      title: 'Ninguém esperando por você',
      body: 'Quando um cliente precisar de você, ele aparece aqui e o celular avisa.',
    },
    ask: {
      title: 'Nada para decidir',
      body: 'Quando o Duá não souber se um número é cliente, ele aparece aqui e o celular avisa.',
    },
    personal: {
      title: 'Nenhum contato pessoal',
      body: 'Quem o Duá ou você marcar como pessoal fica aqui, sem resposta automática.',
    },
    orders: {
      title: 'Nenhuma conversa virou pedido ainda',
      body: 'Os pedidos que o Duá fechar aparecem aqui.',
    },
    agent: {
      title: 'O Duá não está atendendo ninguém agora',
      body: 'As conversas dele aparecem aqui enquanto ele atende.',
    },
    others: {
      title: 'Nenhum número em “outros”',
      body: 'Fornecedores, entregadores e família ficam aqui, sem resposta automática.',
    },
  };
  return (
    <EmptyState
      art={<Mascote pose={filter === 'waiting' || filter === 'ask' ? 'sucesso' : 'carinho'} />}
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
