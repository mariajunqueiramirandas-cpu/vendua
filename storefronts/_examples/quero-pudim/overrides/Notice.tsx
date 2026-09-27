import { X } from 'lucide-react';
import type { Notice, NoticeAction } from '@vendua/kernel';

/** system.Notice override — Kernel falls back to it per notice kind, so this must handle every kind gracefully. */

function actionHref(a: NoticeAction): { label: string; href: string } | null {
  if (a.type === 'link' && typeof a.href === 'string') return { label: a.label, href: a.href };
  const rec = a as Record<string, unknown>;
  if (typeof rec.href === 'string') return { label: a.label, href: rec.href };
  return null;
}

export default function BrandNotice(props: Record<string, unknown>) {
  const notice = props.notice as Notice;
  const onDismiss = props.onDismiss as (() => void) | undefined;
  if (!notice) return null;

  const severity =
    notice.kind === 'emergency'
      ? 'blocking'
      : ['info', 'warning', 'blocking'].includes(String(notice.severity))
        ? String(notice.severity)
        : 'info';
  const links = (notice.actions ?? [])
    .map(actionHref)
    .filter((x): x is NonNullable<typeof x> => x != null);

  return (
    <div
      className="qp-notice"
      data-tone={severity}
      role={severity === 'blocking' ? 'alertdialog' : 'status'}
      aria-modal={severity === 'blocking' || undefined}
    >
      <div className="qp-notice-body">
        <strong className="qp-notice-title">{notice.title}</strong>
        {notice.body ? <p className="qp-notice-text">{notice.body}</p> : null}
        {links.length > 0 ? (
          <p className="qp-notice-links">
            {links.map((l, i) => (
              <a key={i} href={l.href} className="qp-notice-link">
                {l.label}
              </a>
            ))}
          </p>
        ) : null}
      </div>
      {notice.dismissible && onDismiss ? (
        <button
          type="button"
          className="qp-notice-dismiss"
          aria-label="Dispensar aviso"
          onClick={onDismiss}
        >
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
