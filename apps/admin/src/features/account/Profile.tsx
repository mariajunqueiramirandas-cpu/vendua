import {
  BellRinging,
  ChatCircleText,
  CheckCircle,
  CurrencyCircleDollar,
  DeviceMobile,
  DownloadSimple,
  EnvelopeSimple,
  Moon,
  SignOut,
  PaperPlaneTilt,
  SpeakerHigh,
  Sun,
  WhatsappLogo,
  XCircle,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type Alerts, type Session } from '../../lib/api.ts';
import { ago, phone, when } from '../../lib/format.ts';
import { setSoundOn } from '../../lib/live.ts';
import { currentSubscription, disablePush, enablePush, pushSupported } from '../../lib/push.ts';
import { optimistic, qk, useMutation } from '../../lib/query.ts';
import { can, ROLE_LABEL, useSession } from '../../lib/session.ts';
import { chimeNewOrder, setVolume } from '../../lib/sound.ts';
import { readTheme, setTheme, type ThemePref } from '../../lib/theme.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { DuaNote, ErrorState, messageOf, Skeleton } from '../../ui/feedback.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { RowsSkeleton } from '../../ui/skeletons.tsx';
import {
  Chips,
  CommitInput,
  Segmented,
  Field,
  SaveMark,
  Toggle,
  useSaveState,
} from '../../ui/fields.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { toast } from '../../ui/Toast.tsx';
import { resetClient } from '../../lib/persist.ts';
import { isIOS, standalone } from '../../lib/pwa.ts';

