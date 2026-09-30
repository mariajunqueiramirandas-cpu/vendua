import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { ApiError, type Lead } from '@/lib/api.ts';
import { useDebounced } from '@/lib/hooks.ts';
import { errorMessage } from '@/lib/query.ts';
import { Button } from '@/components/ui/button.tsx';
import { Field, Input, Select } from '@/components/ui/input.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';
import { useControlPlans } from '@/features/stores/queries.ts';
import { STORE_SUFFIX } from './bits.tsx';
import { useCreateProvisioning, useSlugStatus } from './queries.ts';

type FieldKey = 'storeName' | 'slug' | 'planId' | 'ownerName' | 'ownerPhone' | 'ownerEmail';
type Form = Record<FieldKey, string>;

/** mirrors normalizeSlug (core) so the prefill matches what Core will store */
export const slugify = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');

const FIELD_ERROR: Record<FieldKey, string> = {
  storeName: 'o nome precisa de 2 a 60 letras',
  slug: 'use 3 a 40 letras, números ou -',
  planId: 'escolha um plano',
  ownerName: 'o nome do dono precisa de 2 a 80 letras',
  ownerPhone: 'whatsapp com DDD, ex.: (11) 99999-0000',
  ownerEmail: 'email inválido',
};

function initial(lead: Lead): Form {
  const storeName = (lead.businessName || lead.name).slice(0, 60);
  return {
    storeName,
    slug: slugify(storeName),
    planId: '',
    ownerName: lead.name.slice(0, 80),
    ownerPhone: lead.whatsapp ?? lead.phone ?? '',
    ownerEmail: lead.email ?? '',
  };
}

function SlugHint({ slug, onUse }: { slug: string; onUse: (s: string) => void }) {
  const deb = useDebounced(slug, 300);
  const q = useSlugStatus(deb);
  if (slug.length < 3) return <>{`${slug || 'endereco'}${STORE_SUFFIX}`}</>;
  const st = deb === slug ? q.data : undefined;
  if (!st) return <span>verificando…</span>;
  if (st.available)
    return (
      <span className="inline-flex items-center gap-1 text-success">
        <Check className="size-3.5" /> {st.slug}
        {STORE_SUFFIX} está livre
      </span>
    );
  const why =
    st.reason === 'reserved'
      ? 'é reservado'
      : st.reason === 'invalid'
        ? 'não vale — use letras, números ou -'
        : 'já existe';
  return (
    <span className="text-warning-foreground">
      {st.slug}
      {STORE_SUFFIX} {why}
      {st.suggestion && (
        <>
          {' — '}
          <button
            type="button"
            className="font-medium text-foreground underline underline-offset-2"
            onClick={() => onUse(st.suggestion!)}
          >
            usar {st.suggestion}
          </button>
        </>
      )}
    </span>
  );
}

