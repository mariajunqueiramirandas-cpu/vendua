import {
  CaretRight,
  ClockCounterClockwise,
  Copy,
  EnvelopeSimple,
  PaperPlaneTilt,
  Plus,
  UserCircle,
  WarningCircle,
  WhatsappLogo,
} from '@phosphor-icons/react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { whatsappUrl } from '@vendua/kernel/rules';
import {
  api,
  type ActivityEntry,
  type InviteResult,
  type Member,
  type Role,
} from '../../lib/api.ts';
import { ago, phone, plural, when } from '../../lib/format.ts';
import { optimistic, qk, useMutation } from '../../lib/query.ts';
import { ROLE_LABEL, useCan, useSession } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState, messageOf, DuaNote } from '../../ui/feedback.tsx';
import { Chips, Field, PhoneInput, TextInput, Toggle } from '../../ui/fields.tsx';
import { HoldButton } from '../../ui/HoldButton.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { OutcomeList, OutcomeRow } from '../../ui/Outcome.tsx';
import { RowsSkeleton } from '../../ui/skeletons.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';

const ROLE_HELP: Record<Role, string> = {
  owner: 'Tudo, incluindo pagamentos, equipe e plano.',
  manager: 'Pedidos, cardápio, loja, clientes, marketing e relatórios.',
  attendant: 'Pedidos e pausar a loja. Ideal para quem fica no balcão.',
};

type TeamData = Awaited<ReturnType<typeof api.team>>;

/** a member write answers the list only: the store's switches stay as they were */
function setMembers(qc: QueryClient, members: Member[]) {
  qc.setQueryData<TeamData>(qk.team, (d) => ({ ...d, members }));
}

export default function Team() {
  const owner = useCan('owner');
  const { data, error, refetch } = useQuery({ queryKey: qk.team, queryFn: api.team });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [result, setResult] = useState<InviteOutcome | null>(null);
  const session = useSession();
  const me = session.user.id;
  return (
    <PageBody wide>
      <PageHeader
        title="Equipe"
        subtitle="Quem ajuda a tocar a loja. Cada pessoa entra com o próprio celular."
        actions={
          owner ? (
            <Button icon={<Plus />} onClick={() => setAdding(true)}>
              adicionar pessoa
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="space-y-8">
          <Section title="Pessoas">
            {error && !data ? (
              <ErrorState error={error} retry={() => void refetch()} />
            ) : !data ? (
              <RowsSkeleton rows={3} />
            ) : (
              <Card as="section" aria-label="pessoas da equipe">
                <ul className="divide-y divide-line">
                  {data.members.map((m) => (
                    <MemberRow
                      key={m.id}
                      m={m}
                      me={m.id === me}
                      owner={owner}
                      onOpen={() => setEditing(m)}
                      onResent={setResult}
                    />
                  ))}
                </ul>
              </Card>
            )}
            {owner && data && data.members.filter((m) => m.status !== 'revoked').length === 1 ? (
              <DuaNote pose="carinho" title="Tocando a loja sem ajuda?" className="mt-3">
                Chame quem ajuda no balcão ou na cozinha. Cada pessoa entra com o próprio celular, e
                você escolhe o que ela pode fazer.
              </DuaNote>
            ) : null}
            {owner ? (
              <Button
                variant="secondary"
                block
                className="mt-3 md:hidden"
                icon={<Plus />}
                onClick={() => setAdding(true)}
              >
                adicionar pessoa
              </Button>
            ) : null}
          </Section>
          {owner && session.duaWhatsapp && data ? (
            <DuaWhatsappManagers on={data.duaWhatsappManagers !== false} />
          ) : null}
        </div>
        <Activity />
      </div>
      <AddSheet open={adding} onOpenChange={setAdding} />
      <InviteResultSheet result={result} onClose={() => setResult(null)} />
      <EditSheet member={editing} onClose={() => setEditing(null)} />
    </PageBody>
  );
}

/** the owner's per-store switch: managers may talk to Duá by WhatsApp (dua-no-whatsapp §6) */
function DuaWhatsappManagers({ on }: { on: boolean }) {
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: (v: boolean) => api.teamSettings({ duaWhatsappManagers: v }),
    onMutate: (v) => optimistic<TeamData>(qc, qk.team, (d) => ({ ...d, duaWhatsappManagers: v })),
    onSuccess: (r) => {
      qc.setQueryData<TeamData>(qk.team, (d) => d && { ...d, ...r });
      void qc.invalidateQueries({ queryKey: qk.activity });
    },
    onError: (e, _v, ctx) => {
      ctx?.restore();
      toast.error(messageOf(e));
    },
  });
  return (
    <Section title="Duá pelo WhatsApp">
      <Card className="px-5 py-1">
        <Toggle
          checked={on}
          onChange={(v) => set.mutate(v)}
          label={
            <span className="inline-flex items-center gap-2">
              <WhatsappLogo className="size-5" /> Duá pelo WhatsApp para gerentes
            </span>
          }
          description="Gerentes podem ligar no Perfil e falar com o Duá pelo próprio WhatsApp. Você sempre pode."
        />
      </Card>
    </Section>
  );
}

