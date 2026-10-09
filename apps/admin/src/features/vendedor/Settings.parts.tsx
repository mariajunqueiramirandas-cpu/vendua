import { ArrowClockwise, LockSimple } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type ReactNode } from 'react';
import {
  api,
  ApiError,
  type AgentTone,
  type AnswerWho,
  type Coverage,
  type VendedorSettings,
  type VendedorSettingsPatch,
} from '../../lib/api.ts';
import { greeting } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { optimistic, qk, useMutation } from '../../lib/query.ts';
import { cn } from '../../ui/cn.ts';
import { messageOf } from '../../ui/feedback.tsx';
import { SaveMark, Segmented, type SaveState } from '../../ui/fields.tsx';
import { toast } from '../../ui/Toast.tsx';

/** The patch over the cached view, so a switch moves at once; Core's reply replaces it. */
function apply(v: VendedorSettings, p: VendedorSettingsPatch): VendedorSettings {
  const { enabled, capabilities, handoff, recovery, ...rest } = p;
  const s = v.settings;
  return {
    ...v,
    enabled: enabled ?? v.enabled,
    settings: {
      ...s,
      ...rest,
      capabilities: { ...s.capabilities, ...capabilities },
      handoff: { ...s.handoff, ...handoff },
      recovery: { ...s.recovery, ...recovery },
    },
  };
}

// every card saves on its own: only the newest reply may paint, an older one asks for the truth
let seq = 0;

/**
 * One card's autosave (admin law 5): optimistic, "salvando → salvo" beside the card's title,
 * and "não salvou · tentar de novo" with the patch kept for the retry.
 */
export function useSettingsPatch() {
  const qc = useQueryClient();
  const [state, setState] = useState<SaveState>('idle');
  const failed = useRef<VendedorSettingsPatch | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const m = useMutation({
    mutationFn: (p: VendedorSettingsPatch) => api.vendedor.updateSettings(p),
  });
  const run = async (p: VendedorSettingsPatch) => {
    const mine = ++seq;
    clearTimeout(timer.current);
    setState('saving');
    const undo = await optimistic<VendedorSettings>(qc, qk.vendedor.settings, (v) => apply(v, p));
    try {
      const s = await m.mutateAsync(p);
      if (mine === seq) qc.setQueryData(qk.vendedor.settings, s);
      else void qc.invalidateQueries({ queryKey: qk.vendedor.settings });
      void qc.invalidateQueries({ queryKey: qk.vendedor.home });
      if (p.enabled !== undefined) void qc.invalidateQueries({ queryKey: qk.session });
      failed.current = null;
      setState('saved');
      timer.current = setTimeout(() => setState((x) => (x === 'saved' ? 'idle' : x)), 2400);
    } catch (e) {
      if (mine === seq) undo.restore();
      else void qc.invalidateQueries({ queryKey: qk.vendedor.settings });
      // the store's number dropped since the screen loaded: the switch locks with its link
      if (e instanceof ApiError && e.code === 'WHATSAPP_REQUIRED')
        void qc.invalidateQueries({ queryKey: qk.vendedor.home });
      failed.current = p;
      setState('error');
      haptic.error();
      toast.error(messageOf(e));
    }
  };
  const retry = () => {
    if (failed.current) void run(failed.current);
  };
  return { run, state, retry };
}

/** "salvo" per card, or the failed save with its retry (sales-agent-ux §3.9 states). */
export function SaveStatus({ state, retry }: { state: SaveState; retry: () => void }) {
  if (state !== 'error') return <SaveMark state={state} />;
  return (
    <button
      type="button"
      onClick={retry}
      className="t-caption inline-flex min-h-11 items-center gap-1 font-semibold text-danger underline-offset-2 hover:underline"
    >
      <ArrowClockwise weight="bold" className="size-3.5" aria-hidden />
      não salvou · tentar de novo
    </button>
  );
}

/** What a manager sees on an owner's control: the value, and who can change it. */
export function OwnerOnly() {
  return (
    <span className="inline-flex items-center gap-1 font-semibold">
      <LockSimple weight="bold" className="size-3.5" aria-hidden />
      só o dono muda
    </span>
  );
}

/** A card with its title and its save state on one line. */
export function Group({
  title,
  hint,
  status,
  children,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('rounded-lg bg-surface depth-1', className)}>
      <div className="flex min-h-12 items-center justify-between gap-3 px-4 pt-3">
        <h2 id={id} className="t-title-2 min-w-0">
          {title}
        </h2>
        <div className="shrink-0">{status}</div>
      </div>
      {hint ? <p className="t-body px-4 text-muted">{hint}</p> : null}
      <div className="px-4 pb-3">{children}</div>
    </section>
  );
}

const TONES: { value: AgentTone; label: string }[] = [
  { value: 'relaxed', label: 'descontraído' },
  { value: 'balanced', label: 'equilibrado' },
  { value: 'formal', label: 'formal' },
];

/** The board's sample greeting per tone, around Core's `intro` ("o Duá, assistente virtual da
 *  …", or "o Duá, da …" with the disclosure off). */
export function greetingFor(tone: AgentTone, intro: string) {
  if (tone === 'relaxed') return `Oi, Carla! Aqui é ${intro} 😊 Bora pedir hoje?`;
  if (tone === 'formal')
    return `${greeting()}, Carla. Sou ${intro}. Como posso ajudar com o seu pedido?`;
  return `${greeting()}, Carla! Sou ${intro}. O que vai ser hoje?`;
}

