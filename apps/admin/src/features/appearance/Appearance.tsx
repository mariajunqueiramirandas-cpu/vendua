import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowSquareOut,
  CaretLeft,
  CaretRight,
  Check,
  ClockCounterClockwise,
  Desktop,
  DeviceMobile,
  HandTap,
  ListBullets,
  Palette,
  Plus,
  RocketLaunch,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { catalogHref, productHref } from '@vendua/kernel/rules';
import { PREVIEW_MESSAGE, PREVIEW_QUERY_PARAM } from '@vendua/kernel/sdk-catalog';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type Appearance as AppearanceData, type StoreTokens } from '../../lib/api.ts';
import { useLiveState, usePollWhenOffline } from '../../lib/live.ts';
import { qk } from '../../lib/query.ts';
import { useSession } from '../../lib/session.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState } from '../../ui/feedback.tsx';
import { Segmented } from '../../ui/fields.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { HeaderBack, PageBody, PageHeader, ScreenBack } from '../../ui/Page.tsx';
import { Sheet, useBackToClose } from '../../ui/Sheet.tsx';
import { AppearanceSkeleton, EditorFrame } from '../../ui/skeletons.tsx';
import { Spinner } from '../../ui/Spinner.tsx';
import { toast } from '../../ui/Toast.tsx';
import { ADD_HINT, addable, sectionName } from './fields.ts';
import { HistorySheet } from './HistorySheet.tsx';
import { Inspector, partPlace } from './Inspector.tsx';
import { Navigator } from './Navigator.tsx';
import { Preview } from './Preview.tsx';
import { SiteSwitch } from './SiteSwitch.tsx';
import { PAGES, tplLabel, useEditor, type PageId, type Selection } from './useEditor.ts';

// Aparência, the edit-what-you-see editor (design §6.7). Wide screens: the list of what's on
// the page, the live storefront, the selected thing's settings. Tablets: the storefront beside
// one panel (the list, or what's picked from it). Phones: a full-screen editor (the Shell hides
// its bars here). The storefront fills it; a tap on a part opens its form under a smaller
// preview, so every change shows as it's made, and "pronto" goes back to the whole page.

type StorefrontPaths = Parameters<typeof catalogHref>[0]['paths'];
/** three columns need this much room beside the app's own side bar */
const WIDE = '(min-width: 1400px)';
const TABLET = '(min-width: 768px)';
/** this browser has tapped a part once: the "toque em uma parte" hint has done its job */
const TAPPED = 'vendua-aparencia-tocou';

function useMedia(q: string) {
  const [on, set] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => set(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [q]);
  return on;
}

/** the edge follows a site switch within its 30 s route cache: the preview reloads after it */
const SWITCH_SETTLE_MS = 35_000;

export default function Appearance() {
  const poll = usePollWhenOffline(10_000);
  const [reload, setReload] = useState(0);
  const settle = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(settle.current), []);
  const { data, error, refetch } = useQuery({
    queryKey: qk.appearance,
    queryFn: api.appearance,
    // "no ar" is pushed when the build lands; polling only covers a stream that's down
    refetchInterval: (q) => (q.state.data?.publish.state === 'publishing' ? poll : false),
  });
  if (error && !data)
    return (
      <div className="pt-[env(safe-area-inset-top)] md:pt-0">
        <PageBody>
          <ScreenBack className="-ml-3 mb-2 md:hidden" />
          <ErrorState error={error} retry={() => void refetch()} />
        </PageBody>
      </div>
    );
  if (!data)
    return (
      <EditorFrame>
        <PageHeader title="Aparência" back="/loja" />
        <AppearanceSkeleton />
      </EditorFrame>
    );
  // the other site is another document: a fresh editor on its layout and colours
  return (
    <Editor
      key={data.site?.mode ?? 'one'}
      data={data}
      reload={reload}
      onSwitched={() => {
        clearTimeout(settle.current);
        settle.current = setTimeout(() => setReload((r) => r + 1), SWITCH_SETTLE_MS);
      }}
    />
  );
}

