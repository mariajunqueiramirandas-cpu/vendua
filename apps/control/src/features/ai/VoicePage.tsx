import { useId, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  ApiError,
  type AiVoiceView,
  type MediaProviderId,
  type MediaRouteSetting,
  type MediaRoutesSetting,
} from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { errorMessage } from '@/lib/query.ts';
import { Page } from '@/components/Page.tsx';
import { ErrorState, LoadingRows } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Switch } from '@/components/ui/controls.tsx';
import { Input, Select } from '@/components/ui/input.tsx';
import { cleanMessage } from './draft.ts';
import { FieldMsg, HintPanel, Notice, SaveBarShown } from './bits.tsx';
import { useAiVoice, useSaveAiSetting } from './queries.ts';
import { useSyncedDraft } from './synced.ts';
import { AI_TABS } from './tabs.ts';

// IA > Voz: how Duá hears the customers' voice notes. Core tries the transcription routes in
// order (vendedor/media.ts); with none saved, the self-hosted STT sidecar is used when it's on.

const MAX_ROUTES = 5;
const PROVIDERS: MediaProviderId[] = ['sidecar', 'openai'];
const LABEL: Record<MediaProviderId, string> = {
  sidecar: 'servidor da Venduá',
  openai: 'OpenAI',
};
/** the provider picker's words: short, so it fits a phone's row */
const OPTION: Record<MediaProviderId, string> = { ...LABEL, sidecar: 'Venduá' };
const SUGGESTED: Record<MediaProviderId, string> = {
  sidecar: 'parakeet-tdt-0.6b-v3',
  openai: 'gpt-4o-transcribe',
};
const MODEL_ID = /^[A-Za-z0-9._:/-]{1,80}$/;

type Row = { key: number; provider: MediaProviderId; model: string; zdr: boolean };
type Draft = { rows: Row[]; rest: Omit<MediaRoutesSetting, 'transcribe'> };

let nextKey = 1;
const toDraft = (routes: MediaRoutesSetting): Draft => {
  const { transcribe, ...rest } = routes;
  return {
    rows: (transcribe ?? []).map((r) => ({
      key: nextKey++,
      provider: r.provider,
      model: r.model,
      zdr: r.zdr,
    })),
    rest,
  };
};
const out = (d: Draft): MediaRoutesSetting => ({
  ...d.rest,
  transcribe: d.rows.map((r): MediaRouteSetting => ({
    provider: r.provider,
    model: r.model.trim(),
    zdr: r.zdr,
  })),
});

/** client-side check, by the same rule Core applies (validateMediaRoutes) */
function rowError(r: Row): string | undefined {
  if (!MODEL_ID.test(r.model.trim())) return 'digite o id do modelo (letras, números, . _ : / -)';
  return undefined;
}

function Dot({ tone }: { tone: 'ok' | 'warn' | 'off' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        tone === 'ok' ? 'bg-success' : tone === 'warn' ? 'bg-warning' : 'bg-border-strong',
      )}
    />
  );
}

function sidecarState(s: AiVoiceView['sidecar']) {
  if (!s.configured)
    return { tone: 'off' as const, label: 'desligado', hint: 'defina STT_SECRET no servidor' };
  if (!s.reachable)
    return {
      tone: 'warn' as const,
      label: 'configurado, sem resposta',
      hint: 'o serviço stt não respondeu agora',
    };
  return { tone: 'ok' as const, label: 'no ar', hint: s.model ?? '' };
}

