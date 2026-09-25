import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bot, Send } from 'lucide-react';
import { api, type ThreadView } from '@/lib/api.ts';
import { errorMessage } from '@/lib/query.ts';
import { Button } from '@/components/ui/button.tsx';
import { Kbd, Tooltip } from '@/components/ui/controls.tsx';
import { Input, Textarea } from '@/components/ui/input.tsx';
import { CH_LABEL } from './channel.ts';
import { useSendMessage } from './queries.ts';

// unsent text survives switching threads for the session
const unsent = new Map<string, string>();

/** Mount with `key={threadId}` — all state here belongs to one thread. */
export function Composer({ view }: { view: ThreadView }) {
  const { thread, lead } = view;
  const [text, setText] = useState(() => unsent.get(thread.id) ?? '');
  const subjRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const send = useSendMessage();

  useEffect(() => {
    if (text) unsent.set(thread.id, text);
    else unsent.delete(thread.id);
  }, [text, thread.id]);

  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [text]);

  const submit = (asDraft: boolean) => {
    if (!text.trim() || send.isPending) return;
    const subject = subjRef.current?.value.trim();
    send.mutate(
      {
        threadId: thread.id,
        body: text,
        send: !asDraft,
        ...(subject ? { subject } : {}),
      },
      { onSuccess: () => setText('') },
    );
  };

  const assist = useSuggest(view);
  const suggestBlock = lead.agentPausedAt
    ? 'agente pausado neste lead (handoff) — retome no card do lead'
    : !thread.agentEnabled
      ? 'agente pausado nesta conversa — reative o toggle acima para pedir sugestão'
      : null;

  return (
    <div className="shrink-0 border-t bg-background">
      <div className="mx-auto flex max-w-3xl flex-col gap-1.5 px-3 py-2 md:px-4">
        {thread.channel === 'email' && (
          <Input
            ref={subjRef}
            defaultValue={thread.subject ?? ''}
            placeholder="assunto do email"
            aria-label="assunto do email"
            maxLength={200}
          />
        )}
        <Textarea
          ref={taRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            submit(e.shiftKey);
          }}
          placeholder={`responder via ${CH_LABEL[thread.channel] ?? thread.channel}…`}
          aria-label="mensagem"
          className="max-h-48 min-h-10 resize-none"
        />
        <div className="flex items-center gap-1.5">
          <Tooltip
            content={suggestBlock ?? 'o agente lê a conversa e deixa um rascunho — nada é enviado'}
          >
            {/* span keeps the tooltip reachable while the button is disabled */}
            <span className="inline-flex">
              <Button
                size="sm"
                variant="ghost"
                onClick={assist.run}
                disabled={assist.busy || !!suggestBlock}
                aria-label={suggestBlock ?? 'agente sugere'}
              >
                <Bot /> {assist.busy ? 'escrevendo…' : 'agente sugere'}
              </Button>
            </span>
          </Tooltip>
          <span className="hidden truncate text-[11px] text-muted-foreground lg:inline">
            <Kbd>ctrl+enter</Kbd> envia · <Kbd>shift+ctrl+enter</Kbd> rascunho
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => submit(true)}
              disabled={!text.trim() || send.isPending}
            >
              rascunho
            </Button>
            <Button
              size="sm"
              onClick={() => submit(false)}
              disabled={!text.trim() || send.isPending}
            >
              <Send /> enviar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * draftOnly run bound to this thread — 'reply' when an inbound exists, 'outreach'
 * otherwise. Busy until a new agent draft lands (SSE refreshes the thread) or 90s pass.
 */
function useSuggest(view: ThreadView) {
  const agentDrafts = view.messages.filter(
    (m) => m.author === 'agent' && m.status === 'draft',
  ).length;
  const [wait, setWait] = useState<{ before: number; until: number } | null>(null);

  useEffect(() => {
    if (wait && agentDrafts > wait.before) setWait(null);
  }, [wait, agentDrafts]);
  useEffect(() => {
    if (!wait) return;
    const t = setTimeout(() => setWait(null), Math.max(0, wait.until - Date.now()));
    return () => clearTimeout(t);
  }, [wait]);

  const m = useMutation({
    mutationFn: () => {
      const kind = view.messages.some((x) => x.direction === 'in') ? 'reply' : 'outreach';
      return api.runOnLead(view.lead.id, kind, { draftOnly: true }, view.thread.id);
    },
    onError: (e) => {
      setWait(null);
      toast.error(errorMessage(e));
    },
  });

  return {
    busy: m.isPending || !!wait,
    run: () => {
      if (m.isPending || wait) return;
      setWait({ before: agentDrafts, until: Date.now() + 90_000 });
      m.mutate();
    },
  };
}
