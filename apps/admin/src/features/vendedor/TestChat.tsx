import { ArrowCounterClockwise, CookingPot, PaperPlaneRight } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type ThreadDetail } from '../../lib/api.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { ErrorState, messageOf } from '../../ui/feedback.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { DetailSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';
import { MiniChat } from '../../ui/vendedor/index.ts';
import { ThreadMessages, useFollow } from './Conversation.parts.tsx';
import { useAgentName } from './Conversation.tsx';

// she answers through the same runtime as a real shopper, a few seconds later
const WAIT_MS = 90_000;

const STARTERS = ['oi, o que vocês têm hoje?', 'quanto fica a entrega?', 'quero fazer um pedido'];

/** the owner's last message still has no answer from her */
function awaiting(d: ThreadDetail | undefined, now = Date.now()) {
  const last = d?.messages.filter((m) => m.status !== 'draft').at(-1);
  return !!last && last.author === 'shopper' && now - new Date(last.at).getTime() < WAIT_MS;
}

/**
 * "Testar como cliente" (sales-agent-ux §3.12 "Peça para mim"): the owner chats with the real
 * Vendedor on the real menu, as a shopper. The order is checked the way checkout checks it but
 * stops before it exists, so nothing reaches the kitchen; the screen says so up front.
 */
export default function TestChat() {
  const qc = useQueryClient();
  const name = useAgentName();
  const q = useQuery({
    queryKey: qk.vendedor.testChat,
    queryFn: api.vendedor.testChat,
    // her answer lands a few seconds after: look again while one is due
    refetchInterval: (query) => (awaiting(query.state.data) ? 1500 : false),
  });
  const d = q.data;
  const [text, setText] = useState('');
  const put = (next: ThreadDetail) => qc.setQueryData(qk.vendedor.testChat, next);
  const send = useMutation({
    mutationFn: (t: string) => api.vendedor.sendTest(t),
    onSuccess: (r) => {
      put(r);
      setText('');
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const reset = useMutation({
    mutationFn: () => api.vendedor.resetTest(),
    onSuccess: (r) => {
      put(r);
      toast('Conversa de teste apagada. Pode começar de novo.');
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const waiting = awaiting(d);
  const last = d?.messages.at(-1);
  const silent =
    !!last && last.author === 'shopper' && !waiting && d!.messages.length > 0 && !send.isPending;
  useFollow(null, d?.messages.length ?? 0, !!d?.messages.length);

  const submit = (t: string) => {
    const v = t.trim();
    if (!v || send.isPending) return;
    send.mutate(v);
  };

  return (
    <PageBody>
      <PageHeader
        title="Testar como cliente"
        back="/vendedor"
        subtitle={`Peça como se fosse um cliente. A ${name} responde com o seu cardápio de verdade.`}
        actions={
          d?.messages.length ? (
            <Button
              variant="ghost"
              icon={<ArrowCounterClockwise weight="bold" />}
              loading={reset.isPending}
              onClick={() => reset.mutate()}
            >
              recomeçar
            </Button>
          ) : null
        }
      />
      <Notice
        tone="info"
        icon={<CookingPot weight="bold" />}
        title="Nada vai para a cozinha"
        className="mb-4"
      >
        O pedido é conferido como no site, mas para antes de existir. Ninguém é cobrado e o resumo
        vem marcado como pedido de teste.
      </Notice>
      {q.error ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : !d ? (
        <DetailSkeleton />
      ) : (
        <MiniChat
          name={name}
          owner
          label="teste · só você vê"
          typing={waiting || send.isPending}

          composer={
            <div className="flex flex-col gap-3">
              {!d.messages.length ? (
                <div className="flex flex-col gap-2">
                  <p className="t-caption text-muted">Para começar, toque numa ou escreva a sua:</p>
                  <div className="flex flex-wrap gap-2">
                    {STARTERS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => submit(s)}
                        className="press t-label h-12 rounded-full bg-surface px-4 text-[0.875rem] ring-1 ring-inset ring-line-strong hover:bg-hover"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {silent ? (
                <p className="t-caption text-muted" role="status">
                  A {name} ainda não respondeu. Mande de novo ou recomece a conversa.
                </p>
              ) : null}
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit(text);
                }}
              >
                <label className="sr-only" htmlFor="test-msg">
                  sua mensagem, como cliente
                </label>
                <textarea
                  id="test-msg"
                  rows={1}
                  value={text}
                  maxLength={1000}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      submit(text);
                    }
                  }}
                  placeholder="Escreva como cliente…"
                  className="t-body-lg field-sizing-content max-h-40 min-h-12 min-w-0 flex-1 resize-none rounded-md bg-surface px-3.5 py-2.5 text-ink ring-1 ring-inset ring-line-strong placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <IconButton
                  type="submit"
                  label="enviar"
                  variant="primary"
                  disabled={!text.trim()}
                  aria-busy={send.isPending || undefined}
                >
                  <PaperPlaneRight weight="fill" />
                </IconButton>
              </form>
            </div>
          }
        >
          {d.messages.length ? (
            <ThreadMessages detail={d} name={name} asCustomer />
          ) : (
            <p className="t-body py-8 text-center text-muted">
              Aqui você é o cliente. Escreva como escreveria no WhatsApp da loja.
            </p>
          )}
        </MiniChat>
      )}
      {d?.messages.length ? (
        <Button
          variant="ghost"
          block
          icon={<ArrowCounterClockwise weight="bold" />}
          loading={reset.isPending}
          onClick={() => reset.mutate()}
          className="mt-3 md:hidden"
        >
          recomeçar a conversa
        </Button>
      ) : null}
    </PageBody>
  );
}