export function ToneField({
  value,
  onChange,
}: {
  value: AgentTone;
  onChange: (t: AgentTone) => void;
}) {
  return (
    <div className="space-y-2 py-2">
      <p className="t-label" id="tone-l">
        Jeito de falar
      </p>
      <Segmented label="Jeito de falar" value={value} onChange={onChange} options={TONES} />
    </div>
  );
}

const COVERAGE: { value: Coverage; title: string; detail: (min: number) => string }[] = [
  {
    value: 'rehearsal',
    title: 'Ensaio',
    detail: () => 'Ele escreve o que diria, mas não manda nada. Você compara.',
  },
  {
    value: 'when_slow',
    title: 'Quando eu demorar',
    detail: (min) => `Se ninguém responder em ${min} min, ou com a loja fechada.`,
  },
  {
    value: 'after_hours',
    title: 'Fora do horário',
    detail: () => 'Só com a loja fechada. Agenda pedidos para quando abrir.',
  },
  {
    value: 'always',
    title: 'Sempre',
    detail: () => 'Responde tudo na hora. Você assume quando quiser.',
  },
];

const WAITS = [
  { value: '1', label: '1 min' },
  { value: '2', label: '2 min' },
  { value: '5', label: '5 min' },
] as const;

/** Coverage replaces an autonomy slider (sales-agent-ux §1.5): when does Duá answer? */
export function CoverageField({
  value,
  slowAfterMin,
  onChange,
  onWait,
}: {
  value: Coverage;
  slowAfterMin: number;
  onChange: (c: Coverage) => void;
  onWait: (m: 1 | 2 | 5) => void;
}) {
  return (
    <ChoiceRows
      label="Quando o Duá atende"
      value={value}
      onChange={onChange}
      options={COVERAGE.map((o) => ({ ...o, detail: o.detail(slowAfterMin) }))}
      under={(v) =>
        v === 'when_slow' ? (
          <div className="space-y-2 px-4 pb-4 pl-13">
            <p className="t-caption text-muted">Quanto esperar antes de o Duá responder</p>
            <Segmented
              label="Quanto esperar antes de o Duá responder"
              value={String(slowAfterMin) as '1' | '2' | '5'}
              onChange={(m) => onWait(Number(m) as 1 | 2 | 5)}
              options={[...WAITS]}
            />
          </div>
        ) : null
      }
    />
  );
}

const ANSWER_WHO: { value: AnswerWho; title: string; detail: string }[] = [
  {
    value: 'known_and_new',
    title: 'Clientes e números novos',
    detail:
      'Quem já pediu na loja e quem nunca conversou com você. Nas conversas que você já tem, o Duá lê as últimas mensagens e deixa as pessoais com você.',
  },
  {
    value: 'known_only',
    title: 'Só quem já é cliente',
    detail: 'Quem já pediu na loja ou você marcou como cliente. Os outros esperam você decidir.',
  },
  {
    value: 'everyone',
    title: 'Todo mundo',
    detail: 'Para quando o número é só da loja.',
  },
];

/** The store's number is often the owner's own: whose messages Duá may answer. */
export function AnswerWhoField({
  value,
  onChange,
}: {
  value: AnswerWho;
  onChange: (v: AnswerWho) => void;
}) {
  return (
    <ChoiceRows label="Quem o Duá atende" value={value} onChange={onChange} options={ANSWER_WHO} />
  );
}

const COMMANDS: { word: string; does: string }[] = [
  { word: '#cliente', does: 'o Duá passa a atender esse contato.' },
  { word: '#pessoal', does: 'o Duá não responde mais esse contato.' },
  { word: '#dua', does: 'o Duá volta a responder agora, mesmo se você estava atendendo.' },
];

/** The owner decides from the phone, inside the chat itself; Core never shows the contact. */
export function PhoneCommands() {
  return (
    <div className="mt-1 rounded-md bg-sunken p-3.5">
      <p className="font-semibold">Pelo seu WhatsApp</p>
      <p className="t-caption text-muted">
        Na conversa com a pessoa, mande só a palavra. A mensagem some na hora, para você e para ela.
      </p>
      <dl className="mt-3 space-y-2">
        {COMMANDS.map((c) => (
          <div key={c.word} className="flex items-baseline gap-2.5">
            <dt className="shrink-0">
              <code className="rounded-sm bg-surface px-1.5 py-0.5 font-sans text-[0.875rem] font-bold text-ink ring-1 ring-inset ring-line-strong">
                {c.word}
              </code>
            </dt>
            <dd className="t-body min-w-0">{c.does}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** One choice of a few, each with what it means: a radio list that fills its card edge to edge. */
function ChoiceRows<T extends string>({
  label,
  value,
  onChange,
  options,
  under,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; title: string; detail: string }[];
  /** what opens under the chosen row (coverage's "quanto esperar") */
  under?: ((v: T) => ReactNode) | undefined;
}) {
  const group = useId();
  return (
    <div role="radiogroup" aria-label={label} className="-mx-4">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <div key={o.value} className="border-t border-line first:border-t-0">
            <label
              className={cn(
                'flex min-h-16 cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-hover',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-primary',
              )}
            >
              <input
                type="radio"
                name={group}
                value={o.value}
                checked={on}
                onChange={() => {
                  haptic.tick();
                  onChange(o.value);
                }}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ring-2 ring-inset',
                  on ? 'bg-primary ring-primary' : 'bg-surface ring-line-strong',
                )}
              >
                {on ? <span className="size-2.5 rounded-full bg-on-primary" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{o.title}</span>
                <span className="t-caption block text-muted">{o.detail}</span>
              </span>
            </label>
            {on && under ? under(o.value) : null}
          </div>
        );
      })}
    </div>
  );
}
