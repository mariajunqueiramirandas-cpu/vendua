import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { SlotProps, StoreChatMessage } from '@vendua/kernel';
import { DEFAULT_VOCABULARY, formatTime } from '@vendua/kernel/rules';
import { zoneOr } from './format.ts';

// system.Chat — the store's assistant on the site (Kernel 1.18): a launcher in the bottom
// corner and the conversation as a modal dialog. The Kernel reads, polls and sends; this only
// shows it, keeps focus where it belongs and announces replies.

type Props = SlotProps['system.Chat'];

const URLISH = /^(?:https?:\/\/\S+|\/(?!\/)\S*)$/i;

/** the message's text, with the URLs the Kernel resolves on this origin made tappable */
function Body({
  text,
  resolveLink,
}: {
  text: string;
  resolveLink: Props['resolveLink'];
}): ReactNode {
  if (!resolveLink) return text;
  return text.split(/(\s+)/).map((tok, i) => {
    const m = /^(.*?)([.,;:!?)\]]*)$/s.exec(tok);
    const raw = m?.[1] ?? '';
    if (!raw || !URLISH.test(raw)) return tok;
    const href = resolveLink(raw);
    if (!href) return tok;
    return (
      <Fragment key={i}>
        <a className="v-chat-link" data-part="link" href={href}>
          {raw.replace(/^https?:\/\//i, '')}
        </a>
        {m?.[2]}
      </Fragment>
    );
  });
}

