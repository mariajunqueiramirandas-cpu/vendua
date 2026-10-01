import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Loader2 } from 'lucide-react';
import { api, ApiError, type ImportSection, type Lead, type MenuImport } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox, Segmented } from '@/components/ui/controls.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';

// Staff side of the menu import (docs/menu-import.md §2): the lead's old menu goes into the
// store "criar loja" made, so the owner's invite opens on a store that already sells. Pix and
// payment methods stay with the owner (the admin's onboarding asks for them).

const SECTIONS: [ImportSection, string, string][] = [
  ['profile', 'perfil e visual', 'nome, logo, capa, cor, whatsapp, instagram, endereço'],
  ['hours', 'horários', 'os turnos de cada dia'],
  ['delivery', 'entrega e retirada', 'retirada, entrega, regiões, pedido mínimo, preparo'],
];

const READ_ERROR: Record<string, string> = {
  NOT_FOUND: 'a loja não existe nesse link',
  BLOCKED: 'a plataforma bloqueou a leitura agora — tente mais tarde',
  UNREADABLE: 'a loja abriu mas o cardápio veio num formato que não entendemos',
  TOO_LARGE: 'cardápio grande demais (mais de 1000 produtos)',
  TIMEOUT: 'a plataforma demorou demais para responder',
};

