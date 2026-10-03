import {
  AndroidLogo,
  Bluetooth,
  Desktop,
  DeviceTablet,
  LinkBreak,
  Plus,
  Printer as PrinterIcon,
  Receipt,
  Usb,
  WifiHigh,
  WindowsLogo,
  type Icon,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  api,
  type CodePage,
  type PrintDevice,
  type Printer,
  type Printers as PrintersData,
} from '../../lib/api.ts';
import { ago } from '../../lib/format.ts';
import { optimistic, qk, useMutation } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState, messageOf } from '../../ui/feedback.tsx';
import { Field, Segmented, Select, Stepper, TextInput, Toggle } from '../../ui/fields.tsx';
import { HoldButton } from '../../ui/HoldButton.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { LockedPage, reasonOf } from '../../ui/PlanLocked.tsx';
import { isPlanRequired, useFeature } from '../../lib/session.ts';
import { TONE, type Tone } from '../../ui/PaymentChip.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { SectionsSkeleton } from '../../ui/skeletons.tsx';
import { Spinner } from '../../ui/Spinner.tsx';
import { toast } from '../../ui/Toast.tsx';

// Impressoras (ADR 0027): a small app on the store's computer or tablet holds the printer; Core
// renders every ticket and sends it there. This screen pairs that app, says which printers print
// orders on their own and how, and shows whether the last ticket made it out.

const PLATFORM: Record<PrintDevice['platform'], { label: string; Icon: Icon }> = {
  windows: { label: 'Computador Windows', Icon: Desktop },
  android: { label: 'Tablet Android', Icon: DeviceTablet },
  linux: { label: 'Computador Linux', Icon: Desktop },
};

const KIND: Record<Printer['kind'], { label: string; Icon: Icon }> = {
  spooler: { label: 'Instalada no Windows', Icon: PrinterIcon },
  tcp: { label: 'Rede', Icon: WifiHigh },
  serial: { label: 'Porta serial', Icon: Usb },
  usb: { label: 'USB', Icon: Usb },
  bluetooth: { label: 'Bluetooth', Icon: Bluetooth },
};

const CODEPAGES: { value: CodePage; label: string }[] = [
  { value: 'cp850', label: 'Padrão (serve na maioria)' },
  { value: 'cp860', label: 'Português (CP860)' },
  { value: 'ascii', label: 'Sem acentos' },
];

/** `k7qd4mxa` → `K7QD-4MXA` as it's typed */
function formatCode(v: string) {
  const c = v
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export default function Printers() {
  const open = useFeature('printing');
  const { data, error, refetch } = useQuery({
    queryKey: qk.printers,
    queryFn: api.printers,
    enabled: open,
  });
  const [params] = useSearchParams();
  const nav = useNavigate();
  const linked = params.get('code');
  const [pairOpen, setPairOpen] = useState(!!linked);
  useEffect(() => {
    if (linked) setPairOpen(true);
  }, [linked]);
  const closePair = (v: boolean) => {
    setPairOpen(v);
    if (!v && linked) nav('/impressoras', { replace: true });
  };

  // the plan without printing: the screen shows the plan that has it (pairing links included)
  if (!open || data?.included === false || isPlanRequired(error))
    return (
      <LockedPage title="Impressoras" feature="printing" reason={reasonOf(error)} refresh={open} />
    );
  if (error && !data)
    return (
      <PageBody>
        <ErrorState error={error} retry={() => void refetch()} />
      </PageBody>
    );
  const devices = data?.devices ?? [];
  return (
    <PageBody wide>
      <PageHeader
        title="Impressoras"
        subtitle="O pedido sai impresso na cozinha, sem ninguém precisar apertar nada."
        actions={
          devices.length > 0 ? (
            <Button variant="secondary" icon={<Plus />} onClick={() => setPairOpen(true)}>
              conectar aparelho
            </Button>
          ) : null
        }
      />
      {!data ? (
        <SectionsSkeleton columns={2} />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] [&>*]:min-w-0">
          <div className="space-y-8">
            {devices.length === 0 ? (
              <Setup data={data} onCode={() => setPairOpen(true)} />
            ) : (
              <Section title="Aparelhos" hint="Cada um imprime nas impressoras ligadas a ele.">
                <ul className="space-y-4">
                  {devices.map((d) => (
                    <DeviceCard key={d.id} device={d} printOn={data.printOn} />
                  ))}
                </ul>
                <Button
                  variant="secondary"
                  block
                  icon={<Plus />}
                  className="mt-4 md:hidden"
                  onClick={() => setPairOpen(true)}
                >
                  conectar outro aparelho
                </Button>
              </Section>
            )}
          </div>
          <div className="space-y-8">
            <WhenSection printOn={data.printOn} />
            <Downloads data={data} compact={devices.length === 0} />
          </div>
        </div>
      )}
      <PairSheet open={pairOpen} onOpenChange={closePair} initialCode={linked ?? ''} />
    </PageBody>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span
        className="tnum grid size-9 shrink-0 place-items-center rounded-full bg-spark-soft font-semibold"
        aria-hidden
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <p className="font-semibold">{title}</p>
        <div className="t-body mt-0.5 text-muted">{children}</div>
      </div>
    </li>
  );
}

