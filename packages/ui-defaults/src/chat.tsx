import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { SlotProps, StoreChatMessage } from '@vendua/kernel';
import { DEFAULT_VOCABULARY, formatTime } from '@vendua/kernel/rules';
import { DUA_FACE } from './dua.ts';
import { zoneOr } from './format.ts';
import {
  MicError,
  canRecord,
  clock,
  shrinkPhoto,
  startRecording,
  type Recording,
} from './chat-media.ts';

// system.Chat — the store's assistant on the site (Kernel 1.18): a launcher in the bottom
// corner and the conversation as a modal dialog. The Kernel reads, polls and sends; this only
// shows it, keeps focus where it belongs and announces replies. Kernel 1.24: a voice message
// (the mic, while the field is empty) and a photo (the composer's text is its caption).

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

/** Duá, the stores' assistant (ADR 0032): the mascot on a cream disc, legible on any theme. */
function Face() {
  return <img className="v-chat-face" src={DUA_FACE} alt="" width={40} height={40} />;
}

function Glyph({ d, size = 22 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
const MIC =
  'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21';
const PHOTO =
  'M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.4-2h5l1.4 2h1.6A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5ZM12 16a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z';
const CROSS = 'M6 6l12 12M18 6 6 18';
const TRASH = 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12';

/** what a voice message or a photo looked like when sent: the shopper's photo isn't served back */
function MediaTag({ kind }: { kind: 'voice' | 'image' }) {
  return (
    <span className="v-chat-media" data-part="media" data-kind={kind}>
      <Glyph d={kind === 'voice' ? MIC : PHOTO} size={16} />
      {kind === 'voice' ? 'Mensagem de voz' : 'Foto'}
    </span>
  );
}

/** the composer's voice message: being recorded, or recorded and not sent yet (a failed send) */
type Voice =
  { phase: 'starting' } | { phase: 'recording' } | { phase: 'held'; blob: Blob; seconds: number };

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
  media,
  onSendVoice,
  onSendPhoto,
  maxVoiceSeconds = 60,
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
  const fileRef = useRef<HTMLInputElement>(null);
  const recSendRef = useRef<HTMLButtonElement>(null);
  const recording = useRef<Recording | null>(null);
  const startedAt = useRef(0);
  /** the chat is open and mounted: a mic that opens after that is closed again at once */
  const live = useRef(open);
  live.current = open;
  const [voice, setVoice] = useState<Voice | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [reading, setReading] = useState(false);
  /** a line of this UI's own (the mic refused, a photo it can't open); the Kernel's `error` else */
  const [note, setNote] = useState<string | null>(null);
  // MediaRecorder exists only in the browser: decided after mount, so server HTML matches
  const [recorder, setRecorder] = useState(false);
  useEffect(() => setRecorder(canRecord()), []);
  const voiceOn = !!(media?.voice && onSendVoice && recorder);
  const photoOn = !!(media?.image && onSendPhoto);
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

  const cancelVoice = () => {
    recording.current?.cancel();
    recording.current = null;
    setVoice(null);
  };
  const sendTake = async (blob: Blob, seconds: number) => {
    setVoice({ phase: 'held', blob, seconds });
    if (await onSendVoice!(blob, seconds)) setVoice(null);
  };
  const finishVoice = async () => {
    const r = recording.current;
    if (!r) return;
    recording.current = null;
    const take = await r.stop();
    if (take) await sendTake(take.blob, take.seconds);
    else setVoice(null);
  };
  const startVoice = async () => {
    if (voice || sending) return;
    setNote(null);
    setVoice({ phase: 'starting' });
    try {
      const r = await startRecording();
      if (!live.current) {
        r.cancel();
        setVoice(null);
        return;
      }
      recording.current = r;
      startedAt.current = Date.now();
      setElapsed(0);
      setVoice({ phase: 'recording' });
    } catch (err) {
      setVoice(null);
      setNote(
        err instanceof MicError && err.reason === 'denied'
          ? 'Permita o uso do microfone para gravar um áudio.'
          : 'Não deu para usar o microfone. Escreva sua mensagem.',
      );
    }
  };

  // the clock while recording; at the cap the take goes by itself
  const finishRef = useRef(finishVoice);
  finishRef.current = finishVoice;
  const isRecording = voice?.phase === 'recording';
  useEffect(() => {
    if (!isRecording) return;
    const t = setInterval(() => {
      const s = (Date.now() - startedAt.current) / 1000;
      setElapsed(s);
      if (s >= maxVoiceSeconds) void finishRef.current();
    }, 250);
    return () => clearInterval(t);
  }, [isRecording, maxVoiceSeconds]);

  // the recording row takes the field's place: focus follows it there and back
  const hasVoice = !!voice;
  const hadVoice = useRef(false);
  useEffect(() => {
    if (hasVoice) recSendRef.current?.focus({ preventScroll: true });
    else if (hadVoice.current && open) inputRef.current?.focus({ preventScroll: true });
    hadVoice.current = hasVoice;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasVoice]);

  // closing the chat (or leaving the page) drops a recording and frees the mic
  useEffect(() => {
    if (!open && recording.current) cancelVoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(
    () => () => {
      live.current = false;
      recording.current?.cancel();
    },
    [],
  );
  const photoUrl = photo?.url;
  useEffect(() => (photoUrl ? () => URL.revokeObjectURL(photoUrl) : undefined), [photoUrl]);

  const pickPhoto = () => {
    if (reading) return;
    setNote(null);
    fileRef.current?.click();
  };
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type && !file.type.startsWith('image/')) {
      setNote('Escolha uma foto.');
      return;
    }
    setReading(true);
    try {
      const blob = await shrinkPhoto(file);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch {
      setNote('Não deu para abrir essa foto. Tente outra.');
    } finally {
      setReading(false);
    }
    inputRef.current?.focus({ preventScroll: true });
  };
  const removePhoto = () => {
    setPhoto(null);
    inputRef.current?.focus({ preventScroll: true });
  };

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
    if (sending || reading || voice) return;
    if (photo && onSendPhoto) {
      setNote(null);
      if (await onSendPhoto(photo.blob, text.trim() || undefined)) {
        setText('');
        setPhoto(null);
      }
      return;
    }
    if (!text.trim()) return;
    setNote(null);
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
  const showMic = voiceOn && empty && !photo;
  const line = note ?? error;
  const shown = voice?.phase === 'held' ? voice.seconds : elapsed;

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
        <Face />
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
              <Face />
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
              const kind = m.kind === 'voice' || m.kind === 'image' ? m.kind : null;
              return (
                <li
                  key={m.id}
                  className="v-chat-msg"
                  data-part="message"
                  data-author={side(m.author)}
                  data-card={m.card ?? undefined}
                  data-kind={kind ?? undefined}
                  data-run={start ? 'start' : end ? 'end' : undefined}
                >
                  <span className={showAuthor ? 'v-chat-author' : 'v-sr'} data-part="author">
                    {label(m.author)}
                    <span className="v-sr">:</span>
                  </span>
                  <p className="v-chat-bubble" data-part="body">
                    {kind ? <MediaTag kind={kind} /> : null}
                    {m.body ? <Body text={m.body} resolveLink={resolveLink} /> : null}
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
          {line ? (
            <p className="v-chat-error" data-part="error" role="alert">
              {line}
            </p>
          ) : null}
          <form
            className="v-chat-composer"
            data-part="composer"
            data-state={voice ? 'voice' : photo ? 'photo' : undefined}
            onSubmit={submit}
          >
            {photo && !voice ? (
              <div className="v-chat-attachment" data-part="attachment" data-kind="image">
                <img className="v-chat-attachment-thumb" src={photo.url} alt="" />
                <span className="v-chat-attachment-label">
                  Foto
                  <span className="v-chat-attachment-hint">A mensagem vai como legenda</span>
                </span>
                <button
                  type="button"
                  className="v-chat-icon-btn"
                  data-part="attachment-remove"
                  aria-label="Remover foto"
                  onClick={removePhoto}
                >
                  <Glyph d={CROSS} size={20} />
                </button>
              </div>
            ) : null}
            {voice ? (
              <div
                className="v-chat-recording"
                data-part="recording"
                data-state={voice.phase === 'held' ? 'held' : 'recording'}
                role="group"
                aria-label={
                  voice.phase === 'held'
                    ? 'Mensagem de voz não enviada'
                    : 'Gravando mensagem de voz'
                }
              >
                <button
                  type="button"
                  className="v-chat-icon-btn"
                  data-part="recording-cancel"
                  aria-label="Descartar áudio"
                  onClick={cancelVoice}
                >
                  <Glyph d={TRASH} size={20} />
                </button>
                {voice.phase === 'held' ? (
                  <span className="v-chat-rec-glyph" aria-hidden="true">
                    <Glyph d={MIC} size={18} />
                  </span>
                ) : (
                  <span className="v-chat-rec-dot" data-part="recording-dot" aria-hidden="true" />
                )}
                <span className="v-chat-rec-time" data-part="recording-time">
                  <span className="v-sr">
                    {voice.phase === 'held' ? 'Áudio de ' : 'Gravando: '}
                  </span>
                  {clock(shown)}
                  {voice.phase === 'held' ? null : (
                    <span className="v-chat-rec-max" aria-hidden="true">
                      {' '}
                      / {clock(maxVoiceSeconds)}
                    </span>
                  )}
                </span>
                <button
                  ref={recSendRef}
                  type="button"
                  className="v-chat-send"
                  data-part="recording-send"
                  aria-label="Enviar mensagem de voz"
                  aria-disabled={voice.phase === 'starting' || sending || undefined}
                  aria-busy={sending || undefined}
                  onClick={() => {
                    if (sending) return;
                    if (voice.phase === 'held') void sendTake(voice.blob, voice.seconds);
                    else if (voice.phase === 'recording') void finishVoice();
                  }}
                >
                  <SendIcon />
                </button>
              </div>
            ) : (
              <>
                {photoOn ? (
                  <>
                    <button
                      type="button"
                      className="v-chat-icon-btn v-chat-photo"
                      data-part="photo"
                      aria-label={photo ? 'Trocar foto' : 'Enviar foto'}
                      aria-busy={reading || undefined}
                      onClick={pickPhoto}
                    >
                      <Glyph d={PHOTO} />
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      name="chat-photo"
                      accept="image/*"
                      hidden
                      tabIndex={-1}
                      onChange={onFile}
                    />
                  </>
                ) : null}
                <label className="v-sr" htmlFor={`${id}-input`}>
                  {photo ? 'Legenda da foto' : `Mensagem para ${assistant.name}`}
                </label>
                <textarea
                  ref={inputRef}
                  id={`${id}-input`}
                  className="v-chat-input"
                  name="chat-message"
                  rows={1}
                  maxLength={maxLength}
                  value={text}
                  placeholder={photo ? 'Legenda (opcional)' : 'Escreva sua mensagem'}
                  enterKeyHint="send"
                  autoComplete="off"
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKey}
                />
                {showMic ? (
                  <button
                    type="button"
                    className="v-chat-send"
                    data-part="mic"
                    aria-label="Gravar mensagem de voz"
                    aria-disabled={sending || undefined}
                    onClick={() => void startVoice()}
                  >
                    <Glyph d={MIC} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="v-chat-send"
                    data-part="send"
                    aria-label={photo ? 'Enviar foto' : 'Enviar mensagem'}
                    aria-disabled={(empty && !photo) || sending || reading || undefined}
                    aria-busy={sending || undefined}
                  >
                    <SendIcon />
                  </button>
                )}
                {left <= 100 ? (
                  <span className="v-chat-count" data-part="count">
                    {left === 1 ? 'Resta 1 caractere' : `Restam ${left} caracteres`}
                  </span>
                ) : null}
              </>
            )}
          </form>
          <p className="v-chat-note" data-part="note" id={`${id}-note`}>
            {assistant.name} pode montar {yourBag} com você. O pedido só sai quando você finaliza.
          </p>
        </section>
      </dialog>
    </div>
  );
}
