import { useEffect, useState } from 'react';
import { Link2, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Input, Label, Textarea } from '@/components/ui/input.tsx';
import { ErrorHint, SaveBar, SectionHead } from './bits.tsx';
import { str } from './queries.ts';
import { useTelegramLink } from './telegram/queries.ts';

type Member = {
  name: string;
  email: string;
  whatsapp: string;
  telegram: string;
  telegramUsername: string;
};
type Save = (v: Record<string, unknown>) => void;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEGRAM_RE = /^\d{5,20}$/;
const MAX_MEMBERS = 20;

/** mirrors normalizeWhatsapp (core) — 10–11 bare digits = BR with DDD */
export function normalizeWhatsapp(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (/^\s*\+/.test(raw)) return d.length >= 8 && d.length <= 15 && d[0] !== '0' ? `+${d}` : null;
  if (d.length === 10 || d.length === 11) return `+55${d}`;
  if (d.length >= 12 && d.length <= 15 && d[0] !== '0') return `+${d}`;
  return null;
}

/** one person per line, any order: "Ana, ana@x.com, (11) 99999-0000" */
export function parsePasted(text: string): Member[] {
  return text
    .split('\n')
    .map((line) => {
      const email = line.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0] ?? '';
      const rest = line.replace(email, ' ');
      const phone = rest.match(/\+?[\d\s().-]{8,}\d/)?.[0] ?? '';
      const name = rest
        .replace(phone, ' ')
        .replace(/[,;|\t<>]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        name,
        email: email.toLowerCase(),
        whatsapp: phone ? (normalizeWhatsapp(phone) ?? phone.trim()) : '',
        telegram: '',
        telegramUsername: '',
      };
    })
    .filter((m) => m.email || m.whatsapp);
}

const memberIssue = (m: Member): { email?: string; whatsapp?: string; telegram?: string } => {
  const out: { email?: string; whatsapp?: string; telegram?: string } = {};
  if (m.email.trim() && !EMAIL_RE.test(m.email.trim())) out.email = 'email inválido';
  if (m.whatsapp.trim() && !normalizeWhatsapp(m.whatsapp)) out.whatsapp = 'número inválido';
  if (m.telegram.trim() && !TELEGRAM_RE.test(m.telegram.trim()))
    out.telegram = 'ID tem 5–20 dígitos';
  if (!m.email.trim() && !m.whatsapp.trim() && !m.telegram.trim())
    out.email = 'preencha email, whatsapp ou telegram';
  return out;
};

const readMembers = (v: unknown): Member[] =>
  Array.isArray(v)
    ? v.map((m) => {
        const r = (m ?? {}) as Record<string, unknown>;
        return {
          name: str(r.name, ''),
          email: str(r.email, ''),
          whatsapp: str(r.whatsapp, ''),
          telegram: str(r.telegram, ''),
          telegramUsername: str(r.telegramUsername, ''),
        };
      })
    : [];

