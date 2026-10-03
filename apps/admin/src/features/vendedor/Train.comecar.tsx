import { ArrowRight, Lightning } from '@phosphor-icons/react';
import { useState } from 'react';
import type { Coverage, StoreAgentSettings, VendedorOnboarding } from '../../lib/api.ts';
import { haptic } from '../../lib/haptics.ts';
import { plural } from '../../lib/format.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { Segmented } from '../../ui/fields.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { ChecklistRow, PersonaAvatar } from '../../ui/vendedor/index.ts';
import { articleOf, COVERAGE, coverageShort, gapKey, type StepId } from './Train.model.ts';
import { TrainFrame } from './Train.parts.tsx';
import { running, useClienteOculto } from './Train.testar.tsx';

// ── Quando a Ana atende ───────────────────────────────────────────────────

export function WhenStep({
  settings,
  name,
  onNext,
  busy,
  back,
  eyebrow,
}: {
  settings: StoreAgentSettings;
  name: string;
  onNext: (p: { coverage: Coverage; slowAfterMin: 1 | 2 | 5 }) => void;
  busy: boolean;
  back: () => void;
  eyebrow: string;
}) {
  const [coverage, setCoverage] = useState<Coverage>(settings.coverage);
  const [slow, setSlow] = useState<1 | 2 | 5>(settings.slowAfterMin);
  return (
    <TrainFrame
      eyebrow={eyebrow}
      title={`Quando ${articleOf(name)} ${name} atende`}
      hint="Dá para trocar quando quiser, em Configurar."
      next={() => onNext({ coverage, slowAfterMin: slow })}
      busy={busy}
      back={back}
    >
      <div role="radiogroup" aria-label="Quando ela atende" className="space-y-2.5">
        {COVERAGE.map((c) => {
          const on = coverage === c.id;
          return (
            <div
              key={c.id}
              className={cn(
                'rounded-lg transition-[background-color,box-shadow] duration-(--duration-quick)',
                on
                  ? 'bg-spark-soft ring-2 ring-primary depth-1 noite:ring-spark'
                  : 'bg-surface depth-1',
              )}
            >
              <button
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  haptic.tick();
                  setCoverage(c.id);
                }}
                className="press flex min-h-18 w-full items-start gap-3 rounded-lg px-4 py-3.5 text-left"
              >
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ring-2',
                    on ? 'bg-primary ring-primary' : 'ring-line-strong',
                  )}
                >
                  {on ? <span className="size-2.5 rounded-full bg-on-primary" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold">{c.title}</span>
                    {c.id === 'when_slow' ? (
                      <span className="t-caption inline-flex h-6 items-center rounded-full bg-success-soft px-2 font-semibold text-success">
                        recomendado
                      </span>
                    ) : null}
                  </span>
                  <span className="t-body block text-muted">{c.detail}</span>
                </span>
              </button>
              {c.id === 'when_slow' && on ? (
                <div className="space-y-1.5 px-4 pb-4 pl-13">
                  <p className="t-caption font-semibold text-muted" id="tr-slow">
                    Depois de quanto tempo sem resposta sua
                  </p>
                  <Segmented
                    label="Depois de quanto tempo sem resposta sua"
                    value={String(slow) as '1' | '2' | '5'}
                    onChange={(v) => setSlow(Number(v) as 1 | 2 | 5)}
                    options={[
                      { value: '1', label: '1 min' },
                      { value: '2', label: '2 min' },
                      { value: '5', label: '5 min' },
                    ]}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </TrainFrame>
  );
}

// ── A Ana está pronta ─────────────────────────────────────────────────────

export function Finale({
  ob,
  name,
  store,
  linked,
  onStart,
  starting,
  go,
}: {
  ob: VendedorOnboarding;
  name: string;
  store: string;
  linked: boolean;
  onStart: (how: 'ensaio' | 'agora') => void;
  starting: 'ensaio' | 'agora' | null;
  go: (s: StepId) => void;
}) {
  const co = useClienteOculto();
  const s = ob.settings;
  const skipped = ob.progress.skipped ?? [];
  const art = articleOf(name);
  const latest = co.data?.latest ?? null;
  const live = running(co.data);
  const done = latest?.results?.length ?? 0;
  const gapsLeft = ob.gaps.filter((g) => !skipped.includes(gapKey(g))).length;

  const later: { id: string; title: string; detail: string; to: StepId; label: string }[] = [];
  if (!linked)
    later.push({
      id: 'wa',
      title: 'Conectar o WhatsApp da loja',
      detail: `Sem ele, ${art} ${name} não tem onde atender.`,
      to: 'whatsapp',
      label: 'conectar',
    });
  if (!ob.progress.interviewDone && ob.interview.messages.length === 0)
    later.push({
      id: 'entrevista',
      title: 'A entrevista',
      detail: 'Se perguntarem o que só você sabe, ela passa para você.',
      to: 'entrevista',
      label: 'responder',
    });
  else if (!ob.progress.interviewDone)
    later.push({
      id: 'entrevista',
      title: 'O resto da entrevista',
      detail: 'Ela continua de onde vocês pararam.',
      to: 'entrevista',
      label: 'continuar',
    });
  if (ob.proposals.length)
    later.push({
      id: 'propostas',
      title: plural(ob.proposals.length, 'sugestão esperando seu ok', 'sugestões esperando seu ok'),
      detail: 'Só valem depois de “está certo”.',
      to: 'entrevista',
      label: 'ver',
    });
  if (gapsLeft)
    later.push({
      id: 'cardapio',
      title: plural(gapsLeft, 'coisa do cardápio sem resposta', 'coisas do cardápio sem resposta'),
      detail: 'Se perguntarem, ela passa para você.',
      to: 'li',
      label: 'ver',
    });
  if (!ob.progress.tested && skipped.includes('peca'))
    later.push({
      id: 'peca',
      title: 'Pedir como cliente',
      detail: `Ver ${art} ${name} atender antes de todo mundo.`,
      to: 'peca',
      label: 'testar',
    });

  return (
    <div className="animate-fade-up space-y-6">
      <section className="flex flex-col items-center gap-3 pt-2 text-center">
        <p className="t-label text-muted">Começar · pronto!</p>
        <PersonaAvatar name={name} size="lg" />
        <h1 className="t-moment text-[2.5rem] leading-[2.75rem] md:text-[3rem] md:leading-[3.25rem]">
          {art === 'o' ? 'O' : 'A'} {name} está {art === 'o' ? 'pronto' : 'pronta'}
        </h1>
        <p className="t-body-lg max-w-md text-muted">
          {ob.enabled
            ? `${art === 'o' ? 'Ele' : 'Ela'} já está atendendo a ${store}, ${coverageShort(s.coverage, s.slowAfterMin)}.`
            : `${art === 'o' ? 'Ele' : 'Ela'} já sabe atender a ${store}. Você escolhe como começa.`}
        </p>
      </section>

      <Card as="section" aria-labelledby="tr-knows" className="px-4 pb-1.5 pt-4">
        <h2 id="tr-knows" className="t-label mb-1">
          O que {art === 'o' ? 'ele' : 'ela'} sabe
        </h2>
        <ChecklistRow
          state="done"
          title="Sabe o cardápio, o horário e a entrega"
          value={plural(ob.read.products, 'item', 'itens')}
        />
        <ChecklistRow state="done" title="Aprendeu respostas com você" value={ob.taught.answers} />
        <ChecklistRow state="done" title="Segue as suas regras" value={ob.taught.rules} />
        {latest && latest.total ? (
          live ? (
            <ChecklistRow
              state="now"
              title="Cliente oculto rodando"
              value={`${done} de ${latest.total}`}
            />
          ) : latest.status === 'done' ? (
            <ChecklistRow
              state="done"
              title="Acertou no cliente oculto"
              value={`${latest.passed ?? 0} de ${latest.total}`}
            />
          ) : null
        ) : null}
        <ChecklistRow
          state="done"
          title={
            s.coverage === 'rehearsal'
              ? 'Começa em ensaio'
              : `Atende ${coverageShort(s.coverage, s.slowAfterMin)}`
          }
          action={
            <Button variant="ghost" size="sm" onClick={() => go('quando')}>
              trocar
            </Button>
          }
        />
      </Card>

      {later.length ? (
        <Card as="section" aria-labelledby="tr-later" className="px-4 pb-1.5 pt-4">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 id="tr-later" className="t-label">
              Ficou para depois
            </h2>
            <span className="t-caption tnum text-muted">
              {plural(later.length, 'item', 'itens')}
            </span>
          </div>
          {later.map((l) => (
            <ChecklistRow
              key={l.id}
              state="optional"
              title={l.title}
              detail={l.detail}
              action={
                <Button variant="secondary" size="sm" onClick={() => go(l.to)}>
                  {l.label}
                </Button>
              }
            />
          ))}
        </Card>
      ) : null}

      {ob.enabled ? (
        <ButtonLink to="/vendedor" size="lg" block>
          ir para o Vendedor <ArrowRight />
        </ButtonLink>
      ) : (
        <div className="space-y-3">
          {!linked ? (
            <Notice tone="warning" title="O WhatsApp da loja ainda não está conectado">
              Dá para ligar agora: {art} {name} começa a atender assim que ele conectar.
            </Notice>
          ) : null}
          <Button
            variant="spark"
            size="lg"
            block
            loading={starting === 'ensaio'}
            disabled={!!starting}
            onClick={() => onStart('ensaio')}
          >
            começar em ensaio
          </Button>
          <p className="t-caption text-center text-muted">
            Recomendado: por alguns dias {art === 'o' ? 'ele' : 'ela'} escreve sem mandar, e você
            compara.
          </p>
          <Button
            variant="secondary"
            size="lg"
            block
            icon={<Lightning weight="bold" />}
            loading={starting === 'agora'}
            disabled={!!starting}
            onClick={() => onStart('agora')}
          >
            ligar agora
          </Button>
        </div>
      )}
    </div>
  );
}