const side = (a: StoreChatMessage['author']) => (a === 'shopper' ? 'shopper' : a);
const run = (a: StoreChatMessage['author']) => (a === 'core' ? 'agent' : a);

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path
        d="M5 12h13M13 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StoreChat({
  assistant,
  messages,
  pending,
  open,
  onOpen,
  onClose,
  onSend,
  sending,
  error,
  unread = 0,
  maxLength = 1000,
  resolveLink,
  storeName,
  timeZone,
  vocabulary,
}: Props) {
  const id = useId();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const wasOpen = useRef(false);
  const [text, setText] = useState('');
  const [announce, setAnnounce] = useState('');
  const zone = zoneOr(timeZone);
  const yourBag = (vocabulary ?? DEFAULT_VOCABULARY).yourBag.toLocaleLowerCase('pt-BR');

  // open as a modal dialog (top layer, the page inert behind it); closing hands focus back
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open) {
      if (!d.open) {
        try {
          d.showModal();
        } catch {
          d.setAttribute('open', '');
        }
      }
      // a touch screen keeps its keyboard down until the shopper taps the field
      const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
      (coarse ? titleRef.current : inputRef.current)?.focus({ preventScroll: true });
    } else if (d.open) {
      try {
        d.close();
      } catch {
        d.removeAttribute('open');
      }
      if (wasOpen.current) launcherRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);

  // the newest message in view
  const last = messages[messages.length - 1];
  useEffect(() => {
    const l = listRef.current;
    if (open && l) l.scrollTop = l.scrollHeight;
  }, [open, last?.id, pending]);

  // replies are announced politely, once each (not the ones already there on load)
  const lastReply = [...messages].reverse().find((m) => m.author !== 'shopper');
  const announced = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const idNow = lastReply?.id ?? null;
    if (announced.current === undefined) {
      announced.current = idNow;
      return;
    }
    if (!lastReply || idNow === announced.current) return;
    announced.current = idNow;
    setAnnounce(
      open
        ? `${label(lastReply.author)}: ${lastReply.body}`
        : `Nova mensagem de ${assistant.name}.`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastReply?.id]);

  function label(a: StoreChatMessage['author']) {
    if (a === 'shopper') return 'Você';
    if (a === 'merchant') return storeName ?? 'Loja';
    return assistant.name;
  }

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (sending || !text.trim()) return;
    if (await onSend(text)) setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };
  const empty = !text.trim();
  const left = maxLength - text.length;

  return (
    <div
      className="v-chat"
      data-vendua="chat"
      data-part="root"
      data-state={open ? 'open' : 'closed'}
    >
      <button
        ref={launcherRef}
        type="button"
        className="v-chat-launcher"
        data-part="launcher"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-dialog`}
        aria-label={`Conversar com ${assistant.name}, assistente da loja${
          unread > 0 ? ` (${unread} ${unread === 1 ? 'nova mensagem' : 'novas mensagens'})` : ''
        }`}
        onClick={onOpen}
      >
        <ChatIcon />
        <span className="v-chat-launcher-label" data-part="launcher-label" aria-hidden="true">
          {assistant.name}
        </span>
        {unread > 0 ? (
          <span className="v-chat-unread" data-part="unread" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>
      {/* showModal() makes everything outside the dialog inert, so while it is open the
          announcement is spoken from inside it */}
      <p className="v-sr" aria-live="polite" data-part={open ? undefined : 'announce'}>
        {open ? '' : announce}
      </p>
      <dialog
        ref={dialogRef}
        id={`${id}-dialog`}
        className="v-chat-dialog"
        data-part="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-note`}
        onCancel={(e) => {
          e.preventDefault();
          onClose();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <p className="v-sr" aria-live="polite" data-part={open ? 'announce' : undefined}>
          {open ? announce : ''}
        </p>
        <section className="v-chat-panel" data-part="panel">
          <header className="v-chat-head" data-part="head">
            <span className="v-chat-avatar" data-part="avatar" aria-hidden="true">
              {assistant.name.trim().charAt(0).toLocaleUpperCase('pt-BR')}
            </span>
            <div className="v-chat-who">
              <h2
                className="v-chat-title"
                data-part="title"
                id={`${id}-title`}
                ref={titleRef}
                tabIndex={-1}
              >
                {assistant.name}
              </h2>
              <p className="v-chat-subtitle" data-part="subtitle">
                Assistente da loja
              </p>
            </div>
            <button
              type="button"
              className="v-chat-close"
              data-part="close"
              aria-label="Fechar conversa"
              onClick={onClose}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
                <path
                  d="M6 6l12 12M18 6 6 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </header>
          <ol className="v-chat-log" data-part="messages" ref={listRef} aria-label="Conversa">
            <li className="v-chat-msg" data-part="intro" data-author="agent" data-run="start">
              <span className="v-chat-author" data-part="author">
                {assistant.name}
              </span>
              <p className="v-chat-bubble" data-part="body">
                Oi! Aqui é {assistant.intro}. Como posso ajudar?
              </p>
            </li>
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const next = messages[i + 1];
              const start = !prev || run(prev.author) !== run(m.author) || i === 0;
              const end = !next || run(next.author) !== run(m.author);
              const showAuthor = start && !(i === 0 && run(m.author) === 'agent');
              return (
                <li
                  key={m.id}
                  className="v-chat-msg"
                  data-part="message"
                  data-author={side(m.author)}
                  data-card={m.card ?? undefined}
                  data-run={start ? 'start' : end ? 'end' : undefined}
                >
                  <span className={showAuthor ? 'v-chat-author' : 'v-sr'} data-part="author">
                    {label(m.author)}
                    <span className="v-sr">:</span>
                  </span>
                  <p className="v-chat-bubble" data-part="body">
                    <Body text={m.body} resolveLink={resolveLink} />
                  </p>
                  <time className={end ? 'v-chat-time' : 'v-sr'} data-part="time" dateTime={m.at}>
                    {formatTime(m.at, zone)}
                  </time>
                </li>
              );
            })}
            {pending ? (
              <li className="v-chat-msg" data-part="typing" data-author="agent">
                <span className="v-chat-bubble v-chat-typing">
                  <span className="v-chat-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  {assistant.name} está digitando…
                </span>
              </li>
            ) : null}
          </ol>
          {error ? (
            <p className="v-chat-error" data-part="error" role="alert">
              {error}
            </p>
          ) : null}
          <form className="v-chat-composer" data-part="composer" onSubmit={submit}>
            <label className="v-sr" htmlFor={`${id}-input`}>
              Mensagem para {assistant.name}
            </label>
            <textarea
              ref={inputRef}
              id={`${id}-input`}
              className="v-chat-input"
              name="chat-message"
              rows={1}
              maxLength={maxLength}
              value={text}
              placeholder="Escreva sua mensagem"
              enterKeyHint="send"
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
            />
            <button
              type="submit"
              className="v-chat-send"
              data-part="send"
              aria-label="Enviar mensagem"
              aria-disabled={empty || sending || undefined}
              aria-busy={sending || undefined}
            >
              <SendIcon />
            </button>
            {left <= 100 ? (
              <span className="v-chat-count" data-part="count">
                {left === 1 ? 'Resta 1 caractere' : `Restam ${left} caracteres`}
              </span>
            ) : null}
          </form>
          <p className="v-chat-note" data-part="note" id={`${id}-note`}>
            {assistant.name} pode montar {yourBag} com você. O pedido só sai quando você finaliza.
          </p>
        </section>
      </dialog>
    </div>
  );
}
