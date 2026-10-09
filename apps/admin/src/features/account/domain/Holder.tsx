import { ArrowLeft, SealCheck } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, type Account } from '../../../lib/api.ts';
import { maskDocument, maskPhone, parseDocument, parsePhone } from '../../../lib/parse.ts';
import { useSession } from '../../../lib/session.ts';
import { Button } from '../../../ui/Button.tsx';
import { messageOf } from '../../../ui/feedback.tsx';
import { DocumentInput, Field, PhoneInput, Select, TextInput } from '../../../ui/fields.tsx';
import { Notice } from '../../../ui/Notice.tsx';
import { toast } from '../../../ui/Toast.tsx';
import { DOCUMENT_ERR, EMAIL_RE } from '../../auth/pending.ts';
import { Host, useAccountWrite } from './kit.tsx';

const UFS =
  'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const UF_OPTIONS = [{ value: '', label: 'UF' }, ...UFS.map((u) => ({ value: u, label: u }))];

type F = {
  document: string;
  name: string;
  email: string;
  phone: string;
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
};
type K = keyof F;
const KEYS = new Set<string>([
  'document',
  'name',
  'email',
  'phone',
  'postalCode',
  'street',
  'number',
  'complement',
  'district',
  'city',
  'state',
]);

// the API's limits; the CNPJ record can be longer, so a pre-filled value is cut to fit
const MAX = { name: 200, street: 120, number: 20, complement: 60, district: 60, city: 60 };
const fit = (k: keyof typeof MAX, v: string) => v.trim().slice(0, MAX[k]).trim();

const cepMask = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};
const digits = (v: string) => v.replace(/\D/g, '');

function problems(f: F): Partial<Record<K, string>> {
  const e: Partial<Record<K, string>> = {};
  if (!parseDocument(f.document)) e.document = DOCUMENT_ERR;
  if (f.name.trim().length < 3) e.name = 'Escreva o nome como está no documento.';
  if (!EMAIL_RE.test(f.email.trim())) e.email = 'Confira o e-mail.';
  if (!parsePhone(f.phone)) e.phone = 'Confira o telefone com DDD.';
  if (digits(f.postalCode).length !== 8) e.postalCode = 'O CEP tem 8 números.';
  if (!f.street.trim()) e.street = 'Falta a rua.';
  if (!f.number.trim()) e.number = 'Falta o número (ou s/n).';
  if (!f.district.trim()) e.district = 'Falta o bairro.';
  if (!f.city.trim()) e.city = 'Falta a cidade.';
  if (!UFS.includes(f.state)) e.state = 'Escolha a UF.';
  return e;
}

/**
 * Who holds the .com.br: the store's CNPJ (its public record pre-fills the rest), or the
 * owner's CPF. A .br holder can't be edited later, so the owner confirms the authorization.
 */