export function CreateStoreSheet({
  lead,
  open,
  onClose,
}: {
  lead: Lead;
  open: boolean;
  onClose: () => void;
}) {
  const [f, setF] = useState<Form>(() => initial(lead));
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const plans = useControlPlans().data;
  const create = useCreateProvisioning();

  useEffect(() => {
    if (!open) return;
    setF(initial(lead));
    setSlugTouched(false);
    setErrors({});
    setFormError(null);
  }, [open, lead.id]);
  // default plan: the first public one, once plans land
  useEffect(() => {
    if (!f.planId && plans?.length) {
      const first = [...plans].sort((a, b) => a.sort - b.sort).find((p) => p.public) ?? plans[0]!;
      setF((v) => ({ ...v, planId: first.id }));
    }
  }, [plans, f.planId]);

  const set = (k: FieldKey, v: string) => {
    setErrors((e) => ({ ...e, [k]: undefined }));
    setF((cur) => {
      const next = { ...cur, [k]: v };
      if (k === 'storeName' && !slugTouched) next.slug = slugify(v);
      return next;
    });
  };

  const submit = () => {
    setFormError(null);
    create.mutate(
      {
        leadId: lead.id,
        slug: f.slug,
        storeName: f.storeName.trim(),
        planId: f.planId,
        ownerName: f.ownerName.trim(),
        ownerPhone: f.ownerPhone.trim(),
        ownerEmail: f.ownerEmail.trim(),
      },
      {
        onSuccess: onClose,
        onError: (e) => {
          if (e instanceof ApiError) {
            if (e.code === 'SLUG_TAKEN')
              return setErrors({ slug: 'esse endereço acabou de ser usado' });
            if (e.code === 'INVALID_SLUG')
              return setErrors({
                slug:
                  e.details?.reason === 'reserved' ? 'esse endereço é reservado' : FIELD_ERROR.slug,
              });
            if (e.code === 'LEAD_HAS_STORE') return setFormError('esse lead já tem uma loja');
            const field = e.details?.field as FieldKey | undefined;
            if (field && field in FIELD_ERROR) return setErrors({ [field]: FIELD_ERROR[field] });
          }
          setFormError(errorMessage(e));
        },
      },
    );
  };

  const input = (k: FieldKey) => ({
    id: `new-store-${k}`,
    value: f[k],
    'aria-invalid': !!errors[k],
    className: 'aria-invalid:border-destructive',
    onChange: (e: { target: { value: string } }) => set(k, e.target.value),
  });
  const err = (k: FieldKey) =>
    errors[k] && <span className="text-destructive-foreground">{errors[k]}</span>;
  const ready = f.storeName.trim().length >= 2 && f.slug.length >= 3 && !!f.planId;

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="criar loja"
      description={`para ${lead.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="md:mr-auto">
            cancelar
          </Button>
          <Button type="submit" form="new-store" disabled={!ready || create.isPending}>
            {create.isPending ? 'criando…' : 'criar loja'}
          </Button>
        </>
      }
    >
      <form
        id="new-store"
        className="flex flex-col gap-3 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) submit();
        }}
      >
        <Field label="nome da loja" htmlFor="new-store-storeName" hint={err('storeName')}>
          <Input {...input('storeName')} maxLength={60} autoComplete="off" />
        </Field>
        <Field
          label="endereço"
          htmlFor="new-store-slug"
          hint={
            errors.slug ? (
              err('slug')
            ) : (
              <SlugHint
                slug={f.slug}
                onUse={(s) => {
                  setSlugTouched(true);
                  set('slug', s);
                }}
              />
            )
          }
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <Input
              {...input('slug')}
              maxLength={40}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setSlugTouched(true);
                set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
              }}
            />
            <span className="shrink-0 text-xs text-muted-foreground">{STORE_SUFFIX}</span>
          </div>
        </Field>
        <Field label="plano" htmlFor="new-store-planId" hint={err('planId')}>
          <Select
            id="new-store-planId"
            value={f.planId}
            onChange={(e) => set('planId', e.target.value)}
            className="w-full"
          >
            {!plans && <option value="">carregando…</option>}
            {plans?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.public ? '' : ' (interno)'}
              </option>
            ))}
          </Select>
        </Field>

        <div
          role="group"
          aria-labelledby="new-store-owner"
          className="flex flex-col gap-3 border-t pt-3"
        >
          <h3
            id="new-store-owner"
            className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
          >
            dono
          </h3>
          <Field label="nome" htmlFor="new-store-ownerName" hint={err('ownerName')}>
            <Input {...input('ownerName')} maxLength={80} autoComplete="off" />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="whatsapp" htmlFor="new-store-ownerPhone" hint={err('ownerPhone')}>
              <Input {...input('ownerPhone')} type="tel" inputMode="tel" maxLength={40} />
            </Field>
            <Field label="email" htmlFor="new-store-ownerEmail" hint={err('ownerEmail')}>
              <Input {...input('ownerEmail')} type="email" inputMode="email" maxLength={200} />
            </Field>
          </div>
        </div>

        {formError && <p className="text-sm text-destructive-foreground">{formError}</p>}
        <p className="text-xs text-muted-foreground">
          a loja nasce pausada até o dono ativar o plano no painel. o convite vai por whatsapp e
          email quando ela estiver no ar.
        </p>
      </form>
    </ResponsiveSheet>
  );
}
