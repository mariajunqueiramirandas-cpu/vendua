import { ArrowLeft, Camera, Images, X } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, ApiError, type PhotoMenuItem } from '../../lib/api.ts';
import { num } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { MoneyField, TextInput } from '../../ui/fields.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { Spinner } from '../../ui/Spinner.tsx';
import { toast } from '../../ui/Toast.tsx';
import { base64, shrinkPhoto } from '../copilot/media.ts';

// "Mandar fotos do cardápio": for a menu no link import reads (anota.ai and iFood refuse
// readers; a printed menu has no link). Each photo goes to Core on its own and comes back as
// products priced by Core; the owner fixes names and prices, drops what's wrong, and only then
// does anything get written (POST /products/import/items).

const MAX_PHOTOS = 8;

type Row = PhotoMenuItem & { key: string };

const keyOf = (i: PhotoMenuItem) => `${i.name.trim().toLowerCase()}|${i.priceCents}`;

function photoError(e: unknown) {
  if (e instanceof ApiError) {
    if (e.code === 'IMAGE_UNREAD') return 'não deu para ler';
    if (e.code === 'RATE_LIMITED') return 'o limite de fotos de hoje acabou';
    if (e.code === 'UNSUPPORTED_MEDIA') return 'não é uma foto que a gente abre';
  }
  return e instanceof Error && e.message ? e.message : 'não deu certo';
}

export function PhotoImport({
  onBack,
  onDone,
}: {
  onBack: () => void;
  /** after the products were created */
  onDone: (created: number) => void;
}) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [reading, setReading] = useState<{ at: number; of: number } | null>(null);
  const [misses, setMisses] = useState<string[]>([]);

  const read = async (files: File[]) => {
    const list = files.slice(0, MAX_PHOTOS);
    const missed: string[] = [];
    for (const [i, f] of list.entries()) {
      setReading({ at: i + 1, of: list.length });
      try {
        const p = await shrinkPhoto(f);
        const r = await api.importPhoto({ mime: p.mime, data: await base64(p.blob) });
        URL.revokeObjectURL(p.url);
        if (!r.items.length) missed.push(`A foto ${i + 1} não mostrou produtos com preço.`);
        // overlapping prints repeat products: one row per name and price
        setRows((prev) => {
          const seen = new Set(prev.map((x) => x.key));
          const fresh = r.items
            .map((it) => ({ ...it, key: keyOf(it) }))
            .filter((x) => !seen.has(x.key) && seen.add(x.key));
          return [...prev, ...fresh];
        });
      } catch (e) {
        missed.push(`A foto ${i + 1}: ${photoError(e)}.`);
        if (e instanceof ApiError && e.code === 'RATE_LIMITED') break;
      }
    }
    if (files.length > MAX_PHOTOS)
      missed.push(`Lemos as ${MAX_PHOTOS} primeiras. Mande o resto numa próxima vez.`);
    setMisses(missed);
    setReading(null);
  };

  const create = useMutation({
    mutationFn: () => api.importItems(rows.map(({ key: _k, ...it }) => it)),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.catalog });
      toast(
        `${num(r.created)} produtos criados${r.categories ? ` em ${num(r.categories)} categorias novas` : ''}. Coloque as fotos quando puder.`,
      );
      onDone(r.created);
    },
    onError: (e) => toast.error(messageOf(e)),
  });

  const patch = (key: string, p: Partial<PhotoMenuItem>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const drop = (key: string) => setRows((prev) => prev.filter((r) => r.key !== key));

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const g = r.category?.trim() || 'Cardápio';
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  const valid = rows.length > 0 && rows.every((r) => r.name.trim().length >= 2 && r.priceCents > 0);

  const picker = (
    <input
      ref={input}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/*"
      multiple
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = '';
        if (files.length) void read(files);
      }}
    />
  );

  if (reading)
    return (
      <div
        className="animate-fade-up flex flex-col items-center gap-4 py-12 text-center"
        role="status"
      >
        <Spinner className="size-8" />
        <p className="t-title-2">
          Lendo a foto {reading.at} de {reading.of}…
        </p>
        <p className="t-body max-w-sm text-muted">
          Cada foto leva alguns segundos. Fique nesta tela até terminar.
        </p>
      </div>
    );

  if (!rows.length)
    return (
      <div className="animate-fade-up space-y-6">
        {picker}
        <div>
          <h2 className="t-title-1">Mande fotos do seu cardápio</h2>
          <p className="t-body-lg mt-2 text-muted">
            Prints do anota.ai, do iFood ou de outro app, ou fotos do cardápio impresso. A Venduá lê
            cada foto e você confere nomes e preços antes de criar os produtos.
          </p>
        </div>
        <ul className="t-body space-y-2 text-muted">
          <li>Até {MAX_PHOTOS} fotos de cada vez, com o texto nítido e sem cortar preços.</li>
          <li>Prints que se repetem não criam produtos repetidos.</li>
          <li>Adicionais, bordas e fotos dos produtos você coloca depois, em cada produto.</li>
        </ul>
        {misses.length ? (
          <Notice tone="warning" title="Algumas fotos não deram certo">
            {misses.join(' ')}
          </Notice>
        ) : null}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
          <Button variant="quiet" size="lg" icon={<ArrowLeft />} onClick={onBack}>
            voltar para o link
          </Button>
          <div className="hidden flex-1 sm:block" />
          <Button size="lg" icon={<Camera />} onClick={() => input.current?.click()}>
            escolher fotos
          </Button>
        </div>
      </div>
    );

  return (
    <div className="animate-fade-up space-y-6">
      {picker}
      <div>
        <h2 className="t-title-1">
          Achamos {num(rows.length)} {rows.length === 1 ? 'produto' : 'produtos'}
        </h2>
        <p className="t-body mt-2 text-muted">
          Confira cada nome e preço com o cardápio antigo. Tire o que não for produto. Nada entra na
          loja até você criar.
        </p>
      </div>
      {misses.length ? (
        <Notice tone="warning" title="Algumas fotos não deram certo">
          {misses.join(' ')}
        </Notice>
      ) : null}
      {[...groups].map(([group, list]) => (
        <section key={group} aria-label={group}>
          <h3 className="t-label mb-2 flex items-baseline justify-between gap-2">
            <span className="truncate">{group}</span>
            <span className="tnum shrink-0 text-muted">{num(list.length)}</span>
          </h3>
          <ul className="divide-y divide-line rounded-md ring-1 ring-line">
            {list.map((r) => (
              <li key={r.key} className="flex items-start gap-2 px-3 py-2.5">
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_9.5rem]">
                  <TextInput
                    aria-label="nome do produto"
                    maxLength={120}
                    value={r.name}
                    onChange={(e) => patch(r.key, { name: e.target.value })}
                  />
                  <MoneyField
                    cents={r.priceCents}
                    min={1}
                    onCommit={(v) => v !== null && patch(r.key, { priceCents: v })}
                  />
                </div>
                <IconButton
                  label={`tirar ${r.name}`}
                  className="mt-0.5 shrink-0"
                  onClick={() => drop(r.key)}
                >
                  <X />
                </IconButton>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        <Button
          variant="secondary"
          size="lg"
          icon={<Images />}
          onClick={() => input.current?.click()}
        >
          mais fotos
        </Button>
        <div className="hidden flex-1 sm:block" />
        <Button
          size="lg"
          disabled={!valid}
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          criar {num(rows.length)} {rows.length === 1 ? 'produto' : 'produtos'}
        </Button>
      </div>
    </div>
  );
}
