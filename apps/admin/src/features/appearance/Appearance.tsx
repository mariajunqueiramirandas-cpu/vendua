import {
  ArrowDown,
  ArrowSquareOut,
  ArrowUp,
  ClockCounterClockwise,
  Desktop,
  DeviceMobile,
  Eye,
  EyeSlash,
  Palette,
  Plus,
  RocketLaunch,
  Trash,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type Appearance as AppearanceData,
  type PageTemplate,
  type StoreTokens,
  type TemplateSection,
} from '../../lib/api.ts';
import { when } from '../../lib/format.ts';
import { usePollWhenOffline } from '../../lib/live.ts';
import { Mascote } from '../../ui/Mascote.tsx';
import { qk, useMutation } from '../../lib/query.ts';
import { useSession } from '../../lib/session.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState, Hint, messageOf } from '../../ui/feedback.tsx';
import { Segmented } from '../../ui/fields.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { AppearanceSkeleton, EditorFrame, RowsSkeleton } from '../../ui/skeletons.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';
import { Colors, readable } from './Colors.tsx';
import { ADDABLE, fieldsFor, sectionName } from './fields.ts';
import { SettingsEditor } from './SettingsEditor.tsx';

type PageId = 'home' | 'catalog' | 'product' | 'layout';
const PAGES: { id: PageId; label: string }[] = [
  { id: 'home', label: 'Início' },
  { id: 'catalog', label: 'Cardápio' },
  { id: 'product', label: 'Produto' },
  { id: 'layout', label: 'Topo e rodapé' },
];

// the Kernel's own fallbacks (sdk/defaults.ts) for a page the store never customized
const FALLBACK: Record<PageId, PageTemplate> = {
  layout: {
    version: 1,
    page: 'layout',
    sections: [
      { id: 'header', type: 'sdk:header' },
      { id: 'content', type: 'sdk:page-content' },
      { id: 'footer', type: 'sdk:footer' },
    ],
  },
  home: { version: 1, page: 'home', sections: [{ id: 'catalog', type: 'sdk:catalog-grid' }] },
  catalog: {
    version: 1,
    page: 'catalog',
    sections: [
      {
        id: 'catalog',
        type: 'sdk:catalog-grid',
        settings: { title: 'Cardápio', showSearch: true },
      },
    ],
  },
  product: {
    version: 1,
    page: 'product',
    sections: [{ id: 'purchase', type: 'sdk:purchase-panel' }],
  },
};

