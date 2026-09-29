import { ClockCounterClockwise, Plus, UserCircle } from '@phosphor-icons/react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type Member, type Role } from '../../lib/api.ts';
import { ago, phone, when } from '../../lib/format.ts';
import { optimistic, qk } from '../../lib/query.ts';
import { ROLE_LABEL, useCan, useSession } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { ErrorState, Loading, messageOf } from '../../ui/feedback.tsx';
import { Chips, Field, PhoneInput, TextInput } from '../../ui/fields.tsx';
import { HoldButton } from '../../ui/HoldButton.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';

const ROLE_HELP: Record<Role, string> = {
  owner: 'Tudo, incluindo pagamentos, equipe e plano.',
  manager: 'Pedidos, cardápio, loja, clientes, marketing e relatórios.',
  attendant: 'Pedidos e pausar a loja. Ideal para quem fica no balcão.',
};

export default function Team() {
  const owner = useCan('owner');
  const { data, error, refetch } = useQuery({ queryKey: qk.team, queryFn: api.team });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const me = useSession().user.id;
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
        <Section title="Pessoas">
          {error && !data ? (
            <ErrorState error={error} retry={() => void refetch()} />
          ) : !data ? (
            <Loading lines={2} />
          ) : (
            <Card className="divide-y divide-line">
              {data.members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={!owner || m.status === 'revoked'}
                  onClick={() => setEditing(m)}
                  className="flex min-h-18 w-full items-center gap-3 px-4 py-3 text-left enabled:hover:bg-hover disabled:opacity-100"
                >
                  <UserCircle weight="duotone" className="size-10 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {m.name}
                      {m.id === me ? (
                        <span className="t-caption ml-2 text-muted">(você)</span>
                      ) : null}
                    </span>
                    <span className="t-caption block text-muted">
                      {phone(m.phone)} ·{' '}
                      {m.status === 'revoked'
                        ? 'sem acesso'
                        : m.lastSeenAt
                          ? `visto ${ago(m.lastSeenAt)}`
                          : 'ainda não entrou'}
                    </span>
                  </span>
                  <span className="t-caption shrink-0 rounded-full bg-sunken px-2.5 py-1 font-semibold">
                    {ROLE_LABEL[m.role]}
                  </span>
                </button>
              ))}
            </Card>
          )}
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
        <Activity />
      </div>
      <AddSheet open={adding} onOpenChange={setAdding} />
      <EditSheet member={editing} onClose={() => setEditing(null)} />
    </PageBody>
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

function AddSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [ph, setPh] = useState('');
  const [digits, setDigits] = useState<string | null>(null);
  const [role, setRole] = useState<Role>('attendant');
  const add = useMutation({
    mutationFn: () => api.addMember({ name: name.trim(), phone: digits!, role }),
    onSuccess: (r) => {
      qc.setQueryData(qk.team, r);
      void qc.invalidateQueries({ queryKey: qk.activity });
      toast(
        `${name.trim()} adicionada à equipe. É só entrar em ${location.host}/admin com o celular.`,
      );
      setName('');
      setPh('');
      onOpenChange(false);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Adicionar pessoa"
      description="Ela entra com um código no WhatsApp. Ninguém compartilha senha."
      footer={
        <Button
          size="lg"
          block
          disabled={!digits || name.trim().length < 2}
          loading={add.isPending}
          onClick={() => add.mutate()}
        >
          adicionar
        </Button>
      }
    >
      <div className="space-y-5 pt-2">
        <Field label="Nome" htmlFor="tm-name">
          <TextInput
            id="tm-name"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Celular (WhatsApp)" htmlFor="tm-phone">
          <PhoneInput
            id="tm-phone"
            value={ph}
            onChange={(v, d) => {
              setPh(v);
              setDigits(d);
            }}
          />
        </Field>
        <RolePicker value={role} onChange={setRole} />
      </div>
    </Sheet>
  );
}

function EditSheet({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [role, setRole] = useState<Role>('attendant');
  useEffect(() => {
    if (member) setRole(member.role);
  }, [member]);
  const done = (r: { members: Member[] }, msg: string) => {
    qc.setQueryData(qk.team, r);
    void qc.invalidateQueries({ queryKey: qk.activity });
    toast(msg);
  };
  // the sheet closes on tap, so what the mutation needs travels in its variables
  const upd = useMutation({
    mutationFn: (v: { id: string; role: Role }) => api.updateMember(v.id, { role: v.role }),
    onMutate: (v) => {
      onClose();
      return optimistic<{ members: Member[] }>(qc, qk.team, (d) => ({
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
      return optimistic<{ members: Member[] }>(qc, qk.team, (d) => ({
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

function Activity() {
  const list = useInfiniteQuery({
    queryKey: qk.activity,
    queryFn: ({ pageParam }) => api.activity(pageParam || undefined),
    initialPageParam: 0,
    getNextPageParam: (p) => p.next ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.entries) ?? [];
  return (
    <Section title="Quem mudou o quê" hint="Tudo o que a equipe fez no painel.">
      {list.isPending ? (
        <Loading lines={3} />
      ) : rows.length ? (
        <Card className="overflow-hidden">
          <ol className="divide-y divide-line">
            {rows.map((e) => (
              <li key={e.id} className="flex gap-3 px-4 py-3">
                <ClockCounterClockwise className="mt-0.5 size-5 shrink-0 text-muted" />
                <div className="min-w-0">
                  <p className="t-body">
                    <strong>{e.actor}</strong> {e.summary}
                  </p>
                  <p className="t-caption text-muted">{when(e.at)}</p>
                </div>
              </li>
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
            As mudanças feitas no painel aparecem aqui, com quem fez e quando.
          </p>
        </Card>
      )}
    </Section>
  );
}
