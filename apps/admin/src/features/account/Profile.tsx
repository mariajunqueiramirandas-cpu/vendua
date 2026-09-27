import { BellRinging, DeviceMobile, Moon, SignOut, SpeakerHigh, Sun } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';
import { ago } from '../../lib/format.ts';
import { setSoundOn } from '../../lib/live.ts';
import { currentSubscription, disablePush, enablePush, pushSupported } from '../../lib/push.ts';
import { qk } from '../../lib/query.ts';
import { ROLE_LABEL, useSession } from '../../lib/session.ts';
import { chimeNewOrder, setVolume } from '../../lib/sound.ts';
import { readTheme, setTheme, type ThemePref } from '../../lib/theme.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { Chips, CommitInput, Field, SaveMark, Toggle, useSaveState } from '../../ui/fields.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { toast } from '../../ui/Toast.tsx';

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
      .then(() => qc.invalidateQueries({ queryKey: qk.session }))
      .catch((e) => toast.error(messageOf(e)));
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
              helper="Para receber avisos se o WhatsApp falhar."
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
                patch({ prefs: { sound: v } });
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
                    patch({ prefs: { push: v } });
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
                      ? 'Este navegador não recebe avisos. No iPhone, adicione o painel à tela de início.'
                      : push === 'denied'
                        ? 'Bloqueado neste navegador. Libere nas configurações do site.'
                        : 'Toca e vibra mesmo com o painel fechado. Dá para aceitar direto do aviso.'
                }
              />
            </div>
          </Card>
        </Section>
        <Section title="Aparência do painel">
          <Card className="p-5">
            <Chips
              label="tema"
              value={theme}
              onChange={(t) => {
                setThemeState(t);
                setTheme(t);
                patch({ prefs: { theme: t } });
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
                { value: 'system', label: 'igual ao celular' },
              ]}
            />
          </Card>
        </Section>
        <Section title="Aparelhos conectados">
          <Card className="divide-y divide-line">
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
              await api.auth.logout();
              qc.clear();
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

function deviceName(ua: string) {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Celular Android' : 'Tablet Android';
  if (/Mac OS/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Computador Windows';
  return 'Navegador';
}