export function HolderForm({ a, host, onBack }: { a: Account; host: string; onBack: () => void }) {
  const session = useSession();
  const s = a.subscription;
  const [f, setF] = useState<F>(() => ({
    document: maskDocument(s?.payerDocument ?? ''),
    name: '',
    email: session.user.email ?? s?.payerEmail ?? '',
    phone: maskPhone(parsePhone(session.user.phone) ?? ''),
    postalCode: '',
    street: '',
    number: '',
    complement: '',
    district: '',
    city: '',
    state: '',
  }));
  // what the owner typed is theirs: the CNPJ lookup only fills the rest
  const typed = useRef(new Set<K>());
  const [seen, setSeen] = useState(new Set<K>());
  const [served, setServed] = useState<Partial<Record<K, string>>>({});
  const [ok, setOk] = useState(false);
  const [okErr, setOkErr] = useState(false);
  const [formErr, setFormErr] = useState<{ text: string; pickAgain: boolean } | null>(null);

  const doc = parseDocument(f.document);
  const cnpj = doc && doc.length === 14 ? doc : null;
  const company = cnpj !== null || digits(f.document).length > 11 || /[A-Z]/i.test(f.document);
  const lookup = useQuery({
    queryKey: ['domain-holder', cnpj],
    queryFn: () => api.domainHolder(cnpj!),
    enabled: !!cnpj,
    staleTime: Infinity,
    retry: false,
  });
  const found = lookup.data && lookup.data.document === cnpj ? lookup.data : null;
  useEffect(() => {
    if (!found) return;
    const fill: Partial<F> = {
      ...(found.name ? { name: fit('name', found.name) } : {}),
      ...(found.address
        ? {
            street: fit('street', found.address.street),
            number: fit('number', found.address.number),
            complement: fit('complement', found.address.complement ?? ''),
            district: fit('district', found.address.district),
            city: fit('city', found.address.city),
            state: found.address.state,
            postalCode: cepMask(found.address.postalCode),
          }
        : {}),
    };
    setF((cur) => {
      const next = { ...cur };
      for (const [k, v] of Object.entries(fill) as [K, string][])
        if (!typed.current.has(k)) next[k] = v;
      return next;
    });
  }, [found]);

  const set = (k: K, v: string) => {
    typed.current.add(k);
    setF((cur) => ({ ...cur, [k]: v }));
    setServed(({ [k]: _, ...rest }) => rest);
    setFormErr(null);
  };
  const errs = problems(f);
  const valid = !Object.keys(errs).length;
  const errOf = (k: K) => served[k] ?? (seen.has(k) ? errs[k] : undefined) ?? null;
  const blur = (k: K) => () => setSeen((cur) => (cur.has(k) ? cur : new Set(cur).add(k)));

  const order = useAccountWrite(
    () =>
      api.orderDomain({
        host,
        holder: {
          document: doc!,
          name: f.name.trim(),
          email: f.email.trim(),
          phone: parsePhone(f.phone)!,
          address: {
            street: f.street.trim(),
            number: f.number.trim(),
            ...(f.complement.trim() ? { complement: f.complement.trim() } : {}),
            district: f.district.trim(),
            city: f.city.trim(),
            state: f.state,
            postalCode: digits(f.postalCode),
          },
        },
        authorize: true,
      }),
    () => toast(`Pedido de ${host} feito ✓`),
    (e) => {
      const key = e instanceof ApiError ? e.field?.split('.').pop() : undefined;
      if (e instanceof ApiError && e.code === 'DOMAIN_TAKEN')
        setFormErr({
          text: 'Esse nome acabou de ser registrado por outra pessoa. Escolha outro.',
          pickAgain: true,
        });
      else if (e instanceof ApiError && e.code === 'INVALID_DOMAIN')
        setFormErr({ text: 'Esse nome não pode ser registrado. Escolha outro.', pickAgain: true });
      else if (e instanceof ApiError && e.code === 'AUTHORIZATION_REQUIRED') setOkErr(true);
      else if (e instanceof ApiError && e.status === 422 && key && KEYS.has(key))
        setServed({ [key]: e.message });
      else setFormErr({ text: messageOf(e), pickAgain: false });
    },
  );

  const text = (k: K, label: string, props: { max: number; optional?: boolean; auto?: string }) => (
    <Field label={label} htmlFor={`holder-${k}`} error={errOf(k)} optional={!!props.optional}>
      <TextInput
        id={`holder-${k}`}
        maxLength={props.max}
        value={f[k]}
        autoCapitalize={props.auto}
        aria-invalid={errOf(k) ? true : undefined}
        onBlur={blur(k)}
        onChange={(e) => set(k, e.target.value)}
      />
    </Field>
  );
  const name = f.name.trim() || 'o dono';

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return setSeen(new Set(Object.keys(errs) as K[]));
        if (!ok) return setOkErr(true);
        order.mutate(undefined);
      }}
    >
      <div className="space-y-2">
        <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={onBack} className="-ml-3">
          outro nome
        </Button>
        <h3 className="t-title-2 break-words">
          Quem vai ser o dono de <Host h={host} />
        </h3>
        <p className="t-body text-muted">
          O domínio fica no nome da empresa (CNPJ). Sem CNPJ, use o CPF do responsável: aí o nome e
          parte do CPF aparecem na consulta pública do Registro.br.
        </p>
      </div>

      <Field
        label="CNPJ ou CPF"
        htmlFor="holder-document"
        error={errOf('document')}
        helper={
          lookup.isFetching
            ? 'Buscando os dados do CNPJ…'
            : found?.name
              ? 'Preenchemos com os dados públicos do CNPJ. Confira.'
              : undefined
        }
      >
        <DocumentInput
          id="holder-document"
          value={f.document}
          invalid={!!errOf('document')}
          onBlur={blur('document')}
          onChange={(v) => set('document', v)}
        />
      </Field>
      {text('name', company ? 'Razão social' : 'Nome completo', { max: MAX.name, auto: 'words' })}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="E-mail" htmlFor="holder-email" error={errOf('email')}>
          <TextInput
            id="holder-email"
            type="email"
            maxLength={254}
            value={f.email}
            aria-invalid={errOf('email') ? true : undefined}
            onBlur={blur('email')}
            onChange={(e) => set('email', e.target.value)}
          />
        </Field>
        <Field label="Telefone" htmlFor="holder-phone" error={errOf('phone')}>
          <div onBlur={blur('phone')}>
            <PhoneInput id="holder-phone" value={f.phone} onChange={(v) => set('phone', v)} />
          </div>
        </Field>
      </div>

      <fieldset className="space-y-5">
        <legend className="t-label mb-4">Endereço</legend>
        <div className="grid grid-cols-6 gap-x-3 gap-y-5">
          <Cell className="col-span-3 sm:col-span-2">
            <Field label="CEP" htmlFor="holder-postalCode" error={errOf('postalCode')}>
              <TextInput
                id="holder-postalCode"
                inputMode="numeric"
                maxLength={9}
                placeholder="00000-000"
                value={f.postalCode}
                aria-invalid={errOf('postalCode') ? true : undefined}
                onBlur={blur('postalCode')}
                onChange={(e) => set('postalCode', cepMask(e.target.value))}
                className="tnum"
              />
            </Field>
          </Cell>
          <Cell className="col-span-6 sm:col-span-4">
            {text('street', 'Rua', { max: MAX.street })}
          </Cell>
          <Cell className="col-span-2">{text('number', 'Número', { max: MAX.number })}</Cell>
          <Cell className="col-span-4">
            {text('complement', 'Complemento', { max: MAX.complement, optional: true })}
          </Cell>
          <Cell className="col-span-6 sm:col-span-2">
            {text('district', 'Bairro', { max: MAX.district })}
          </Cell>
          <Cell className="col-span-4 sm:col-span-3">
            {text('city', 'Cidade', { max: MAX.city })}
          </Cell>
          <Cell className="col-span-2 sm:col-span-1">
            <Field label="UF" htmlFor="holder-state" error={errOf('state')}>
              <div onBlur={blur('state')}>
                <Select
                  id="holder-state"
                  value={f.state}
                  options={UF_OPTIONS}
                  onChange={(v) => set('state', v)}
                />
              </div>
            </Field>
          </Cell>
        </div>
      </fieldset>

      <div className="space-y-1">
        <label className="t-body flex min-h-12 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={ok}
            aria-invalid={okErr && !ok ? true : undefined}
            onChange={(e) => {
              setOk(e.target.checked);
              setOkErr(false);
            }}
            className="size-5 shrink-0 accent-primary"
          />
          <span className="min-w-0">
            Confirmo que {name} autoriza registrar {host} no nome dele.
          </span>
        </label>
        {okErr && !ok ? (
          <p className="t-caption text-danger" role="alert">
            Marque a confirmação para registrar.
          </p>
        ) : null}
      </div>

      {s?.status !== 'active' && s?.status !== 'past_due' ? (
        <p className="t-body text-muted">
          O registro acontece assim que o primeiro pagamento do plano for confirmado.
        </p>
      ) : null}

      {formErr ? (
        <Notice
          tone="danger"
          role="alert"
          title={formErr.text}
          action={
            formErr.pickAgain ? (
              <Button variant="secondary" onClick={onBack}>
                escolher outro nome
              </Button>
            ) : undefined
          }
        />
      ) : null}

      <div className="space-y-2">
        <Button
          type="submit"
          block
          icon={<SealCheck />}
          loading={order.isPending}
          disabled={!valid || !ok}
          className="!h-auto min-h-12 !whitespace-normal py-3 text-center [overflow-wrap:anywhere] sm:w-auto"
        >
          registrar {host}
        </Button>
        {!valid || !ok ? (
          <p className="t-caption text-muted">Preencha tudo e marque a confirmação.</p>
        ) : null}
      </div>
    </form>
  );
}

const Cell = ({ className, children }: { className: string; children: ReactNode }) => (
  <div className={className}>{children}</div>
);
