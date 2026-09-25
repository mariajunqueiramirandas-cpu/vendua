import { useEffect, useState } from 'react';
import { Check, FlaskConical, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Integration } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { errorMessage } from '@/lib/query.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { ConfirmButton } from '@/components/common.tsx';
import {
  providerStatus,
  TONE_BADGE,
  type Driver,
  type IntegrationDraft,
  type Kind,
  type ProvTone,
  type WaState,
} from './providers.ts';
import { WhatsAppPairing } from './WhatsAppPairing.tsx';

const MARK: Record<ProvTone | 'cfg', string> = {
  live: 'bg-agent',
  warn: 'bg-warning',
  off: 'bg-border-strong',
  cfg: 'bg-muted-foreground/60',
};

/** One provider kind: driver picker, the selected driver's fields, enable/test actions. */
export function ProviderCard({
  kind,
  rows,
  wa,
  onWaLogout,
  waLoggingOut,
  onSave,
  saving,
}: {
  kind: Kind;
  rows: Integration[];
  wa: WaState;
  onWaLogout?: (() => void) | undefined;
  waLoggingOut?: boolean | undefined;
  onSave: (d: IntegrationDraft, enable: boolean) => void;
  saving: boolean;
}) {
  const current = rows.find((r) => r.enabled);
  // nothing enabled → seed the form from the first driver's saved row so
  // 'usar X' re-enables WITH its config
  const baseRow = current ?? rows.find((r) => r.driver === kind.drivers[0]?.d);
  const baseline: IntegrationDraft = {
    driver: baseRow?.driver ?? kind.drivers[0]?.d ?? '',
    secretRef: baseRow?.secretRef ?? '',
    config: (baseRow?.config ?? {}) as Record<string, string | number>,
  };
  const [driver, setDriver] = useState(baseline.driver);
  const [secretRef, setSecretRef] = useState(baseline.secretRef);
  const [config, setConfig] = useState<Record<string, string | number>>(baseline.config);
  const [test, setTest] = useState<{ ok: boolean; detail: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [pairReset, setPairReset] = useState(0);

  useEffect(() => {
    setDriver(baseline.driver);
    setSecretRef(baseline.secretRef);
    setConfig(baseline.config);
    // a saved-row change restarts the socket — on-screen probe/pair state belongs to the old config
    setTest(null);
    setPairReset((n) => n + 1);
    // re-sync only when the saved row changes, not on every refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseRow?.driver, baseRow?.secretRef, baseRow?.updatedAt]);

  const drv = kind.drivers.find((x) => x.d === driver) ?? kind.drivers[0];
  // the saved row for the SELECTED driver — secret state reflects the server, not `enabled`
  const selRow = rows.find((r) => r.driver === driver);
  const selIsActive = !!current && driver === current.driver;
  const dirty =
    driver !== baseline.driver ||
    secretRef !== baseline.secretRef ||
    JSON.stringify(config) !== JSON.stringify(baseline.config);
  const st = providerStatus(kind.key, rows, wa);
  const liveDetail = current
    ? [
        current.driver,
        ...(kind.drivers.find((x) => x.d === current.driver)?.fields ?? []).map(
          (f) => String(current.config[f.key] ?? '') || f.placeholder,
        ),
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  const pickDriver = (d: string) => {
    const dd = kind.drivers.find((x) => x.d === d);
    if (!dd) return;
    setDriver(dd.d);
    setTest(null);
    setPairReset((n) => n + 1);
    if (dd.d === baseline.driver) {
      setSecretRef(baseline.secretRef);
      setConfig(baseline.config);
    } else {
      // preload that driver's own saved row, not the live one's leftovers
      const row = rows.find((r) => r.driver === dd.d);
      setSecretRef(row?.secretRef ?? dd.secretName ?? '');
      setConfig({ ...(row?.config ?? {}) } as Record<string, string | number>);
    }
  };
  const reset = () => {
    setDriver(baseline.driver);
    setSecretRef(baseline.secretRef);
    setConfig(baseline.config);
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const r = await api.testIntegration(kind.key);
      setTest(r);
      if (r.ok) toast.success(`${kind.label}: ${r.detail}`);
      else toast.error(`${kind.label}: ${r.detail}`);
    } catch (e) {
      const detail = errorMessage(e);
      setTest({ ok: false, detail });
      toast.error(`${kind.label}: ${detail}`);
    } finally {
      setTesting(false);
    }
  };

  const options = kind.drivers.map((dd) => {
    const row = rows.find((r) => r.driver === dd.d);
    const mark: ProvTone | 'cfg' | null = row?.enabled
      ? st.tone
      : row?.secretName && !row.secretPresent
        ? 'warn'
        : row
          ? 'cfg'
          : null;
    const title = row?.enabled
      ? 'driver ativo'
      : row
        ? 'configurado, desligado'
        : 'nunca configurado';
    return [
      dd.d,
      <span key={dd.d} title={title} className="inline-flex items-center gap-1.5">
        {mark && <i className={cn('size-1.5 rounded-full', MARK[mark])} aria-hidden />}
        {dd.label}
      </span>,
    ] as const;
  });

  return (
    <Card className="flex min-w-0 flex-1 flex-col">
      <div className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-1.5">
        <h3 className="text-[13px] font-semibold">{kind.label}</h3>
        <span className="truncate text-xs text-muted-foreground">{kind.sub}</span>
        <Badge variant={TONE_BADGE[st.tone]} className="ml-auto">
          {st.text}
        </Badge>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="no-scrollbar -mx-3 overflow-x-auto px-3">
          <Segmented value={driver} onChange={pickDriver} options={options} size="sm" />
        </div>
        {drv?.hint && <p className="text-xs text-muted-foreground">{drv.hint}</p>}
        {liveDetail && (
          <p className="min-w-0 truncate text-xs text-muted-foreground" title={liveDetail}>
            {selIsActive ? 'rodando: ' : 'rodando agora: '}
            <code className="font-mono text-[11px] text-foreground">{liveDetail}</code>
          </p>
        )}

        {kind.key === 'whatsapp' &&
          driver === 'baileys' &&
          (current?.driver === 'baileys' && current.enabled ? (
            <WhatsAppPairing
              wa={wa}
              resetSignal={pairReset}
              testing={testing}
              onReconnect={() => void runTest()}
              onLogout={() => onWaLogout?.()}
              loggingOut={!!waLoggingOut}
            />
          ) : (
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              ative pra gerar o QR — o número pareia por aqui mesmo
            </p>
          ))}

        {drv && (drv.secret || drv.fields?.length) ? (
          <DriverFields
            kind={kind}
            drv={drv}
            selRow={selRow}
            secretRef={secretRef}
            setSecretRef={setSecretRef}
            config={config}
            setConfig={setConfig}
          />
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          {!selIsActive ? (
            <Button disabled={saving} onClick={() => onSave({ driver, secretRef, config }, true)}>
              usar {drv?.label ?? driver}
            </Button>
          ) : dirty ? (
            <Button disabled={saving} onClick={() => onSave({ driver, secretRef, config }, true)}>
              salvar
            </Button>
          ) : null}
          {dirty && (
            <Button variant="ghost" onClick={reset}>
              desfazer
            </Button>
          )}
          <Button
            variant="outline"
            disabled={testing || !current?.enabled}
            title="chama o driver ativo de verdade (1 chamada barata)"
            onClick={() => void runTest()}
          >
            {testing ? <Loader2 className="animate-spin" /> : <FlaskConical />}
            {testing ? 'testando…' : 'testar'}
          </Button>
          {current?.enabled && selIsActive && (
            <ConfirmButton
              variant="destructive-outline"
              className="ml-auto"
              confirm="desativar mesmo?"
              disabled={saving}
              onConfirm={() =>
                onSave(
                  {
                    driver: current.driver,
                    secretRef: baseline.secretRef,
                    config: baseline.config,
                  },
                  false,
                )
              }
            >
              desativar
            </ConfirmButton>
          )}
        </div>
        {test && (
          <p
            className={cn(
              'flex min-w-0 items-start gap-1 rounded-md px-2 py-1 text-xs',
              test.ok ? 'bg-agent-soft' : 'bg-destructive-soft text-destructive-foreground',
            )}
            title={test.detail}
          >
            {test.ok ? (
              <Check className="mt-px size-3.5 shrink-0" />
            ) : (
              <X className="mt-px size-3.5 shrink-0" />
            )}
            <span className="line-clamp-2 min-w-0 break-words">{test.detail}</span>
          </p>
        )}
      </div>
    </Card>
  );
}

function DriverFields({
  kind,
  drv,
  selRow,
  secretRef,
  setSecretRef,
  config,
  setConfig,
}: {
  kind: Kind;
  drv: Driver;
  selRow: Integration | undefined;
  secretRef: string;
  setSecretRef: (v: string) => void;
  config: Record<string, string | number>;
  setConfig: (v: Record<string, string | number>) => void;
}) {
  const envName = selRow?.secretName ?? drv.secretName;
  const code = (s: string) => <code className="font-mono text-[11px] text-foreground">{s}</code>;
  return (
    <div className="grid gap-3 pt-1 md:grid-cols-2">
      {drv.secret && (
        <Field
          label="chave — nome da env var"
          htmlFor={`${kind.key}-secret`}
          hint={
            !envName ? (
              'a chave mora numa env var do servidor — nunca no banco'
            ) : selRow ? (
              selRow.secretPresent ? (
                <span className="inline-flex flex-wrap items-center gap-1">
                  {code(envName)}
                  <span className="inline-flex items-center gap-0.5 text-foreground">
                    <Check className="size-3 text-success" /> presente no servidor
                  </span>
                </span>
              ) : (
                <span className="text-warning-foreground">
                  {code(envName)} ausente — cadastre nas envs do serviço e reinicie
                </span>
              )
            ) : (
              <>o driver lê {code(envName)} quando o campo fica vazio</>
            )
          }
        >
          <Input
            id={`${kind.key}-secret`}
            className="font-mono"
            value={secretRef}
            placeholder={drv.secretName ?? `${kind.key.toUpperCase()}_API_KEY`}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setSecretRef(e.target.value)}
          />
        </Field>
      )}
      {drv.fields?.map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint} htmlFor={`${kind.key}-${f.key}`}>
          <Input
            id={`${kind.key}-${f.key}`}
            type={f.number ? 'number' : undefined}
            inputMode={f.number ? 'numeric' : undefined}
            value={config[f.key] ?? ''}
            placeholder={f.placeholder}
            spellCheck={false}
            onChange={(e) =>
              setConfig({
                ...config,
                [f.key]:
                  f.number && e.target.value !== '' ? Number(e.target.value) : e.target.value,
              })
            }
          />
        </Field>
      ))}
    </div>
  );
}
