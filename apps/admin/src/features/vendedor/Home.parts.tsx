import { ArrowRight, BookOpen, ChatText, Lightning, WhatsappLogo } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  api,
  type Coverage,
  type VendedorHome,
  type VendedorSettingsPatch,
} from '../../lib/api.ts';
import { haptic } from '../../lib/haptics.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { Mascote, type Pose } from '../../ui/Mascote.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { toast } from '../../ui/Toast.tsx';
import { AGENT_PARTS, AgentGuide, ChecklistRow } from '../../ui/vendedor/index.ts';

export const COVERAGE_LABEL: Record<Coverage, string> = {
  rehearsal: 'Ensaio',
  when_slow: 'Quando eu demorar',
  after_hours: 'Fora do horário',
  always: 'Sempre',
};

/** Turning Duá on (owner) or into Ensaio: one PATCH, then every one of his views and the nav. */
export function useAgentSwitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: VendedorSettingsPatch) => api.vendedor.updateSettings(patch),
    onSuccess: (s) => {
      haptic.commit();
      qc.setQueryData(qk.vendedor.settings, s);
      void qc.invalidateQueries({ queryKey: ['vendedor'] });
      void qc.invalidateQueries({ queryKey: qk.session });
    },
    onError: (e) => toast.error(messageOf(e)),
  });
}

const PART_DETAIL: Record<string, string> = {
  conhecer: 'O WhatsApp, quem ele atende e o jeito de falar',
  ensinar: 'O que ele leu da loja e a entrevista',
  testar: 'Peça para mim e cliente oculto',
  comecar: 'Quando ele atende e como começa',
};
const PART_ICON = {
  conhecer: WhatsappLogo,
  ensinar: BookOpen,
  testar: ChatText,
  comecar: Lightning,
};

/** The first-use moments' Duá: larger than an avatar, on the lit disc. */
function Hero({ pose }: { pose: Pose }) {
  return (
    <span className="dua-disc grid size-32 place-items-center bg-spark-soft">
      <Mascote pose={pose} size={120} className="size-[120px]" />
    </span>
  );
}

/** The wizard's first step: connecting the store's WhatsApp, back to Treinar after. */
const CONNECT = '/vendedor/comecar?passo=whatsapp';

/**
 * `/vendedor` before Duá is on (sales-agent-ux §3.1): the door to "Treinar o Duá", its resume map
 * midway, and the finale's two actions once it's done. The training never gates "ligar"; the
 * store's WhatsApp does (Core answers WHATSAPP_REQUIRED), so without it the way is "conectar".
 */