function RolePicker({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <Field label="O que pode fazer" helper={ROLE_HELP[value]}>
      <Chips
        label="papel"
        value={value}
        onChange={onChange}
        options={(['attendant', 'manager', 'owner'] as Role[]).map((r) => ({
          value: r,
          label: ROLE_LABEL[r],
        }))}
      />
    </Field>
  );
}

/** What the result sheet shows after an invite goes out (a new person, or "reenviar"). */
export interface InviteOutcome {
  member: Pick<Member, 'name' | 'phone' | 'email'>;
  invite: InviteResult;
  signInUrl: string;
  resent?: boolean;
}

const channelsText = (c: string[]) => {
  const names = c.map((x) => (x === 'whatsapp' ? 'WhatsApp' : x === 'email' ? 'e-mail' : x));
  return names.length ? ` pelo ${names.join(' e ')}` : '';
};

/** "convite enviado há 2 h pelo WhatsApp" · "o convite não chegou" · "visto há 3 min" */
export function inviteLine(m: Member): { text: string; failed?: boolean; pending: boolean } {
  if (m.status === 'revoked') return { text: 'sem acesso', pending: false };
  if (m.lastSeenAt) return { text: `visto ${ago(m.lastSeenAt)}`, pending: false };
  if (m.inviteError) return { text: 'o convite não chegou', failed: true, pending: true };
  if (m.inviteSentAt)
    return {
      text: `convite enviado ${ago(m.inviteSentAt)}${channelsText(m.inviteChannels)}`,
      pending: true,
    };
  return { text: 'ainda não entrou', pending: true };
}