function IntroPanel({ view, draft }: { view: AiVoiceView; draft: Draft }) {
  const sc = sidecarState(view.sidecar);
  const first = draft.rows[0];
  return (
    <Panel title="como funciona">
      <div className="flex flex-col gap-3">
        <p className="max-w-prose text-[13px] leading-relaxed">
          O Duá transcreve todo áudio antes de responder: o dos clientes no WhatsApp e no chat do
          site da loja, e o do dono ou gerente no painel e no WhatsApp da Venduá. As rotas abaixo
          são tentadas em ordem: se uma falha, o Duá passa para a seguinte. As mudanças valem em até
          um minuto depois de salvar.
        </p>
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
          O servidor da Venduá transcreve na nossa própria máquina: o áudio não vai para nenhuma
          outra empresa, e não há custo por minuto. Ele também reconhece os nomes dos produtos de
          cada loja.
        </p>
        {draft.rows.length === 0 && !view.sidecar.configured && (
          <Notice tone="bad">
            Nenhuma rota e o servidor de voz desligado: os áudios ficam sem transcrição, e o Duá
            pede para escreverem.
          </Notice>
        )}
        {first && first.provider !== 'sidecar' && (
          <Notice>
            A primeira rota é {LABEL[first.provider]}: os áudios saem da Venduá e vão para essa
            empresa.
          </Notice>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3 text-[13px]">
          <span className="flex min-w-0 items-center gap-1.5" title={sc.hint}>
            <span className="text-xs text-muted-foreground">servidor de voz</span>
            <Dot tone={sc.tone} />
            <span className={cn(sc.tone === 'off' && 'text-muted-foreground')}>{sc.label}</span>
            {sc.tone === 'ok' && view.sidecar.model && (
              <span className="truncate text-xs text-muted-foreground">{view.sidecar.model}</span>
            )}
          </span>
          <ul
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
            aria-label="chaves dos provedores"
          >
            {view.providers.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-1.5"
                title={p.configured ? 'chave presente' : `sem chave (${p.secretName})`}
              >
                <Dot tone={p.configured ? 'ok' : 'off'} />
                <span className={cn(!p.configured && 'text-muted-foreground')}>{LABEL[p.id]}</span>
                <span className="sr-only">{p.configured ? 'chave presente' : 'sem chave'}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

function RouteItem({
  index,
  count,
  row: r,
  view,
  error,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  row: Row;
  view: AiVoiceView;
  error: string | undefined;
  onChange: (r: Row) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  const zdrId = useId();
  const own = r.provider === 'sidecar';
  const key = view.providers.find((p) => p.id === r.provider);
  const skipped = own
    ? !view.sidecar.configured && 'servidor de voz desligado: esta rota é pulada'
    : key && !key.configured && `sem chave (${key.secretName}): esta rota é pulada`;
  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-md border bg-card p-2 shadow-card',
        error && 'border-destructive/40',
      )}
    >
      <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-2 md:grid-cols-[1.25rem_11rem_minmax(0,1fr)_auto]">
        <span
          className="flex h-10 items-center justify-center text-xs font-medium text-muted-foreground tnum md:h-8"
          aria-label={`tentativa ${index + 1}`}
        >
          {index + 1}
        </span>
        <Select
          value={r.provider}
          aria-label="provedor"
          onChange={(e) => {
            const p = e.target.value as MediaProviderId;
            onChange({ ...r, provider: p, model: SUGGESTED[p], zdr: p === 'sidecar' || r.zdr });
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {OPTION[p]}
            </option>
          ))}
        </Select>
        <div className="col-start-3 row-start-1 flex items-center md:col-start-4">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="subir"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="descer"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="remover rota" onClick={onRemove}>
            <Trash2 />
          </Button>
        </div>
        <div className="col-span-2 col-start-2 flex min-w-0 flex-col gap-1 md:col-span-1 md:col-start-3 md:row-start-1">
          {own ? (
            <div className="flex h-10 min-w-0 items-center rounded-md border border-dashed px-2.5 text-xs text-muted-foreground md:h-8">
              <span className="truncate">
                modelo do servidor: {view.sidecar.model ?? 'parakeet-tdt-0.6b-v3'}
              </span>
            </div>
          ) : (
            <Input
              value={r.model}
              aria-label="modelo"
              aria-invalid={!!error}
              placeholder={SUGGESTED[r.provider]}
              spellCheck={false}
              autoCapitalize="off"
              onChange={(e) => onChange({ ...r, model: e.target.value })}
            />
          )}
          <FieldMsg>{error}</FieldMsg>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 pl-7">
        {own ? (
          <p className="text-xs leading-5 text-muted-foreground">
            retenção zero: o áudio fica no servidor da Venduá
          </p>
        ) : (
          <>
            <div className="flex items-start gap-2.5 pointer-coarse:py-1">
              <Switch
                id={zdrId}
                checked={r.zdr}
                onCheckedChange={(v) => onChange({ ...r, zdr: v })}
              />
              <label
                htmlFor={zdrId}
                className="flex min-w-0 cursor-pointer flex-col text-xs leading-5 sm:flex-row sm:gap-2"
              >
                <span className="font-medium">retenção zero de dados</span>
                <span className="text-muted-foreground">
                  marque se o contrato desta conta garante retenção zero
                </span>
              </label>
            </div>
            {!r.zdr && (
              <p className="flex items-start gap-1.5 pl-[2.875rem] text-xs leading-relaxed text-muted-foreground">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
                <span>o provedor pode guardar os áudios dos clientes</span>
              </p>
            )}
          </>
        )}
        {skipped && <Notice>{skipped}</Notice>}
      </div>
    </li>
  );
}

export default function VoicePage() {
  const query = useAiVoice();
  const view = query.data;
  const routes = useSyncedDraft(view?.routes, toDraft, out);
  const save = useSaveAiSetting();
  const [tried, setTried] = useState(false);
  const [server, setServer] = useState<{ row?: number; msg: string } | null>(null);

  const d = routes.draft;
  const clientErrors = d ? d.rows.map(rowError) : [];
  const errorAt = (i: number) =>
    (tried ? clientErrors[i] : undefined) ?? (server?.row === i ? server.msg : undefined);

  const edit = (rows: Row[]) => {
    if (!d) return;
    routes.setDraft({ ...d, rows });
    setServer(null);
  };
  const move = (i: number, by: -1 | 1) => {
    if (!d) return;
    const rows = [...d.rows];
    const [r] = rows.splice(i, 1);
    rows.splice(i + by, 0, r!);
    edit(rows);
  };
  const add = () => {
    if (!d) return;
    const provider: MediaProviderId = d.rows.some((r) => r.provider === 'sidecar')
      ? 'openai'
      : 'sidecar';
    edit([
      ...d.rows,
      { key: nextKey++, provider, model: SUGGESTED[provider], zdr: provider === 'sidecar' },
    ]);
  };

  async function onSave() {
    if (!d) return;
    setTried(true);
    if (clientErrors.some(Boolean)) {
      toast.error('corrija o campo marcado');
      return;
    }
    // a sidecar route always carries the model the server reports
    const value = out({
      ...d,
      rows: d.rows.map((r) =>
        r.provider === 'sidecar' ? { ...r, model: view?.sidecar.model ?? SUGGESTED.sidecar } : r,
      ),
    });
    try {
      await save.mutateAsync({ key: 'agent_runtime.media_routes', value });
      routes.markSaved(d);
      setTried(false);
      setServer(null);
      toast.success('salvo, vale em até um minuto');
    } catch (e) {
      const field = e instanceof ApiError && e.status === 422 ? e.details?.field : undefined;
      const m = typeof field === 'string' ? /^transcribe\.(\d+)/.exec(field) : null;
      const msg =
        e instanceof ApiError && e.status === 422 ? cleanMessage(e.message) : errorMessage(e);
      setServer({ ...(m ? { row: Number(m[1]) } : {}), msg });
      toast.error(`não salvou: ${msg}`);
    }
  }

  function onDiscard() {
    routes.discard();
    setTried(false);
    setServer(null);
  }

  const general = server && server.row === undefined ? server.msg : null;
  const speak = d?.rest.speak?.length ?? 0;

  return (
    <Page title="IA" tabs={AI_TABS}>
      {query.isPending ? (
        <LoadingRows />
      ) : query.isError || !view ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !d ? (
        <LoadingRows />
      ) : (
        <>
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            <IntroPanel view={view} draft={d} />
            <HintPanel
              title="transcrição dos áudios"
              hint="tentadas em ordem, valem em todas as lojas"
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={add}
                  disabled={d.rows.length >= MAX_ROUTES}
                >
                  <Plus />
                  adicionar rota
                </Button>
              }
            >
              {d.rows.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  {view.sidecar.configured
                    ? 'nenhuma rota salva: os áudios vão para o servidor da Venduá'
                    : 'sem rotas: adicione uma para os áudios serem transcritos'}
                </p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {d.rows.map((r, i) => (
                    <RouteItem
                      key={r.key}
                      index={i}
                      count={d.rows.length}
                      row={r}
                      view={view}
                      error={errorAt(i)}
                      onChange={(next) => edit(d.rows.map((x, j) => (j === i ? next : x)))}
                      onMove={(by) => move(i, by)}
                      onRemove={() => edit(d.rows.filter((_, j) => j !== i))}
                    />
                  ))}
                </ol>
              )}
              {speak > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  As respostas em áudio do Duá têm {speak === 1 ? '1 rota' : `${speak} rotas`} de
                  fala, que ficam como estão.
                </p>
              )}
            </HintPanel>
            <div className="h-14" aria-hidden />
          </div>
          {(routes.dirty || general) && (
            <div className="sticky bottom-0 z-20 mx-auto -mb-3 max-w-4xl pb-3 md:-mb-5 md:pb-5">
              <SaveBarShown />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-popover px-3 py-2 shadow-pop">
                <div className="min-w-0 flex-1 text-[13px]">
                  {general ? (
                    <span className="text-destructive-foreground">não salvou: {general}</span>
                  ) : (
                    <span className="font-medium">alterações não salvas</span>
                  )}
                </div>
                <div className="ml-auto flex gap-2">
                  <Button variant="ghost" onClick={onDiscard} disabled={save.isPending}>
                    descartar
                  </Button>
                  <Button onClick={() => void onSave()} disabled={save.isPending || !routes.dirty}>
                    {save.isPending ? 'salvando…' : 'salvar'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </Page>
  );
}