const BASE_TOKENS: StoreTokens = {
  color: {
    bg: '#FCFBF8',
    surface: '#FFFFFF',
    text: '#1A1714',
    muted: '#6B6456',
    accent: '#123C32',
    onAccent: '#FFFFFF',
    danger: '#B3372F',
    success: '#3D7A4F',
  },
  font: { display: 'Georgia, serif', body: 'system-ui, sans-serif' },
  radius: { sm: '6px', md: '10px', lg: '16px' },
  space: { scale: 1 },
  motion: { duration: '200ms', easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export default function Appearance() {
  const poll = usePollWhenOffline(10_000);
  const { data, error, refetch } = useQuery({
    queryKey: qk.appearance,
    queryFn: api.appearance,
    // "no ar" is pushed when the build lands; polling only covers a stream that's down
    refetchInterval: (q) => (q.state.data?.publish.state === 'publishing' ? poll : false),
  });
  if (error && !data)
    return (
      <PageBody>
        <ErrorState error={error} retry={() => void refetch()} />
      </PageBody>
    );
  if (!data)
    return (
      <EditorFrame>
        <PageHeader title="Aparência" />
        <AppearanceSkeleton />
      </EditorFrame>
    );
  return <Editor data={data} />;
}

function Editor({ data }: { data: AppearanceData }) {
  const s = useSession();
  const qc = useQueryClient();
  const base = useMemo(() => {
    const out = {} as Record<PageId, { version: number; template: PageTemplate }>;
    for (const p of PAGES) {
      const row = data.pages.find((x) => x.page === p.id);
      out[p.id] = row
        ? { version: row.version, template: row.template }
        : { version: 0, template: FALLBACK[p.id] };
    }
    return out;
  }, [data.pages]);
  const [drafts, setDrafts] = useState<Record<PageId, PageTemplate>>(
    () =>
      Object.fromEntries(PAGES.map((p) => [p.id, base[p.id].template])) as Record<
        PageId,
        PageTemplate
      >,
  );
  const [page, setPage] = useState<PageId>('home');
  const [selected, setSelected] = useState<string | null>(null);
  const [device, setDevice] = useState<'phone' | 'desktop'>('phone');
  const [frameTokens, setFrameTokens] = useState<StoreTokens | null>(null);
  const [paths, setPaths] = useState<Record<string, string> | null>(null);
  const [tokens, setTokens] = useState<StoreTokens | null>(data.tokens?.tokens ?? null);
  const [sheet, setSheet] = useState<null | 'section' | 'colors' | 'history' | 'add' | 'outline'>(
    null,
  );
  const [slug, setSlug] = useState<string | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [colorsPanel, setColorsPanel] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const baseTokens = data.tokens?.tokens ?? frameTokens;

  // a newer version (another device, a restore) replaces only pages this device hasn't touched
  const prevBase = useRef(base);
  useEffect(() => {
    const was = prevBase.current;
    prevBase.current = base;
    setDrafts((d) => {
      const n = { ...d };
      for (const p of PAGES) if (same(d[p.id], was[p.id].template)) n[p.id] = base[p.id].template;
      return n;
    });
  }, [base]);
  const dirtyPage = (p: PageId) => !same(drafts[p], base[p].template);
  const dirtyPages = PAGES.filter((p) => dirtyPage(p.id)).map((p) => p.id);
  const tokensDirty = !!tokens && !same(tokens, baseTokens);
  const dirty = dirtyPages.length > 0 || tokensDirty;

  useEffect(() => {
    void api.share().then(
      (r) => setSlug(r.products[0]?.slug ?? null),
      () => undefined,
    );
  }, []);

  // ── the frame ────────────────────────────────────────────────────────────
  const post = useCallback(
    (extra: Record<string, unknown> = {}) =>
      frame.current?.contentWindow?.postMessage(
        {
          type: 'vendua:preview',
          templates: drafts,
          selected,
          ...(tokens ? { tokens } : {}),
          ...extra,
        },
        new URL(data.previewUrl).origin,
      ),
    [drafts, selected, tokens, data.previewUrl],
  );
  useEffect(() => {
    const t = setTimeout(() => post(), 120);
    return () => clearTimeout(t);
  }, [post]);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== new URL(data.previewUrl).origin) return;
      const d = e.data as {
        type?: string;
        id?: string;
        tokens?: StoreTokens | null;
        paths?: Record<string, string>;
      };
      if (d?.type === 'vendua:preview-ready') {
        setFrameReady(true);
        if (d.tokens) setFrameTokens(d.tokens);
        if (d.paths) setPaths(d.paths);
        post();
      }
      if (d?.type === 'vendua:preview-select' && d.id) {
        const inPage = drafts[page].sections.some((x) => x.id === d.id);
        const inLayout = drafts.layout.sections.some((x) => x.id === d.id);
        if (!inPage && inLayout) setPage('layout');
        setSelected(d.id);
        if (window.matchMedia('(max-width: 1199px)').matches) setSheet('section');
      }
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [data.previewUrl, drafts, page, post]);
  const pathFor = (p: PageId) => {
    if (p === 'catalog') return paths?.catalog ?? '/cardapio';
    if (p === 'product')
      return slug
        ? (paths?.product ?? '/produto/:slug').replace(':slug', encodeURIComponent(slug))
        : '/';
    return '/';
  };
  const src = `${data.previewUrl}${pathFor(page)}?vendua-preview=1`;

  // ── section operations ───────────────────────────────────────────────────
  const tpl = drafts[page];
  const sec = tpl.sections.find((x) => x.id === selected) ?? null;
  const setSections = (fn: (s: TemplateSection[]) => TemplateSection[]) =>
    setDrafts((d) => ({ ...d, [page]: { ...d[page], sections: fn(d[page].sections) } }));
  const move = (id: string, dir: -1 | 1) =>
    setSections((ss) => {
      const i = ss.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ss.length) return ss;
      const n = [...ss];
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  const toggle = (id: string) =>
    setSections((ss) => ss.map((x) => (x.id === id ? hidden(x, !x.disabled) : x)));
  const remove = (id: string) => {
    const before = drafts[page];
    setSections((ss) => ss.filter((x) => x.id !== id));
    setSelected(null);
    setSheet(null);
    toast('Parte tirada da página', { undo: () => setDrafts((d) => ({ ...d, [page]: before })) });
  };
  const add = (type: string) => {
    const id = `${type.replace(/^sdk:/, '')}-${Math.random().toString(36).slice(2, 6)}`;
    setSections((ss) => {
      const at = page === 'layout' ? ss.findIndex((x) => x.type === 'sdk:page-content') : ss.length;
      const n = [...ss];
      n.splice(at < 0 ? ss.length : at, 0, {
        id,
        type,
        settings:
          type === 'sdk:rich-text'
            ? { title: 'Um título', body: 'Conte aqui algo sobre a sua loja.' }
            : {},
      });
      return n;
    });
    setSelected(id);
    setSheet('section');
  };
  const setSettings = (v: Record<string, unknown>) =>
    setSections((ss) => ss.map((x) => (x.id === selected ? { ...x, settings: v } : x)));

  // ── publish ──────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<'idle' | 'publishing' | 'live'>('idle');
  const publish = useMutation({
    mutationFn: async () => {
      for (const p of dirtyPages) await api.savePage(p, drafts[p], base[p].version);
      if (tokensDirty && tokens) await api.saveTokens(tokens);
    },
    onMutate: () => setPhase('publishing'),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.appearance });
      setPhase('live');
      toast(
        tokensDirty
          ? 'Página no ar ✓ As cores entram na próxima atualização da loja.'
          : 'Sua página está no ar ✓',
        {
          action: { label: 'ver a loja', run: () => window.open(data.url, '_blank') },
        },
      );
      setTimeout(() => setPhase('idle'), 4000);
    },
    onError: async (e) => {
      setPhase('idle');
      // pages saved before the failure have new versions: a retry needs them as its base
      await qc.invalidateQueries({ queryKey: qk.appearance });
      toast.error(messageOf(e));
    },
  });
  const tokensOk = !tokens || readable(tokens);

  const colors =
    baseTokens || tokens ? (
      <Colors value={tokens ?? baseTokens!} onChange={setTokens} logoUrl={s.store.logoUrl} />
    ) : (
      <div className="space-y-3 pt-2">
        <p className="t-body text-muted">Carregando as cores atuais da sua loja pela prévia…</p>
        <Button variant="secondary" onClick={() => setTokens(BASE_TOKENS)}>
          começar de uma paleta nova
        </Button>
      </div>
    );

  const outline = (
    <Outline
      tpl={tpl}
      selected={selected}
      onSelect={(id) => {
        setSelected(id);
        setColorsPanel(false);
        if (window.matchMedia('(max-width: 1199px)').matches) setSheet('section');
      }}
      onMove={move}
      onToggle={toggle}
      onAdd={() => setSheet('add')}
    />
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-40 pt-4 md:px-8 md:pb-10 md:pt-8">
      <header className="mb-4 flex items-start gap-2 md:items-center md:gap-3">
        {phase === 'live' ? (
          <Mascote
            pose="publicar"
            size={72}
            className="animate-pop size-16 shrink-0 md:size-[72px]"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="t-title-1">Aparência</h1>
          <p className="t-body text-muted">
            {phase === 'publishing'
              ? 'publicando…'
              : phase === 'live'
                ? 'no ar ✓'
                : data.publish.state === 'publishing'
                  ? 'cores sendo aplicadas na loja…'
                  : dirty
                    ? 'mudanças não publicadas'
                    : 'tudo publicado'}
            {' · '}
            <a
              href={data.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              ver a loja <ArrowSquareOut className="size-4" />
            </a>
          </p>
        </div>
        <Button
          variant={colorsPanel ? 'primary' : 'secondary'}
          icon={<Palette />}
          aria-label="cores"
          onClick={() => {
            // desktop: beside the preview, so the change is visible as it's picked
            if (window.matchMedia('(min-width: 1200px)').matches) setColorsPanel((v) => !v);
            else setSheet('colors');
          }}
        >
          <span className="max-sm:sr-only">cores</span>
        </Button>
        <Button
          variant="ghost"
          icon={<ClockCounterClockwise />}
          aria-label="versões"
          onClick={() => setSheet('history')}
        >
          <span className="max-sm:sr-only">versões</span>
        </Button>
        <span className="hidden md:contents">
          <Button
            icon={<RocketLaunch />}
            disabled={!dirty || !tokensOk}
            loading={publish.isPending}
            onClick={() => publish.mutate()}
          >
            publicar
          </Button>
        </span>
      </header>

      <Hint id="appearance-tap" className="mb-4">
        Toque em qualquer parte da loja para editar. Nada muda para os clientes até você tocar em{' '}
        <strong>publicar</strong>.
      </Hint>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          label="página"
          value={page}
          onChange={(p) => {
            setPage(p);
            setSelected(null);
          }}
          className="min-w-0 basis-full md:max-w-xl md:basis-auto md:flex-1"
          options={PAGES.map((p) => ({
            value: p.id,
            label: dirtyPage(p.id) ? `${p.label} •` : p.label,
          }))}
        />
        <Segmented
          label="aparelho"
          value={device}
          onChange={setDevice}
          className="hidden md:flex"
          options={[
            { value: 'phone', label: <DeviceMobile className="size-5" aria-label="celular" /> },
            { value: 'desktop', label: <Desktop className="size-5" aria-label="computador" /> },
          ]}
        />
        <Button variant="ghost" className="xl:hidden" onClick={() => setSheet('outline')}>
          partes da página
        </Button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[280px_1fr_380px]">
        <aside className="hidden xl:block">{outline}</aside>
        <DevicePreview
          src={src}
          device={device}
          frameRef={frame}
          ready={frameReady}
          url={data.url}
        />
        <aside className="hidden xl:block">
          <Card className="sticky top-6 max-h-[calc(100dvh-48px)] overflow-y-auto p-5">
            {colorsPanel ? (
              <div className="space-y-4">
                <h2 className="t-title-2">Cores da loja</h2>
                {colors}
              </div>
            ) : sec ? (
              <SectionPanel
                origin={new URL(data.previewUrl).origin}
                sec={sec}
                onChange={setSettings}
                onRemove={() => remove(sec.id)}
                onToggle={() => toggle(sec.id)}
              />
            ) : (
              <p className="t-body text-muted">
                Toque em uma parte da loja, ou escolha na lista, para editar textos e fotos.
              </p>
            )}
          </Card>
        </aside>
      </div>

      {/* phones: publish in the thumb zone */}
      <div
        data-action-bar
        className="glass fixed inset-x-0 bottom-[var(--tabbar-h,calc(72px+env(safe-area-inset-bottom)))] z-30 border-t border-line px-4 py-3 md:hidden"
      >
        <Button
          size="lg"
          block
          icon={<RocketLaunch />}
          disabled={!dirty || !tokensOk}
          loading={publish.isPending}
          onClick={() => publish.mutate()}
        >
          {dirty ? 'publicar' : 'tudo publicado'}
        </Button>
      </div>

      <Sheet
        open={sheet === 'outline'}
        onOpenChange={(v) => setSheet(v ? 'outline' : null)}
        title="Partes da página"
      >
        {outline}
      </Sheet>
      <Sheet
        open={sheet === 'section' && !!sec}
        onOpenChange={(v) => setSheet(v ? 'section' : null)}
        title={sec ? sectionName(sec.type) : ''}
      >
        {sec ? (
          <SectionPanel
            origin={new URL(data.previewUrl).origin}
            sec={sec}
            onChange={setSettings}
            onRemove={() => remove(sec.id)}
            onToggle={() => toggle(sec.id)}
            bare
          />
        ) : null}
      </Sheet>
      <Sheet
        open={sheet === 'add'}
        onOpenChange={(v) => setSheet(v ? 'add' : null)}
        title="Adicionar à página"
      >
        <div className="grid gap-2 pt-1">
          {ADDABLE.map((t) => (
            <Button key={t} variant="secondary" size="lg" block onClick={() => add(t)}>
              {sectionName(t)}
            </Button>
          ))}
        </div>
      </Sheet>
      <Sheet
        open={sheet === 'colors'}
        onOpenChange={(v) => setSheet(v ? 'colors' : null)}
        title="Cores da loja"
        description="Você vê na prévia na hora. Na loja, entram depois de publicar."
        wide
      >
        {colors}
      </Sheet>
      <HistorySheet
        open={sheet === 'history'}
        onOpenChange={(v) => setSheet(v ? 'history' : null)}
        page={page}
      />
    </div>
  );
}

/** `disabled` is present only when true — templates stay minimal. */
function hidden(s: TemplateSection, on: boolean): TemplateSection {
  const { disabled: _drop, ...rest } = s;
  return on ? { ...rest, disabled: true } : rest;
}

function Outline({
  tpl,
  selected,
  onSelect,
  onMove,
  onToggle,
  onAdd,
}: {
  tpl: PageTemplate;
  selected: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, d: -1 | 1) => void;
  onToggle: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div>
      <ol className="space-y-2">
        {tpl.sections.map((x, i) => {
          const fixed = x.type === 'sdk:page-content';
          return (
            <li key={x.id}>
              <div
                className={cn(
                  'flex items-center gap-1 rounded-md bg-surface p-1 pl-3 ring-1 transition-colors',
                  selected === x.id ? 'ring-2 ring-spark' : 'ring-line',
                  x.disabled && 'opacity-55',
                )}
              >
                <button
                  type="button"
                  disabled={fixed}
                  onClick={() => onSelect(x.id)}
                  className="press-row -ml-2 min-h-12 min-w-0 flex-1 rounded-sm pl-2 text-left"
                >
                  <span className="block truncate font-semibold">
                    {fixed ? 'Conteúdo de cada página' : sectionName(x.type)}
                  </span>
                  {x.disabled ? <span className="t-caption text-muted">escondida</span> : null}
                </button>
                {!fixed ? (
                  <>
                    <IconButton
                      label="subir"
                      size="sm"
                      disabled={i === 0}
                      onClick={() => onMove(x.id, -1)}
                    >
                      <ArrowUp />
                    </IconButton>
                    <IconButton
                      label="descer"
                      size="sm"
                      disabled={i === tpl.sections.length - 1}
                      onClick={() => onMove(x.id, 1)}
                    >
                      <ArrowDown />
                    </IconButton>
                    <IconButton
                      label={x.disabled ? 'mostrar' : 'esconder'}
                      size="sm"
                      onClick={() => onToggle(x.id)}
                    >
                      {x.disabled ? <EyeSlash /> : <Eye />}
                    </IconButton>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <Button variant="ghost" block className="mt-3" icon={<Plus />} onClick={onAdd}>
        adicionar parte
      </Button>
    </div>
  );
}

function SectionPanel({
  sec,
  onChange,
  onRemove,
  onToggle,
  bare,
  origin,
}: {
  origin: string;
  sec: TemplateSection;
  onChange: (v: Record<string, unknown>) => void;
  onRemove: () => void;
  onToggle: () => void;
  bare?: boolean;
}) {
  return (
    <div className="space-y-5">
      {!bare ? <h2 className="t-title-2">{sectionName(sec.type)}</h2> : null}
      <SettingsEditor
        origin={origin}
        idPrefix={sec.id}
        fields={fieldsFor(sec.type, sec.settings)}
        value={sec.settings ?? {}}
        onChange={onChange}
      />
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Button variant="secondary" icon={sec.disabled ? <Eye /> : <EyeSlash />} onClick={onToggle}>
          {sec.disabled ? 'mostrar na página' : 'esconder da página'}
        </Button>
        <Button variant="ghost" className="text-danger" icon={<Trash />} onClick={onRemove}>
          tirar da página
        </Button>
      </div>
    </div>
  );
}

function DevicePreview({
  src,
  device,
  frameRef,
  ready,
  url,
}: {
  src: string;
  device: 'phone' | 'desktop';
  frameRef: React.RefObject<HTMLIFrameElement>;
  ready: boolean;
  url: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLoaded(false);
    setLate(false);
    // the store never said hello: its build predates the editor, or it's offline
    const t = setTimeout(() => setLate(true), 8000);
    return () => clearTimeout(t);
  }, [src]);
  return (
    <div className="flex justify-center">
      <div
        className={cn(
          'relative w-full overflow-hidden bg-[#0c1410] depth-3',
          device === 'phone' ? 'max-w-[400px] rounded-[44px] px-3 pb-3 pt-10' : 'rounded-xl p-2',
        )}
      >
        {device === 'phone' ? (
          <div
            aria-hidden
            className="absolute left-1/2 top-4 z-10 h-1.5 w-16 -translate-x-1/2 rounded-full bg-white/20"
          />
        ) : null}
        <div
          className={cn(
            'relative overflow-hidden bg-surface',
            device === 'phone' ? 'aspect-[9/19] rounded-[28px]' : 'aspect-[16/10] rounded-lg',
          )}
        >
          {!loaded && !late ? <div className="skeleton absolute inset-0" /> : null}
          {late && !ready ? (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface p-6 text-center">
              <p className="t-title-2">A prévia não abriu</p>
              <p className="t-body text-muted">
                A sua loja precisa de uma atualização para mostrar as mudanças aqui. Você ainda pode
                editar e publicar; confira o resultado na loja.
              </p>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="t-label inline-flex min-h-11 items-center rounded-md px-4 ring-1 ring-line-strong"
              >
                abrir a loja
              </a>
            </div>
          ) : null}
          <iframe
            ref={frameRef}
            key={src}
            title="prévia da loja"
            src={src}
            onLoad={() => setLoaded(true)}
            className="size-full border-0"
            style={
              device === 'desktop'
                ? { width: '200%', height: '200%', transform: 'scale(.5)', transformOrigin: '0 0' }
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}

function HistorySheet({
  open,
  onOpenChange,
  page,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  page: PageId;
}) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['appearance', 'history', page],
    queryFn: () => api.pageHistory(page),
    enabled: open,
  });
  const restore = useMutation({
    mutationFn: (v: number) => api.restorePage(page, v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.appearance });
      void qc.invalidateQueries({ queryKey: ['appearance', 'history', page] });
      toast('Versão restaurada e publicada ✓');
      onOpenChange(false);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const rows = data?.history ?? [];
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Versões: ${PAGES.find((p) => p.id === page)?.label}`}
      description="Voltar a uma versão publica ela de novo. A atual continua no histórico."
    >
      {!data ? <RowsSkeleton rows={3} avatar={false} className="pt-1" /> : null}
      <ol className="divide-y divide-line pt-1">
        {rows.map((h, i) => (
          <li key={h.version} className="flex min-h-16 items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                Versão {h.version}{' '}
                {i === 0 ? (
                  <span className="t-caption rounded-full bg-success-soft px-2 py-0.5 text-success">
                    no ar
                  </span>
                ) : null}
              </p>
              <p className="t-caption text-muted">
                {when(h.at)} · {h.by}
              </p>
            </div>
            {i > 0 ? (
              <Button
                size="sm"
                variant="secondary"
                loading={restore.isPending && restore.variables === h.version}
                onClick={() => restore.mutate(h.version)}
              >
                voltar a esta
              </Button>
            ) : null}
          </li>
        ))}
        {!rows.length ? (
          <li className="t-body py-4 text-muted">Essa página ainda usa o modelo padrão.</li>
        ) : null}
      </ol>
    </Sheet>
  );
}