/** Staff words for the commonest notes; the rest show their code. */
const NOTE: Record<string, string> = {
  hidden_items: 'categoria vazia (itens ocultos na plataforma)',
  loyalty: 'programa de pontos',
  referral: 'indicação',
  instagram_points: 'pontos por seguir no instagram',
  birthday_message: 'mensagem de aniversário',
  miss_you_message: 'mensagem de saudade',
  upsell: 'sugestão no fim do pedido',
  time_slots: 'horários de agendamento',
  pix_beneficiary_shortened: 'nome do recebedor pix encurtado',
  payment_method: 'forma de pagamento sem igual',
  payment_adjustment: 'desconto/acréscimo por pagamento',
  options_unreadable: 'opções ilegíveis (produto oculto)',
  pizza_pricing: 'regra de sabores sem igual (produto oculto)',
  sold_by_weight: 'vendido por peso (produto oculto)',
  link_discount: 'desconto só pelo link do produto',
  delivery_fee_later: 'taxa de entrega combinada depois',
  delivery_flat_fee: 'taxa fixa para qualquer endereço',
  promo_unreadable: 'desconto ilegível (produto oculto)',
  delivery_fees_unreadable: 'taxas de entrega ilegíveis',
  photo_failed: 'foto não veio',
  second_price: 'dois preços (produto oculto)',
  delivery_gap: 'faixa de km sem entrega',
  free_delivery_rule: 'regra de entrega grátis',
};

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function LeadImport({
  lead,
  slug,
  open,
  onClose,
}: {
  lead: Lead;
  slug: string;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [id, setId] = useState<string | null>(null);
  const [url, setUrl] = useState(() =>
    lead.website && /instadelivery\.com\.br/i.test(lead.website) ? lead.website : '',
  );
  const [sections, setSections] = useState<Set<ImportSection>>(
    () => new Set(['profile', 'hours', 'delivery']),
  );
  const [mode, setMode] = useState<'add' | 'replace'>('add');
  const [authorized, setAuthorized] = useState(false);

  const recent = useQuery({
    queryKey: qk.storeImports(slug),
    queryFn: () => api.storeImports(slug),
    enabled: open,
    select: (r) => r.imports,
  });
  // reopen on the import still being read or waiting to be applied
  useEffect(() => {
    if (id || !recent.data) return;
    const live = recent.data.find((i) => i.status === 'reading' || i.status === 'ready');
    if (live) setId(live.id);
  }, [recent.data, id]);

  const imp = useQuery({
    queryKey: qk.menuImport(id ?? ''),
    queryFn: () => api.menuImport(id!),
    enabled: open && !!id,
    // the import job doesn't publish control events: poll only while something is moving
    refetchInterval: (q) => {
      const d = q.state.data;
      if (d?.status === 'reading') return 1500;
      if (d?.status === 'applied' && !d.images.finished) return 2500;
      return false;
    },
  });

  const start = useMutation({
    mutationFn: () => api.startStoreImport(slug, url.trim()),
    onSuccess: (r) => setId(r.id),
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'IMPORT_IN_PROGRESS' && e.details?.id) {
        setId(String(e.details.id));
        return;
      }
      const platform =
        e instanceof ApiError && typeof e.details?.platform === 'string' ? e.details.platform : '';
      toast.error(
        e instanceof ApiError && e.code === 'IMPORT_UNSUPPORTED'
          ? platform
            ? `ainda não lemos ${platform}`
            : 'link não reconhecido — por enquanto só instadelivery'
          : e instanceof ApiError && e.code === 'IMPORT_BLOCKED'
            ? `${platform} bloqueia leitura externa`
            : errorMessage(e),
      );
    },
  });
  const apply = useMutation({
    mutationFn: (i: MenuImport) => api.applyMenuImport(i.id, { mode, sections: [...sections] }),
    onSuccess: (n) => {
      qc.setQueryData(qk.menuImport(n.id), n);
      void qc.invalidateQueries({ queryKey: qk.storeImports(slug) });
      toast.success(`${n.result?.products ?? 0} produtos importados`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const discard = useMutation({
    mutationFn: (i: MenuImport) => api.discardMenuImport(i.id),
    onSettled: () => {
      setId(null);
      void qc.invalidateQueries({ queryKey: qk.storeImports(slug) });
    },
  });

  const d = imp.data;
  const reset = () => {
    setId(null);
    setAuthorized(false);
  };

  const footer =
    d?.status === 'ready' ? (
      <div className="flex w-full items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => discard.mutate(d)}>
          descartar
        </Button>
        <Button
          className="ml-auto"
          disabled={!authorized || apply.isPending}
          onClick={() => apply.mutate(d)}
        >
          {apply.isPending ? 'importando…' : `importar ${d.counts?.products ?? 0} produtos`}
        </Button>
      </div>
    ) : d?.status === 'applied' ? (
      <Button className="ml-auto" onClick={onClose}>
        fechar
      </Button>
    ) : !id || d?.status === 'failed' || d?.status === 'expired' ? (
      <Button
        className="ml-auto"
        disabled={url.trim().length < 4 || start.isPending}
        onClick={() => {
          reset();
          start.mutate();
        }}
      >
        {start.isPending ? 'enviando…' : 'ler cardápio'}
      </Button>
    ) : null;

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="importar cardápio"
      description="traz produtos, fotos e configurações da loja antiga para a loja da venduá"
      width="max-w-lg"
      footer={footer}
    >
      <div className="flex flex-col gap-3 text-sm">
        {!id || d?.status === 'failed' || d?.status === 'expired' ? (
          <>
            <Field
              label="link da loja antiga"
              htmlFor="lead-import-url"
              hint="por enquanto: instadelivery"
            >
              <Input
                id="lead-import-url"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="instadelivery.com.br/loja"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </Field>
            {d?.status === 'failed' && (
              <p className="text-xs text-destructive">
                não deu: {READ_ERROR[d.errorCode ?? ''] ?? 'erro ao ler'}
              </p>
            )}
            {d?.status === 'expired' && (
              <p className="text-xs text-warning-foreground">prévia vencida — leia de novo</p>
            )}
          </>
        ) : !d || d.status === 'reading' ? (
          <p className="flex items-center gap-2 text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" /> lendo o cardápio…
          </p>
        ) : d.status === 'ready' ? (
          <Ready
            d={d}
            sections={sections}
            setSections={setSections}
            mode={mode}
            setMode={setMode}
            authorized={authorized}
            setAuthorized={setAuthorized}
          />
        ) : (
          <Applied d={d} />
        )}
      </div>
    </ResponsiveSheet>
  );
}

function Ready({
  d,
  sections,
  setSections,
  mode,
  setMode,
  authorized,
  setAuthorized,
}: {
  d: MenuImport;
  sections: Set<ImportSection>;
  setSections: (s: Set<ImportSection>) => void;
  mode: 'add' | 'replace';
  setMode: (m: 'add' | 'replace') => void;
  authorized: boolean;
  setAuthorized: (v: boolean) => void;
}) {
  const c = d.counts!;
  const notes = d.lost.map(
    (l) => `${NOTE[l.code] ?? l.code.replace(/_/g, ' ')}${l.subject ? ` · ${l.subject}` : ''}`,
  );
  return (
    <>
      <div className="rounded-lg border bg-card p-3 shadow-card">
        <p className="font-medium">
          {d.preview?.store.name ?? 'loja'}: <span className="tnum">{c.products}</span> produtos em{' '}
          <span className="tnum">{c.categories}</span> categorias
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground tnum">
          {[
            `${c.photos} fotos`,
            c.optionGroups && `${c.optionGroups} grupos de opções`,
            c.hidden && `${c.hidden} ocultos para o lojista conferir`,
            c.hours && 'horários',
            c.zones && `${c.zones} regiões`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <ul className="mt-2 flex flex-col gap-0.5 text-xs">
          {d.preview?.categories.map((cat) => (
            <li key={cat.name} className="flex justify-between gap-2">
              <span className="truncate">{cat.name}</span>
              <span className="shrink-0 text-muted-foreground tnum">
                {cat.products.length} · a partir de{' '}
                {brl(Math.min(...cat.products.map((p) => p.priceCents)))}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium text-muted-foreground">também trazer</legend>
        {SECTIONS.map(([k, label, hint]) => (
          <label key={k} className="flex items-start gap-2">
            <Checkbox
              className="mt-0.5"
              checked={sections.has(k)}
              onCheckedChange={(v) => {
                const n = new Set(sections);
                if (v === true) n.add(k);
                else n.delete(k);
                setSections(n);
              }}
            />
            <span>
              <span className="font-medium">{label}</span>
              <span className="block text-xs text-muted-foreground">{hint}</span>
            </span>
          </label>
        ))}
        <p className="text-xs text-muted-foreground">pix e formas de pagamento ficam com o dono.</p>
      </fieldset>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">cardápio atual da loja</span>
        <Segmented
          size="sm"
          className="ml-auto"
          value={mode}
          onChange={setMode}
          options={[
            ['add', 'somar'],
            ['replace', 'trocar (arquiva)'],
          ]}
        />
      </div>

      {notes.length > 0 && (
        <details className="rounded-lg border px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium">
            não vem igual: <span className="tnum">{notes.length}</span>
          </summary>
          <ul className="mt-1.5 list-disc pl-4 text-xs text-muted-foreground">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}

      <label className="flex items-start gap-2">
        <Checkbox
          className="mt-0.5"
          checked={authorized}
          onCheckedChange={(v) => setAuthorized(v === true)}
        />
        <span>o lojista é dono dessa loja e pediu a importação</span>
      </label>
    </>
  );
}

function Applied({ d }: { d: MenuImport }) {
  const r = d.result;
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 font-medium">
        <Check className="size-4 text-success" />
        {r?.products ?? 0} produtos importados
        {r?.hidden ? (
          <span className="text-xs text-muted-foreground">({r.hidden} ocultos)</span>
        ) : null}
      </p>
      {d.images.total > 0 && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground tnum" role="status">
          {!d.images.finished && <Loader2 className="size-3.5 animate-spin" />}
          fotos {d.images.done}/{d.images.total}
          {d.images.failed ? ` · ${d.images.failed} não vieram` : ''}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        o lojista confere os produtos ocultos e cadastra o pix no painel.
      </p>
    </div>
  );
}
