import type { Notice, NoticeAction, SlotProps } from '@vendua/kernel';
import { dateTime } from './format.ts';

// system.* defaults — the generic notice is THE fallback for every future kind
// (05 — forward-compatibility rules), so it must read well for anything.

const SEVERITIES = new Set(['info', 'warning', 'blocking']);

export function noticeSeverity(n: Notice): 'info' | 'warning' | 'blocking' {
  if (n.kind === 'emergency') return 'blocking';
  const s = String(n.severity);
  return SEVERITIES.has(s) ? (s as 'info' | 'warning' | 'blocking') : 'info';
}

/** Unknown action types degrade to a link when they carry an href, else are omitted. */
export function noticeLinks(n: Notice): { label: string; href: string; action: NoticeAction }[] {
  return (n.actions ?? []).slice(0, 2).flatMap((a) => {
    const href = (a as Record<string, unknown>).href;
    return typeof href === 'string' && typeof a.label === 'string'
      ? [{ label: a.label, href, action: a }]
      : [];
  });
}

function Dismiss({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      type="button"
      className="v-notice-dismiss"
      data-part="dismiss"
      aria-label="Dispensar aviso"
      onClick={onDismiss}
    >
      ×
    </button>
  );
}

export function NoticeCard({
  notice,
  onDismiss,
  onAction,
  extra,
}: SlotProps['system.Notice'] & { extra?: React.ReactNode }) {
  const severity = noticeSeverity(notice);
  const links = noticeLinks(notice);
  return (
    <div
      className={`v-notice v-notice-${severity}`}
      data-vendua="notice"
      data-part="root"
      data-kind={notice.kind}
      data-severity={severity}
      role={severity === 'blocking' ? 'alertdialog' : 'status'}
      aria-modal={severity === 'blocking' || undefined}
      aria-labelledby={`vn-${notice.id}`}
    >
      <strong className="v-notice-title" data-part="title" id={`vn-${notice.id}`}>
        {notice.title || 'Aviso'}
      </strong>
      {notice.body ? (
        <p className="v-notice-body" data-part="body">
          {notice.body}
        </p>
      ) : null}
      {extra}
      {links.length > 0 ? (
        <p className="v-notice-actions" data-part="actions">
          {links.map((l, i) => (
            <a
              key={i}
              className="v-notice-action"
              href={l.href}
              onClick={() => onAction?.(l.action)}
            >
              {l.label}
            </a>
          ))}
        </p>
      ) : null}
      {notice.dismissible && onDismiss && severity !== 'blocking' ? (
        <Dismiss onDismiss={onDismiss} />
      ) : null}
    </div>
  );
}

export function PauseNotice({
  notice,
  resumesAt,
  onNotifyMe,
  onDismiss,
}: SlotProps['system.PauseNotice']) {
  return (
    <NoticeCard
      notice={notice}
      {...(onDismiss ? { onDismiss } : {})}
      extra={
        <>
          {resumesAt ? (
            <p className="v-notice-meta" data-part="resumes">
              Volta {dateTime(resumesAt)}
            </p>
          ) : null}
          {onNotifyMe ? (
            <button
              type="button"
              className="v-btn v-btn-accent"
              data-part="notify"
              onClick={onNotifyMe}
            >
              Avise-me quando voltar
            </button>
          ) : null}
        </>
      }
    />
  );
}

export function StoreClosedNotice({
  notice,
  opensAt,
  onDismiss,
}: SlotProps['system.StoreClosedNotice']) {
  return (
    <NoticeCard
      notice={notice}
      {...(onDismiss ? { onDismiss } : {})}
      extra={
        opensAt && !notice.body ? (
          <p className="v-notice-meta" data-part="opens">
            Abrimos {dateTime(opensAt)}
          </p>
        ) : null
      }
    />
  );
}

export function PromoNotice(props: SlotProps['system.PromoNotice']) {
  return <NoticeCard {...props} />;
}

export function EmergencyOverlay({ notice }: SlotProps['system.EmergencyOverlay']) {
  return <NoticeCard notice={{ ...notice, severity: 'blocking', dismissible: false }} />;
}

export function ConsentBanner({ purposes, onAccept, onReject }: SlotProps['system.ConsentBanner']) {
  return (
    <section className="v-consent" data-vendua="consent" data-part="root" aria-label="Privacidade">
      <p className="v-consent-text" data-part="text">
        Usamos dados de navegação para {purposes.map((p) => p.label.toLowerCase()).join(' e ')}.
        Você escolhe.
      </p>
      <div className="v-consent-actions" data-part="actions">
        <button type="button" className="v-btn v-btn-ghost" onClick={onReject}>
          Só o essencial
        </button>
        <button
          type="button"
          className="v-btn v-btn-accent"
          onClick={() => onAccept(purposes.map((p) => p.id))}
        >
          Aceitar
        </button>
      </div>
    </section>
  );
}

export function ErrorFallback({ error, retry }: SlotProps['system.ErrorFallback']) {
  return (
    <div className="v-panel v-error" data-vendua="error-fallback" data-part="root" role="alert">
      <h2 className="v-panel-title" data-part="title">
        Algo não carregou
      </h2>
      <p className="v-muted" data-part="body">
        {error.message || 'Tente de novo em instantes.'}
      </p>
      <button type="button" className="v-btn v-btn-accent" data-part="retry" onClick={retry}>
        Tentar novamente
      </button>
    </div>
  );
}

export function NotFound({ path, homeHref }: SlotProps['system.NotFound']) {
  return (
    <main id="main" className="v-page v-not-found" data-vendua-page="not-found" data-part="root">
      <h1 className="v-page-title" data-part="title">
        Página não encontrada
      </h1>
      <p className="v-muted" data-part="body">
        O endereço <code>{path}</code> não existe nesta loja.
      </p>
      <a className="v-btn v-btn-accent" href={homeHref} data-part="home">
        Voltar para o início
      </a>
    </main>
  );
}
