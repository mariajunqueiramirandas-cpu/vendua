import { CaretDown, PaperPlaneTilt, WhatsappLogo } from '@phosphor-icons/react';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.ts';
import { useSession } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { Chips, Field, TextArea } from '../../ui/fields.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { toast } from '../../ui/Toast.tsx';

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: 'Como pauso a loja?',
    a: (
      <>
        Toque no status lá em cima (“Aberta”) e em <strong>pausar agora</strong>. Escolha por quanto
        tempo.
      </>
    ),
  },
  {
    q: 'Como marco um produto como esgotado hoje?',
    a: (
      <>
        Em{' '}
        <Link to="/cardapio" className="underline">
          Cardápio
        </Link>
        , modo lista, toque em “disponível” e escolha <strong>esgotado hoje</strong>. Ele volta
        sozinho à meia-noite.
      </>
    ),
  },
  {
    q: 'O cliente pagou no Pix. E agora?',
    a: (
      <>
        Confira no app do seu banco e toque em <strong>marcar pago</strong> no pedido, ou em{' '}
        <Link to="/pagamentos" className="underline">
          Pagamentos
        </Link>
        .
      </>
    ),
  },
  {
    q: 'Não ouço o som do pedido novo',
    a: (
      <>
        Toque em qualquer lugar do painel uma vez (o navegador só libera o som depois de um toque) e
        teste em{' '}
        <Link to="/perfil" className="underline">
          Meu perfil
        </Link>
        . Deixe o celular fora do silencioso.
      </>
    ),
  },
  {
    q: 'Quero mudar o visual da minha página',
    a: (
      <>
        Em{' '}
        <Link to="/aparencia" className="underline">
          Aparência
        </Link>{' '}
        você muda textos, fotos, ordem e cores, e vê como fica antes de publicar.
      </>
    ),
  },
];

export default function Help() {
  const support = useSession().support.whatsapp;
  const [topic, setTopic] = useState('dúvida');
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState<number | null>(null);
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
      <PageHeader title="Ajuda" subtitle="A gente responde de gente para gente." />
      <div className="space-y-8">
        <Card className="flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:text-left">
          <Mascote pose="avatar-ola" size={128} className="w-32 shrink-0" />
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
                className="t-label mt-3 inline-flex min-h-12 items-center gap-2 rounded-md bg-[#1f7a4d] px-4 text-white"
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
        <Section title="Perguntas rápidas">
          <Card className="divide-y divide-line">
            {FAQ.map((f, i) => (
              <div key={f.q}>
                <button
                  type="button"
                  aria-expanded={open === i}
                  onClick={() => setOpen(open === i ? null : i)}
                  className="flex min-h-16 w-full items-center gap-3 px-4 text-left font-semibold hover:bg-hover"
                >
                  <span className="flex-1">{f.q}</span>
                  <CaretDown
                    className={`size-5 shrink-0 text-muted transition-transform ${open === i ? 'rotate-180' : ''}`}
                  />
                </button>
                {open === i ? <p className="t-body px-4 pb-4 text-muted">{f.a}</p> : null}
              </div>
            ))}
          </Card>
        </Section>
      </div>
    </PageBody>
  );
}
