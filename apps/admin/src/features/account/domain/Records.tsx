import {
  ArrowsClockwise,
  Check,
  MagnifyingGlass,
  Plus,
  Trash,
  WarningOctagon,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { api, ApiError, type DnsRecord, type DnsRecordType } from '../../../lib/api.ts';
import { plural } from '../../../lib/format.ts';
import { useMutation } from '../../../lib/query.ts';
import { Button, IconButton } from '../../../ui/Button.tsx';
import { CopyValue } from '../../../ui/CopyValue.tsx';
import { messageOf } from '../../../ui/feedback.tsx';
import { Select, TextInput } from '../../../ui/fields.tsx';
import { toast } from '../../../ui/Toast.tsx';
import { Callout, Host, useAccountWrite } from './kit.tsx';
import type { Domain } from './status.tsx';

/** One record to create at the owner's provider, each value one tap to copy. */
export function DnsRecordView({
  type,
  name,
  value,
}: {
  type: string;
  name: string;
  value: string;
}) {
  return (
    <div className="rounded-md ring-1 ring-line">
      <p className="t-caption flex items-center gap-2 border-b border-line px-3 py-2 font-semibold">
        <span className="rounded-sm bg-sunken px-1.5 py-0.5 font-mono">{type}</span>
        registro {type}
      </p>
      <div className="grid gap-3 p-3 sm:grid-cols-2">
        <CopyValue label="Nome" value={name} copied="Nome copiado" />
        <CopyValue
          label={type === 'CNAME' ? 'Aponta para' : 'Valor'}
          value={value}
          copied="Valor copiado"
        />
      </div>
    </div>
  );
}

/** method cname: the two records at the owner's provider */
export function CnameRecords({ d, edgeIpv4 }: { d: Domain; edgeIpv4: string | null }) {
  return (
    <>
      <div>
        <p className="font-semibold">Crie estes dois registros</p>
        <p className="t-body mt-0.5 text-muted">
          No painel de onde você comprou o domínio (Registro.br, GoDaddy, Hostinger…), procure por
          DNS ou zona de DNS e adicione:
        </p>
      </div>
      <div className="space-y-3">
        <DnsRecordView type="CNAME" name={d.host} value={d.cnameTarget} />
        <DnsRecordView type="TXT" name={d.txtName} value={d.txtValue} />
      </div>
      {edgeIpv4 && d.aliasHost === `www.${d.host}` ? (
        <p className="t-body text-muted">
          Se o seu provedor não aceita CNAME na raiz, use um registro A para{' '}
          <span className="tnum font-mono text-ink">{edgeIpv4}</span>.
        </p>
      ) : null}
      <p className="t-caption text-muted">
        Depois de salvar, pode levar algumas horas até a internet toda enxergar.
      </p>
    </>
  );
}

/** method ns: the pair to put in registro.br's "Servidores DNS" */
export function NameServers({ d }: { d: Domain }) {
  if (!d.nameServers.length)
    return (
      <p className="t-body flex items-center gap-2 text-muted" role="status">
        <ArrowsClockwise className="size-5 shrink-0 animate-spin" aria-hidden />
        Preparando os servidores…
      </p>
    );
  return (
    <div className="space-y-3">
      {d.dnssecSigned ? (
        <Callout tone="danger" icon={WarningOctagon} title="Desligue o DNSSEC antes">
          Seu domínio está com DNSSEC ligado no Registro.br. Desligue o DNSSEC antes de trocar os
          servidores, ou o domínio para de funcionar.
        </Callout>
      ) : null}
      <p className="t-body">
        No Registro.br, em Servidores DNS, troque os servidores por estes dois:
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {d.nameServers.map((ns, i) => (
          <CopyValue key={ns} label={`Servidor ${i + 1}`} value={ns} copied="Servidor copiado" />
        ))}
      </div>
      <p className="t-caption text-muted">
        A troca pode levar algumas horas para valer. Conferimos sozinhos.
      </p>
    </div>
  );
}

// ── the owner's records in a zone Venduá hosts ──────────────────────────────

const TYPES: DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT'];
const TYPE_OPTIONS = TYPES.map((t) => ({ value: t, label: t }));
const MAX = 50;

type Row = Omit<DnsRecord, 'priority'> & { priority?: number | undefined; key: number };
type RowErr = Partial<Record<'name' | 'value' | 'priority', string | undefined>>;
let seq = 0;
const rowOf = (r: DnsRecord): Row => ({ ...r, key: ++seq });
const same = (a: Omit<DnsRecord, 'priority'>, b: DnsRecord) =>
  a.type === b.type && a.name === b.name && a.value === b.value;

/** '@', or the name relative to the domain (a pasted full name is cut down) */
function relName(name: string, host: string) {
  const n = name.trim().toLowerCase().replace(/\.$/, '');
  if (!n || n === host) return n ? '@' : '';
  return n.endsWith(`.${host}`) ? n.slice(0, -host.length - 1) : n;
}

function check(r: Row, host: string): RowErr {
  const e: RowErr = {};
  const name = relName(r.name, host);
  if (!name) e.name = 'Falta o nome (@ para o domínio).';
  else if (!/^(@|\*|[a-z0-9_*]([a-z0-9_.-]*[a-z0-9_])?)$/.test(name))
    e.name = 'Use letras, números, ponto, hífen ou _.';
  else if ((name === '@' || name === 'www') && ['A', 'AAAA', 'CNAME'].includes(r.type))
    e.name = 'Esse nome é da loja: a Venduá cuida dele.';
  const v = r.value.trim();
  if (!v) e.value = 'Falta o valor.';
  else if (r.type === 'A' && !/^(\d{1,3}\.){3}\d{1,3}$/.test(v))
    e.value = 'Use um IPv4, como 1.2.3.4.';
  else if (r.type === 'AAAA' && !v.includes(':')) e.value = 'Use um IPv6.';
  if (
    r.type === 'MX' &&
    !(Number.isInteger(r.priority) && r.priority! >= 0 && r.priority! <= 65535)
  )
    e.priority = 'Prioridade de 0 a 65535.';
  return e;
}

const clean = (rows: Row[], host: string): DnsRecord[] =>
  rows.map(({ type, name, value, priority }) => ({
    type,
    name: relName(name, host),
    value: value.trim(),
    ...(type === 'MX' ? { priority: priority ?? 10 } : {}),
  }));

/**
 * The records that keep working once the domain moves to Venduá's servers (e-mail above all):
 * found by Core, completed by the owner, confirmed once ("Esses são todos"), editable after.
 */
export function RecordsEditor({ d, confirm }: { d: Domain; confirm: boolean }) {
  const [rows, setRows] = useState<Row[]>(() => d.records.map(rowOf));
  const [searched, setSearched] = useState(d.records.length > 0);
  const [dirty, setDirty] = useState(false);
  const [shown, setShown] = useState(false);
  const [served, setServed] = useState<Record<number, RowErr>>({});
  const [added, setAdded] = useState<number | null>(null);

  const edit = (key: number, p: Partial<Omit<Row, 'key'>>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
    setServed(({ [key]: _, ...rest }) => rest);
    setDirty(true);
  };
  const discover = useMutation({
    mutationFn: () => api.discoverDomainRecords(d.id),
    onSuccess: ({ records }) => {
      setSearched(true);
      const fresh = records.filter((f) => !rows.some((r) => same(r, f)));
      if (fresh.length) {
        setRows((rs) => [...rs, ...fresh.map(rowOf)]);
        setDirty(true);
      }
      toast(
        records.length
          ? `Achamos ${plural(records.length, 'registro', 'registros')}`
          : 'Não achamos registros. Se o domínio tem e-mail, adicione os dele.',
        { tone: records.length ? 'ok' : 'info' },
      );
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const save = useAccountWrite(
    (records: DnsRecord[]) => api.saveDomainRecords(d.id, records, confirm || undefined),
    () => {
      setDirty(false);
      setShown(false);
      toast(confirm ? 'Registros conferidos ✓' : 'Registros salvos ✓');
    },
    (e) => {
      const m =
        e instanceof ApiError
          ? /^records\.(\d+)\.(name|value|priority)$/.exec(e.field ?? '')
          : null;
      const row = m ? rows[Number(m[1])] : undefined;
      if (m && row) setServed({ [row.key]: { [m[2]!]: e instanceof Error ? e.message : '' } });
      else toast.error(messageOf(e));
    },
  );
  const errs = Object.fromEntries(rows.map((r) => [r.key, check(r, d.host)]));
  const ok = rows.every((r) => !Object.keys(errs[r.key]!).length);

  return (
    <div className="space-y-4">
      {rows.length ? (
        <ul className="space-y-3" aria-label="registros do domínio">
          {rows.map((r, i) => {
            // a field's problem shows once it has something in it, or after a save attempt
            const all = errs[r.key]!;
            const e: RowErr = {
              ...(shown || r.name ? { name: all.name } : {}),
              ...(shown || r.value ? { value: all.value } : {}),
              priority: all.priority,
              ...served[r.key],
            };
            const n = i + 1;
            return (
              <li key={r.key} className="space-y-2 rounded-md p-3 ring-1 ring-line">
                <div className="flex items-start gap-2">
                  <div className="w-32 shrink-0">
                    <Select
                      label={`Tipo do registro ${n}`}
                      value={r.type}
                      options={TYPE_OPTIONS}
                      onChange={(t) => edit(r.key, { type: t as DnsRecordType })}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <TextInput
                      aria-label={`Nome do registro ${n}`}
                      autoFocus={added === r.key}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={253}
                      placeholder="@ ou mail"
                      value={r.name}
                      aria-invalid={e.name ? true : undefined}
                      onChange={(ev) => edit(r.key, { name: ev.target.value })}
                      className="font-mono"
                    />
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  {r.type === 'MX' ? (
                    <div className="w-24 shrink-0">
                      <TextInput
                        aria-label={`Prioridade do registro ${n}`}
                        inputMode="numeric"
                        maxLength={5}
                        placeholder="10"
                        value={r.priority === undefined ? '' : String(r.priority)}
                        aria-invalid={e.priority ? true : undefined}
                        onChange={(ev) => {
                          const v = ev.target.value.replace(/\D/g, '');
                          edit(r.key, { priority: v ? Number(v) : undefined });
                        }}
                        className="tnum"
                      />
                    </div>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <TextInput
                      aria-label={`Valor do registro ${n}`}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={2048}
                      placeholder={r.type === 'MX' ? 'mx.provedor.com' : 'valor'}
                      value={r.value}
                      aria-invalid={e.value ? true : undefined}
                      onChange={(ev) => edit(r.key, { value: ev.target.value })}
                      className="font-mono"
                    />
                  </div>
                  <IconButton
                    label={`remover o registro ${n}`}
                    onClick={() => {
                      setRows((rs) => rs.filter((x) => x.key !== r.key));
                      setDirty(true);
                    }}
                  >
                    <Trash />
                  </IconButton>
                </div>
                {e.name || e.value || e.priority ? (
                  <p className="t-caption text-danger" role="alert">
                    {[e.name, e.priority, e.value].filter(Boolean).join(' ')}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : searched ? (
        <p className="t-body text-muted">
          Nenhum registro. Se o domínio tem e-mail, adicione os dele.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={searched ? 'secondary' : 'primary'}
          icon={<MagnifyingGlass />}
          loading={discover.isPending}
          onClick={() => discover.mutate()}
        >
          {searched ? 'procurar de novo' : 'procurar registros'}
        </Button>
        {rows.length < MAX ? (
          <Button
            variant="ghost"
            icon={<Plus />}
            onClick={() => {
              const r = rowOf({ type: 'TXT', name: '', value: '' });
              setRows((rs) => [...rs, r]);
              setAdded(r.key);
              setSearched(true);
            }}
          >
            adicionar registro
          </Button>
        ) : null}
      </div>

      {confirm ? (
        searched ? (
          <div className="space-y-2 border-t border-line pt-4">
            <p className="t-body text-muted">
              Na dúvida, confira com quem cuida do seu e-mail antes de confirmar.
            </p>
            <Button
              icon={<Check weight="bold" />}
              loading={save.isPending}
              onClick={() => (ok ? save.mutate(clean(rows, d.host)) : setShown(true))}
            >
              Esses são todos
            </Button>
          </div>
        ) : null
      ) : dirty ? (
        <Button
          icon={<Check weight="bold" />}
          loading={save.isPending}
          onClick={() => (ok ? save.mutate(clean(rows, d.host)) : setShown(true))}
        >
          salvar registros
        </Button>
      ) : null}
    </div>
  );
}
