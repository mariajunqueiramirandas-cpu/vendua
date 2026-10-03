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
import { Notice } from '../../ui/Notice.tsx';
import { toast } from '../../ui/Toast.tsx';
import { AGENT_PARTS, AgentGuide, ChecklistRow, PersonaAvatar } from '../../ui/vendedor/index.ts';

export const COVERAGE_LABEL: Record<Coverage, string> = {
  rehearsal: 'Ensaio',
  when_slow: 'Quando eu demorar',
  after_hours: 'Fora do horário',
  always: 'Sempre',
};

/** Turning her on (owner) or into Ensaio: one PATCH, then every Vendedor view and the nav. */
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
  conhecer: 'Nome, jeito de falar e o WhatsApp da loja',
  ensinar: 'O que ela leu da loja e a entrevista',
  testar: 'Peça para mim e cliente oculto',
  comecar: 'Quando ela atende e como começa',
};
const PART_ICON = {
  conhecer: WhatsappLogo,
  ensinar: BookOpen,
  testar: ChatText,
  comecar: Lightning,
};

/**
 * `/vendedor` before she's on (sales-agent-ux §3.1): the door to "Treinar a Ana", its resume map
 * midway, and the finale's two actions once it's done. "Ligar" is never gated: the onboarding
 * informs, the owner decides.
 */
export function FirstUse({ data, owner }: { data: VendedorHome; owner: boolean }) {
  const name = data.agent.name;
  const on = useAgentSwitch();
  const { started, finished, part } = data.onboarding;
  const at = Math.max(
    0,
    AGENT_PARTS.findIndex((p) => p.id === part),
  );
  const turnOn = (patch: VendedorSettingsPatch, done: string) =>
    on.mutate(patch, { onSuccess: () => toast(done) });

  const notOwner = owner ? null : (
    <Notice title={`Quem liga a ${name} é o dono da loja`}>
      Quando ela estiver atendendo, as conversas e quem precisa de você aparecem aqui.
    </Notice>
  );

  if (finished)
    return (
      <div className="mx-auto max-w-lg space-y-5">
        <Card className="flex flex-col items-center px-5 py-8 text-center">
          <PersonaAvatar name={name} size="lg" />
          <h2 className="t-moment mt-4 text-[2.25rem] leading-[2.5rem]">A {name} está pronta</h2>
          <p className="t-body mt-2 max-w-sm text-muted">
            Ela já conhece o cardápio, os horários e as taxas da loja. Comece em ensaio para ver o
            que ela diria antes de ela falar com alguém.
          </p>
        </Card>
        {owner ? (
          <div className="space-y-3">
            <Button
              size="lg"
              block
              loading={on.isPending && on.variables?.coverage === 'rehearsal'}
              onClick={() =>
                turnOn({ enabled: true, coverage: 'rehearsal' }, `A ${name} está em ensaio`)
              }
            >
              começar em ensaio
            </Button>
            <Button
              variant="secondary"
              block
              icon={<Lightning weight="bold" />}
              loading={on.isPending && on.variables?.coverage === undefined}
              onClick={() => turnOn({ enabled: true }, `A ${name} está ligada`)}
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
        <AgentGuide name={name} turn="resume">
          Que bom te ver de novo! Guardei tudo o que você já me ensinou. Falta pouco.
        </AgentGuide>
      ) : (
        <Card className="flex flex-col items-center px-5 py-8 text-center">
          <PersonaAvatar name={name} size="lg" />
          <h2 className="t-title-1 mt-4">Conheça a {name}</h2>
          <p className="t-body mt-2 max-w-sm text-muted">
            Ela atende no WhatsApp da loja: tira dúvidas, monta a sacola e fecha o pedido. Preços,
            taxas e horários ela lê da loja, na hora.
          </p>
        </Card>
      )}

      {started ? (
        <ol aria-label={`Treinar a ${name}`} className="space-y-2.5">
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

      {!data.whatsapp.linked && !started ? (
        <Notice icon={<WhatsappLogo weight="fill" />} title="O WhatsApp da loja não está conectado">
          A primeira parte do treino conecta, com um código, sem sair daqui.
        </Notice>
      ) : null}

      {owner ? (
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
                treinar a {name}
                <span className="font-normal opacity-80">· cerca de 5 min</span>
              </>
            )}
          </ButtonLink>
          <Button
            variant="secondary"
            block
            icon={<Lightning weight="bold" />}
            loading={on.isPending}
            onClick={() => turnOn({ enabled: true }, `A ${name} está ligada`)}
          >
            ligar a {name}
          </Button>
          <p className="t-caption text-center text-muted">
            {started
              ? 'Dá para ligar agora e terminar de ensinar depois.'
              : 'Você pode desligar quando quiser.'}
          </p>
        </div>
      ) : (
        notOwner
      )}
    </div>
  );
}