function DownloadLink({ href, Icon, children }: { href: string; Icon: Icon; children: ReactNode }) {
  return (
    <a
      href={href}
      rel="noreferrer"
      className="t-label inline-flex h-12 items-center justify-center gap-2 rounded-md bg-surface px-4 text-ink ring-1 ring-line-strong transition-[scale,background-color] duration-(--duration-instant) depth-1 hover:bg-hover active:scale-[0.97] [&_svg]:size-5"
    >
      <Icon weight="fill" aria-hidden />
      {children}
    </a>
  );
}

function Setup({ data, onCode }: { data: PrintersData; onCode: () => void }) {
  return (
    <Card as="section" aria-labelledby="pr-setup" className="p-5 md:p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-on-primary">
          <Receipt weight="fill" className="size-6.5" />
        </span>
        <div className="min-w-0">
          <h2 id="pr-setup" className="t-title-2">
            Conecte sua impressora
          </h2>
          <p className="t-caption text-muted">Térmica de 58 ou 80 mm, USB, rede ou Bluetooth.</p>
        </div>
      </div>
      <ol className="space-y-5">
        <Step n={1} title="Instale o app no aparelho ligado à impressora">
          <p>
            Um computador com Windows ou um tablet Android, que fique ligado no horário da loja.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
            <DownloadLink href={data.downloads.windows} Icon={WindowsLogo}>
              Windows
            </DownloadLink>
            <DownloadLink href={data.downloads.android} Icon={AndroidLogo}>
              Android
            </DownloadLink>
          </div>
        </Step>
        <Step n={2} title="Abra o app">
          Ele mostra um código com 8 letras e números.
        </Step>
        <Step n={3} title="Digite o código aqui">
          <Button className="mt-3" onClick={onCode}>
            digitar código
          </Button>
        </Step>
      </ol>
    </Card>
  );
}

function WhenSection({ printOn }: { printOn: PrintersData['printOn'] }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: async (v: PrintersData['printOn']) => {
      const o = await optimistic<PrintersData>(qc, qk.printers, (d) => ({ ...d, printOn: v }));
      try {
        return await api.printersSettings(v);
      } catch (e) {
        o.restore();
        throw e;
      }
    },
    onSuccess: (d) => qc.setQueryData(qk.printers, d),
    onError: (e) => toast.error(messageOf(e)),
  });
  return (
    <Section
      title="Quando imprimir"
      hint="Vale para as impressoras com impressão automática ligada."
    >
      <Card className="p-4">
        <Segmented
          label="quando imprimir"
          value={printOn}
          onChange={(v) => save.mutate(v)}
          options={[
            { value: 'confirmed', label: 'Ao aceitar o pedido' },
            { value: 'placed', label: 'Assim que chega' },
          ]}
        />
        <p className="t-caption mt-3 px-1 text-muted">
          {printOn === 'confirmed'
            ? 'A comanda sai quando você toca em aceitar. Pedido recusado não gasta papel.'
            : 'A comanda sai no instante em que o cliente fecha o pedido.'}
        </p>
      </Card>
    </Section>
  );
}

function Downloads({ data, compact }: { data: PrintersData; compact: boolean }) {
  return (
    <Section title="O app Venduá Impressora" hint={compact ? undefined : 'Para outro aparelho.'}>
      <Card className="space-y-4 p-4">
        {!compact ? (
          <div className="grid grid-cols-2 gap-2">
            <DownloadLink href={data.downloads.windows} Icon={WindowsLogo}>
              Windows
            </DownloadLink>
            <DownloadLink href={data.downloads.android} Icon={AndroidLogo}>
              Android
            </DownloadLink>
          </div>
        ) : null}
        <Notice tone="info" title="No Windows" icon={<WindowsLogo weight="fill" />}>
          Se aparecer “O Windows protegeu o computador”, toque em <b>Mais informações</b> e depois
          em <b>Executar assim mesmo</b>. Ele abre sozinho quando o computador liga.
        </Notice>
        <Notice tone="info" title="No Android" icon={<AndroidLogo weight="fill" />}>
          Permita instalar apps do navegador quando o tablet pedir. Depois, no app, siga a lista de
          ajustes para ele não ser fechado com a tela apagada.
        </Notice>
      </Card>
    </Section>
  );
}