export default function Profile() {
  const s = useSession();
  const qc = useQueryClient();
  const save = useSaveState();
  const prefs = s.user.prefs;
  const [volume, setVol] = useState(prefs.volume ?? 0.8);
  const [theme, setThemeState] = useState<ThemePref>(readTheme());
  const [push, setPush] = useState<'on' | 'off' | 'unsupported' | 'denied'>('off');
  useEffect(() => {
    if (!pushSupported()) return setPush('unsupported');
    void currentSubscription().then((sub) =>
      setPush(sub ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off'),
    );
  }, []);
  const patch = (body: Parameters<typeof api.updateMe>[0]) =>
    void save
      .track(api.updateMe(body))
      .then((r) => {
        // a new email signs in once proven: it waits for the link sent to it
        if (r.emailConfirmation === 'sent') toast('Enviamos um link para confirmar o e-mail');
        else if (r.emailConfirmation === 'rate_limited')
          toast.error('Muitos pedidos de confirmação. Tente de novo em uma hora.');
        return qc.invalidateQueries({ queryKey: qk.session });
      })
      .catch((e) => toast.error(messageOf(e)));
  // toggles flip at once; a failed save puts them back
  const setPref = async (p: Partial<Session['user']['prefs']>) => {
    const o = await optimistic<Session>(qc, qk.session, (d) => ({
      ...d,
      user: { ...d.user, prefs: { ...d.user.prefs, ...p } },
    }));
    try {
      await save.track(api.updateMe({ prefs: p }));
    } catch (e) {
      o.restore();
      toast.error(messageOf(e));
    }
  };
  const manager = can(s.user.role, 'manager');
  const owner = s.user.role === 'owner';
  const sessions = useQuery({ queryKey: qk.sessions, queryFn: api.sessions });
  const end = useMutation({
    mutationFn: api.endSession,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.sessions }),
  });
  return (
    <PageBody>
      <PageHeader
        title="Meu perfil"
        subtitle={
          <>
            {ROLE_LABEL[s.user.role]} em {s.store.name} <SaveMark state={save.state} />
          </>
        }
      />
      <div className="space-y-8">
        <Section title="Você">
          <Card className="space-y-5 p-5">
            <Field label="Nome" htmlFor="me-name">
              <CommitInput
                id="me-name"
                maxLength={80}
                value={s.user.name}
                onCommit={(v) => patch({ name: v })}
              />
            </Field>
            <Field
              label="E-mail"
              optional
              htmlFor="me-mail"
              helper={
                s.user.pendingEmail
                  ? `Confirme ${s.user.pendingEmail} pelo link que enviamos para lá.`
                  : 'Para receber avisos se o WhatsApp falhar.'
              }
            >
              <CommitInput
                id="me-mail"
                type="email"
                maxLength={200}
                value={s.user.email ?? ''}
                placeholder="voce@exemplo.com"
                onCommit={(v) => patch({ email: v || null })}
              />
            </Field>
          </Card>
        </Section>
        <Section title="Pedido novo" hint="Como o painel te chama quando chega um pedido.">
          <Card className="space-y-4 p-5">
            <Toggle
              checked={prefs.sound !== false}
              onChange={(v) => {
                setSoundOn(v);
                void setPref({ sound: v });
              }}
              label={
                <span className="inline-flex items-center gap-2">
                  <SpeakerHigh className="size-5" /> Som
                </span>
              }
              description="Toca de novo a cada 20 segundos até alguém ver o pedido."
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex flex-1 items-center gap-3">
                <span className="t-label shrink-0">Volume</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  aria-label="volume do som"
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setVol(v);
                    setVolume(v);
                  }}
                  onPointerUp={() => patch({ prefs: { volume } })}
                  onKeyUp={() => patch({ prefs: { volume } })}
                  className="h-11 w-full accent-(--primary)"
                />
              </label>
              <Button
                variant="secondary"
                size="sm"
                icon={<BellRinging />}
                onClick={() => chimeNewOrder()}
              >
                testar som
              </Button>
            </div>
            <div className="border-t border-line pt-4">
              <Toggle
                checked={push === 'on'}
                disabled={push === 'unsupported' || !s.push.publicKey}
                onChange={async (v) => {
                  try {
                    if (v) {
                      const r = await enablePush(s.push.publicKey!);
                      setPush(r);
                      if (r === 'denied')
                        toast.error(
                          'O navegador bloqueou os avisos. Libere nas configurações do site.',
                        );
                      else toast('Avisos ligados neste aparelho ✓');
                    } else {
                      await disablePush();
                      setPush('off');
                    }
                    void setPref({ push: v });
                  } catch (e) {
                    toast.error(messageOf(e));
                  }
                }}
                label={
                  <span className="inline-flex items-center gap-2">
                    <DeviceMobile className="size-5" /> Avisos no celular
                  </span>
                }
                description={
                  !s.push.publicKey
                    ? 'Os avisos ainda não estão ligados na Venduá. O som funciona com o painel aberto.'
                    : push === 'unsupported'
                      ? isIOS() && !standalone()
                        ? 'No iPhone, os avisos chegam pelo app: toque em Compartilhar › Adicionar à Tela de Início e abra por lá.'
                        : 'Este navegador não recebe avisos.'
                      : push === 'denied'
                        ? 'Bloqueado neste navegador. Libere nas configurações do site.'
                        : 'Toca e vibra mesmo com o painel fechado. Dá para aceitar direto do aviso.'
                }
              />
            </div>
          </Card>
        </Section>
        <Section title="Outros avisos" hint="O que mais pode te chamar, além do pedido novo.">
          <Card className="divide-y divide-line px-5 py-1">
            <Toggle
              checked={prefs.pushPayments !== false}
              onChange={(v) => void setPref({ pushPayments: v })}
              label={
                <span className="inline-flex items-center gap-2">
                  <CurrencyCircleDollar className="size-5" /> Pagamento recebido
                </span>
              }
              description="Um aviso no celular quando um pagamento online é aprovado."
            />
            {s.vendedor?.enabled ? (
              <Toggle
                checked={prefs.pushWaiting !== false}
                onChange={(v) => void setPref({ pushWaiting: v })}
                label={
                  <span className="inline-flex items-center gap-2">
                    <ChatCircleText className="size-5" /> Cliente esperando por você
                  </span>
                }
                description="Quando o Duá passa uma conversa para você. Se ninguém responder, avisa de novo em 5 e em 15 minutos."
              />
            ) : null}
            {manager ? (
              <Toggle
                checked={prefs.whatsappAlerts !== false}
                onChange={(v) => void setPref({ whatsappAlerts: v })}
                label={
                  <span className="inline-flex items-center gap-2">
                    <WhatsappLogo className="size-5" /> WhatsApp se o aviso falhar
                  </span>
                }
                description={
                  s.vendedor?.enabled
                    ? 'Se um pedido novo passar do tempo de aceite, ou um cliente esperar 5 minutos, e nenhum aviso tiver chegado, mandamos uma mensagem no seu WhatsApp.'
                    : 'Se um pedido novo passar do tempo de aceite e nenhum aviso tiver chegado, mandamos uma mensagem no seu WhatsApp.'
                }
              />
            ) : null}
            {owner ? (
              <Toggle
                checked={prefs.emailInvoices !== false}
                onChange={(v) => void setPref({ emailInvoices: v })}
                disabled={!s.user.email}
                label={
                  <span className="inline-flex items-center gap-2">
                    <EnvelopeSimple className="size-5" /> Faturas por e-mail
                  </span>
                }
                description={
                  s.user.email
                    ? `A fatura do plano chega em ${s.user.email}.`
                    : 'Cadastre seu e-mail acima para receber as faturas do plano.'
                }
              />
            ) : null}
          </Card>
        </Section>
        <AlertsSection manager={manager} />
        {s.duaWhatsapp ? (
          <DuaWhatsappSection
            dua={s.duaWhatsapp}
            on={prefs.duaWhatsapp === true}
            myPhone={s.user.phone}
            onChange={(v) => void setPref({ duaWhatsapp: v })}
          />
        ) : null}
        <Section title="Aparência do painel" hint="Auto segue o claro ou escuro do celular.">
          <Card className="p-5">
            <Segmented
              label="tema"
              value={theme}
              onChange={(t) => {
                setThemeState(t);
                setTheme(t);
                void setPref({ theme: t });
              }}
              options={[
                {
                  value: 'creme',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <Sun className="size-4" /> Creme
                    </span>
                  ),
                },
                {
                  value: 'noite',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <Moon className="size-4" /> Noite
                    </span>
                  ),
                },
                {
                  value: 'system',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <DeviceMobile className="size-4" /> Auto
                    </span>
                  ),
                },
              ]}
            />
          </Card>
        </Section>
        <Section title="Aparelhos conectados">
          <DuaNote pose="seguranca" className="mb-3">
            Só entra quem tem o código no WhatsApp. Não reconhece um aparelho? Toque em sair nele.
          </DuaNote>
          <Card className="divide-y divide-line">
            {sessions.isPending ? <Skeleton className="h-16 rounded-none" delay={0} /> : null}
            {(sessions.data?.sessions ?? []).map((x) => (
              <div key={x.id} className="flex min-h-16 items-center gap-3 px-4 py-2">
                <DeviceMobile className="size-6 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{deviceName(x.device)}</p>
                  <p className="t-caption text-muted">
                    {x.current ? 'este aparelho' : `usado ${ago(x.lastSeenAt)}`}
                  </p>
                </div>
                {!x.current ? (
                  <Button size="sm" variant="ghost" onClick={() => end.mutate(x.id)}>
                    sair
                  </Button>
                ) : null}
              </div>
            ))}
          </Card>
          <Button
            variant="ghost"
            className="mt-3 text-danger"
            icon={<SignOut />}
            onClick={async () => {
              await disablePush().catch(() => undefined);
              await api.auth.logout().catch(() => undefined);
              await resetClient(qc);
              window.location.assign('/admin/entrar');
            }}
          >
            sair deste aparelho
          </Button>
        </Section>
      </div>
    </PageBody>
  );
}