export function FirstUse({ data, owner }: { data: VendedorHome; owner: boolean }) {
  const on = useAgentSwitch();
  const { started, finished, part } = data.onboarding;
  const linked = data.whatsapp.linked;
  const at = Math.max(
    0,
    AGENT_PARTS.findIndex((p) => p.id === part),
  );
  const turnOn = (patch: VendedorSettingsPatch, done: string) =>
    on.mutate(patch, { onSuccess: () => toast(done) });

  const notOwner = owner ? null : (
    <Notice title="Quem liga o Duá é o dono da loja">
      Quando ele estiver atendendo, as conversas e quem precisa de você aparecem aqui.
    </Notice>
  );

  if (finished && !linked)
    return (
      <div className="mx-auto max-w-lg space-y-5">
        <Card className="flex flex-col items-center px-5 py-8 text-center">
          <Hero pose="avatar-ola" />
          <h2 className="t-title-1 mt-4">Falta só o WhatsApp</h2>
          <p className="t-body mt-2 max-w-sm text-muted">
            O Duá já sabe atender a loja. Ele atende pelo WhatsApp dela: conecte com um código, sem
            sair daqui, e ele começa.
          </p>
        </Card>
        {owner ? (
          <ButtonLink to={CONNECT} size="lg" block icon={<WhatsappLogo weight="fill" />}>
            conectar o WhatsApp
          </ButtonLink>
        ) : (
          notOwner
        )}
      </div>
    );

  if (finished)
    return (
      <div className="mx-auto max-w-lg space-y-5">
        <Card className="flex flex-col items-center px-5 py-8 text-center">
          <Hero pose="avatar-feliz" />
          <h2 className="t-moment mt-4 text-[2.25rem] leading-[2.5rem]">O Duá está pronto</h2>
          <p className="t-body mt-2 max-w-sm text-muted">
            Ele já conhece o cardápio, os horários e as taxas da loja. Comece em ensaio para ver o
            que ele diria antes de falar com alguém.
          </p>
        </Card>
        {owner ? (
          <div className="space-y-3">
            <Button
              size="lg"
              block
              loading={on.isPending && on.variables?.coverage === 'rehearsal'}
              onClick={() =>
                turnOn({ enabled: true, coverage: 'rehearsal' }, 'O Duá está em ensaio')
              }
            >
              começar em ensaio
            </Button>
            <Button
              variant="secondary"
              block
              icon={<Lightning weight="bold" />}
              loading={on.isPending && on.variables?.coverage === undefined}
              onClick={() => turnOn({ enabled: true }, 'O Duá está ligado')}
            >
              ligar agora
            </Button>
            <p className="t-caption text-center text-muted">Você pode desligar quando quiser.</p>
          </div>
        ) : (
          notOwner
        )}
      </div>
    );

  return (
    <div className="mx-auto max-w-lg space-y-5">
      {started ? (
        <AgentGuide turn="resume">
          Que bom te ver de novo! Guardei tudo o que você já me ensinou. Falta pouco.
        </AgentGuide>
      ) : (
        <Card className="flex flex-col items-center px-5 py-8 text-center">
          <Hero pose="avatar-ola" />
          <h2 className="t-title-1 mt-4">Conheça o Duá</h2>
          <p className="t-body mt-2 max-w-sm text-muted">
            O vendedor com IA no WhatsApp da loja: tira dúvidas, monta a sacola e fecha o pedido.
            Preços, taxas e horários ele lê da loja, na hora.
          </p>
        </Card>
      )}

      {started ? (
        <ol aria-label="Treinar o Duá" className="space-y-2.5">
          {AGENT_PARTS.map((p, i) => (
            <li key={p.id} aria-current={i === at ? 'step' : undefined}>
              <ChecklistRow
                card
                state={i < at ? 'done' : i === at ? 'now' : 'todo'}
                eyebrow={i === at ? `Parte ${i + 1} · agora` : `Parte ${i + 1}`}
                title={p.label}
                icon={PART_ICON[p.id]}
                detail={PART_DETAIL[p.id]}
                value={i < at ? 'pronto' : i === at ? undefined : 'a fazer'}
              />
            </li>
          ))}
        </ol>
      ) : null}

      {!linked ? (
        <Notice icon={<WhatsappLogo weight="fill" />} title="O WhatsApp da loja não está conectado">
          {started
            ? 'O Duá atende por ele: sem o WhatsApp conectado, ele não tem como começar.'
            : 'É por ele que o Duá atende, então o treino começa conectando, com um código, sem sair daqui.'}
        </Notice>
      ) : null}

      {owner && !linked && !started ? (
        <div className="space-y-3">
          <ButtonLink to={CONNECT} size="lg" block icon={<WhatsappLogo weight="fill" />}>
            conectar o WhatsApp
          </ButtonLink>
          <p className="t-caption text-center text-muted">
            É o primeiro passo do treino. Leva cerca de 5 min ao todo.
          </p>
        </div>
      ) : owner ? (
        <div className="space-y-3">
          <ButtonLink
            to="/vendedor/comecar"
            size="lg"
            block
            icon={started ? undefined : <BookOpen weight="bold" />}
          >
            {started ? (
              <>
                continuar: {AGENT_PARTS[at]?.label.toLowerCase()}
                <ArrowRight weight="bold" />
              </>
            ) : (
              <>
                treinar o Duá
                <span className="font-normal opacity-80">· cerca de 5 min</span>
              </>
            )}
          </ButtonLink>
          {linked ? (
            <>
              <Button
                variant="secondary"
                block
                icon={<Lightning weight="bold" />}
                loading={on.isPending}
                onClick={() => turnOn({ enabled: true }, 'O Duá está ligado')}
              >
                ligar o Duá
              </Button>
              <p className="t-caption text-center text-muted">
                {started
                  ? 'Dá para ligar agora e terminar de ensinar depois.'
                  : 'Você pode desligar quando quiser.'}
              </p>
            </>
          ) : (
            <ButtonLink
              to={CONNECT}
              variant="secondary"
              block
              icon={<WhatsappLogo weight="fill" />}
            >
              conectar o WhatsApp
            </ButtonLink>
          )}
        </div>
      ) : (
        notOwner
      )}
    </div>
  );
}