function Editor({
  data,
  reload,
  onSwitched,
}: {
  data: AppearanceData;
  reload: number;
  onSwitched: () => void;
}) {
  const s = useSession();
  const ed = useEditor(data, s.store.id);
  const wide = useMedia(WIDE);
  const tablet = useMedia(TABLET);
  const [device, setDevice] = useState<'phone' | 'desktop'>('phone');
  const [sheet, setSheet] = useState<null | 'add' | 'history' | 'parts'>(null);
  const [where, setWhere] = useState<'page' | 'layout'>('page');
  const [frameReady, setFrameReady] = useState(false);
  const [paths, setPaths] = useState<StorefrontPaths | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  // phones: whatever is selected has its form open under the preview, and back closes it
  const editing = !tablet && !!ed.sel;
  useBackToClose(editing, () => ed.setSel(null));
  const [tapped, setTapped] = useState(() => {
    try {
      return localStorage.getItem(TAPPED) === '1';
    } catch {
      return false;
    }
  });
  const origin = new URL(data.previewUrl).origin;
  useEffect(() => setFrameReady(false), [reload]);

  useEffect(() => {
    void api.share().then(
      (r) => setSlug(r.products[0]?.slug ?? null),
      () => undefined,
    );
  }, []);
  const told = useRef(false);
  useEffect(() => {
    // once, for what this browser kept from last time (StrictMode runs effects twice)
    if (!ed.restored || told.current) return;
    told.current = true;
    toast('Suas mudanças não publicadas continuam aqui.', {
      action: { label: 'descartar', run: ed.discard },
    });
  });

  const pick = (sel: Selection) => ed.setSel(sel);
  const back = () => ed.setSel(null);

  // ── the frame ────────────────────────────────────────────────────────────
  const selectedId = ed.sel?.kind === 'section' ? ed.sel.id : null;
  const post = useCallback(
    (extra: Record<string, unknown> = {}) =>
      frame.current?.contentWindow?.postMessage(
        {
          type: PREVIEW_MESSAGE.draft,
          templates: ed.previewDrafts,
          selected: selectedId,
          ...(ed.tokens ? { tokens: ed.tokens } : {}),
          ...extra,
        },
        origin,
      ),
    [ed.previewDrafts, selectedId, ed.tokens, origin],
  );
  useEffect(() => {
    const t = setTimeout(() => post(), 120);
    return () => clearTimeout(t);
  }, [post]);
  const onFrame = useRef<(e: MessageEvent) => void>(() => undefined);
  onFrame.current = (e: MessageEvent) => {
    if (e.origin !== origin) return;
    const d = e.data as {
      type?: string;
      id?: string;
      tokens?: StoreTokens | null;
      paths?: StorefrontPaths;
      templates?: Record<string, unknown> | null;
      schemas?: unknown;
    };
    if (d?.type === PREVIEW_MESSAGE.ready) {
      setFrameReady(true);
      if (d.tokens) ed.setFrameTokens(d.tokens);
      if (d.paths) setPaths(d.paths);
      if (d.templates && typeof d.templates === 'object') ed.setFrameTemplates(d.templates);
      if (d.schemas !== undefined) ed.setFrameSchemas(d.schemas);
      post();
    }
    if (d?.type === PREVIEW_MESSAGE.select && d.id) {
      const sel = ed.locate(d.id);
      if (!sel) return;
      // on a phone this opens the part's form, and a tap while it's open switches it. A wrong
      // part (easy on a small screen) is one tap on ‹ › away: the form names it over its fields
      ed.setSel(sel);
      if (!tapped) {
        setTapped(true);
        try {
          localStorage.setItem(TAPPED, '1');
        } catch {
          // the hint shows again next time
        }
      }
    }
  };
  useEffect(() => {
    const on = (e: MessageEvent) => onFrame.current(e);
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, []);
  // the preview changes height when the settings open: bring the selected part back into view
  useEffect(() => {
    const t = setTimeout(() => post(), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  // the store's own paths (the frame reports them), else the Kernel's defaults
  const config = { paths: paths ?? {} };
  const pathFor = (p: PageId) =>
    p === 'catalog'
      ? catalogHref(config)
      : p === 'product' && slug
        ? productHref(config, slug)
        : '/';
  const src = `${data.previewUrl}${pathFor(ed.page)}?${PREVIEW_QUERY_PARAM}=1`;

  // undo and redo from the keyboard, unless a text field is handling its own
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]'))
        return;
      const k = e.key.toLowerCase();
      if (k === 'z' || k === 'y') {
        e.preventDefault();
        if (k === 'y' || e.shiftKey) ed.redo();
        else ed.undo();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [ed.undo, ed.redo]);

  const publishing = ed.publish.isPending;
  const canPublish = ed.dirty && ed.tokensOk;
  const publish = () => ed.publish.mutate();
  const openAdd = () => {
    setWhere('page');
    setSheet('add');
  };

  const navigator = <Navigator ed={ed} onPick={pick} onAdd={openAdd} />;
  const inspector = (exit: 'close' | 'back' | 'phone') => (
    <Inspector
      ed={ed}
      origin={origin}
      logoUrl={s.store.logoUrl}
      previewShown={frameReady}
      onAdd={openAdd}
      {...(exit === 'back' ? { onBack: back } : {})}
      {...(exit === 'phone' ? { noExit: true, noHead: true } : {})}
    />
  );
  const undoRedo = (
    <>
      <IconButton label="desfazer" disabled={!ed.canUndo} onClick={ed.undo}>
        <ArrowCounterClockwise />
      </IconButton>
      <IconButton label="refazer" disabled={!ed.canRedo} onClick={ed.redo}>
        <ArrowClockwise />
      </IconButton>
    </>
  );
  // tablets: one panel, the list or what was picked from it
  const single = ed.sel ? inspector('back') : navigator;
  const siteSwitch = data.site ? (
    <SiteSwitch mode={data.site.mode} dirty={ed.dirty} onSwitched={onSwitched} />
  ) : null;
  const preview = (
    <Preview
      key={reload}
      src={src}
      device={tablet ? device : 'bare'}
      frameRef={frame}
      ready={frameReady}
      url={data.url}
      className={tablet ? undefined : 'h-full'}
    />
  );

  const sheets = (
    <>
      <Sheet
        open={sheet === 'parts'}
        onOpenChange={(v) => setSheet(v ? 'parts' : null)}
        title="Partes da página"
        footer={
          ed.dirty ? (
            <Button
              variant="ghost"
              block
              onClick={() => {
                setSheet(null);
                ed.discard();
              }}
            >
              descartar todas as mudanças
            </Button>
          ) : undefined
        }
      >
        <Navigator
          ed={ed}
          onPick={(sel) => {
            setSheet(null);
            pick(sel);
          }}
          onAdd={openAdd}
        />
      </Sheet>
      <Sheet
        open={sheet === 'add'}
        onOpenChange={(v) => setSheet(v ? 'add' : null)}
        title="Adicionar uma parte"
        description={
          where === 'layout'
            ? 'Entra no alto de todas as páginas. Depois dá para mover.'
            : `Entra no fim da página ${tplLabel(ed.page)}. Depois dá para mover.`
        }
      >
        <Segmented
          label="onde"
          value={where}
          onChange={setWhere}
          className="mb-3"
          options={[
            { value: 'page', label: `Só em ${tplLabel(ed.page)}` },
            { value: 'layout', label: 'Em todas as páginas' },
          ]}
        />
        <ul className="grid gap-2">
          {addable(ed.schemas).map((t) => (
            <li key={t}>
              <button
                type="button"
                onClick={() => {
                  ed.add(t, where);
                  setSheet(null);
                }}
                className="press-row flex min-h-16 w-full items-center gap-3 rounded-md bg-surface px-4 py-2 text-left ring-1 ring-line hover:bg-hover"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{sectionName(t, ed.schemas)}</span>
                  {ADD_HINT[t] ? (
                    <span className="t-caption block text-muted">{ADD_HINT[t]}</span>
                  ) : null}
                </span>
                <Plus className="size-5 shrink-0 text-muted" />
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
      <HistorySheet
        open={sheet === 'history'}
        onOpenChange={(v) => setSheet(v ? 'history' : null)}
        initial={ed.sel?.kind === 'section' ? ed.sel.tpl : ed.page}
      />
    </>
  );

  if (!tablet) {
    const prev = ed.neighbour(-1);
    const next = ed.neighbour(1);
    const sel = ed.sel;
    const pageTabs = (
      <Segmented
        label="página"
        value={ed.page}
        onChange={ed.setPage}
        className="w-full"
        options={PAGES.map((p) => ({
          value: p.id,
          label: ed.dirtyTpl(p.id) ? (
            <span className="inline-flex items-center gap-1.5">
              {p.label}
              <span className="size-1.5 rounded-full bg-primary" aria-hidden />
              <span className="sr-only">(mudou)</span>
            </span>
          ) : (
            p.label
          ),
        }))}
      />
    );
    return (
      // phones: the editor is the whole screen, sized to what the keyboard leaves visible (iOS
      // can pan the page under it), so nothing behind it scrolls and the form keeps its place
      <div
        data-no-pull
        className="fixed inset-0 z-[45] flex flex-col overflow-hidden bg-bg kb:bottom-auto kb:top-(--vvt) kb:h-(--vvh)"
      >
        {editing ? (
          <div className="flex shrink-0 items-center gap-1 pb-1 pl-1 pr-3 pt-[calc(env(safe-area-inset-top)+0.25rem)]">
            <h1 className="sr-only">Aparência</h1>
            {undoRedo}
            <div className="flex-1" />
            <Button variant="secondary" icon={<Check />} onClick={back}>
              pronto
            </Button>
          </div>
        ) : (
          <>
            <header className="flex shrink-0 items-center gap-0.5 pl-1 pr-1 pt-[calc(env(safe-area-inset-top)+0.25rem)]">
              <ScreenBack />
              <div className="min-w-0 flex-1">
                <h1 className="t-title-2">Aparência</h1>
                <Status ed={ed} data={data} onFix={() => pick({ kind: 'style' })} />
              </div>
              {undoRedo}
              <IconButton label="versões publicadas" onClick={() => setSheet('history')}>
                <ClockCounterClockwise />
              </IconButton>
            </header>
            {siteSwitch ? <div className="shrink-0 px-4 pt-2">{siteSwitch}</div> : null}
            <div className="shrink-0 px-4 py-2">{pageTabs}</div>
          </>
        )}
        {/* while typing the field gets the room, but the store stays laid out out of sight:
            a frame taken out of the layout loses its place on the part being edited */}
        <div
          className={cn(
            'relative min-h-0 border-y border-line',
            // colours are judged by eye: the store keeps more of the screen than a part's form
            editing
              ? cn(
                  'shrink-0 kb:invisible kb:absolute kb:inset-x-0 kb:top-0',
                  sel?.kind === 'style' ? 'h-[46%]' : 'h-[38%]',
                )
              : 'flex-1',
          )}
        >
          {preview}
          {!sel && !tapped && frameReady ? (
            <p className="t-label pointer-events-none absolute inset-x-0 bottom-4 mx-auto flex w-fit items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-bg depth-2">
              <HandTap className="size-5" /> Toque em uma parte para editar
            </p>
          ) : null}
        </div>
        {editing ? (
          <>
            <div
              role="toolbar"
              aria-label="parte aberta"
              className="flex shrink-0 items-center gap-1 border-b border-line bg-surface px-1 py-1 kb:hidden"
            >
              {sel?.kind === 'section' ? (
                <IconButton
                  label="parte anterior"
                  disabled={!prev}
                  onClick={() => prev && ed.setSel(prev)}
                >
                  <CaretLeft />
                </IconButton>
              ) : null}
              <div className="min-w-0 flex-1 px-2 py-1 text-center">
                <p className="t-caption truncate text-muted">
                  {sel?.kind === 'section'
                    ? `${partPlace(sel.tpl)}${ed.position ? ` · ${ed.position.n} de ${ed.position.of}` : ''}`
                    : 'Loja toda'}
                </p>
                <h2 className="truncate font-semibold leading-tight">
                  {ed.selected ? sectionName(ed.selected.type, ed.schemas) : 'Cores e cantos'}
                </h2>
              </div>
              {sel?.kind === 'section' ? (
                <IconButton
                  label="próxima parte"
                  disabled={!next}
                  onClick={() => next && ed.setSel(next)}
                >
                  <CaretRight />
                </IconButton>
              ) : null}
            </div>
            {/* relative: the form's visually hidden inputs (a photo's file picker) are placed in
                here, not past the screen's end */}
            <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-surface px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-5">
              {inspector('phone')}
            </div>
          </>
        ) : (
          <div
            data-action-bar
            className="flex shrink-0 gap-2 px-4 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2"
          >
            <BarButton icon={<ListBullets />} label="partes" onClick={() => setSheet('parts')} />
            <BarButton icon={<Palette />} label="cores" onClick={() => pick({ kind: 'style' })} />
            <BarButton
              primary
              icon={<RocketLaunch />}
              label={ed.phase === 'live' ? 'no ar ✓' : 'publicar'}
              disabled={!canPublish}
              loading={publishing}
              onClick={publish}
            />
          </div>
        )}
        {sheets}
      </div>
    );
  }

  return (
    // from tablets up the editor is the screen: each column scrolls on its own
    <div className="mx-auto flex h-dvh w-full max-w-[1600px] flex-col px-8 pb-6 pt-6">
      <header className="mb-2 flex items-center gap-1 md:mb-4 md:gap-2">
        <HeaderBack to="/loja" />
        {ed.phase === 'live' ? (
          <Mascote
            pose="publicar"
            size={64}
            className="animate-pop size-16 shrink-0 max-md:hidden"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="t-title-2 md:t-title-1">Aparência</h1>
          <Status ed={ed} data={data} onFix={() => pick({ kind: 'style' })} />
        </div>
        {undoRedo}
        <IconButton
          label="versões publicadas"
          className="md:hidden"
          onClick={() => setSheet('history')}
        >
          <ClockCounterClockwise />
        </IconButton>
        <span className="hidden md:contents">
          <Button
            variant="ghost"
            icon={<ClockCounterClockwise />}
            onClick={() => setSheet('history')}
          >
            versões
          </Button>
          {ed.dirty ? (
            <Button variant="secondary" onClick={ed.discard}>
              descartar
            </Button>
          ) : null}
          <Button
            icon={<RocketLaunch />}
            disabled={!canPublish}
            loading={publishing}
            onClick={publish}
          >
            publicar
          </Button>
        </span>
      </header>

      <div className="mb-2 flex items-center gap-2 md:mb-4">
        {siteSwitch}
        <Segmented
          label="página"
          value={ed.page}
          onChange={ed.setPage}
          className="min-w-0 flex-1 md:max-w-md"
          options={PAGES.map((p) => ({
            value: p.id,
            label: ed.dirtyTpl(p.id) ? (
              <span className="inline-flex items-center gap-1.5">
                {p.label}
                <span className="size-1.5 rounded-full bg-primary" aria-hidden />
                <span className="sr-only">(mudou)</span>
              </span>
            ) : (
              p.label
            ),
          }))}
        />
        <Segmented
          label="aparelho"
          value={device}
          onChange={setDevice}
          className="hidden shrink-0 md:flex"
          options={[
            { value: 'phone', label: <DeviceMobile className="size-5" aria-label="celular" /> },
            { value: 'desktop', label: <Desktop className="size-5" aria-label="computador" /> },
          ]}
        />
      </div>

      <div
        className={cn(
          'grid min-h-0 flex-1 gap-5',
          wide
            ? 'grid-cols-[320px_minmax(0,1fr)_380px]'
            : 'grid-cols-[minmax(0,1fr)_minmax(320px,380px)]',
        )}
      >
        {wide ? (
          <aside className="relative -m-1 overflow-y-auto overscroll-contain p-1 pb-6">
            {navigator}
          </aside>
        ) : null}
        {preview}
        <aside className="relative overflow-y-auto overscroll-contain rounded-lg">
          <Card className="p-5">{wide ? inspector('close') : single}</Card>
        </aside>
      </div>
      {sheets}
    </div>
  );
}

function Status({
  ed,
  data,
  onFix,
}: {
  ed: ReturnType<typeof useEditor>;
  data: AppearanceData;
  onFix: () => void;
}) {
  // phones cover the Shell's offline banner with the editor: the line says it instead
  const online = useLiveState().online;
  const areas = [...ed.dirtyTpls.map(tplLabel), ...(ed.tokensDirty ? ['cores'] : [])];
  const text =
    ed.phase === 'publishing'
      ? online
        ? 'publicando…'
        : 'sem conexão: publica quando voltar'
      : ed.phase === 'live'
        ? 'no ar ✓'
        : !ed.tokensOk
          ? null
          : !online
            ? 'sem conexão'
            : data.publish.state === 'publishing'
              ? 'cores sendo aplicadas na loja…'
              : ed.dirty
                ? `não publicado: ${areas.join(', ')}`
                : 'tudo publicado';
  return (
    <p
      className="t-caption md:t-body flex min-w-0 items-center gap-1.5 text-muted"
      aria-live="polite"
    >
      {ed.dirty && ed.phase === 'idle' ? (
        <span className="size-2 shrink-0 rounded-full bg-warning" aria-hidden />
      ) : null}
      {text === null ? (
        <button
          type="button"
          onClick={onFix}
          className="truncate text-danger underline underline-offset-2"
        >
          cores difíceis de ler: ajustar
        </button>
      ) : (
        <span className="truncate">{text}</span>
      )}
      <span aria-hidden>·</span>
      <a
        href={data.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center gap-1 underline underline-offset-2"
      >
        <span className="max-sm:sr-only">ver a loja</span> <ArrowSquareOut className="size-4" />
      </a>
    </p>
  );
}

/** The phone's bottom bar: icon over a short word, so three fit a 320 px screen at 56 px tall. */
function BarButton({
  icon,
  label,
  onClick,
  primary,
  disabled,
  loading,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'press t-caption flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md font-semibold disabled:opacity-45 [&_svg]:size-6',
        primary
          ? 'bg-primary text-on-primary depth-1'
          : 'bg-surface text-ink ring-1 ring-line-strong',
      )}
    >
      {loading ? <Spinner /> : icon}
      {label}
    </button>
  );
}