export function StaffArea({
  value,
  onSave,
  saving,
  telegramReady,
}: {
  value: Record<string, unknown>;
  onSave: Save;
  saving: boolean;
  telegramReady?: boolean;
}) {
  const cur = { members: readMembers(value.members) };
  const curKey = JSON.stringify(cur);
  const [edit, setEdit] = useState(cur);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setEdit(cur), [curKey]);
  const [paste, setPaste] = useState<string | null>(null);
  const link = useTelegramLink();
  const [linkingIdx, setLinkingIdx] = useState<number | null>(null);

  const dirty = JSON.stringify(edit) !== curKey;
  const issues = edit.members.map(memberIssue);
  const invalid = issues.some((i) => i.email || i.whatsapp || i.telegram);

  const setMember = (i: number, patch: Partial<Member>) =>
    setEdit({ ...edit, members: edit.members.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const add = (more: Member[]) =>
    setEdit({ ...edit, members: [...edit.members, ...more].slice(0, MAX_MEMBERS) });

  const copyInvite = async (index: number) => {
    setLinkingIdx(index);
    try {
      const r = await link.mutateAsync(index);
      await navigator.clipboard.writeText(r.url).then(
        () => toast.success('link copiado — mande pra pessoa abrir no Telegram e tocar em Começar'),
        () => toast.success(`link: ${r.url}`),
      );
    } finally {
      setLinkingIdx(null);
    }
  };

  const pasted = paste ? parsePasted(paste) : [];

  return (
    <section className="max-w-4xl">
      <SectionHead
        title="equipe"
        sub="cada pessoa com Telegram conectado recebe os avisos na DM e pode usar comandos e botões. esses números de WhatsApp nunca viram lead e o agente nunca manda mensagem pra eles"
      />
      <Panel>
        <div className="flex flex-col gap-3">
          {edit.members.length === 0 && (
            <p className="text-sm text-muted-foreground">
              ninguém cadastrado ainda — adicione uma pessoa, cole uma lista ou conecte direto pela
              aba Telegram.
            </p>
          )}
          {edit.members.length > 0 && (
            <div className="hidden grid-cols-[1fr_1.2fr_1fr_1.2fr_auto] gap-2 text-xs font-medium text-foreground/80 sm:grid">
              <span>nome</span>
              <span>email</span>
              <span>whatsapp</span>
              <span>telegram</span>
              <span className="w-8" />
            </div>
          )}
          {edit.members.map((m, i) => {
            const wa = m.whatsapp.trim() ? normalizeWhatsapp(m.whatsapp) : null;
            const savedRow = i < cur.members.length;
            return (
              <div
                key={i}
                className="grid grid-cols-[1fr_auto] gap-2 border-b pb-3 last:border-0 last:pb-0 sm:grid-cols-[1fr_1.2fr_1fr_1.2fr_auto] sm:items-start sm:border-0 sm:pb-0"
              >
                <Input
                  aria-label={`nome da pessoa ${i + 1}`}
                  placeholder="nome"
                  value={m.name}
                  maxLength={80}
                  onChange={(e) => setMember(i, { name: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="sm:order-last"
                  aria-label={`remover ${m.name || `pessoa ${i + 1}`}`}
                  onClick={() =>
                    setEdit({ ...edit, members: edit.members.filter((_, j) => j !== i) })
                  }
                >
                  <Trash2 />
                </Button>
                <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                  <Input
                    aria-label={`email da pessoa ${i + 1}`}
                    type="email"
                    inputMode="email"
                    placeholder="voce@empresa.com"
                    value={m.email}
                    maxLength={320}
                    aria-invalid={!!issues[i]?.email}
                    className="aria-invalid:border-destructive"
                    onChange={(e) => setMember(i, { email: e.target.value })}
                  />
                  {issues[i]?.email && <ErrorHint>{issues[i].email}</ErrorHint>}
                </div>
                <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                  <Input
                    aria-label={`whatsapp da pessoa ${i + 1}`}
                    type="tel"
                    inputMode="tel"
                    placeholder="(11) 99999-0000"
                    value={m.whatsapp}
                    maxLength={40}
                    aria-invalid={!!issues[i]?.whatsapp}
                    className="aria-invalid:border-destructive"
                    onChange={(e) => setMember(i, { whatsapp: e.target.value })}
                    onBlur={() => wa && wa !== m.whatsapp && setMember(i, { whatsapp: wa })}
                  />
                  {issues[i]?.whatsapp ? (
                    <ErrorHint>{issues[i].whatsapp}</ErrorHint>
                  ) : (
                    wa &&
                    wa !== m.whatsapp && (
                      <p className="text-xs text-muted-foreground tnum">salva como {wa}</p>
                    )
                  )}
                </div>
                <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                  <div className="flex gap-1.5">
                    <Input
                      aria-label={`ID do Telegram da pessoa ${i + 1}`}
                      inputMode="numeric"
                      placeholder="ID do Telegram"
                      value={m.telegram}
                      maxLength={20}
                      aria-invalid={!!issues[i]?.telegram}
                      className="min-w-0 flex-1 tnum aria-invalid:border-destructive"
                      onChange={(e) =>
                        setMember(i, {
                          telegram: e.target.value.replace(/\D/g, ''),
                          telegramUsername: '',
                        })
                      }
                    />
                    {telegramReady && !m.telegram && savedRow && !dirty && (
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        title="copiar link de conexão em 1 clique"
                        aria-label={`gerar link do Telegram para ${m.name || `pessoa ${i + 1}`}`}
                        disabled={linkingIdx !== null}
                        onClick={() => void copyInvite(i)}
                      >
                        {linkingIdx === i ? <Loader2 className="animate-spin" /> : <Link2 />}
                      </Button>
                    )}
                  </div>
                  {issues[i]?.telegram ? (
                    <ErrorHint>{issues[i].telegram}</ErrorHint>
                  ) : (
                    m.telegram &&
                    m.telegramUsername && (
                      <p className="text-xs text-muted-foreground">@{m.telegramUsername}</p>
                    )
                  )}
                </div>
              </div>
            );
          })}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={edit.members.length >= MAX_MEMBERS}
              onClick={() =>
                add([{ name: '', email: '', whatsapp: '', telegram: '', telegramUsername: '' }])
              }
            >
              <Plus /> adicionar pessoa
            </Button>
            {paste === null && (
              <Button variant="ghost" size="sm" onClick={() => setPaste('')}>
                colar lista
              </Button>
            )}
          </div>

          {paste !== null && (
            <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-2.5">
              <Label htmlFor="staff-paste">uma pessoa por linha — nome, email e/ou whatsapp</Label>
              <Textarea
                id="staff-paste"
                rows={4}
                autoFocus
                placeholder={'Ana, ana@empresa.com, (11) 99999-0000\nBruno 21 98888-7777'}
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={!pasted.length}
                  onClick={() => {
                    add(pasted);
                    setPaste(null);
                  }}
                >
                  adicionar {pasted.length || ''} {pasted.length === 1 ? 'pessoa' : 'pessoas'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setPaste(null)}>
                  cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
        <SaveBar inCard pinned={dirty}>
          <Button
            disabled={!dirty || invalid || saving}
            onClick={() =>
              onSave({
                members: edit.members.map((m) => ({
                  name: m.name.trim(),
                  email: m.email.trim().toLowerCase(),
                  whatsapp: m.whatsapp.trim() ? (normalizeWhatsapp(m.whatsapp) ?? '') : '',
                  ...(m.telegram.trim() ? { telegram: m.telegram.trim() } : {}),
                  ...(m.telegram.trim() && m.telegramUsername.trim()
                    ? { telegramUsername: m.telegramUsername.trim() }
                    : {}),
                })),
              })
            }
          >
            salvar equipe
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setEdit(cur)}>
              desfazer
            </Button>
          )}
        </SaveBar>
      </Panel>
    </section>
  );
}