function MemberRow({
  m,
  me,
  owner,
  onOpen,
  onResent,
}: {
  m: Member;
  me: boolean;
  owner: boolean;
  onOpen: () => void;
  onResent: (r: InviteOutcome) => void;
}) {
  const qc = useQueryClient();
  const line = inviteLine(m);
  const resend = useMutation({
    mutationFn: () => api.resendInvite(m.id),
    onSuccess: (r) => {
      setMembers(qc, r.members);
      onResent({
        member: m,
        invite: r.invite,
        signInUrl: '/admin/',
        resent: true,
      });
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  return (
    <li>
      <button
        type="button"
        disabled={!owner || m.status === 'revoked'}
        onClick={onOpen}
        className="flex min-h-18 w-full items-center gap-3 px-4 py-3 text-left enabled:hover:bg-hover disabled:opacity-100"
      >
        <UserCircle weight="duotone" className="size-10 shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            {m.name}
            {me ? <span className="t-caption ml-2 text-muted">(você)</span> : null}
          </span>
          <span className="t-caption block text-muted">
            {phone(m.phone)} ·{' '}
            <span className={cn(line.failed && 'font-semibold text-danger')}>
              {line.failed ? (
                <WarningCircle
                  weight="fill"
                  className="mr-0.5 inline size-3.5 align-[-2px]"
                  aria-hidden
                />
              ) : null}
              {line.text}
            </span>
          </span>
        </span>
        <span className="t-caption shrink-0 rounded-full bg-sunken px-2.5 py-1 font-semibold">
          {ROLE_LABEL[m.role]}
        </span>
      </button>
      {owner && line.pending && !me ? (
        <div className="-mt-2 pb-3 pl-[68px] pr-4">
          <Button
            size="sm"
            variant={line.failed ? 'secondary' : 'ghost'}
            className={cn(!line.failed && '-ml-3.5')}
            icon={<PaperPlaneTilt />}
            loading={resend.isPending}
            onClick={() => resend.mutate()}
          >
            reenviar convite
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function AddSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const store = useSession().store.name;
  // one sheet that turns into the result: closing one sheet and opening another in the same tick
  // lets the first one's history.back() close the second
  const [done, setDone] = useState<InviteOutcome | null>(null);
  useEffect(() => {
    if (open) setDone(null);
  }, [open]);
  const [name, setName] = useState('');
  const [ph, setPh] = useState('');
  const [digits, setDigits] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('attendant');
  const mail = email.trim();
  const mailBad = !!mail && !EMAIL.test(mail);
  const add = useMutation({
    mutationFn: (v: { name: string; phone: string; role: Role; email: string | null }) =>
      api.addMember(v),
    onSuccess: (r, v) => {
      setMembers(qc, r.members);
      void qc.invalidateQueries({ queryKey: qk.activity });
      setName('');
      setPh('');
      setDigits(null);
      setEmail('');
      setDone({
        member: { name: v.name, phone: v.phone, email: v.email },
        invite: r.invite,
        signInUrl: r.signInUrl,
      });
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  if (done) {
    const v = inviteView(done, store, () => onOpenChange(false));
    return (
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={v.title}
        description={v.description}
        footer={v.footer}
      >
        {v.body}
      </Sheet>
    );
  }
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Adicionar pessoa"
      description="A gente manda o convite no WhatsApp dela. Ninguém compartilha senha."
      footer={
        <Button
          size="lg"
          block
          disabled={!digits || name.trim().length < 2 || mailBad}
          loading={add.isPending}
          onClick={() =>
            add.mutate({ name: name.trim(), phone: digits!, role, email: mail || null })
          }
        >
          adicionar e convidar
        </Button>
      }
    >
      <div className="space-y-5 pt-2">
        <Field label="Nome" htmlFor="tm-name">
          <TextInput
            id="tm-name"
            maxLength={80}
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Celular (WhatsApp)" htmlFor="tm-phone" helper="O convite chega aqui.">
          <PhoneInput
            id="tm-phone"
            value={ph}
            onChange={(v, d) => {
              setPh(v);
              setDigits(d);
            }}
          />
        </Field>
        <Field
          label="E-mail"
          optional
          htmlFor="tm-email"
          helper="Mandamos o convite por e-mail também. Serve para entrar se o WhatsApp falhar."
          error={mailBad ? 'Confira o e-mail, como nome@exemplo.com.' : null}
        >
          <TextInput
            id="tm-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            maxLength={200}
            value={email}
            aria-invalid={mailBad || undefined}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nome@exemplo.com"
          />
        </Field>
        <RolePicker value={role} onChange={setRole} />
      </div>
    </Sheet>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const absolute = (u: string) => (u.startsWith('/') ? `${location.origin}${u}` : u);

/** After an invite: where it went, and the merchant's own WhatsApp as the fallback. */
/** The result of an invite, as the parts of a sheet (the add sheet turns into it; "reenviar" opens it). */
function inviteView(r: InviteOutcome, store: string, onClose: () => void) {
  const { invite, member } = r;
  const first = member.name.split(' ')[0] ?? member.name;
  const url = absolute(r.signInUrl);
  const reached = invite.whatsapp === 'sent' || invite.email === 'sent';
  const failed = invite.whatsapp === 'failed' || invite.email === 'failed';
  const text = `Oi, ${first}! Você agora faz parte da equipe da ${store} na Venduá. Para entrar, abra ${url} e use o seu celular (${phone(member.phone)}). O código chega no seu WhatsApp.`;
  const title = reached
    ? r.resent
      ? 'Convite reenviado'
      : `${first} está na equipe`
    : r.resent
      ? 'O convite não chegou'
      : `${first} está na equipe, falta o convite`;
  return {
    title,
    description: reached
      ? `Quando ${first} abrir o link, é só entrar com o celular. O código chega no WhatsApp.`
      : `Não conseguimos avisar ${first}. Mande o convite pelo seu WhatsApp: leva um toque.`,
    footer: (
      <div className="space-y-2">
        <a
          href={whatsappUrl(member.phone, text) ?? undefined}
          target="_blank"
          rel="noreferrer"
          className={cn(
            't-label inline-flex h-14 w-full items-center justify-center gap-2 rounded-lg px-6 transition-transform active:scale-[0.97]',
            reached
              ? 'bg-surface text-ink ring-1 ring-line-strong depth-1 hover:bg-hover'
              : 'bg-primary text-on-primary depth-1 hover:bg-primary-hover',
          )}
        >
          <WhatsappLogo weight="fill" className="size-6" />
          mandar pelo meu WhatsApp
        </a>
        <Button size="lg" variant={reached ? 'primary' : 'ghost'} block onClick={onClose}>
          pronto
        </Button>
      </div>
    ),
    body: (
      <div className="space-y-4 pt-2">
        <OutcomeList label="para onde foi o convite">
          <OutcomeRow
            channel="WhatsApp"
            icon={<WhatsappLogo weight="duotone" />}
            detail={phone(member.phone)}
            state={OUT[invite.whatsapp]}
            word={WORD[invite.whatsapp]}
          />
          {member.email ? (
            <OutcomeRow
              channel="E-mail"
              icon={<EnvelopeSimple weight="duotone" />}
              detail={member.email}
              state={OUT[invite.email]}
              word={WORD[invite.email]}
            />
          ) : null}
        </OutcomeList>
        {failed && reached ? (
          <p className="t-body text-muted">
            Um dos avisos não foi. Se {first} não achar o convite, mande pelo seu WhatsApp.
          </p>
        ) : null}
        <div>
          <p className="t-label mb-1.5">Link para entrar</p>
          <div className="flex items-center gap-2 rounded-sm bg-sunken py-1.5 pl-4 pr-1.5">
            <span className="t-body min-w-0 flex-1 truncate tnum">
              {url.replace(/^https?:\/\//, '')}
            </span>
            <Button
              size="sm"
              variant="secondary"
              icon={<Copy />}
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(url)
                  .then(() => toast('Link copiado'))
                  .catch(() => toast.error('Não deu para copiar. Segure o link para copiar.'))
              }
            >
              copiar
            </Button>
          </div>
        </div>
      </div>
    ),
  };
}

function InviteResultSheet({
  result,
  onClose,
}: {
  result: InviteOutcome | null;
  onClose: () => void;
}) {
  const store = useSession().store.name;
  // keep the last result while the sheet animates closed
  const [last, setLast] = useState(result);
  useEffect(() => {
    if (result) setLast(result);
  }, [result]);
  const r = result ?? last;
  if (!r) return null;
  const v = inviteView(r, store, onClose);
  return (
    <Sheet
      open={!!result}
      onOpenChange={(o) => !o && onClose()}
      title={v.title}
      description={v.description}
      footer={v.footer}
    >
      {v.body}
    </Sheet>
  );
}

const OUT = { sent: 'ok', failed: 'failed', skipped: 'skipped' } as const;
const WORD = { sent: 'enviado', failed: 'falhou', skipped: 'não enviado' } as const;

function EditSheet({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [role, setRole] = useState<Role>('attendant');
  useEffect(() => {
    if (member) setRole(member.role);
  }, [member]);
  const done = (r: { members: Member[] }, msg: string) => {
    setMembers(qc, r.members);
    void qc.invalidateQueries({ queryKey: qk.activity });
    toast(msg);
  };
  // the sheet closes on tap, so what the mutation needs travels in its variables
  const upd = useMutation({
    mutationFn: (v: { id: string; role: Role }) => api.updateMember(v.id, { role: v.role }),
    onMutate: (v) => {
      onClose();
      return optimistic<TeamData>(qc, qk.team, (d) => ({
        ...d,
        members: d.members.map((m) => (m.id === v.id ? { ...m, role: v.role } : m)),
      }));
    },
    onSuccess: (r) => done(r, 'Papel atualizado'),
    onError: (e, _v, ctx) => {
      ctx?.restore();
      toast.error(messageOf(e));
    },
  });
  const rm = useMutation({
    mutationFn: (v: { id: string; name: string }) => api.removeMember(v.id),
    onMutate: (v) => {
      onClose();
      return optimistic<TeamData>(qc, qk.team, (d) => ({
        ...d,
        members: d.members.filter((m) => m.id !== v.id),
      }));
    },
    onSuccess: (r, v) => done(r, `${v.name} não tem mais acesso`),
    onError: (e, _v, ctx) => {
      ctx?.restore();
      toast.error(messageOf(e));
    },
  });
  return (
    <Sheet
      open={!!member}
      onOpenChange={(v) => !v && onClose()}
      title={member?.name ?? ''}
      description={member ? phone(member.phone) : undefined}
      footer={
        <div className="space-y-2">
          <Button
            size="lg"
            block
            loading={upd.isPending}
            disabled={role === member?.role}
            onClick={() => upd.mutate({ id: member!.id, role })}
          >
            salvar papel
          </Button>
          <HoldButton onConfirm={() => rm.mutate({ id: member!.id, name: member!.name })}>
            {rm.isPending ? 'removendo…' : 'segure para tirar o acesso'}
          </HoldButton>
        </div>
      }
    >
      <div className="pt-2">
        <RolePicker value={role} onChange={setRole} />
      </div>
    </Sheet>
  );
}

// Core's kinds (admin/routes-team.ts ACTIVITY_KINDS), in the order a store thinks of them
const KINDS = [
  ['pedidos', 'pedidos'],
  ['cardapio', 'cardápio'],
  ['loja', 'loja'],
  ['clientes', 'clientes'],
  ['marketing', 'marketing'],
  ['pagamentos', 'pagamentos'],
  ['equipe', 'equipe'],
  ['conta', 'conta'],
] as const;

// a chip chosen from the address may sit past the row's edge: bring it into view once, sideways only
const revealChecked = (row: HTMLElement | null) => {
  const chip = row?.querySelector<HTMLElement>('[aria-checked="true"]');
  if (!row || !chip) return;
  const r = row.getBoundingClientRect();
  const c = chip.getBoundingClientRect();
  if (c.left < r.left || c.right > r.right)
    row.scrollLeft += c.left - r.left - (r.width - c.width) / 2;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** where the thing an entry changed lives; none for this page's own people or a customer
 *  (the log keeps only a phone's last digits) */
function linkOf(e: ActivityEntry): string | null {
  const id = e.entityId && UUID.test(e.entityId) ? e.entityId : null;
  const gone = e.action.endsWith('.delete') || e.action.endsWith('.remove');
  switch (e.entity) {
    case 'order':
      return id ? `/pedidos/${id}` : '/pedidos';
    case 'product':
      return id && !gone ? `/cardapio/produto/${id}` : '/cardapio';
    case 'category':
    case 'import':
    case 'catalog':
    case 'modifier':
      return '/cardapio';
    case 'store':
      return '/loja';
    case 'zone':
      return '/loja#entrega';
    case 'kitchen':
      return '/cozinha';
    case 'printer':
    case 'printers':
    case 'print_device':
      return '/impressoras';
    case 'whatsapp':
      return '/whatsapp';
    case 'page':
    case 'tokens':
      return '/aparencia';
    case 'coupon':
    case 'loyalty':
      return '/marketing';
    case 'payments':
      return '/pagamentos';
    case 'account':
    case 'invoice':
    case 'custom_domain':
      return '/conta';
    case 'thread':
      return id ? `/vendedor/conversas/${id}` : '/vendedor/conversas';
    case 'store_agent':
      return '/vendedor/configurar';
    case 'store_knowledge':
      return '/vendedor/ensinar';
    case 'vendedor_runs':
      return '/vendedor';
    default:
      return null;
  }
}

function Activity() {
  const s = useSession();
  const [params, setParams] = useSearchParams();
  const kinds: { value: string; label: string }[] = [
    { value: '', label: 'tudo' },
    ...KINDS.map(([value, label]) => ({ value, label })),
    ...(s.vendedor ? [{ value: 'vendedor', label: s.vendedor.name }] : []),
  ];
  const k = params.get('atividade') ?? '';
  const kind = kinds.some((o) => o.value === k) ? k : '';
  const list = useInfiniteQuery({
    queryKey: qk.activityOf(kind),
    queryFn: ({ pageParam }) => api.activity(pageParam || undefined, kind || undefined),
    initialPageParam: 0,
    getNextPageParam: (p) => p.next ?? undefined,
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.pages.flatMap((p) => p.entries) ?? [];
  const label = kinds.find((o) => o.value === kind)?.label;
  return (
    <Section title="Quem mudou o quê" hint="Tudo o que a equipe fez no painel.">
      <div ref={revealChecked} className="scroll-row -mx-4 mb-3 px-4 md:mx-0 md:px-0">
        <Chips
          label="mostrar"
          value={kind}
          onChange={(v) =>
            setParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                if (v) next.set('atividade', v);
                else next.delete('atividade');
                return next;
              },
              { replace: true },
            )
          }
          className="w-max flex-nowrap md:w-auto md:flex-wrap"
          options={kinds}
        />
      </div>
      {list.isPending ? (
        <RowsSkeleton rows={5} avatar={false} />
      ) : rows.length ? (
        <Card
          className={cn(
            'overflow-hidden transition-opacity',
            list.isPlaceholderData && 'opacity-60',
          )}
          aria-busy={list.isPlaceholderData || undefined}
        >
          <ol className="divide-y divide-line">
            {rows.map((e) => (
              <ActivityRow key={e.id} e={e} />
            ))}
          </ol>
          {list.hasNextPage ? (
            <div className="p-3">
              <Button
                variant="ghost"
                block
                loading={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                ver mais
              </Button>
            </div>
          ) : null}
        </Card>
      ) : (
        <Card className="p-5">
          <p className="t-body text-muted">
            {kind
              ? `Nada mudou em ${label} ainda.`
              : 'As mudanças feitas no painel aparecem aqui, com quem fez e quando.'}
          </p>
        </Card>
      )}
    </Section>
  );
}

const ORDER_DID: Record<string, (n: string) => string> = {
  'order.confirmed': (n) => `aceitou o pedido #${n}`,
  'order.preparing': (n) => `começou o preparo do pedido #${n}`,
  'order.ready': (n) => `marcou o pedido #${n} como pronto`,
  'order.out_for_delivery': (n) => `mandou o pedido #${n} para entrega`,
  'order.delivered': (n) => `concluiu o pedido #${n}`,
  'order.cancelled': (n) => `cancelou o pedido #${n}`,
  'order.refunded': (n) => `estornou o pedido #${n}`,
};

/** Core writes a move as "pedido #882: novo → aceito"; after the name it reads as a verb, and
 *  the move itself is already in the changes under it. Its reason and refund stay. */
function summaryOf(e: ActivityEntry) {
  const m = /^pedido #(\d+): .+? → .+?((?: \(.*\))?(?: · .*)?)$/.exec(e.summary);
  const did = ORDER_DID[e.action];
  return m && did ? `${did(m[1]!)}${m[2] ?? ''}` : e.summary;
}

function ActivityRow({ e }: { e: ActivityEntry }) {
  const to = linkOf(e);
  const body = (
    <>
      <ClockCounterClockwise className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="t-body">
          <strong>{e.actor}</strong> {summaryOf(e)}
        </p>
        {e.changes?.length ? (
          <ul className="t-caption mt-1 space-y-0.5 text-muted">
            {e.changes.map((c) => (
              <li key={c.label} className="break-words">
                <span className="text-ink">{c.label}:</span>{' '}
                {c.hidden ? (
                  'mudou'
                ) : c.from !== null ? (
                  <>
                    {c.from} <span aria-hidden>→</span>
                    <span className="sr-only">para</span> {c.to ?? '—'}
                  </>
                ) : (
                  (c.to ?? '—')
                )}
              </li>
            ))}
            {e.more ? <li>e mais {plural(e.more, 'mudança', 'mudanças')}</li> : null}
          </ul>
        ) : null}
        <p className="t-caption mt-0.5 text-muted">{when(e.at)}</p>
      </div>
      {to ? <CaretRight className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden /> : null}
    </>
  );
  return (
    <li>
      {to ? (
        <Link to={to} className="press-row flex gap-3 px-4 py-3 hover:bg-hover">
          {body}
        </Link>
      ) : (
        <div className="flex gap-3 px-4 py-3">{body}</div>
      )}
    </li>
  );
}