/** "+55 (11) 98765-4321" for Brazil; other countries as "+<digits>" */
function intlPhone(d: string) {
  return d.startsWith('55') && (d.length === 12 || d.length === 13) ? `+55 ${phone(d)}` : `+${d}`;
}

function vcard(d: string) {
  const card = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Duá · Venduá',
    'N:Venduá;Duá;;;',
    'ORG:Venduá',
    `TEL;TYPE=CELL:+${d}`,
    'END:VCARD',
    '',
  ].join('\r\n');
  return `data:text/vcard;charset=utf-8,${encodeURIComponent(card)}`;
}

/** Perfil's opt-in to talk to Duá from the person's own WhatsApp (dua-no-whatsapp §6). */
function DuaWhatsappSection({
  dua,
  on,
  myPhone,
  onChange,
}: {
  dua: NonNullable<Session['duaWhatsapp']>;
  on: boolean;
  myPhone: string;
  onChange: (v: boolean) => void;
}) {
  const active = on && dua.allowed;
  return (
    <Section
      id="dua-whatsapp"
      title="Duá pelo WhatsApp"
      hint="Pergunte e peça mudanças na loja sem abrir o painel."
    >
      <Card className="space-y-4 p-5">
        <Toggle
          checked={active}
          disabled={!dua.allowed}
          onChange={onChange}
          label={
            <span className="inline-flex items-center gap-2">
              <WhatsappLogo className="size-5" /> Falar com o Duá pelo WhatsApp
            </span>
          }
          description={
            dua.allowed
              ? `Escrevendo ou por áudio, do seu número ${phone(myPhone)}.`
              : 'O dono da loja desligou o Duá pelo WhatsApp para gerentes.'
          }
        />
        {active ? (
          <div className="space-y-4 border-t border-line pt-4">
            {dua.number ? (
              <div>
                <p className="t-label text-muted">Número da Venduá</p>
                <p className="t-title-2 mt-0.5 whitespace-nowrap tabular-nums">
                  {intlPhone(dua.number)}
                </p>
                <p className="t-caption mt-1 text-muted">
                  É o mesmo número que manda seus códigos de acesso.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href={`https://wa.me/${dua.number}?text=oi`}
                    target="_blank"
                    rel="noreferrer"
                    className="t-label inline-flex min-h-12 items-center gap-2 rounded-md bg-whatsapp px-4 text-on-whatsapp depth-1 transition-transform active:scale-[0.97]"
                  >
                    <WhatsappLogo weight="fill" className="size-5" /> abrir no WhatsApp
                  </a>
                  <a
                    href={vcard(dua.number)}
                    download="dua-vendua.vcf"
                    className="t-label inline-flex min-h-12 items-center gap-2 rounded-md bg-surface px-4 text-ink ring-1 ring-line-strong depth-1 transition-transform hover:bg-hover active:scale-[0.97]"
                  >
                    <DownloadSimple className="size-5" /> salvar contato
                  </a>
                </div>
              </div>
            ) : (
              <p className="t-body text-muted">
                Mande uma mensagem para o número que manda seus códigos de acesso.
              </p>
            )}
            <ul className="t-caption list-disc space-y-1 pl-5 text-muted">
              <li>Quando o Duá preparar uma mudança, responda SIM para aplicar.</li>
              <li>Mudanças de preço e desconto continuam só pelo painel.</li>
            </ul>
          </div>
        ) : null}
      </Card>
    </Section>
  );
}