function deviceStatus(d: PrintDevice): { label: string; tone: Tone } {
  if (!d.ready) return { label: 'abrindo o app', tone: 'info' };
  if (d.online) return { label: 'conectado', tone: 'success' };
  return { label: 'desligado', tone: 'warning' };
}

function DeviceCard({
  device,
  printOn,
}: {
  device: PrintDevice;
  printOn: PrintersData['printOn'];
}) {
  const [open, setOpen] = useState<Printer | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const st = deviceStatus(device);
  const P = PLATFORM[device.platform];
  const seen = !device.online && device.lastSeenAt ? `visto ${ago(device.lastSeenAt)}` : P.label;
  const current = open ? (device.printers.find((p) => p.id === open.id) ?? open) : null;
  return (
    <Card as="li" className="overflow-hidden">
      <div className="flex items-start gap-3 p-4 pb-3 md:px-5">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sunken">
          <P.Icon weight="duotone" className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="t-body-lg min-w-0 truncate font-semibold">{device.name}</h3>
            <span
              className={cn(
                't-caption inline-flex h-7 shrink-0 items-center rounded-full px-2.5 font-semibold',
                TONE[st.tone],
              )}
            >
              {st.label}
            </span>
          </div>
          <p className="t-caption tnum mt-0.5 text-muted">
            {seen}
            {device.version ? ` · versão ${device.version}` : ''}
          </p>
        </div>
      </div>
      {!device.ready ? (
        <p className="t-body flex items-center gap-2 px-4 pb-4 text-muted md:px-5">
          <Spinner className="size-4" /> Esperando o app terminar de conectar…
        </p>
      ) : device.printers.length === 0 ? (
        <p className="t-body px-4 pb-4 text-muted md:px-5">
          Nenhuma impressora encontrada. Ligue a impressora e, no app, toque em procurar
          impressoras.
        </p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {device.printers.map((p) => (
            <li key={p.id}>
              <PrinterRow printer={p} onOpen={() => setOpen(p)} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 border-t border-line px-2 py-2 md:px-3">
        <Button variant="ghost" size="sm" icon={<WifiHigh />} onClick={() => setAdding(true)}>
          impressora de rede
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<LinkBreak />}
          className="text-muted"
          onClick={() => setRemoving(true)}
        >
          desconectar
        </Button>
      </div>
      <PrinterSheet printer={current} printOn={printOn} onOpenChange={(v) => !v && setOpen(null)} />
      <NetworkSheet open={adding} onOpenChange={setAdding} device={device} />
      <UnpairSheet open={removing} onOpenChange={setRemoving} device={device} />
    </Card>
  );
}

/** the line under a printer: what happened last, in words */
function lastResult(p: Printer): { text: string; tone: 'ok' | 'bad' | 'quiet' } {
  if (!p.present) return { text: 'não encontrada agora', tone: 'bad' };
  const failed = p.lastErrorAt && (!p.lastOkAt || p.lastErrorAt > p.lastOkAt);
  if (failed) return { text: `falhou ${ago(p.lastErrorAt!)}: ${p.lastError}`, tone: 'bad' };
  if (p.lastOkAt) return { text: `imprimiu ${ago(p.lastOkAt)}`, tone: 'ok' };
  return { text: 'ainda não imprimiu', tone: 'quiet' };
}

function PrinterRow({ printer: p, onOpen }: { printer: Printer; onOpen: () => void }) {
  const K = KIND[p.kind];
  const last = lastResult(p);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="press-row flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left md:px-5"
    >
      <K.Icon weight="duotone" className="size-6 shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{p.name}</span>
        <span className="t-caption block truncate text-muted">
          {p.kind === 'tcp' ? `${K.label} · ${p.address}` : K.label}
        </span>
        <span
          className={cn(
            't-caption line-clamp-2 block',
            last.tone === 'bad' ? 'text-danger' : 'text-muted',
          )}
        >
          {last.text}
        </span>
      </span>
      <span
        className={cn(
          't-caption shrink-0 rounded-full px-2.5 py-1 font-semibold',
          p.auto ? TONE.success : 'bg-sunken text-muted',
        )}
      >
        {p.auto ? 'automática' : 'manual'}
      </span>
    </button>
  );
}

function PrinterSheet({
  printer,
  printOn,
  onOpenChange,
}: {
  printer: Printer | null;
  printOn: PrintersData['printOn'];
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const [auto, setAuto] = useState(false);
  const [paper, setPaper] = useState<'58' | '80'>('80');
  const [copies, setCopies] = useState(1);
  const [cut, setCut] = useState(true);
  const [codepage, setCodepage] = useState<CodePage>('cp850');
  const id = printer?.id;
  useEffect(() => {
    if (!printer) return;
    setLabel(printer.label ?? '');
    setAuto(printer.auto);
    setPaper(String(printer.paper) as '58' | '80');
    setCopies(printer.copies);
    setCut(printer.cut);
    setCodepage(printer.codepage);
    // only when another printer opens, not on every refetch under the open sheet
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const save = useMutation({
    mutationFn: () =>
      api.updatePrinter(id!, {
        label: label.trim() || null,
        auto,
        paper: Number(paper) as 58 | 80,
        copies,
        cut,
        codepage,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.printers });
      toast('Impressora salva');
      onOpenChange(false);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const test = useMutation({
    mutationFn: async () => {
      // the test prints with what's on screen
      await api.updatePrinter(id!, { paper: Number(paper) as 58 | 80, cut, codepage });
      return api.testPrinter(id!);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.printers });
      toast(`Teste enviado para ${printer?.name ?? 'a impressora'}`);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.removePrinter(id!),
    onSuccess: (d) => {
      qc.setQueryData(qk.printers, d);
      toast('Impressora removida');
      onOpenChange(false);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const removable = printer && (printer.source === 'manual' || !printer.present);
  return (
    <Sheet
      open={!!printer}
      onOpenChange={onOpenChange}
      title={printer?.name ?? 'Impressora'}
      description={printer ? `${KIND[printer.kind].label} · ${printer.reportedName}` : undefined}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            size="lg"
            loading={test.isPending}
            onClick={() => test.mutate()}
          >
            imprimir teste
          </Button>
          <Button size="lg" loading={save.isPending} onClick={() => save.mutate()}>
            salvar
          </Button>
        </div>
      }
    >
      {printer ? (
        <div className="space-y-5 pb-2 pt-1">
          <Toggle
            checked={auto}
            onChange={setAuto}
            label="Imprimir pedidos sozinha"
            description={
              printOn === 'confirmed'
                ? 'A comanda sai quando você aceita o pedido.'
                : 'A comanda sai assim que o pedido chega.'
            }
          />
          <Field label="Nome" htmlFor="pr-label" optional helper="Como “Cozinha” ou “Balcão”.">
            <TextInput
              id="pr-label"
              maxLength={60}
              value={label}
              placeholder={printer.reportedName}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Field label="Largura do papel">
            <Segmented
              label="largura do papel"
              value={paper}
              onChange={setPaper}
              options={[
                { value: '58', label: '58 mm' },
                { value: '80', label: '80 mm' },
              ]}
            />
          </Field>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-semibold">Cópias</p>
              <p className="t-caption text-muted">De cada pedido.</p>
            </div>
            <Stepper label="cópias" value={copies} onChange={setCopies} min={1} max={3} />
          </div>
          <Toggle
            checked={cut}
            onChange={setCut}
            label="Cortar o papel"
            description="Desligue se a impressora não tem guilhotina."
          />
          <Field
            label="Acentos"
            htmlFor="pr-cp"
            helper="Se sair um símbolo no lugar de ç ou ã, troque aqui e imprima um teste."
          >
            <Select
              id="pr-cp"
              value={codepage}
              onChange={(v) => setCodepage(v as CodePage)}
              options={CODEPAGES}
            />
          </Field>
          {removable ? (
            <Button
              variant="ghost"
              className="-ml-3 text-danger"
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              remover impressora
            </Button>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}

function PairSheet({
  open,
  onOpenChange,
  initialCode,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialCode: string;
}) {
  const qc = useQueryClient();
  const [code, setCode] = useState(() => formatCode(initialCode));
  useEffect(() => {
    if (open) setCode(formatCode(initialCode));
  }, [open, initialCode]);
  const complete = code.length === 9;
  const info = useQuery({
    queryKey: qk.pairing(code),
    queryFn: () => api.pairing(code),
    enabled: open && complete,
    retry: false,
    staleTime: 0,
  });
  const pair = useMutation({
    mutationFn: () => api.pairDevice(code),
    onSuccess: (d) => {
      qc.setQueryData(qk.printers, d);
      toast(`${info.data?.name ?? 'Aparelho'} conectado`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const p = info.data;
  const problem =
    info.error || p?.status === 'expired'
      ? 'Esse código não vale mais. No app, gere um código novo.'
      : p?.status === 'taken'
        ? 'Esse código já foi usado em outra loja.'
        : null;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Conectar aparelho"
      description="Digite o código que aparece no app Venduá Impressora."
      footer={
        <Button
          size="lg"
          block
          disabled={!complete || !p || p.status !== 'pending'}
          loading={pair.isPending}
          onClick={() => pair.mutate()}
        >
          conectar
        </Button>
      }
    >
      <form
        className="space-y-5 pb-2 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (p?.status === 'pending') pair.mutate();
        }}
      >
        <Field label="Código" htmlFor="pr-code">
          <TextInput
            id="pr-code"
            value={code}
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="XXXX-XXXX"
            maxLength={9}
            aria-invalid={!!problem || undefined}
            className="tnum font-mono tracking-[0.18em] uppercase"
            onChange={(e) => setCode(formatCode(e.target.value))}
          />
        </Field>
        <div aria-live="polite">
          {problem ? (
            <Notice tone="warning" title="Não deu para conectar">
              {problem}
            </Notice>
          ) : p?.status === 'approved' ? (
            <Notice tone="success" title={`${p.name} já está conectado`} />
          ) : p ? (
            <div className="flex items-center gap-3 rounded-md bg-sunken p-4">
              {(() => {
                const P = PLATFORM[p.platform];
                return <P.Icon weight="duotone" className="size-7 shrink-0" aria-hidden />;
              })()}
              <div className="min-w-0">
                <p className="truncate font-semibold">{p.name}</p>
                <p className="t-caption text-muted">
                  {PLATFORM[p.platform].label} quer imprimir os pedidos da sua loja.
                </p>
              </div>
            </div>
          ) : complete && info.isFetching ? (
            <p className="t-caption flex items-center gap-2 text-muted">
              <Spinner className="size-4" /> Procurando o aparelho…
            </p>
          ) : null}
        </div>
      </form>
    </Sheet>
  );
}

function NetworkSheet({
  open,
  onOpenChange,
  device,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  device: PrintDevice;
}) {
  const qc = useQueryClient();
  const [address, setAddress] = useState('');
  useEffect(() => {
    if (open) setAddress('');
  }, [open]);
  const add = useMutation({
    mutationFn: () => api.addNetworkPrinter(device.id, address.trim()),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: qk.printers });
      toast(`${p.name} adicionada`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Impressora de rede"
      description={`Uma impressora ligada no roteador, na mesma rede de ${device.name}.`}
      footer={
        <Button
          size="lg"
          block
          disabled={address.trim().length < 3}
          loading={add.isPending}
          onClick={() => add.mutate()}
        >
          adicionar
        </Button>
      }
    >
      <form
        className="space-y-4 pb-2 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (address.trim().length >= 3) add.mutate();
        }}
      >
        <Field
          label="Endereço IP"
          htmlFor="pr-ip"
          helper="Aparece no papel de autoteste: desligue, segure o botão de avanço e ligue."
        >
          <TextInput
            id="pr-ip"
            inputMode="decimal"
            spellCheck={false}
            autoCapitalize="none"
            placeholder="192.168.0.50"
            maxLength={100}
            value={address}
            className="tnum"
            onChange={(e) => setAddress(e.target.value)}
          />
        </Field>
      </form>
    </Sheet>
  );
}

function UnpairSheet({
  open,
  onOpenChange,
  device,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  device: PrintDevice;
}) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.unpairDevice(device.id),
    onSuccess: (d) => {
      qc.setQueryData(qk.printers, d);
      toast(`${device.name} desconectado`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Desconectar ${device.name}?`}
      description="Os pedidos param de sair nas impressoras dele. Para voltar, conecte com um código novo."
      footer={
        <HoldButton onConfirm={() => remove.mutate()} disabled={remove.isPending}>
          {remove.isPending ? 'desconectando…' : 'segure para desconectar'}
        </HoldButton>
      }
    >
      <div className="pb-2">
        <Notice tone="warning" title="A configuração das impressoras dele se perde">
          Nome, papel e cópias de cada impressora voltam ao padrão se ele for conectado de novo.
        </Notice>
      </div>
    </Sheet>
  );
}
