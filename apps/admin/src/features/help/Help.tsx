import { PaperPlaneTilt, WhatsappLogo } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { qk, useMutation } from '../../lib/query.ts';
import { useState } from 'react';
import { api } from '../../lib/api.ts';
import { useSession } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { messageOf, Skeleton } from '../../ui/feedback.tsx';
import { Chips, Field, TextArea } from '../../ui/fields.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { toast } from '../../ui/Toast.tsx';
import { TopicAnswers } from './HelpSheet.tsx';
import { PlatformStatus } from './status.tsx';
import { TOPICS, type TopicId } from './topics.tsx';

// "falar com a Venduá" from a screen's help opens here on that screen's questions
function topicFromReferrer(): TopicId {
  const t = new URLSearchParams(location.search).get('tela');
  return t && t in TOPICS ? (t as TopicId) : 'pedidos';
}

export default function Help() {
  const support = useSession().support.whatsapp;
  const [topic, setTopic] = useState('dúvida');
  const [msg, setMsg] = useState('');
  const [topic_, setTopicId] = useState<TopicId>(() => topicFromReferrer());
  const status = useQuery({ queryKey: qk.helpStatus, queryFn: api.helpStatus, staleTime: 60_000 });
  const send = useMutation({
    mutationFn: () => api.help(msg.trim(), topic),
    onSuccess: () => {
      setMsg('');
      toast('Recebemos! A equipe Venduá te responde pelo WhatsApp.');
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  return (
    <PageBody>
      <PageHeader title="Ajuda" subtitle="A gente responde de gente para gente." help={false} />
      <div className="space-y-8">
        <Section title="Como está a Venduá" id="status">
          {status.data ? (
            <PlatformStatus incidents={status.data.incidents} />
          ) : status.error ? (
            <Card className="p-5">
              <p className="t-body text-muted">
                Não conseguimos ver o status agora. Se algo não funciona, mande uma mensagem abaixo.
              </p>
            </Card>
          ) : (
            <Skeleton className="h-[76px] rounded-lg" />
          )}
        </Section>
        <Card className="flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:text-left">
          <Mascote pose="avatar-ajuda" size={128} className="w-32 shrink-0" />
          <div className="flex-1">
            <p className="t-title-2">Fale com a Venduá</p>
            <p className="t-body mt-1 text-muted">
              Seg a sáb, das 8h às 20h. Mande uma mensagem aqui: ela chega na hora para a equipe.
            </p>
            {support ? (
              <a
                href={`https://wa.me/${support}?text=${encodeURIComponent('Oi, Venduá! Preciso de ajuda com minha loja.')}`}
                target="_blank"
                rel="noreferrer"
                className="t-label mt-3 inline-flex min-h-12 items-center gap-2 rounded-md bg-primary px-4 text-on-primary depth-1 transition-transform hover:bg-primary-hover active:scale-[0.97]"
              >
                <WhatsappLogo weight="fill" className="size-5" /> chamar no WhatsApp
              </a>
            ) : null}
          </div>
        </Card>
        <Section title="Mandar uma mensagem">
          <Card className="space-y-4 p-5">
            <Chips
              label="assunto"
              value={topic}
              onChange={setTopic}
              options={['dúvida', 'problema', 'mudar o visual', 'sugestão'].map((t) => ({
                value: t,
                label: t,
              }))}
            />
            <Field label="Conte o que aconteceu" htmlFor="help-msg">
              <TextArea
                id="help-msg"
                maxLength={2000}
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                placeholder="Ex.: queria trocar a foto da página inicial por uma do Natal."
              />
            </Field>
            <Button
              block
              icon={<PaperPlaneTilt />}
              disabled={msg.trim().length < 3}
              loading={send.isPending}
              onClick={() => send.mutate()}
            >
              enviar para a Venduá
            </Button>
          </Card>
        </Section>
        <Section
          title="Perguntas rápidas"
          hint="Em qualquer tela, toque em ajuda para ver as dúvidas dela."
        >
          <div className="space-y-3">
            <div className="scroll-row -mx-4 px-4 md:mx-0 md:px-0">
              <Chips
                label="assunto das perguntas"
                value={topic_}
                onChange={setTopicId}
                className="w-max flex-nowrap! md:w-auto md:flex-wrap!"
                options={(Object.keys(TOPICS) as TopicId[]).map((t) => ({
                  value: t,
                  label: TOPICS[t].title,
                }))}
              />
            </div>
            <Card className="overflow-hidden">
              <TopicAnswers key={topic_} topic={TOPICS[topic_]} first={null} />
            </Card>
          </div>
        </Section>
      </div>
    </PageBody>
  );
}
