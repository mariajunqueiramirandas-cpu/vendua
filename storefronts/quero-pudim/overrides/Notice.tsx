import { X } from 'lucide-react';
import type { SlotProps } from '@vendua/kernel';
import { isBlocking, noticeLinks, noticeSeverity } from '@vendua/kernel/rules';

/** system.Notice override — the brand's look over the Kernel's notice rules (severity, links,
 *  blocking). The Kernel falls back to it per notice kind, so it handles every kind. */
// typed loosely: an override module's default must take any slot's props (SlotComponent)
export default function BrandNotice(props: Record<string, unknown>) {
  const { notice, onDismiss, onAction } = props as SlotProps['system.Notice'];
  if (!notice) return null;
  const severity = noticeSeverity(notice);
  const blocking = isBlocking(notice);
  const links = noticeLinks(notice);

  return (
    <div
      className="qp-notice"
      data-kind={notice.kind}
      data-severity={severity}
      role={blocking ? 'alertdialog' : 'status'}
      aria-modal={blocking || undefined}
    >
      <div className="qp-notice-body">
        <strong className="qp-notice-title">{notice.title}</strong>
        {notice.body ? <p className="qp-notice-text">{notice.body}</p> : null}
        {links.length > 0 ? (
          <p className="qp-notice-links">
            {links.map((l, i) => (
              <a
                key={i}
                href={l.href}
                className="qp-notice-link"
                onClick={() => onAction?.(l.action)}
              >
                {l.label}
              </a>
            ))}
          </p>
        ) : null}
      </div>
      {/* a blocking notice is the store's state, not the shopper's to hide */}
      {notice.dismissible && onDismiss && !blocking ? (
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
