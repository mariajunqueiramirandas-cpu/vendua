import { CaretDown, ChatCircleText, Keyboard } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { matchRoute } from '../../app/routes.ts';
import { api } from '../../lib/api.ts';
import { qk } from '../../lib/query.ts';
import { ButtonLink } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { Sheet } from '../../ui/Sheet.tsx';
import { IncidentNotice, openIncidents } from './status.tsx';
import { topicFor, TOPICS, type Topic } from './topics.tsx';

/** The help for the screen you're on, opened by "ajuda" in the page header or the "?" key. */
export default function HelpSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const loc = useLocation();
  const id = topicFor(matchRoute(loc.pathname)?.r.id);
  // keep the topic that was open while the sheet animates away after a link inside it
  const [shown, setShown] = useState(id);
  useEffect(() => {
    if (open) setShown(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // a link inside the help (or back) moved to another screen: the sheet goes with it
  const path = useRef(loc.pathname);
  useEffect(() => {
    if (path.current === loc.pathname) return;
    path.current = loc.pathname;
    if (open) onOpenChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);
  const topic = shown ? TOPICS[shown] : null;
  const status = useQuery({
    queryKey: qk.helpStatus,
    queryFn: api.helpStatus,
    staleTime: 60_000,
    enabled: open,
  });
  const incident = openIncidents(status.data?.incidents)[0];
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={topic ? `Ajuda: ${topic.title}` : 'Ajuda'}
      description={topic?.intro ?? 'Respostas rápidas e como falar com a Venduá.'}
      footer={
        <ButtonLink
          to={shown ? `/ajuda?tela=${shown}` : '/ajuda'}
          variant="secondary"
          size="lg"
          block
          icon={<ChatCircleText />}
        >
          falar com a Venduá
        </ButtonLink>
      }
    >
      <div className="space-y-5 pt-2">
        {incident ? <IncidentNotice incident={incident} compact /> : null}
        {topic ? (
          <TopicAnswers topic={topic} key={shown} />
        ) : (
          <p className="t-body text-muted">
            Escolha um assunto na página de ajuda ou mande sua dúvida para a equipe.
          </p>
        )}
        <Shortcuts />
      </div>
    </Sheet>
  );
}

export function TopicAnswers({ topic, first = 0 }: { topic: Topic; first?: number | null }) {
  const [open, setOpen] = useState<number | null>(first);
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-md ring-1 ring-line">
      {topic.items.map((f, i) => (
        <li key={f.q}>
          <button
            type="button"
            aria-expanded={open === i}
            onClick={() => setOpen(open === i ? null : i)}
            className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left font-semibold hover:bg-hover"
          >
            <span className="flex-1">{f.q}</span>
            <CaretDown
              aria-hidden
              className={cn(
                'size-5 shrink-0 text-muted transition-transform',
                open === i && 'rotate-180',
              )}
            />
          </button>
          {open === i ? <div className="t-body px-4 pb-4 text-muted">{f.a}</div> : null}
        </li>
      ))}
    </ul>
  );
}

const KEYS: [string, string][] = [
  ['/', 'buscar pedidos, produtos e clientes'],
  ['?', 'abrir esta ajuda'],
  ['A', 'aceitar o pedido selecionado'],
  ['→', 'levar o pedido selecionado adiante'],
  ['Enter', 'abrir o pedido selecionado'],
];

// the Vendedor's inbox reads A and the arrows its own way (sales-agent-ux §3.10)
const INBOX_KEYS: [string, string][] = [
  ['/', 'buscar nas conversas'],
  ['?', 'abrir esta ajuda'],
  ['J / K', 'próxima / anterior conversa'],
  ['A', 'assumir a conversa aberta'],
  ['D', 'devolver ao Vendedor'],
];

/** Keyboard shortcuts (§10), for the computer at the counter. */
function Shortcuts() {
  const inbox = useLocation().pathname.includes('/vendedor/conversas');
  const keys = inbox ? INBOX_KEYS : KEYS;
  return (
    <section aria-labelledby="help-keys" className="hidden md:block">
      <h3 id="help-keys" className="t-label mb-2 inline-flex items-center gap-2">
        <Keyboard className="size-5 text-muted" aria-hidden /> Atalhos no computador
      </h3>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
        {keys.map(([k, v]) => (
          <div key={k} className="contents">
            <dt>
              <kbd className="t-caption inline-grid h-7 min-w-7 place-items-center rounded-sm bg-sunken px-2 font-semibold ring-1 ring-line-strong">
                {k}
              </kbd>
            </dt>
            <dd className="t-body text-muted">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