function deviceName(ua: string) {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Celular Android' : 'Tablet Android';
  if (/Mac OS/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Computador Windows';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Linux/.test(ua)) return 'Computador Linux';
  return ua.trim() && ua.length <= 40 ? ua : 'Navegador';
}

const EVENT: Record<string, string> = {
  'order.placed': 'Pedido novo',
  'order.whatsapp': 'Pedido esperando',
  'vendedor.waiting': 'Cliente esperando',
  'vendedor.whatsapp': 'Cliente esperando',
  'vendedor.ask': 'Contato novo',
  'payment.received': 'Pagamento recebido',
  test: 'Aviso de teste',
};

type TestResult = { devices: number; ok: number; failed: number };

/** "Seus avisos": did the last alerts reach anyone, and a test the merchant can run now. */
function AlertsSection({ manager }: { manager: boolean }) {
  const qc = useQueryClient();
  const me = useSession().user.id;
  const alerts = useQuery({ queryKey: qk.alerts, queryFn: api.alerts, enabled: manager });
  const [result, setResult] = useState<TestResult | null>(null);
  const test = useMutation({
    mutationFn: api.testAlert,
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: qk.alerts });
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const data = alerts.data;
  const devices = [...(data?.devices ?? [])].sort(
    (a, b) => Number(b.userId === me) - Number(a.userId === me),
  );
  const recent = (data?.recent ?? []).slice(0, 8);
  useEffect(() => {
    // "ver avisos" from a toast or the help sheet lands here
    if (location.hash === '#avisos')
      document.getElementById('avisos')?.scrollIntoView({ block: 'start' });
  }, []);
  return (
    <Section
      id="avisos"
      title="Seus avisos"
      hint="Confira se os avisos de pedido estão chegando nos celulares."
    >
      <div className="space-y-3">
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            <p className="t-body min-w-0 flex-1 text-muted">
              Mandamos um aviso de teste para os seus aparelhos com avisos ligados.
            </p>
            <Button
              variant="secondary"
              icon={<PaperPlaneTilt />}
              loading={test.isPending}
              onClick={() => test.mutate()}
            >
              testar aviso
            </Button>
          </div>
          {result ? <TestOutcome r={result} /> : null}
        </Card>
        {manager ? (
          alerts.error && !data ? (
            <Card>
              <ErrorState error={alerts.error} retry={() => void alerts.refetch()} />
            </Card>
          ) : !data ? (
            <RowsSkeleton rows={2} />
          ) : (
            <>
              <Card as="section" aria-label="aparelhos que recebem avisos">
                <p className="t-label px-4 pb-1 pt-4">Aparelhos que recebem avisos</p>
                {devices.length ? (
                  <ul className="divide-y divide-line">
                    {devices.map((d) => (
                      <DeviceAlertRow key={d.id} d={d} mine={d.userId === me} />
                    ))}
                  </ul>
                ) : (
                  <p className="t-body px-4 pb-4 text-muted">
                    Nenhum aparelho recebe avisos ainda. Ligue os avisos no celular que fica na
                    cozinha ou no balcão.
                  </p>
                )}
              </Card>
              <Notice
                tone={data.whatsappFallback ? 'success' : 'info'}
                icon={<WhatsappLogo weight="fill" />}
                title={
                  data.whatsappFallback
                    ? 'WhatsApp de reserva ligado'
                    : 'Sem WhatsApp de reserva por enquanto'
                }
              >
                {data.whatsappFallback
                  ? 'Se um pedido novo esperar e nenhum aviso tiver chegado, donos e gerentes recebem uma mensagem no WhatsApp.'
                  : 'Hoje os avisos chegam só pelo celular. Deixe os avisos ligados e o painel aberto no balcão.'}
              </Notice>
              {recent.length ? (
                <Card as="section" aria-label="últimos avisos">
                  <p className="t-label px-4 pb-1 pt-4">Últimos avisos</p>
                  <ul className="divide-y divide-line">
                    {recent.map((a, i) => {
                      const bad = a.result !== 'ok';
                      return (
                        <li
                          key={`${a.at}-${i}`}
                          className={cn(
                            'flex min-h-14 items-center gap-3 px-4 py-2.5',
                            bad && 'bg-danger-soft',
                          )}
                        >
                          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sunken [&_svg]:size-4.5">
                            {a.channel === 'whatsapp' ? (
                              <WhatsappLogo weight="duotone" aria-label="WhatsApp" />
                            ) : (
                              <BellRinging weight="duotone" aria-label="aviso no celular" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">
                              {EVENT[a.event] ?? 'Aviso'}
                              {a.userName ? (
                                <span className="font-normal text-muted"> · {a.userName}</span>
                              ) : null}
                            </span>
                            <span className="t-caption block text-muted">
                              {when(a.at)}
                              {bad && a.detail ? ` · ${friendlyDetail(a.detail)}` : ''}
                            </span>
                          </span>
                          <ResultWord r={a.result} />
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              ) : null}
            </>
          )
        ) : null}
      </div>
    </Section>
  );
}

function TestOutcome({ r }: { r: TestResult }) {
  if (!r.devices)
    return (
      <Notice
        tone="warning"
        title="Nenhum aparelho seu recebe avisos"
        className="mt-4"
        role="status"
      >
        Ligue “Avisos no celular” acima, neste aparelho ou no celular do balcão, e teste de novo.
      </Notice>
    );
  if (!r.failed)
    return (
      <Notice tone="success" title="Aviso enviado" className="mt-4" role="status">
        {r.ok === 1
          ? 'Chegou no seu aparelho. Se não tocou, confira o volume e o modo silencioso.'
          : `Chegou nos seus ${r.ok} aparelhos. Se algum não tocou, confira o volume e o modo silencioso.`}
      </Notice>
    );
  return (
    <Notice tone="danger" title="Nem todo aviso chegou" className="mt-4" role="status">
      {r.ok
        ? `Chegou em ${r.ok} de ${r.devices} aparelhos. `
        : r.devices === 1
          ? 'Não chegou no seu aparelho. '
          : `Não chegou em nenhum dos seus ${r.devices} aparelhos. `}
      Abra o painel no aparelho que falhou e ligue os avisos de novo.
    </Notice>
  );
}

function ResultWord({ r }: { r: 'ok' | 'error' | 'gone' | null }) {
  if (!r) return <span className="t-caption shrink-0 text-muted">sem avisos</span>;
  const ok = r === 'ok';
  return (
    <span
      className={cn(
        't-label inline-flex shrink-0 items-center gap-1',
        ok ? 'text-success' : 'text-danger',
      )}
    >
      {ok ? (
        <CheckCircle weight="fill" className="size-4.5" aria-hidden />
      ) : (
        <XCircle weight="fill" className="size-4.5" aria-hidden />
      )}
      {ok ? 'chegou' : r === 'gone' ? 'desligado' : 'falhou'}
    </span>
  );
}

function DeviceAlertRow({ d, mine }: { d: Alerts['devices'][number]; mine: boolean }) {
  const line =
    d.lastResult === 'gone'
      ? 'Os avisos foram desligados neste aparelho. Abra o painel nele e ligue de novo.'
      : d.lastResult === 'error' && d.lastAt
        ? `O último aviso falhou ${ago(d.lastAt)}`
        : d.lastResult === 'ok' && d.lastAt
          ? `Último aviso chegou ${ago(d.lastAt)}`
          : `Ligado ${ago(d.createdAt)} · nenhum aviso ainda`;
  return (
    <li className="flex min-h-16 items-center gap-3 px-4 py-2.5">
      <DeviceMobile className="size-6 shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">
          {deviceName(d.device)}
          <span className="font-normal text-muted"> · {mine ? 'você' : d.userName}</span>
        </span>
        <span
          className={cn(
            't-caption block',
            d.lastResult && d.lastResult !== 'ok' ? 'text-danger' : 'text-muted',
          )}
        >
          {line}
        </span>
      </span>
      <ResultWord r={d.lastResult} />
    </li>
  );
}

// provider errors arrive as raw text; the merchant only needs to know what to do
function friendlyDetail(d: string) {
  if (/410|gone|expired|unsubscribed/i.test(d)) return 'o aparelho desligou os avisos';
  if (/timeout|network|ECONN/i.test(d)) return 'sem conexão na hora';
  return 'não chegou';
}
